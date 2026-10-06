// Rebuilds the disclosure case from the committed candidates, review input and decision with the current code,
// and checks the committed signed attestation against it with only the published public keys.
import { readFile } from "node:fs/promises";

import { HYBRID_SIGNATURE_POLICY, publishedKeyResolver, verifySignedAttestation } from "@grounding-climate/core";
import { InMemoryNodeCryptoProvider } from "@grounding-climate/crypto-node";
import { DisclosureService } from "@grounding-climate/disclosure";

const json = async (path) => JSON.parse(await readFile(new URL("../" + path, import.meta.url), "utf8"));
const run = await json("reports/disclosure/case-run.json");
const crypto = new InMemoryNodeCryptoProvider();
const { caseBundle } = await new DisclosureService((await json("sources/cadi-candidates.json")).candidates, {
  ...(await json("reports/disclosure/review-input.json")),
  provider: crypto,
  observedAt: run.runAt,
  decisions: await json("reports/disclosure/claim-decisions.json"),
}).review();
const result = await verifySignedAttestation(caseBundle, run.attestation, {
  hashProvider: crypto,
  resolveKey: publishedKeyResolver(run.publishedKeys, crypto),
  policy: HYBRID_SIGNATURE_POLICY,
});
if (!result.validForCurrentEvidence) {
  console.error("Disclosure case no longer matches its signed attestation: " + JSON.stringify({ signatureValid: result.signature.valid, changedRefs: result.changedRefs }));
  process.exit(1);
}
console.log("Disclosure case matches its signed attestation (Ed25519 + ML-DSA-65, " + run.runAt + ").");
