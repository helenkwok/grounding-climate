import assert from "node:assert/strict";
import test from "node:test";

import {
  createEvidenceRoot,
  domainSeparatedBytes,
  verifyEvidenceRoot,
} from "@grounding-climate/core";
import type {
  ContentDigest,
  CryptoProvider,
  CryptoSignature,
  KeyMetadata,
  SigningKeyRef,
  VerificationKey,
} from "@grounding-climate/core";

import {
  buildBatteryPassport,
  compareDummyBenchmarkToPublished,
  createBatteryDppModule,
  decideBatteryDisposition,
  estimateBatteryHealth,
  runCalbDummyBenchmark,
} from "../src/index.js";
import { BatteryDppService } from "../src/service.js";
import type {
  BatteryHistory,
  LifeLabelRecord,
} from "../src/types.js";
import type { BatteryLifeSplit } from "../src/benchmark.js";

class TestProvider implements CryptoProvider {
  async hash(data: Uint8Array): Promise<ContentDigest> {
    let state = 2166136261;
    for (const byte of data) {
      state ^= byte;
      state = Math.imul(state, 16777619);
    }
    return {
      algorithm: "SHA-256",
      value: (state >>> 0).toString(16).padStart(8, "0"),
    };
  }

  async sign(payload: Uint8Array, key: SigningKeyRef): Promise<CryptoSignature> {
    const digest = await this.hash(payload);
    return {
      suite: key.suite,
      algorithm: key.algorithm,
      keyId: key.keyId,
      encoding: "base64url",
      value: digest.value,
    };
  }

  async verify(
    payload: Uint8Array,
    signature: CryptoSignature,
    _key: VerificationKey,
  ): Promise<boolean> {
    return (await this.hash(payload)).value === signature.value;
  }

  async describeKey(_keyId: string): Promise<KeyMetadata | undefined> {
    return undefined;
  }
}

function history(): BatteryHistory {
  const cycles = Array.from({ length: 60 }, (_, index) => {
    const cycle = index + 1;
    return {
      cycle,
      dischargeCapacityAh: 58 - cycle * 0.08,
    };
  });

  return {
    batteryId: "CALB_test",
    chemistry: "NMC",
    formFactor: "Prismatic",
    nominalCapacityAh: 58,
    cycles,
    source: {
      uri: "https://zenodo.org/records/19688272",
      sourceManifestId: "batterylife-processed",
      dataset: "BatteryLife CALB",
      datasetVersion: "v11",
    },
  };
}

test("transparent health baseline estimates SOH and finite RUL", () => {
  const result = estimateBatteryHealth({
    history: history(),
    fitLastCycles: 30,
  });

  assert.equal(result.observedCycle, 60);
  assert.ok(result.currentSoh < 1);
  assert.ok(result.currentSoh > 0.8);
  assert.ok(result.capacitySlopeAhPerCycle < 0);
  assert.ok((result.estimatedRulCycles ?? 0) > 0);
  assert.ok((result.fit.rSquared ?? 0) > 0.99);
});

test("battery policy distinguishes reuse and low-confidence service review", () => {
  const healthy = estimateBatteryHealth({
    history: history(),
    fitLastCycles: 30,
  });
  const reuse = decideBatteryDisposition(healthy, {
    reuseMinSoh: 0.85,
    reuseMinRulCycles: 50,
    repurposeMinSoh: 0.75,
    minimumFitRSquared: 0.5,
  });
  assert.equal(reuse.disposition, "reuse");
  assert.equal(reuse.permitted, true);

  const review = decideBatteryDisposition(
    {
      ...healthy,
      fit: { ...healthy.fit, rSquared: 0.1 },
    },
    {
      reuseMinSoh: 0.85,
      reuseMinRulCycles: 50,
      repurposeMinSoh: 0.75,
      minimumFitRSquared: 0.5,
    },
  );
  assert.equal(review.disposition, "service-review");
  assert.equal(review.permitted, false);
});

test("dummy benchmark uses mean training life and 15-percent accuracy", () => {
  const labels: LifeLabelRecord[] = [
    { batteryFile: "a.pkl", lifeCycles: 100 },
    { batteryFile: "b.pkl", lifeCycles: 200 },
    { batteryFile: "c.pkl", lifeCycles: 150 },
    { batteryFile: "d.pkl", lifeCycles: 300 },
  ];
  const split = (seed: 42 | 2021 | 2024): BatteryLifeSplit => ({
    seed,
    trainFiles: ["a.pkl", "b.pkl"],
    testFiles: ["c.pkl", "d.pkl"],
  });

  const result = runCalbDummyBenchmark({
    labels,
    splits: [split(42), split(2021), split(2024)],
  });

  assert.equal(result.runs[0]?.trainMeanLifeCycles, 150);
  assert.equal(result.runs[0]?.accuracyWithin15Percent, 0.5);
  assert.ok(result.runs[0]?.mape !== undefined);
  const comparison = compareDummyBenchmarkToPublished(result);
  assert.ok(Number.isFinite(comparison.mapeMeanDelta));
});

