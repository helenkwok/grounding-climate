import assert from "node:assert/strict";
import test from "node:test";

import {
  createSignedAttestation,
  validateBundle,
  verifySignedAttestation,
} from "@grounding-climate/core";
import { InMemoryNodeCryptoProvider } from "@grounding-climate/crypto-node";

import {
  adviceModelRun,
  applyDecisions,
  BuildingMrvService,
  buildBuildingMrvCase,
  buildFlagState,
  callJev,
  checkSentState,
  digestMeterSeries,
  flagStatuses,
  handOff,
  injectTamper,
  isSkippedLocalTime,
  JevError,
  runBuildingMrv,
  runLengths,
} from "../src/index.js";
import type {
  GridEmissionFactor,
  IntervalDecision,
  JevDeps,
  MeterPoint,
  PreparedBuildingDataset,
} from "../src/index.js";

const factor: GridEmissionFactor = {
  id: "factor:test-grid",
  valueKgCo2ePerKwh: 0.2,
  geography: "Test grid",
  sourceOrganisation: "Test factor publisher",
  sourceUri: "https://example.invalid/grid-factor",
  retrievedAt: "2026-09-29T00:00:00Z",
};

const metadata = {
  buildingId: "Panther_test_Building",
  siteId: "Panther",
  primarySpaceUsage: "Office",
};

// Ten flat weeks with one reading dropped to zero in the holdout.
const FLAG = 9 * 7 * 24 + 3;
function meter(): MeterPoint[] {
  const start = Date.UTC(2017, 0, 1);
  return Array.from({ length: 10 * 7 * 24 }, (_, index) => {
    const at = new Date(start + index * 3_600_000);
    return {
      timestamp: at.toISOString().replace(".000Z", "Z"),
      value: index === FLAG ? 0 : 100 + at.getUTCHours() * 2 + at.getUTCDay() * 5,
    };
  });
}

function dataset(series: MeterPoint[], digest: PreparedBuildingDataset["source"]["meterDigest"]): PreparedBuildingDataset {
  return {
    metadata,
    meter: series,
    source: {
      sourceManifestId: "bdg2",
      zenodoRecord: "https://zenodo.org/records/3887306",
      doi: "10.5281/zenodo.3887306",
      archiveName: "test",
      publishedArchiveMd5: "test",
      meterMember: "test",
      metadataMember: "test",
      weatherMember: "test",
      preparedAt: "2026-09-29T00:00:00Z",
      meterDigest: digest,
      meterSeriesDigest: digest,
      metadataDigest: { algorithm: "SHA-256", value: "test" },
    },
  };
}

function fakeJev(responses: Array<{ status: number; body?: unknown }>): JevDeps & { calls: string[]; slept: number[] } {
  const calls: string[] = [];
  const slept: number[] = [];
  return {
    calls,
    slept,
    now: () => 0,
    sleep: async (ms) => void slept.push(ms),
    fetch: async (_url, init) => {
      calls.push(init.body);
      const next = responses.shift();
      if (!next) throw new Error("no more responses");
      return {
        ok: next.status === 200,
        status: next.status,
        headers: { get: (name: string) => (name === "retry-after" ? "3" : null) },
        json: async () => next.body,
      };
    },
  };
}

const ANSWER = {
  model: "jev-1.13.0",
  answers: {
    triage: {
      type: "choice",
      choice: "meter_fault",
      probabilities: { meter_fault: 0.96, real_consumption: 0.03, unclear: 0.01 },
      confidence: 0.96,
    },
  },
  usage: { input_tokens: 210 },
};

test("flag state holds only allow-listed numbers and public descriptors", () => {
  const series = meter();
  const analysis = runBuildingMrv(series, factor);
  const state = buildFlagState(series, analysis.anomalies, FLAG, metadata);

  assert.equal(state.reading_kwh, 0);
  assert.equal(state.previous_3_kwh.length, 3);
  assert.ok(!JSON.stringify(state).includes("Panther"));
  assert.throws(() => checkSentState({ ...state, building: "Panther_test_Building" }), /not allowed/);
  assert.throws(() => checkSentState({ ...state, building_use: "Panther_test_Building" }), /identifier/);
  assert.throws(() => checkSentState({ ...state, weekday: "meter 1234567" }), /id/);
  assert.throws(() => buildFlagState(series, analysis.anomalies, 0, metadata), /not flagged/);
});

