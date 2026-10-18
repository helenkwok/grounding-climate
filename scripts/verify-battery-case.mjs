// Rebuilds the battery passport case from the committed cycle history and sign-off with the current code,
// and checks the committed signed attestation against it with only the published public keys.
import { readFile } from "node:fs/promises";

import { HYBRID_SIGNATURE_POLICY, publishedKeyResolver, verifySignedAttestation } from "@grounding-climate/core";
import { InMemoryNodeCryptoProvider } from "@grounding-climate/crypto-node";
import { buildBatteryPassport } from "@grounding-climate/battery-dpp";

const json = async (path) => JSON.parse(await readFile(new URL("../" + path, import.meta.url), "utf8"));
const run = await json("reports/battery-dpp/case-run.json");
const crypto = new InMemoryNodeCryptoProvider();
const { caseBundle } = await buildBatteryPassport({
  history: await json("data/external/nasa-battery/battery-history.json"),
  provider: crypto,
  observedAt: run.runAt,
  decisions: await json("reports/battery-dpp/disposition-decisions.json"),
});
const result = await verifySignedAttestation(caseBundle, run.attestation, {
  hashProvider: crypto,
  resolveKey: publishedKeyResolver(run.publishedKeys, crypto),
  policy: HYBRID_SIGNATURE_POLICY,
});
if (!result.validForCurrentEvidence) {
  console.error("Battery case no longer matches its signed attestation: " + JSON.stringify({ signatureValid: result.signature.valid, changedRefs: result.changedRefs }));
  process.exit(1);
}
console.log("Battery case matches its signed attestation (Ed25519 + ML-DSA-65, " + run.runAt + ").");
