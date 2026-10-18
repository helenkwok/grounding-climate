// Writes a W3C Verifiable Credential view of each signed case (UNTP 0.6.0 shape; see docs/credentials.md):
//   reports/<module>/credential.json          the credential with a Data Integrity proof set (Ed25519, then ML-DSA-65)
//   reports/<module>/credential.eddsa.jws     VC-JOSE-COSE envelope, alg EdDSA
//   reports/<module>/credential.ml-dsa-65.jws VC-JOSE-COSE envelope, alg ML-DSA-65 (RFC 9964)
//   reports/did.json                          the issuer's DID document (public keys only)
// Like the case runs, each export makes fresh demo keys; only their public halves are kept, in reports/did.json.
//
//   node scripts/export-credentials.mjs
import { readFile, readdir, writeFile } from "node:fs/promises";

import { estimateBatteryHealth } from "@grounding-climate/battery-dpp";
import { addProofSet, caseCredential, issuerDidDocument, signCredentialJws } from "@grounding-climate/core";
import { InMemoryNodeCryptoProvider } from "@grounding-climate/crypto-node";

export const reports = new URL("../reports/", import.meta.url);
const readJson = (url) => readFile(url, "utf8").then(JSON.parse, () => undefined);

/** The battery's health recomputed from the committed history; it must agree with the signed case run. */
async function batteryHealth(run) {
  const history = await readJson(new URL("../data/external/batterylife-processed/battery-history.json", import.meta.url));
  const health = estimateBatteryHealth({ history });
  if (history.batteryId !== run.battery.batteryId || health.currentSoh !== run.clean.currentSoh) {
    throw new Error("battery-dpp: the committed history no longer gives the signed case's state of health");
  }
  return health;
}

/** Every module with a signed case, and the unsecured credential its committed files map to. */
export async function expectedCredentials() {
  const out = [];
  for (const entry of await readdir(reports, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = new URL(entry.name + "/", reports);
    const run = await readJson(new URL("case-run.json", dir));
    if (!run) continue;
    if (run.battery) run.health = await batteryHealth(run);
    const record = await readJson(new URL("anchor.json", dir));
    const anchor = record && { record, proofPath: "reports/" + entry.name + "/anchor.ots" };
    out.push({ module: entry.name, dir, credential: await caseCredential(entry.name, run, anchor) });
  }
  return out;
}

if (import.meta.url === new URL(process.argv[1], "file://").href) {
  const created = new Date().toISOString();
  const signer = new InMemoryNodeCryptoProvider();
  const options = { controller: "did:web:helenkwok.github.io:grounding-climate", createdAt: created };
  const ed = signer.generateEd25519Key({ keyId: "key:issuer-ed25519:" + created, ...options });
  const pq = signer.generateMlDsa65Key({ keyId: "key:issuer-ml-dsa-65:" + created, ...options });
  const signers = [ed, pq].map((pair) => ({ provider: signer, key: pair.signingKey }));
  const did = issuerDidDocument([await signer.describeKey(ed.signingKey.keyId), await signer.describeKey(pq.signingKey.keyId)]);
  await writeFile(new URL("did.json", reports), JSON.stringify(did, null, 2) + "\n");

  for (const { module, dir, credential } of await expectedCredentials()) {
    const secured = await addProofSet(credential, signers, created);
    await writeFile(new URL("credential.json", dir), JSON.stringify(secured, null, 2) + "\n");
    await writeFile(new URL("credential.eddsa.jws", dir), (await signCredentialJws(credential, signers[0])) + "\n");
    await writeFile(new URL("credential.ml-dsa-65.jws", dir), (await signCredentialJws(credential, signers[1])) + "\n");
    console.log(module + ": " + credential.type.join(", "));
  }
}
