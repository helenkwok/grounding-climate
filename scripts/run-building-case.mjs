// One building case end to end: BDG2 meter series -> baseline and anomaly screen -> decision-model advice
// on each flag -> a person's decision on each flag -> emissions -> attestation signed with Ed25519 and
// ML-DSA-65 -> verification by a verifier that holds only the public keys -> the same check after a tamper.
//
//   node scripts/run-building-case.mjs advise <prepared-dir>   asks Jev about each flag (needs TYPESAFE_API_KEY)
//   node scripts/run-building-case.mjs run <prepared-dir>      builds, signs and verifies the case
//
// Advice is cached in reports/building-mrv/triage-advice.json; decisions are written by a person in
// reports/building-mrv/interval-decisions.json (run prints a template when a flag has no decision).
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createSignedAttestation,
  validateBundle,
  verifySignedAttestation,
} from "@climatechain/core";
import { InMemoryNodeCryptoProvider } from "@climatechain/crypto-node";
import {
  adviceModelRun,
  applyDecisions,
  buildBuildingMrvCase,
  buildFlagState,
  callJev,
  digestMeterSeries,
  flagStatuses,
  injectTamper,
  loadPreparedBuildingDataset,
  runBuildingMrv,
  verifyPreparedArtifactDigests,
} from "@climatechain/building-mrv";

const REPORTS = new URL("../reports/building-mrv/", import.meta.url);
const ADVICE_FILE = new URL("triage-advice.json", REPORTS);
const DECISIONS_FILE = new URL("interval-decisions.json", REPORTS);
const OUT_FILE = new URL("case-run.json", REPORTS);

const [mode, dir] = process.argv.slice(2);
if (!["advise", "run"].includes(mode) || !dir) {
  throw new Error("Usage: node scripts/run-building-case.mjs advise|run <prepared-dir>");
}

