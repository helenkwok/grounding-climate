// Rebuilds the earth case from the committed HLS scene arrays, policy and area decision with the current code,
// and checks the committed signed attestation against it with only the published public keys.
import { readFile } from "node:fs/promises";

import { HYBRID_SIGNATURE_POLICY, publishedKeyResolver, verifySignedAttestation } from "@climatechain/core";
import { InMemoryNodeCryptoProvider } from "@climatechain/crypto-node";
import { buildEarthReviewCase } from "@climatechain/earth-observation";

import { loadHlsScene } from "./lib/hls-scene.mjs";

const json = async (path, fallback) => {
  try {
    return JSON.parse(await readFile(new URL("../" + path, import.meta.url), "utf8"));
  } catch (error) {
    if (fallback !== undefined && error?.code === "ENOENT") return fallback;
    throw error;
  }
};
const run = await json("reports/earth-observation/case-run.json");
const pinned = await json("reports/earth-observation/t10seh-2018190-nbr.json");
const crypto = new InMemoryNodeCryptoProvider();
const { caseBundle } = await buildEarthReviewCase({
  caseId: run.case.caseId,
  createdAt: run.runAt,
  scene: (await loadHlsScene(run.scene.id)).scene,
  pinned: pinned.baseline.metrics,
  policy: (await json("reports/earth-observation/area-policy.json")).policy,
  provider: crypto,
  decisions: await json("reports/earth-observation/area-decisions.json", []),
  publishedPrithviIoU: pinned.publishedPrithviReference.burnClassIoU,
});
const result = await verifySignedAttestation(caseBundle, run.attestation, {
  hashProvider: crypto,
  resolveKey: publishedKeyResolver(run.publishedKeys, crypto),
  policy: HYBRID_SIGNATURE_POLICY,
});
if (!result.validForCurrentEvidence) {
  console.error("Earth case no longer matches its signed attestation: " + JSON.stringify({ signatureValid: result.signature.valid, changedRefs: result.changedRefs }));
  process.exit(1);
}
console.log("Earth case matches its signed attestation (Ed25519 + ML-DSA-65, " + run.runAt + ").");
