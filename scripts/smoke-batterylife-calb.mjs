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
    "Usage: node scripts/smoke-batterylife-calb.mjs <paper-v4-dir> <current-v11-dir>",
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

const tolerance = 0.0015;
const benchmarkMatchesPublished =
  Math.abs(delta.mapeMeanDelta) < tolerance &&
  Math.abs(delta.mapeStdDelta) < tolerance &&
  Math.abs(delta.accuracyMeanDelta) < tolerance &&
  Math.abs(delta.accuracyStdDelta) < tolerance;

if (!benchmarkMatchesPublished) {
  throw new Error(
    "BatteryLife CALB Dummy reproduction drifted from the published rounded table: " +
      JSON.stringify({ benchmark, delta }),
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