test("Jev caller retries once after 429 and validates the answer", async () => {
  const series = meter();
  const analysis = runBuildingMrv(series, factor);
  const state = buildFlagState(series, analysis.anomalies, FLAG, metadata);

  const deps = fakeJev([{ status: 429 }, { status: 200, body: ANSWER }]);
  const advice = await callJev(deps, "test-key", state);
  assert.equal(advice.choice, "meter_fault");
  assert.equal(advice.model, "jev-1.13.0");
  assert.deepEqual(deps.slept, [3000]);
  assert.ok(!deps.calls[0]!.includes("test-key"));

  const outside = structuredClone(ANSWER);
  outside.answers.triage.choice = "delete_it";
  await assert.rejects(callJev(fakeJev([{ status: 200, body: outside }]), "k", state), /criteria/);

  await assert.rejects(
    callJev(fakeJev([{ status: 401 }]), "secret-key", state),
    (error: unknown) =>
      error instanceof JevError && error.code === "unauthorized" && !error.message.includes("secret-key"),
  );
});

test("advice never changes a status; only a current human decision does", async () => {
  const provider = new InMemoryNodeCryptoProvider();
  const series = meter();
  const digest = await digestMeterSeries(series, provider);
  const analysis = runBuildingMrv(series, factor);
  const state = buildFlagState(series, analysis.anomalies, FLAG, metadata);
  const timestamp = analysis.anomalies.points[FLAG]!.timestamp;
  const run = await adviceModelRun({
    timestamp,
    state,
    advice: { ...(await callJev(fakeJev([{ status: 200, body: ANSWER }]), "k", state)) },
    executedAt: "2026-10-05T00:00:00Z",
    hashProvider: provider,
  });

  const base = { caseId: "case:t", createdAt: "2026-10-05T00:00:00Z", dataset: dataset(series, digest), factor };
  const undecided = flagStatuses(analysis, [], digest);
  const without = buildBuildingMrvCase({ ...base, analysis, flagStatuses: undecided });
  const withAdvice = buildBuildingMrvCase({ ...base, analysis, flagStatuses: undecided, advice: [run] });

  for (const index of [0, 1]) {
    assert.deepEqual(withAdvice.verifications[index]?.checks, without.verifications[index]?.checks);
    assert.equal(withAdvice.verifications[index]?.result, without.verifications[index]?.result);
  }
  assert.equal(withAdvice.verifications[0]?.result, "insufficient-evidence");
  assert.deepEqual(withAdvice.claims, without.claims);
  assert.deepEqual(validateBundle(withAdvice), []);

  const decision: IntervalDecision = {
    timestamp,
    decision: "keep",
    reason: "Test: keep the reading.",
    decidedBy: "person:test",
    decidedAt: "2026-10-05T01:00:00Z",
    meterSeriesDigest: digest,
    adviceShown: run.id,
  };
  const statuses = flagStatuses(analysis, [decision], digest);
  const decided = applyDecisions(series, factor, analysis, statuses);
  const decidedCase = buildBuildingMrvCase({ ...base, analysis: decided, flagStatuses: statuses, advice: [run] });
  assert.equal(decidedCase.verifications[0]?.result, "reconciled");
  assert.equal(decidedCase.verifications[1]?.verifier.id, "person:test");
  assert.equal(decided.emissions.excludedEnergyKWh, 0);
  assert.match(decidedCase.verifications[0]!.findings.join(" "), /not resolved/);
  // The accounting boundary states the policy choices apart from the numbers, and follows the decision.
  const boundary = decidedCase.claims[0]!.boundary!.accounting!;
  assert.match(boundary.policyChoices.join(" "), /Location-based, not market-based/);
  assert.match(boundary.policyChoices.join(" "), /costed at 5 reviews/);
  assert.match(boundary.excluded[0]!, /^Excluded readings \(0\.000 kWh\)/);
  assert.match(boundary.notAssessed.join(" "), /cause of each flagged reading/);

  // The same decision on a changed series is stale, and the claim is back to needing review.
  const tampered = injectTamper(series, FLAG + 5, 20);
  const tamperedDigest = await digestMeterSeries(tampered, provider);
  const tamperedAnalysis = runBuildingMrv(tampered, factor);
  const stale = flagStatuses(tamperedAnalysis, [decision], tamperedDigest);
  assert.deepEqual(stale.map((status) => status.state).sort(), ["stale", "undecided"]);
});