test("passport uses shared evidence graph and tamper changes evidence root", async () => {
  const provider = new TestProvider();
  const cleanHistory = history();
  const clean = await buildBatteryPassport({
    history: cleanHistory,
    provider,
    observedAt: "2026-09-29T12:00:00Z",
    fitLastCycles: 30,
  });

  assert.equal(clean.caseBundle.capabilities.includes("battery-dpp"), true);
  assert.equal(clean.caseBundle.evidence.length, 1);
  assert.equal(clean.caseBundle.modelRuns.length, 1);
  assert.equal(clean.caseBundle.claims.length, 1);
  assert.equal(clean.caseBundle.verifications.length, 2);
  assert.equal(clean.caseBundle.verifications[0]?.result, "insufficient-evidence");

  const tamperedHistory = structuredClone(cleanHistory);
  const latest = tamperedHistory.cycles.at(-1);
  assert.ok(latest);
  latest.dischargeCapacityAh += 2;

  const tampered = await buildBatteryPassport({
    history: tamperedHistory,
    provider,
    observedAt: "2026-09-29T12:00:00Z",
    fitLastCycles: 30,
  });

  assert.notEqual(
    clean.passport.inputDigest?.value,
    tampered.passport.inputDigest?.value,
  );
  assert.notEqual(clean.evidenceRoot.root.value, tampered.evidenceRoot.root.value);

  const currentVerification = await verifyEvidenceRoot(
    tampered.caseBundle,
    clean.evidenceRoot,
    provider,
  );
  assert.equal(currentVerification.currentEvidenceMatches, false);
});

test("Battery DPP WebMCP module routes through the same service", async () => {
  const provider = new TestProvider();
  const service = new BatteryDppService({
    caseId: "case:battery:test",
    history: history(),
    provider,
    observedAt: "2026-09-29T12:00:00Z",
  });
  const module = createBatteryDppModule(service);

  assert.deepEqual(
    module.tools.map((tool) => tool.name).sort(),
    [
      "battery_build_passport_claim",
      "battery_compare_baseline",
      "battery_predict_health",
    ],
  );

  const passportTool = module.tools.find(
    (tool) => tool.name === "battery_build_passport_claim",
  );
  assert.ok(passportTool);
  const result = await passportTool.execute(
    { caseId: "case:battery:test" },
    { workspace: {} as never },
  );
  assert.ok((result as { passport?: unknown }).passport);
});

test("a person's sign-off settles the disposition and goes stale when the history changes", async () => {
  const provider = new TestProvider();
  const cleanHistory = history();
  const base = { history: cleanHistory, provider, observedAt: "2026-09-29T12:00:00Z", fitLastCycles: 30 };
  const proposed = await buildBatteryPassport(base);
  const decision = {
    flagId: "disposition:" + cleanHistory.batteryId,
    decision: "service-review",
    reason: "Test: hold for inspection.",
    decidedBy: "person:test",
    decidedAt: "2026-09-30T00:00:00Z",
    inputDigest: proposed.passport.inputDigest!,
  };

  const signed = await buildBatteryPassport({ ...base, decisions: [decision] });
  assert.equal(signed.caseBundle.verifications[0]?.result, "reconciled");
  assert.equal(signed.passport.disposition, "service-review");
  assert.match(String(signed.caseBundle.claims[0]?.assertion.kind === "qualitative" && signed.caseBundle.claims[0].assertion.statement), /signed off by person:test/);
  assert.ok(signed.caseBundle.claims[0]?.boundary?.accounting?.notAssessed.length);

  const tamperedHistory = structuredClone(cleanHistory);
  tamperedHistory.cycles.at(-1)!.dischargeCapacityAh += 2;
  const tampered = await buildBatteryPassport({ ...base, history: tamperedHistory, decisions: [decision] });
  assert.equal(tampered.review[0]?.state, "stale");
  assert.equal(tampered.caseBundle.verifications[0]?.result, "insufficient-evidence");
  assert.equal(tampered.passport.disposition, proposed.passport.disposition);
});
