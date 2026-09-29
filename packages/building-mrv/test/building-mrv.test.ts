import assert from "node:assert/strict";
import test from "node:test";

import {
  createEvidenceRoot,
  verifyEvidenceRoot,
} from "@climatechain/core";
import {
  InMemoryNodeCryptoProvider,
} from "@climatechain/crypto-node";

import {
  BuildingMrvService,
  buildBuildingMrvCase,
  classificationMetrics,
  createBuildingMrvModule,
  digestMeterSeries,
  injectTamper,
  loadPreparedBuildingDataset,
  runBuildingMrv,
  verifyPreparedArtifactDigests,
  runHourOfWeekBaseline,
} from "../src/index.js";
import type {
  GridEmissionFactor,
  MeterPoint,
  PreparedBuildingDataset,
} from "../src/index.js";

function series(weeks = 10): MeterPoint[] {
  const start = Date.UTC(2017, 0, 1, 0, 0, 0);
  const count = weeks * 7 * 24;

  return Array.from({ length: count }, (_, index) => {
    const timestamp = new Date(
      start + index * 60 * 60 * 1000,
    )
      .toISOString()
      .replace(".000Z", "Z");
    const date = new Date(start + index * 60 * 60 * 1000);
    const slot = date.getUTCDay() * 24 + date.getUTCHours();
    const value =
      100 +
      (slot % 24) * 2 +
      Math.floor(slot / 24) * 5;

    return { timestamp, value };
  });
}

const factor: GridEmissionFactor = {
  id: "factor:test-grid",
  valueKgCo2ePerKwh: 0.2,
  geography: "Test grid",
  sourceOrganisation: "Test factor publisher",
  sourceUri: "https://example.invalid/grid-factor",
  sourceDocument: "Test factor 2017",
  retrievedAt: "2026-09-29T00:00:00Z",
  effectivePeriod: {
    start: "2017-01-01",
    end: "2017-12-31",
  },
};

async function dataset(
  meter: MeterPoint[],
  provider: InMemoryNodeCryptoProvider,
): Promise<PreparedBuildingDataset> {
  return {
    metadata: {
      buildingId: "Panther_test_Building",
      siteId: "Panther",
      primarySpaceUsage: "Office",
      floorAreaM2: 1000,
    },
    meter,
    source: {
      sourceManifestId: "bdg2",
      zenodoRecord: "https://zenodo.org/records/3887306",
      doi: "10.5281/zenodo.3887306",
      archiveName: "buds-lab/building-data-genome-project-2-v1.0.zip",
      publishedArchiveMd5: "44393dc4cf61e84dec105e955368c890",
      meterMember:
        "buds-lab-building-data-genome-project-2-3d0cbaf/data/meters/cleaned/electricity_cleaned.csv",
      metadataMember:
        "buds-lab-building-data-genome-project-2-3d0cbaf/data/metadata/metadata.csv",
      weatherMember:
        "buds-lab-building-data-genome-project-2-3d0cbaf/data/weather/weather.csv",
      preparedAt: "2026-09-29T00:00:00Z",
      meterDigest: {
        algorithm: "SHA-256",
        value: "prepared-meter-file",
      },
      meterSeriesDigest: await digestMeterSeries(meter, provider),
      metadataDigest: {
        algorithm: "SHA-256",
        value: "metadata-test",
      },
    },
  };
}

test("transparent temporal baseline reproduces a stable weekly pattern", () => {
  const meter = series();
  const baseline = runHourOfWeekBaseline(meter, 0.8);

  assert.equal(baseline.split.trainingRows, 8 * 7 * 24);
  assert.equal(baseline.split.testRows, 2 * 7 * 24);
  assert.ok(baseline.metrics.rmsle < 1e-12);
  assert.ok(baseline.metrics.mae < 1e-12);
});

