// Rebuilds the energy case from the committed series, published reference, request and approval with the
// current code, and checks the committed signed attestation against it with only the published public keys.
import { readFile } from "node:fs/promises";

import { HYBRID_SIGNATURE_POLICY, publishedKeyResolver, verifySignedAttestation } from "@climatechain/core";
import { InMemoryNodeCryptoProvider } from "@climatechain/crypto-node";
import { buildEnergyActionCase } from "@climatechain/energy-forecast";

const json = async (path) => JSON.parse(await readFile(new URL("../" + path, import.meta.url), "utf8"));
const run = await json("reports/energy-forecast/case-run.json");
const action = await json("reports/energy-forecast/action-request.json");
const crypto = new InMemoryNodeCryptoProvider();
const { caseBundle } = await buildEnergyActionCase({
  caseId: run.case.caseId,
  createdAt: run.runAt,
  series: (await json("data/external/energy-eva-active-power-load/series.json")).series,
  published: (await json("packages/energy-forecast/references/energy-eva-active-power-load.json")).energyEva.publishedResults,
  action: { request: action.request, policy: action.policy },
  provider: crypto,
  decisions: await json("reports/energy-forecast/action-decisions.json"),
});
const result = await verifySignedAttestation(caseBundle, run.attestation, {
  hashProvider: crypto,
  resolveKey: publishedKeyResolver(run.publishedKeys, crypto),
  policy: HYBRID_SIGNATURE_POLICY,
});
if (!result.validForCurrentEvidence) {
  console.error("Energy case no longer matches its signed attestation: " + JSON.stringify({ signatureValid: result.signature.valid, changedRefs: result.changedRefs }));
  process.exit(1);
}
console.log("Energy case matches its signed attestation (Ed25519 + ML-DSA-65, " + run.runAt + ").");
