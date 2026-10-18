// The battery passport case end to end: committed BatteryLife cycle history -> health estimate and the
// policy's proposed disposition -> a person's sign-off -> attestation signed with Ed25519 and ML-DSA-65 ->
// verification with only the public keys -> the same check after a tamper.
//
//   node scripts/run-battery-case.mjs
//
// Sign-off decisions are written by a person in reports/battery-dpp/disposition-decisions.json; the script
// prints a template when the disposition has no current sign-off.
import { readFile, writeFile } from "node:fs/promises";

import { InMemoryNodeCryptoProvider } from "@grounding-climate/crypto-node";
import { buildBatteryPassport } from "@grounding-climate/battery-dpp";

import { signCase, verificationSummary } from "./lib/attest.mjs";

const json = async (path, fallback) => {
  try {
    return JSON.parse(await readFile(new URL("../" + path, import.meta.url), "utf8"));
  } catch (error) {
    if (fallback !== undefined && error?.code === "ENOENT") return fallback;
    throw error;
  }
};
const DECISIONS = "reports/battery-dpp/disposition-decisions.json";
const OUT = new URL("../reports/battery-dpp/case-run.json", import.meta.url);

const history = await json("data/external/batterylife-processed/battery-history.json");
const decisions = await json(DECISIONS, []);
const crypto = new InMemoryNodeCryptoProvider();
const createdAt = new Date().toISOString();
const build = (someHistory) =>
  buildBatteryPassport({ history: someHistory, provider: crypto, observedAt: createdAt, decisions });

const clean = await build(history);
const open = clean.review.filter((status) => status.state !== "decided");
if (open.length > 0) {
  console.log("The disposition has no current sign-off. Template for " + DECISIONS + ":");
  console.log(
    JSON.stringify(
      open.map((status) => ({
        flagId: status.flag.id,
        decision: "approve | reuse | repurpose | recycle | service-review",
        reason: "",
        decidedBy: "person:<your id>",
        decidedAt: "<ISO time>",
        inputDigest: clean.passport.inputDigest,
      })),
      null,
      2,
    ),
  );
}

const claimId = clean.caseBundle.claims[0].id;
const verificationId = clean.caseBundle.verifications[0].id;
const { attestation, publishedKeys, verify } = await signCase({
  climateCase: clean.caseBundle,
  module: "battery-dpp",
  statement:
    "Battery passport for " + history.batteryId + " recomputed from the BatteryLife cycle history. " +
    "Verification result at signing: " + clean.caseBundle.verifications[0].result + "; disposition " +
    clean.passport.disposition + (open.length ? ", not signed off." : ", signed off by a person."),
  claimRef: { nodeType: "claim", id: claimId },
  verificationRef: { nodeType: "verification", id: verificationId },
  createdAt,
});

// Tamper: the last cycle's capacity raised by 20%, as in the BatteryLife smoke.
const tamperedHistory = structuredClone(history);
const last = tamperedHistory.cycles.at(-1);
const originalCapacity = last.dischargeCapacityAh;
last.dischargeCapacityAh = originalCapacity * 1.2;
const tampered = await build(tamperedHistory);

const summary = (built, verification) => ({
  inputDigest: built.passport.inputDigest,
  result: built.caseBundle.verifications[0].result,
  currentSoh: built.passport.currentSoh,
  estimatedRulCycles: built.passport.estimatedRulCycles,
  disposition: built.passport.disposition,
  signOff: built.review.map(({ flag, state, decision }) => ({ flag: flag.id, state, decision: decision?.decision ?? null })),
  ...verificationSummary(verification),
});

const report = {
  schemaVersion: "grounding.battery-case-run/0.1",
  runAt: createdAt,
  organisingQuestion: "Is this cell's second-life disposition supported by its measured capacity, and who signed it off?",
  battery: { batteryId: history.batteryId, nominalCapacityAh: history.nominalCapacityAh, cycles: history.cycles.length },
  clean: summary(clean, await verify(clean.caseBundle)),
  tamper: {
    cycle: last.cycle ?? history.cycles.length,
    field: "dischargeCapacityAh",
    from: originalCapacity,
    to: last.dischargeCapacityAh,
    ...summary(tampered, await verify(tampered.caseBundle)),
  },
  publishedKeys,
  attestation,
  case: clean.caseBundle,
  limitations: [
    "Signing keys are generated for each run; they identify the run, not a person or an organisation.",
    "The disposition is decision support; the claim lists the condition and safety assessments it does not cover.",
    "Remaining life comes from a straight-line capacity trend, not BatteryLife's published models.",
  ],
};
await writeFile(OUT, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ clean: report.clean, tamper: report.tamper }, null, 2));