test("tampered holdout interval is flagged and changes accepted emissions", () => {
  const normal = series();
  const normalAnalysis = runBuildingMrv(normal, factor, {
    trainingFraction: 0.8,
    anomalyThreshold: 6,
  });

  assert.equal(normalAnalysis.anomalies.flaggedCount, 0);

  const tamperIndex = 9 * 7 * 24 + 3;
  const tampered = injectTamper(normal, tamperIndex, 20);
  const tamperedAnalysis = runBuildingMrv(tampered, factor, {
    trainingFraction: 0.8,
    anomalyThreshold: 6,
  });

  assert.equal(tamperedAnalysis.anomalies.flaggedCount, 1);
  assert.equal(
    tamperedAnalysis.anomalies.points[tamperIndex]?.flagged,
    true,
  );
  assert.ok(tamperedAnalysis.emissions.excludedEnergyKWh > 0);
  assert.notEqual(
    tamperedAnalysis.emissions.emissionsTCo2e,
    normalAnalysis.emissions.emissionsTCo2e,
  );
});

test("classification metrics expose precision and recall for labelled checks", () => {
  const metrics = classificationMetrics(
    [true, true, false, false],
    [true, false, true, false],
  );

  assert.equal(metrics.truePositive, 1);
  assert.equal(metrics.falsePositive, 1);
  assert.equal(metrics.trueNegative, 1);
  assert.equal(metrics.falseNegative, 1);
  assert.equal(metrics.precision, 0.5);
  assert.equal(metrics.recall, 0.5);
  assert.equal(metrics.f1, 0.5);
});

test("tamper changes the ClimateChain evidence root and reconciliation state", async () => {
  const provider = new InMemoryNodeCryptoProvider();
  const normalMeter = series();
  const normalDataset = await dataset(normalMeter, provider);
  const normalAnalysis = runBuildingMrv(normalMeter, factor, {
    trainingFraction: 0.8,
    anomalyThreshold: 6,
  });
  const normalCase = buildBuildingMrvCase({
    caseId: "case:building:test",
    createdAt: "2026-09-29T01:00:00Z",
    dataset: normalDataset,
    factor,
    analysis: normalAnalysis,
  });

  assert.equal(normalCase.verifications[0]?.result, "reconciled");

  const root = await createEvidenceRoot(
    normalCase,
    [
      {
        nodeType: "verification",
        id: "verification:building-mrv",
      },
    ],
    provider,
  );

  const tamperedMeter = injectTamper(
    normalMeter,
    9 * 7 * 24 + 3,
    20,
  );
  const tamperedDataset = await dataset(tamperedMeter, provider);
  const tamperedAnalysis = runBuildingMrv(tamperedMeter, factor, {
    trainingFraction: 0.8,
    anomalyThreshold: 6,
  });
  const tamperedCase = buildBuildingMrvCase({
    caseId: "case:building:test",
    createdAt: "2026-09-29T01:00:00Z",
    dataset: tamperedDataset,
    factor,
    analysis: tamperedAnalysis,
  });

  assert.equal(tamperedCase.verifications[0]?.result, "mismatch");

  const verification = await verifyEvidenceRoot(
    tamperedCase,
    root,
    provider,
  );

  assert.equal(verification.manifestRootMatches, true);
  assert.equal(verification.currentEvidenceMatches, false);
  assert.notEqual(verification.currentRoot.value, root.root.value);
  assert.ok(
    verification.changedRefs.some(
      (ref) => ref.id === "evidence:bdg2-electricity",
    ),
  );
});

