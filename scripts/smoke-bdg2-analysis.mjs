import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  InMemoryNodeCryptoProvider,
} from "@climatechain/crypto-node";
import {
  detectResidualAnomalies,
  digestMeterSeries,
  injectTamper,
  loadPreparedBuildingDataset,
  runHourOfWeekBaseline,
  verifyPreparedArtifactDigests,
} from "@climatechain/building-mrv";

const dir = process.argv[2];
if (!dir) {
  throw new Error(
    "Usage: node scripts/smoke-bdg2-analysis.mjs <prepared-dir>",
  );
}

async function optional(file) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }
}

const [meterCsv, weatherCsv, metadataJson, sourceJson] =
  await Promise.all([
    readFile(path.join(dir, "meter.csv"), "utf8"),
    optional(path.join(dir, "weather.csv")),
    readFile(path.join(dir, "metadata.json"), "utf8"),
    readFile(path.join(dir, "source.json"), "utf8"),
  ]);

const crypto = new InMemoryNodeCryptoProvider();
const input = {
  meterCsv,
  ...(weatherCsv ? { weatherCsv } : {}),
  metadataJson,
  sourceJson,
};

const integrity = await verifyPreparedArtifactDigests(input, crypto);
if (!integrity.valid) {
  throw new Error(
    "Prepared subset integrity failed: " + JSON.stringify(integrity),
  );
}

const dataset = loadPreparedBuildingDataset(input);
const baseline = runHourOfWeekBaseline(dataset.meter, 0.8);
const anomalies = detectResidualAnomalies(
  dataset.meter,
  baseline,
  6,
);

const alreadyFlagged = new Set(
  anomalies.points
    .filter((point) => point.flagged)
    .map((point) => point.timestamp),
);
const tamperIndex = dataset.meter.findIndex(
  (point, index) =>
    index >= baseline.split.trainingEndIndex &&
    point.value > 0 &&
    !alreadyFlagged.has(point.timestamp),
);
if (tamperIndex < 0) {
  throw new Error("Could not find a non-zero unflagged holdout row for tamper smoke.");
}

const tamperedMeter = injectTamper(
  dataset.meter,
  tamperIndex,
  20,
);
const tamperedBaseline = runHourOfWeekBaseline(
  tamperedMeter,
  0.8,
);
const tamperedAnomalies = detectResidualAnomalies(
  tamperedMeter,
  tamperedBaseline,
  6,
);
const cleanDigest = await digestMeterSeries(
  dataset.meter,
  crypto,
);
const tamperedDigest = await digestMeterSeries(
  tamperedMeter,
  crypto,
);

console.log(
  "CLIMATECHAIN_BDG2_SMOKE=" +
    JSON.stringify({
      source: {
        doi: dataset.source.doi,
        archive: dataset.source.archiveName,
        archiveMd5: dataset.source.publishedArchiveMd5,
      },
      building: dataset.metadata,
      rows: dataset.meter.length,
      weatherRows: dataset.weather?.length ?? 0,
      integrity,
      baseline: {
        method: baseline.method,
        split: baseline.split,
        metrics: baseline.metrics,
      },
      anomalyCheck: {
        method: anomalies.method,
        threshold: anomalies.threshold,
        flaggedCount: anomalies.flaggedCount,
        flaggedEnergyKWh: anomalies.flaggedEnergyKWh,
      },
      tamperSmoke: {
        index: tamperIndex,
        timestamp: dataset.meter[tamperIndex]?.timestamp,
        originalValue: dataset.meter[tamperIndex]?.value,
        multiplier: 20,
        tamperedValue: tamperedMeter[tamperIndex]?.value,
        flaggedAfterTamper:
          tamperedAnomalies.points[tamperIndex]?.flagged ?? false,
        cleanFlaggedCount: anomalies.flaggedCount,
        tamperedFlaggedCount: tamperedAnomalies.flaggedCount,
        cleanDigest,
        tamperedDigest,
        digestChanged:
          cleanDigest.algorithm !== tamperedDigest.algorithm ||
          cleanDigest.value !== tamperedDigest.value,
      },
    }),
);
