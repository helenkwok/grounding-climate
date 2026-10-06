import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createEvidenceRoot,
} from "@grounding-climate/core";
import {
  InMemoryNodeCryptoProvider,
} from "@grounding-climate/crypto-node";

import {
  runBuildingMrv,
} from "./analysis.js";
import {
  injectTamper,
} from "./anomaly.js";
import {
  digestMeterSeries,
} from "./integrity.js";
import {
  buildBuildingMrvCase,
} from "./case.js";
import {
  loadPreparedBuildingDataset,
  verifyPreparedArtifactDigests,
} from "./prepared.js";
import type {
  GridEmissionFactor,
} from "./types.js";

interface CliArgs {
  dir: string;
  out: string;
  factor?: number;
  factorGeography: string | undefined;
  factorSource: string | undefined;
  factorOrganisation: string;
  factorDocument: string | undefined;
  factorRetrievedAt: string;
  anomalyThreshold: number;
  trainingFraction: number;
  tamperIndex: number | undefined;
  tamperMultiplier: number;
}

function argsFrom(argv: string[]): CliArgs {
  const args: CliArgs = {
    dir: "",
    out: "out/building-mrv",
    factorGeography: undefined,
    factorSource: undefined,
    factorOrganisation: "User-specified factor source",
    factorDocument: undefined,
    factorRetrievedAt: new Date().toISOString(),
    anomalyThreshold: 6,
    trainingFraction: 0.8,
    tamperIndex: undefined,
    tamperMultiplier: 20,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];

    if (key === "--dir") {
      args.dir = value ?? "";
      index += 1;
    } else if (key === "--out") {
      args.out = value ?? "";
      index += 1;
    } else if (key === "--factor") {
      args.factor = Number(value);
      index += 1;
    } else if (key === "--factor-geography") {
      args.factorGeography = value;
      index += 1;
    } else if (key === "--factor-source") {
      args.factorSource = value;
      index += 1;
    } else if (key === "--factor-organisation") {
      args.factorOrganisation = value ?? args.factorOrganisation;
      index += 1;
    } else if (key === "--factor-document") {
      args.factorDocument = value;
      index += 1;
    } else if (key === "--factor-retrieved-at") {
      args.factorRetrievedAt = value ?? args.factorRetrievedAt;
      index += 1;
    } else if (key === "--anomaly-threshold") {
      args.anomalyThreshold = Number(value);
      index += 1;
    } else if (key === "--training-fraction") {
      args.trainingFraction = Number(value);
      index += 1;
    } else if (key === "--tamper-index") {
      args.tamperIndex = Number(value);
      index += 1;
    } else if (key === "--tamper-multiplier") {
      args.tamperMultiplier = Number(value);
      index += 1;
    } else if (key === "--help") {
      console.log(
        [
          "Usage: node dist/src/cli.js --dir <prepared-bdg2-dir> --factor <kgCO2e/kWh> --factor-geography <name> --factor-source <url> [options]",
          "",
          "The factor is intentionally required. Grounding does not guess a grid factor from an anonymised BDG2 site.",
          "",
          "Options:",
          "  --out <dir>                    Output directory (default out/building-mrv)",
          "  --factor-organisation <name>   Publisher/source organisation",
          "  --factor-document <name>       Factor document/version",
          "  --factor-retrieved-at <iso>    Retrieval timestamp",
          "  --training-fraction <0..1>     Temporal training share (default 0.8)",
          "  --anomaly-threshold <z>        Robust residual threshold (default 6)",
          "  --tamper-index <row>            Deliberately modify one row after integrity verification",
          "  --tamper-multiplier <n>         Demo tamper multiplier (default 20)",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error("Unknown argument: " + key);
    }
  }

  if (!args.dir) throw new Error("--dir is required.");
  if (
    args.factor === undefined ||
    !Number.isFinite(args.factor) ||
    args.factor < 0
  ) {
    throw new Error("--factor must be a non-negative kgCO2e/kWh value.");
  }
  if (!args.factorGeography) {
    throw new Error("--factor-geography is required.");
  }
  if (!args.factorSource) {
    throw new Error("--factor-source is required.");
  }

  return args;
}

async function optionalText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
    if (code === "ENOENT") return undefined;
    throw error;
  }
}