test("Building MRV WebMCP module uses the same analysis service", async () => {
  const provider = new InMemoryNodeCryptoProvider();
  const meter = series();
  const prepared = await dataset(meter, provider);
  const service = new BuildingMrvService({
    caseId: "case:building:test",
    dataset: prepared,
    factor,
    trainingFraction: 0.8,
    anomalyThreshold: 6,
  });
  const module = createBuildingMrvModule(service);

  assert.deepEqual(
    module.tools.map((tool) => tool.name).sort(),
    [
      "building_detect_anomalies",
      "building_get_meter_series",
      "building_reconstruct_emissions",
      "building_run_baseline",
    ],
  );

  const baseline = await service.execute(
    "building-mrv",
    "building_run_baseline",
    { caseId: "case:building:test" },
  ) as { metrics: { rmsle: number } };

  assert.ok(baseline.metrics.rmsle < 1e-12);

  service.tamper(9 * 7 * 24 + 3, 20);

  const anomaly = await service.execute(
    "building-mrv",
    "building_detect_anomalies",
    { caseId: "case:building:test" },
  ) as { flaggedCount: number };

  const emissions = await service.execute(
    "building-mrv",
    "building_reconstruct_emissions",
    { caseId: "case:building:test" },
  ) as { reconciliation: string };

  assert.equal(anomaly.flaggedCount, 1);
  assert.equal(emissions.reconciliation, "not-reconciled");
});

test("prepared artifact loader preserves pinned BDG2 provenance", () => {
  const meter = series(2);
  const meterCsv =
    "timestamp,meter_reading\n" +
    meter.map((point) => point.timestamp + "," + point.value).join("\n") +
    "\n";

  const loaded = loadPreparedBuildingDataset({
    meterCsv,
    metadataJson: JSON.stringify({
      buildingId: "Panther_test_Building",
      siteId: "Panther",
    }),
    sourceJson: JSON.stringify({
      sourceManifestId: "bdg2",
      zenodoRecord: "https://zenodo.org/records/3887306",
      doi: "10.5281/zenodo.3887306",
      archiveName: "buds-lab/building-data-genome-project-2-v1.0.zip",
      publishedArchiveMd5: "44393dc4cf61e84dec105e955368c890",
      preparedAt: "2026-09-29T00:00:00Z",
      members: {
        meter: "electricity_cleaned.csv",
        metadata: "metadata.csv",
        weather: "weather.csv",
      },
      digests: {
        meter: { algorithm: "SHA-256", value: "meter" },
        metadata: { algorithm: "SHA-256", value: "metadata" },
      },
    }),
  });

  assert.equal(loaded.meter.length, 336);
  assert.equal(loaded.source.sourceManifestId, "bdg2");
  assert.equal(
    loaded.source.publishedArchiveMd5,
    "44393dc4cf61e84dec105e955368c890",
  );
});


test("prepared artifact integrity fails when meter.csv is edited", async () => {
  const provider = new InMemoryNodeCryptoProvider();
  const meterCsv = "timestamp,meter_reading\n2017-01-01T00:00:00Z,100\n";
  const metadataJson = JSON.stringify({
    buildingId: "Panther_test_Building",
    siteId: "Panther",
  }) + "\n";

  const meterDigest = await provider.hash(
    new TextEncoder().encode(meterCsv),
    "SHA-256",
  );
  const metadataDigest = await provider.hash(
    new TextEncoder().encode(metadataJson),
    "SHA-256",
  );

  const sourceJson = JSON.stringify({
    sourceManifestId: "bdg2",
    zenodoRecord: "https://zenodo.org/records/3887306",
    doi: "10.5281/zenodo.3887306",
    archiveName: "buds-lab/building-data-genome-project-2-v1.0.zip",
    publishedArchiveMd5: "44393dc4cf61e84dec105e955368c890",
    preparedAt: "2026-09-29T00:00:00Z",
    members: {
      meter: "electricity_cleaned.csv",
      metadata: "metadata.csv",
      weather: "weather.csv",
    },
    digests: {
      meter: meterDigest,
      metadata: metadataDigest,
    },
  });

  const valid = await verifyPreparedArtifactDigests(
    { meterCsv, metadataJson, sourceJson },
    provider,
  );
  assert.equal(valid.valid, true);

  const changed = await verifyPreparedArtifactDigests(
    {
      meterCsv: meterCsv.replace(",100", ",999"),
      metadataJson,
      sourceJson,
    },
    provider,
  );
  assert.equal(changed.valid, false);
  assert.equal(changed.meter, false);
});
