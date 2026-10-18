// The disclosure case end to end: a figure extracted from a company's own public page -> a person's decision on
// what the claim may rest on (nothing can be recalculated) -> attestation signed with Ed25519 and ML-DSA-65 ->
// verification with only the public keys -> the same check after the extracted figure changes.
//
//   node scripts/run-disclosure-case.mjs
//
// Decisions are written by a person in reports/disclosure/claim-decisions.json; the script prints a template
// when the claim has no current decision.
import { readFile, writeFile } from "node:fs/promises";

import { InMemoryNodeCryptoProvider } from "@grounding-climate/crypto-node";
import { DisclosureService } from "@grounding-climate/disclosure";

import { signCase, verificationSummary } from "./lib/attest.mjs";

const json = async (path, fallback) => {
  try {
    return JSON.parse(await readFile(new URL("../" + path, import.meta.url), "utf8"));
  } catch (error) {
    if (fallback !== undefined && error?.code === "ENOENT") return fallback;
    throw error;
  }
};
const DECISIONS = "reports/disclosure/claim-decisions.json";
const OUT = new URL("../reports/disclosure/case-run.json", import.meta.url);

const input = await json("reports/disclosure/review-input.json");
const { candidates } = await json("sources/cadi-candidates.json");
const createdAt = new Date().toISOString();
const service = new DisclosureService(candidates, {
  ...input,
  provider: new InMemoryNodeCryptoProvider(),
  observedAt: createdAt,
  decisions: await json(DECISIONS, []),
});

const clean = await service.review();
const open = clean.review.filter((status) => status.state !== "decided");
if (open.length > 0) {
  console.log("The claim has no current decision. Template for " + DECISIONS + ":");
  console.log(JSON.stringify(open.map((status) => ({
    flagId: status.flag.id,
    decision: "accept-as-attributed | needs-source | reject",
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
  module: "disclosure",
  statement:
    "Public figure extracted from the company's own page, with a person's decision on what the claim rests on. " +
    "Not recalculated. Verification result at signing: " + verification.result + ".",
  claimRef: { nodeType: "claim", id: claim.id },
  verificationRef: { nodeType: "verification", id: verification.id },
  createdAt,
});

service.setReviewedValue(input.tamper.to);
const tampered = await service.review();
service.resetCandidates();

const summary = (built, someVerification) => ({
  value: built.caseBundle.claims[0].assertion.quantity.value,
  result: built.caseBundle.verifications[0].result,
  decision: built.review.map(({ flag, state, decision }) => ({ flag: flag.id, state, decision: decision?.decision ?? null })),
  ...verificationSummary(someVerification),
});

const report = {
  schemaVersion: "grounding.disclosure-case-run/0.1",
  runAt: createdAt,
  organisingQuestion: "What may a public emissions figure rest on when nobody outside the company can recalculate it?",
  input,
  clean: summary(clean, await verify(clean.caseBundle)),
  tamper: { ...input.tamper, ...summary(tampered, await verify(tampered.caseBundle)) },
  publishedKeys,
  attestation,
  case: clean.caseBundle,
  limitations: [
    "Signing keys are generated for each run; they identify the run, not a person or an organisation.",
    "The figure is extracted by hand from the company's page; the page itself is link-only and may change.",
    "Accepted as attributed means the claim rests on the company's statement; nothing is recalculated or audited.",
  ],
};
await writeFile(OUT, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ clean: report.clean, tamper: report.tamper }, null, 2));