async function readJson(url, fallback) {
  try {
    return JSON.parse(await readFile(url, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

const crypto = new InMemoryNodeCryptoProvider();
const input = {
  meterCsv: await readFile(path.join(dir, "meter.csv"), "utf8"),
  weatherCsv: await readFile(path.join(dir, "weather.csv"), "utf8"),
  metadataJson: await readFile(path.join(dir, "metadata.json"), "utf8"),
  sourceJson: await readFile(path.join(dir, "source.json"), "utf8"),
};
const integrity = await verifyPreparedArtifactDigests(input, crypto);
if (!integrity.valid) throw new Error("Prepared subset integrity failed: " + JSON.stringify(integrity));
const loaded = loadPreparedBuildingDataset(input);

const reference = JSON.parse(
  await readFile(new URL("../packages/building-mrv/references/epa-egrid2016-camx.json", import.meta.url), "utf8"),
);
const factor = { ...reference, valueKgCo2ePerKwh: reference.conversion.valueKgCo2ePerKwh };

/** Builds the case for a meter series; decisions on another series come out stale. */
async function buildCase(meter, advice, decisions, createdAt) {
  const digest = await digestMeterSeries(meter, crypto);
  const dataset = { ...loaded, meter, source: { ...loaded.source, meterSeriesDigest: digest } };
  const raw = runBuildingMrv(meter, factor);
  const statuses = flagStatuses(raw, decisions, digest);
  const analysis = applyDecisions(meter, factor, raw, statuses);
  const climateCase = buildBuildingMrvCase({
    caseId: "case:building-mrv:" + loaded.metadata.buildingId,
    createdAt,
    dataset,
    factor,
    analysis,
    flagStatuses: statuses,
    advice,
  });
  const issues = validateBundle(climateCase);
  if (issues.length > 0) throw new Error("Invalid case: " + JSON.stringify(issues));
  return { climateCase, digest, analysis, statuses };
}

const meterDigest = await digestMeterSeries(loaded.meter, crypto);
const analysis = runBuildingMrv(loaded.meter, factor);
const flagged = analysis.anomalies.points.flatMap((point, index) => (point.flagged ? [index] : []));

if (mode === "advise") {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) throw new Error("TYPESAFE_API_KEY is not set.");
  const deps = { fetch: globalThis.fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: Date.now };
  const records = [];
  for (const index of flagged) {
    const state = buildFlagState(loaded.meter, analysis.anomalies, index, loaded.metadata);
    const advice = await callJev(deps, key, state);
    records.push({
      timestamp: analysis.anomalies.points[index].timestamp,
      meterSeriesDigest: meterDigest,
      state,
      advice,
      executedAt: new Date().toISOString(),
    });
    console.log(records.at(-1).timestamp, advice.choice, advice.confidence, advice.model);
  }
  await writeFile(ADVICE_FILE, JSON.stringify(records, null, 2) + "\n");
  console.log("Wrote " + records.length + " advice records to " + ADVICE_FILE.pathname);
  process.exit(0);
}

const adviceRecords = await readJson(ADVICE_FILE, []);
const advice = [];
for (const record of adviceRecords) {
  advice.push(await adviceModelRun({ ...record, hashProvider: crypto }));
}
const decisions = await readJson(DECISIONS_FILE, []);
const createdAt = new Date().toISOString();
const clean = await buildCase(loaded.meter, advice, decisions, createdAt);

const undecided = clean.statuses.filter((status) => status.state !== "decided");
if (undecided.length > 0) {
  console.log("These flags have no current decision. Template for " + DECISIONS_FILE.pathname + ":");
  console.log(
    JSON.stringify(
      undecided.map((status) => {
        const shown = advice.find((run) => run.inferenceParameters.interval === status.timestamp);
        return {
          timestamp: status.timestamp,
          decision: "exclude | keep",
          reason: "",
          decidedBy: "person:<your id>",
          decidedAt: "<ISO time>",
          meterSeriesDigest: clean.digest,
          ...(shown ? { adviceShown: shown.id } : {}),
        };
      }),
      null,
      2,
    ),
  );
}

// Demo keys made for this run. They identify the run, not a person or an organisation.
const keyOptions = { controller: "org:climatechain-demo", createdAt };
const ed = crypto.generateEd25519Key({ keyId: "key:demo-ed25519:" + createdAt, ...keyOptions });
const pq = crypto.generateMlDsa65Key({ keyId: "key:demo-ml-dsa-65:" + createdAt, ...keyOptions });
const signed = await createSignedAttestation(clean.climateCase, {
  id: "attestation:building-mrv:" + createdAt,
  attester: { subjectId: "org:climatechain-demo", name: "ClimateChain demo run" },
  statement:
    "Scope 2 electricity emissions for this building were recomputed from the BDG2 meter series. " +
    "Verification result at signing: " +
    clean.climateCase.verifications[0].result +
    "; " +
    (clean.statuses.length - undecided.length) +
    " of " +
    clean.statuses.length +
    " flagged readings had a current decision by a person.",
  claimRefs: [{ nodeType: "claim", id: "claim:building-electricity-emissions" }],
  verificationRef: { nodeType: "verification", id: "verification:building-mrv" },
  issuedAt: createdAt,
  hashProvider: crypto,
  signers: [
    { provider: crypto, key: ed.signingKey },
    { provider: crypto, key: pq.signingKey },
  ],
});

// The verifier gets only the published key metadata, never the signing provider's private keys.
const publishedKeys = [await crypto.describeKey(ed.signingKey.keyId), await crypto.describeKey(pq.signingKey.keyId)];
const verifier = new InMemoryNodeCryptoProvider();
const verifyOptions = {
  hashProvider: verifier,
  resolveKey: async (signature) => {
    const metadata = publishedKeys.find((key) => key.keyId === signature.keyId);
    return metadata && { provider: verifier, key: metadata.verificationKey, metadata };
  },
  policy: { requiredSuites: ["classical", "post-quantum"], minimumSignatures: 2 },
};
const cleanVerification = await verifySignedAttestation(clean.climateCase, signed, verifyOptions);

const tamperIndex = analysis.baseline.split.trainingEndIndex;
const tamperedMeter = injectTamper(loaded.meter, tamperIndex, 20);
const tampered = await buildCase(tamperedMeter, advice, decisions, createdAt);
const tamperedVerification = await verifySignedAttestation(tampered.climateCase, signed, verifyOptions);

const summary = (built, verification) => ({
  meterSeriesDigest: built.digest,
  result: built.climateCase.verifications[0].result,
  flags: built.statuses.map(({ timestamp, state, decision }) => ({ timestamp, state, decision: decision?.decision ?? null })),
  emissionsTCo2e: built.analysis.emissions.emissionsTCo2e,
  excludedEnergyKWh: built.analysis.emissions.excludedEnergyKWh,
  attestationValidForSignedEvidence: verification.validForSignedEvidence,
  attestationValidForCurrentEvidence: verification.validForCurrentEvidence,
  changedRefs: verification.changedRefs,
  signatures: verification.signature.signatures.map((item) => ({
    algorithm: item.signature.algorithm,
    signatureValid: item.signatureValid,
  })),
});

const report = {
  schemaVersion: "climatechain.building-case-run/0.1",
  runAt: createdAt,
  organisingQuestion:
    "Can this building's Scope 2 number be trusted, and who decided what about each flagged reading?",
  building: loaded.metadata,
  sourceIntegrity: integrity,
  clean: summary(clean, cleanVerification),
  tamper: {
    index: tamperIndex,
    timestamp: loaded.meter[tamperIndex].timestamp,
    multiplier: 20,
    ...summary(tampered, tamperedVerification),
  },
  publishedKeys,
  attestation: signed,
  case: clean.climateCase,
  limitations: [
    "Signing keys are generated for each run; they identify the run, not a person or an organisation.",
    "Decision-model advice is recorded but never changes a status; a person's decision does.",
    "A decision is not an explanation: the cause of each flagged reading is not confirmed by site records.",
    "Advice accuracy has not been measured on labelled data yet.",
  ],
};
await writeFile(OUT_FILE, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ clean: report.clean, tamper: { ...report.tamper } }, null, 2));
