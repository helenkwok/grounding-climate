// The carbon case end to end: committed ACR records (and any report the reviewer brings) -> reconciliation by
// project and vintage -> a person's decision on the coverage gap -> attestation signed with Ed25519 and ML-DSA-65 ->
// verification with only the public keys -> the same check after one retirement is duplicated.
//
//   node scripts/run-carbon-case.mjs
//   node scripts/run-carbon-case.mjs --import climate-action-reserve:retirement:<file.csv>:<page URL> --out <run.json>
//
// The committed run (reports/carbon-registry/case-run.json) uses the ACR records only. A run with --import must be
// written elsewhere with --out: the reviewer's report is not redistributable. Decisions are written by a person in
// reports/carbon-registry/coverage-decisions.json; the script prints a template when the gap has no current decision.
import { writeFile } from "node:fs/promises";

import { InMemoryNodeCryptoProvider } from "@grounding-climate/crypto-node";

import { signCase, verificationSummary } from "./lib/attest.mjs";
import { applyImports, DECISIONS, loadCarbonCase } from "./lib/carbon-case.mjs";

const argv = process.argv.slice(2);
const outArg = argv.indexOf("--out");
const createdAt = new Date().toISOString();
const { service, records } = await loadCarbonCase({ provider: new InMemoryNodeCryptoProvider(), observedAt: createdAt });
const imported = await applyImports(service, argv, createdAt);
if (imported > 0 && outArg < 0) throw new Error("A run with --import needs --out outside the repository.");
const OUT = outArg >= 0 ? argv[outArg + 1] : new URL("../reports/carbon-registry/case-run.json", import.meta.url);

const clean = await service.review();
const open = clean.review.filter((status) => status.state !== "decided");
if (open.length > 0) {
  console.log("The coverage gap has no current decision. Template for " + DECISIONS + ":");
  console.log(JSON.stringify(open.map((status) => ({
    flagId: status.flag.id,
    decision: "out-of-sample | investigate",
    reason: "",
    decidedBy: "person:<your id>",
    decidedAt: "<ISO time>",
    inputDigest: clean.reviewInputDigest,
  })), null, 2));
}

const verification = clean.caseBundle.verifications[0];
const claim = clean.caseBundle.claims[0];
const { attestation, publishedKeys, verify } = await signCase({
  climateCase: clean.caseBundle,
  module: "carbon-registry",
  statement:
    "Registry records reconciled by project and vintage" + (imported ? ", including reports the reviewer brought (digests only)" : "") +
    ". Verification result at signing: " + verification.result + ".",
  claimRef: { nodeType: "claim", id: claim.id },
  verificationRef: { nodeType: "verification", id: verification.id },
  createdAt,
});

// Tamper: the first ACR retirement appears twice, as a double claim would.
const first = records.find((record) => record.kind === "retirement");
service.setRecords([...records, { ...first, sourceRow: records.length + 2 }]);
const tampered = await service.review();
service.setRecords(records);

const summary = (built, someVerification) => ({
  records: built.report.recordCount,
  supported: built.report.supportedCount,
  issuedNotRetired: built.report.issuedNotRetiredCount,
  missingIssuance: built.report.unresolvedMissingIssuanceCount,
  overRetired: built.report.overRetiredCount,
  duplicateExcess: built.report.duplicateExcessCount,
  result: built.caseBundle.verifications[0].result,
  coverageDecision: built.review.map(({ flag, state, decision }) => ({ flag: flag.id, state, decision: decision?.decision ?? null })),
  ...verificationSummary(someVerification),
});

const report = {
  schemaVersion: "grounding.carbon-case-run/0.1",
  runAt: createdAt,
  organisingQuestion: "Do these registry records show any credit retired twice or beyond its issuance, and who decided what a gap in the records means?",
  clean: summary(clean, await verify(clean.caseBundle)),
  tamper: { duplicated: first.serialRange, ...summary(tampered, await verify(tampered.caseBundle)) },
  publishedKeys,
  attestation,
  case: clean.caseBundle,
  limitations: [
    "Signing keys are generated for each run; they identify the run, not a person or an organisation.",
    "The ACR records are a 100-row test sample from CarbonPlan OffsetsDB, not the full registry.",
    "Duplicates are exact serial-range matches; overlapping ranges written differently are not compared.",
    "Durability, additionality and project quality are not assessed.",
  ],
};
await writeFile(OUT, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ clean: report.clean, tamper: report.tamper }, null, 2));
