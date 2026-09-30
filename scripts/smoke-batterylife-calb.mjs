import { readFile } from "node:fs/promises";

import { InMemoryNodeCryptoProvider } from "../packages/crypto-node/dist/src/index.js";
import {
  buildBatteryPassport,
  compareDummyBenchmarkToPublished,
  runCalbDummyBenchmark,
} from "../packages/battery-dpp/dist/src/index.js";

const paperRoot = process.argv[2];
const currentRoot = process.argv[3];
if (!paperRoot || !currentRoot) {
  throw new Error(
    "Usage: node scripts/smoke-batterylife-calb.mjs <paper-v1-dir> <current-v11-dir>",
  );
}

const paperLabels = JSON.parse(
  await readFile(paperRoot + "/calb-labels.json", "utf8"),
);
const currentLabels = JSON.parse(
  await readFile(currentRoot + "/calb-labels.json", "utf8"),
);
const history = JSON.parse(
  await readFile(currentRoot + "/battery-history.json", "utf8"),
);
const paperManifest = JSON.parse(
  await readFile(paperRoot + "/manifest.json", "utf8"),
);
const currentManifest = JSON.parse(
  await readFile(currentRoot + "/manifest.json", "utf8"),
);
const reference = JSON.parse(
  await readFile(
    new URL(
      "../packages/battery-dpp/references/batterylife-calb.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

const benchmark = runCalbDummyBenchmark({
  labels: paperLabels,
  splits: reference.splits,
});
const delta = compareDummyBenchmarkToPublished(benchmark);

const currentBenchmark = runCalbDummyBenchmark({
  labels: currentLabels,
  splits: reference.splits,
});
const currentDelta = compareDummyBenchmarkToPublished(currentBenchmark);

const publishedTolerance = 0.0015;
const benchmarkMatchesPublished =
  Math.abs(delta.mapeMeanDelta) < publishedTolerance &&
  Math.abs(delta.mapeStdDelta) < publishedTolerance &&
  Math.abs(delta.accuracyMeanDelta) < publishedTolerance &&
  Math.abs(delta.accuracyStdDelta) < publishedTolerance;

const measured = reference.measuredV1;
const reproducibilityTolerance = 1e-12;
const benchmarkMatchesPinnedV1 =
  Math.abs(benchmark.meanMape - measured.meanMape) < reproducibilityTolerance &&
  Math.abs(benchmark.stdMape - measured.stdMape) < reproducibilityTolerance &&
  Math.abs(
    benchmark.meanAccuracyWithin15Percent -
      measured.meanAccuracyWithin15Percent,
  ) < reproducibilityTolerance &&
  Math.abs(
    benchmark.stdAccuracyWithin15Percent -
      measured.stdAccuracyWithin15Percent,
  ) < reproducibilityTolerance;

if (!benchmarkMatchesPinnedV1) {
  throw new Error(
    "BatteryLife CALB v1 Dummy rerun drifted from ClimateChain's pinned measured result: " +
      JSON.stringify({ benchmark, measured }),
  );
}

const provider = new InMemoryNodeCryptoProvider();
provider.generateEd25519Key({
  keyId: "key:battery-smoke",
  controller: "service:climatechain:battery-dpp",
  createdAt: "2026-09-29T00:00:00Z",
});

const clean = await buildBatteryPassport({
  history,
  provider,
  observedAt: "2026-09-29T00:00:00Z",
});

const tamperedHistory = structuredClone(history);
const tamperedCycle = tamperedHistory.cycles.at(-1);
if (!tamperedCycle) throw new Error("Battery history unexpectedly empty.");
const originalCapacity = tamperedCycle.dischargeCapacityAh;
tamperedCycle.dischargeCapacityAh = originalCapacity * 1.2;

const tampered = await buildBatteryPassport({
  history: tamperedHistory,
  provider,
  observedAt: "2026-09-29T00:00:00Z",
});

if (clean.evidenceRoot.root.value === tampered.evidenceRoot.root.value) {
  throw new Error("Tampering did not change the Battery DPP evidence root.");
}

const result = {
  schemaVersion: "climatechain.batterylife-smoke/0.1",
  source: {
    paperBenchmarkRelease: paperManifest.source,
    currentPassportRelease: currentManifest.source,
  },
  benchmark: {
    dataset: "CALB",
    paperLabelCount: paperLabels.length,
    currentLabelCount: currentLabels.length,
    runs: benchmark.runs,
    reproduced: {
      meanMape: benchmark.meanMape,
      stdMape: benchmark.stdMape,
      meanAccuracyWithin15Percent:
        benchmark.meanAccuracyWithin15Percent,
      stdAccuracyWithin15Percent:
        benchmark.stdAccuracyWithin15Percent,
    },
    published: benchmark.published,
    delta,
    benchmarkMatchesPublished,
    benchmarkMatchesPinnedV1,
    reproducibilityFinding:
      benchmarkMatchesPublished
        ? "Pinned v1 code/data reproduces the published rounded table."
        : "Pinned v1 code/data does not reproduce the published rounded table; the measured discrepancy is retained as provenance rather than hidden by tolerance.",
    paperEraCodeCommit: reference.source.paperEra.codeCommit,
    correctedV11: {
      runs: currentBenchmark.runs,
      reproduced: {
        meanMape: currentBenchmark.meanMape,
        stdMape: currentBenchmark.stdMape,
        meanAccuracyWithin15Percent:
          currentBenchmark.meanAccuracyWithin15Percent,
        stdAccuracyWithin15Percent:
          currentBenchmark.stdAccuracyWithin15Percent,
      },
      deltaFromPublishedTable: currentDelta,
      note:
        "BatteryLife v11 corrected labels are measured separately and are not expected to reproduce the historical paper-era table.",
    },
  },
  passport: {
    batteryId: clean.passport.batteryId,
    cycleCount: history.cycles.length,
    nominalCapacityAh: history.nominalCapacityAh,
    observedCycle: clean.passport.observedCycle,
    currentSoh: clean.passport.currentSoh,
    estimatedRulCycles: clean.passport.estimatedRulCycles,
    disposition: clean.passport.disposition,
    fitRSquared: clean.passport.model.fitRSquared,
    inputDigest: clean.passport.inputDigest,
    evidenceRoot: clean.evidenceRoot.root,
  },
  tamper: {
    cycle: tamperedCycle.cycle,
    originalCapacityAh: originalCapacity,
    changedCapacityAh: tamperedCycle.dischargeCapacityAh,
    changedInputDigest: tampered.passport.inputDigest,
    changedEvidenceRoot: tampered.evidenceRoot.root,
    rootChanged:
      clean.evidenceRoot.root.value !== tampered.evidenceRoot.root.value,
  },
  scope: {
    primaryUser: "second-life battery operator",
    decision: "reuse, repurpose, service-review, or retire-review",
    caveat:
      "Decision support only; no claim of avoided emissions or battery safety certification.",
  },
};

console.log("CLIMATECHAIN_BATTERYLIFE_SMOKE=" + JSON.stringify(result));
