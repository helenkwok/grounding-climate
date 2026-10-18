// Rebuilds the carbon case from the committed ACR records and decision with the current code (plus any report the
// reviewer brings again with --import), and checks the signed attestation with only the published public keys.
// A reviewer-supplied report whose digest differs from the signed one is reported as source-changed.
//   node scripts/verify-carbon-case.mjs [--run <run.json>] [--import <registry>:<kind>:<file>:<page URL>]...
import { readFile } from "node:fs/promises";

import { HYBRID_SIGNATURE_POLICY, publishedKeyResolver, verifySignedAttestation } from "@grounding-climate/core";
import { InMemoryNodeCryptoProvider } from "@grounding-climate/crypto-node";

import { applyImports, loadCarbonCase } from "./lib/carbon-case.mjs";

const argv = process.argv.slice(2);
const runArg = argv.indexOf("--run");
const run = JSON.parse(
  await readFile(runArg >= 0 ? argv[runArg + 1] : new URL("../reports/carbon-registry/case-run.json", import.meta.url), "utf8"),
);
const crypto = new InMemoryNodeCryptoProvider();
const { service } = await loadCarbonCase({ provider: crypto, observedAt: run.runAt, caseId: run.case.caseId });
const signedImports = run.case.evidence.filter((item) => item.access?.mode === "reviewer-supplied");
// The signed download times are part of the case; each brought file is compared by its records' digest.
await applyImports(service, argv, (index) => signedImports[index]?.source.retrievedAt ?? run.runAt);
const { caseBundle } = await service.review();
const result = await verifySignedAttestation(caseBundle, run.attestation, {
  hashProvider: crypto,
  resolveKey: publishedKeyResolver(run.publishedKeys, crypto),
  policy: HYBRID_SIGNATURE_POLICY,
});
if (!result.validForCurrentEvidence) {
  const changed = new Set(result.changedRefs.map((ref) => ref.id));
  const sourceChanged = signedImports.filter((item) => changed.has(item.id)).map((item) => item.id);
  console.error(
    (sourceChanged.length ? "source-changed: " + sourceChanged.join(", ") + ". " : "") +
      "Carbon case no longer matches its signed attestation: " +
      JSON.stringify({ signatureValid: result.signature.valid, changedRefs: result.changedRefs }),
  );
  process.exit(1);
}
console.log("Carbon case matches its signed attestation (Ed25519 + ML-DSA-65, " + run.runAt + ").");