async function main() {
  const args = argsFrom(process.argv.slice(2));
  const [meterCsv, weatherCsv, metadataJson, sourceJson] =
    await Promise.all([
      readFile(path.join(args.dir, "meter.csv"), "utf8"),
      optionalText(path.join(args.dir, "weather.csv")),
      readFile(path.join(args.dir, "metadata.json"), "utf8"),
      readFile(path.join(args.dir, "source.json"), "utf8"),
    ]);

  const crypto = new InMemoryNodeCryptoProvider();
  const preparedInput = {
    meterCsv,
    ...(weatherCsv ? { weatherCsv } : {}),
    metadataJson,
    sourceJson,
  };
  const sourceIntegrity = await verifyPreparedArtifactDigests(
    preparedInput,
    crypto,
  );
  if (!sourceIntegrity.valid) {
    throw new Error(
      "Prepared BDG2 source integrity check failed: " +
        JSON.stringify(sourceIntegrity),
    );
  }

  const loadedDataset = loadPreparedBuildingDataset(preparedInput);
  const canonicalMeterDigest = await digestMeterSeries(
    loadedDataset.meter,
    crypto,
  );
  let dataset = {
    ...loadedDataset,
    source: {
      ...loadedDataset.source,
      meterSeriesDigest: canonicalMeterDigest,
    },
  };

  if (args.tamperIndex !== undefined) {
    if (!Number.isInteger(args.tamperIndex)) {
      throw new Error("--tamper-index must be an integer.");
    }
    const tamperedMeter = injectTamper(
      dataset.meter,
      args.tamperIndex,
      args.tamperMultiplier,
    );
    dataset = {
      ...dataset,
      meter: tamperedMeter,
      source: {
        ...dataset.source,
        meterSeriesDigest: await digestMeterSeries(
          tamperedMeter,
          crypto,
        ),
      },
    };
  }

  const factor: GridEmissionFactor = {
    id: "factor:user-grid-electricity",
    valueKgCo2ePerKwh: args.factor as number,
    geography: args.factorGeography as string,
    sourceOrganisation: args.factorOrganisation,
    sourceUri: args.factorSource as string,
    ...(args.factorDocument
      ? { sourceDocument: args.factorDocument }
      : {}),
    retrievedAt: args.factorRetrievedAt,
  };

  const analysis = runBuildingMrv(dataset.meter, factor, {
    trainingFraction: args.trainingFraction,
    anomalyThreshold: args.anomalyThreshold,
  });

  const createdAt = new Date().toISOString();
  const climateCase = buildBuildingMrvCase({
    caseId: "case:building-mrv:" + dataset.metadata.buildingId,
    createdAt,
    dataset,
    factor,
    analysis,
  });

  const evidence = await createEvidenceRoot(
    climateCase,
    [
      {
        nodeType: "verification",
        id: "verification:building-mrv",
      },
    ],
    crypto,
  );

  const report = {
    caseId: climateCase.caseId,
    primaryUser: "building/facility energy manager",
    building: dataset.metadata,
    sourceIntegrity,
    demoTamper:
      args.tamperIndex === undefined
        ? null
        : {
            index: args.tamperIndex,
            multiplier: args.tamperMultiplier,
          },
    baseline: {
      method: analysis.baseline.method,
      split: analysis.baseline.split,
      metrics: analysis.baseline.metrics,
    },
    anomalyCheck: {
      method: analysis.anomalies.method,
      threshold: analysis.anomalies.threshold,
      flaggedCount: analysis.anomalies.flaggedCount,
      flaggedEnergyKWh: analysis.anomalies.flaggedEnergyKWh,
    },
    emissions: analysis.emissions,
    verification: climateCase.verifications[0],
    evidenceRoot: evidence.root,
    limitations: [
      "The grid factor is supplied explicitly and must match the site/geography and reporting period.",
      "The baseline is a transparent local benchmark, not a reproduced ALDI++ model score.",
      "Flagging a meter interval is a data-quality signal, not proof of malicious tampering.",
      "No emissions reduction is claimed; the output is a reconstructed emissions quantity from accepted measurements.",
    ],
  };

  await mkdir(args.out, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(args.out, "case.json"),
      JSON.stringify(climateCase, null, 2) + "\n",
    ),
    writeFile(
      path.join(args.out, "evidence-root.json"),
      JSON.stringify(evidence, null, 2) + "\n",
    ),
    writeFile(
      path.join(args.out, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    ),
  ]);

  console.log(JSON.stringify(report, null, 2));
}

await main();
