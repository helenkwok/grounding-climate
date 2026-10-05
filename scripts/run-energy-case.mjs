// The energy case end to end: committed Energy-EVA series -> benchmark checked against Energy-EVA's
// published results -> the operator's request checked by the policy, with the forecast's mean LOAD_ACC as its
// confidence -> a person's approval -> attestation signed with Ed25519 and ML-DSA-65 -> verification with only
// the public keys -> the same check after a tamper.
//
//   node scripts/run-energy-case.mjs
//
// Approvals are written by a person in reports/energy-forecast/action-decisions.json; the script prints a
// template when the action needs approval and has no current one.
import { readFile, writeFile } from "node:fs/promises";

import { InMemoryNodeCryptoProvider } from "@climatechain/crypto-node";
import { buildEnergyActionCase } from "@climatechain/energy-forecast";

import { signCase, verificationSummary } from "./lib/attest.mjs";

const json = async (path, fallback) => {
  try {
    return JSON.parse(await readFile(new URL("../" + path, import.meta.url), "utf8"));
  } catch (error) {
    if (fallback !== undefined && error?.code === "ENOENT") return fallback;
    throw error;
  }
};
const DECISIONS = "reports/energy-forecast/action-decisions.json";
const OUT = new URL("../reports/energy-forecast/case-run.json", import.meta.url);
const CASE_ID = "case:energy:active-power-load";

const { series } = await json("data/external/energy-eva-active-power-load/series.json");
const reference = await json("packages/energy-forecast/references/energy-eva-active-power-load.json");
const action = await json("reports/energy-forecast/action-request.json");
const decisions = await json(DECISIONS, []);
const crypto = new InMemoryNodeCryptoProvider();
const createdAt = new Date().toISOString();
const build = (someSeries) =>
  buildEnergyActionCase({
    caseId: CASE_ID,
    createdAt,
    series: someSeries,
    published: reference.energyEva.publishedResults,
    action: { request: action.request, policy: action.policy },
    provider: crypto,
    decisions,
  });

const clean = await build(series);
const open = clean.review.filter((status) => status.state !== "decided");
if (open.length > 0) {
  console.log("The action has no current approval. Template for " + DECISIONS + ":");
  console.log(
    JSON.stringify(
      open.map((status) => ({
        flagId: status.flag.id,
        decision: "approve | reject",
        reason: "",
        decidedBy: "person:<your id>",
        decidedAt: "<ISO time>",
        inputDigest: clean.actionInputDigest,
      })),
      null,
      2,
    ),
  );
}

const verification = clean.caseBundle.verifications[0];
const { attestation, publishedKeys, verify } = await signCase({
  climateCase: clean.caseBundle,
  module: "energy-forecast",
  statement:
    "Energy forecast benchmark recomputed from the committed Energy-EVA series and a bounded load action checked " +
    "against policy. Verification result at signing: " + verification.result + "; " +
    clean.caseBundle.claims[1].assertion.statement,
  claimRef: { nodeType: "claim", id: clean.caseBundle.claims[1].id },
  verificationRef: { nodeType: "verification", id: verification.id },
  createdAt,
});

// Tamper: the last load value of the first series raised by 20%; it falls in the last forecast window.
const ITEM = 0;
const tamperedSeries = structuredClone(series);
const last = tamperedSeries[ITEM].points.at(-1);
const original = last.value;
last.value = original * 1.2;
const tampered = await build(tamperedSeries);

const summary = (built, someVerification) => ({
  meanLoadAcc: built.confidence,
  baselineReproduced: built.comparisons.every((row) => row.reproduced),
  result: built.caseBundle.verifications[0].result,
  action: { permitted: built.action.permitted, approvedMWh: built.action.approvedMWh, requiresHumanApproval: built.action.requiresHumanApproval },
  approval: built.review.map(({ flag, state, decision }) => ({ flag: flag.id, state, decision: decision?.decision ?? null })),
  ...verificationSummary(someVerification),
});

const report = {
  schemaVersion: "climatechain.energy-case-run/0.1",
  runAt: createdAt,
  organisingQuestion: "Is the forecast good enough for the policy to allow this load shift, and who approved the capped amount?",
  data: { items: series.length, rows: series.reduce((sum, item) => sum + item.points.length, 0) },
  clean: summary(clean, await verify(clean.caseBundle)),
  tamper: {
    item: series[ITEM].itemId,
    itemIndex: ITEM,
    pointIndex: series[ITEM].points.length - 1,
    timestamp: last.timestamp,
    from: original,
    to: last.value,
    ...summary(tampered, await verify(tampered.caseBundle)),
  },
  publishedKeys,
  attestation,
  case: clean.caseBundle,
  limitations: [
    "Signing keys are generated for each run; they identify the run, not a person or an organisation.",
    "The request and policy are illustrative; the action is prepared, not sent to a market or a device.",
    "The forecast is Energy-EVA's dummy baseline; forecast quality is not a claim of avoided emissions.",
  ],
};
await writeFile(OUT, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ clean: report.clean, tamper: report.tamper }, null, 2));