test("decided case signed with Ed25519 and ML-DSA-65 fails verification after tamper", async () => {
  const provider = new InMemoryNodeCryptoProvider();
  const options = { controller: "org:test", createdAt: "2026-10-01T00:00:00Z" };
  const ed = provider.generateEd25519Key({ keyId: "key:ed", ...options });
  const pq = provider.generateMlDsa65Key({ keyId: "key:pq", ...options });

  const series = meter();
  const digest = await digestMeterSeries(series, provider);
  const analysis = runBuildingMrv(series, factor);
  const timestamp = analysis.anomalies.points[FLAG]!.timestamp;
  const statuses = flagStatuses(
    analysis,
    [{ timestamp, decision: "exclude", reason: "Test", decidedBy: "person:test", decidedAt: "2026-10-05T01:00:00Z", meterSeriesDigest: digest }],
    digest,
  );
  const base = { caseId: "case:t", createdAt: "2026-10-05T00:00:00Z", factor };
  const signedCase = buildBuildingMrvCase({ ...base, dataset: dataset(series, digest), analysis, flagStatuses: statuses });

  const signed = await createSignedAttestation(signedCase, {
    id: "attestation:t",
    attester: { subjectId: "org:test" },
    statement: "test",
    claimRefs: [{ nodeType: "claim", id: "claim:building-electricity-emissions" }],
    verificationRef: { nodeType: "verification", id: "verification:building-mrv" },
    issuedAt: "2026-10-05T02:00:00Z",
    hashProvider: provider,
    signers: [
      { provider, key: ed.signingKey },
      { provider, key: pq.signingKey },
    ],
  });
  const verifyOptions = {
    hashProvider: provider,
    resolveKey: async (signature: { keyId: string }) => {
      const metadata = await provider.describeKey(signature.keyId);
      return metadata && { provider, key: metadata.verificationKey, metadata };
    },
    policy: { requiredSuites: ["classical", "post-quantum"] as Array<"classical" | "post-quantum"> },
  };

  const clean = await verifySignedAttestation(signedCase, signed, verifyOptions);
  assert.equal(clean.validForCurrentEvidence, true);

  const tampered = injectTamper(series, FLAG + 5, 20);
  const tamperedDigest = await digestMeterSeries(tampered, provider);
  const tamperedAnalysis = runBuildingMrv(tampered, factor);
  const tamperedCase = buildBuildingMrvCase({
    ...base,
    dataset: dataset(tampered, tamperedDigest),
    analysis: tamperedAnalysis,
    flagStatuses: flagStatuses(tamperedAnalysis, [], tamperedDigest),
  });
  const after = await verifySignedAttestation(tamperedCase, signed, verifyOptions);
  assert.equal(after.validForSignedEvidence, true);
  assert.equal(after.validForCurrentEvidence, false);
  assert.ok(after.changedRefs.some((ref) => ref.id === "evidence:bdg2-electricity"));
});

test("WebMCP review tool serves the decided case and sees decisions go stale after a tamper", async () => {
  const provider = new InMemoryNodeCryptoProvider();
  const series = meter();
  const digest = await digestMeterSeries(series, provider);
  const timestamp = runBuildingMrv(series, factor).anomalies.points[FLAG]!.timestamp;
  const service = new BuildingMrvService({
    caseId: "case:t",
    dataset: dataset(series, digest),
    factor,
    review: {
      createdAt: "2026-10-05T00:00:00Z",
      advice: [],
      decisions: [
        { timestamp, decision: "exclude", reason: "Test", decidedBy: "person:test", decidedAt: "2026-10-05T01:00:00Z", meterSeriesDigest: digest },
      ],
      hashProvider: provider,
    },
  });
  type Review = { result: string; flags: Array<{ state: string }> };
  const review = () => service.execute("building-mrv", "building_review_flags", { caseId: "case:t" }) as Promise<Review>;

  assert.equal((await review()).result, "reconciled");
  service.tamper(FLAG + 5, 20);
  const after = await review();
  assert.equal(after.result, "insufficient-evidence");
  assert.deepEqual(after.flags.map((flag) => flag.state).sort(), ["stale", "undecided"]);
  await assert.rejects(service.execute("building-mrv", "building_review_flags", { caseId: "case:other" }), /Unknown/);
});

test("stuck-reading screen flags zeros and runs of identical hourly readings, not runs across a gap", () => {
  const at = (hour: number) => new Date(Date.UTC(2017, 0, 1) + hour * 3_600_000).toISOString().replace(".000Z", "Z");
  const points = [5, 7, 7, 7, 0, 9, 9, 9].map((value, hour) => ({ timestamp: at(hour), value }));
  points.push({ timestamp: at(10), value: 9 }); // two-hour gap: does not extend the run of 9s
  assert.deepEqual(runLengths(points), [1, 3, 3, 3, 1, 3, 3, 3, 1]);

  const series = meter();
  const residual = runBuildingMrv(series, factor, { minRunHours: 0 });
  const stuck = runBuildingMrv(series, factor, { minRunHours: 3 });
  assert.deepEqual(stuck.anomalies.points[FLAG]!.reasons, ["residual", "zero"]);
  assert.equal(stuck.anomalies.method, "baseline-residual-mad+stuck-readings");
  assert.equal(stuck.anomalies.flaggedCount, residual.anomalies.flaggedCount);

  const flat = series.map((point, index) => (index >= 100 && index < 110 ? { ...point, value: 42 } : point));
  const flatStuck = runBuildingMrv(flat, factor, { minRunHours: 3 });
  assert.ok(flatStuck.anomalies.points.slice(100, 110).every((point) => point.reasons.includes("constant-run")));
  assert.throws(() => runBuildingMrv(series, factor, { minRunHours: 1 }), /at least 2/);
});

test("advice is a suggestion only at or above the measured hand-off threshold", () => {
  const p = (meter_fault: number) => ({ meter_fault, real_consumption: 1 - meter_fault, unclear: 0 });
  assert.equal(handOff({ choice: "meter_fault", probabilities: p(0.97) }), "suggested");
  assert.equal(handOff({ choice: "meter_fault", probabilities: p(0.96) }), "needs a person");
  assert.equal(handOff({ choice: "real_consumption", probabilities: p(0.99) }), "needs a person");
});

test("a clock hour skipped for daylight saving is recognised, and ordinary hours are not", () => {
  assert.equal(isSkippedLocalTime("2016-03-13 02:00:00", "US/Pacific"), true);
  assert.equal(isSkippedLocalTime("2016-03-13 01:00:00", "US/Pacific"), false);
  assert.equal(isSkippedLocalTime("2016-03-13 03:00:00", "US/Pacific"), false);
  // The repeated hour when clocks go back exists (twice), so it is not skipped.
  assert.equal(isSkippedLocalTime("2016-11-06 01:00:00", "US/Pacific"), false);
  assert.equal(isSkippedLocalTime("2016-03-27 01:30:00", "Europe/London"), true);
  assert.equal(isSkippedLocalTime("2016-03-13 02:00:00", "UTC"), false);
});
