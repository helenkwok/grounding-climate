// Checks each case's credential offline: it must be exactly what its committed signed case maps to, and its Data
// Integrity proof set and both VC-JOSE-COSE envelopes (EdDSA and ML-DSA-65) must verify against reports/did.json.
import { readFile } from "node:fs/promises";

import { canonicalize, hybridSatisfied, verifyCredentialJws, verifyProofSet } from "@grounding-climate/core";
import { InMemoryNodeCryptoProvider } from "@grounding-climate/crypto-node";

import { expectedCredentials, reports } from "./export-credentials.mjs";

const did = JSON.parse(await readFile(new URL("did.json", reports), "utf8"));
const provider = new InMemoryNodeCryptoProvider();
let failed = false;

for (const { module, dir, credential } of await expectedCredentials()) {
  const problems = [];
  const secured = await readFile(new URL("credential.json", dir), "utf8").then(JSON.parse, () => undefined);
  if (!secured) {
    console.error(module + ": no credential.json; run scripts/export-credentials.mjs");
    failed = true;
    continue;
  }
  const { proof: _proof, ...body } = secured;
  if (canonicalize(body) !== canonicalize(credential)) problems.push("credential.json no longer matches its signed case; run scripts/export-credentials.mjs");
  const proofs = await verifyProofSet(secured, did, provider);
  if (!hybridSatisfied(proofs)) problems.push("proof set: " + JSON.stringify(proofs.map((p) => [p.cryptosuite, p.valid])));
  const envelopes = [];
  for (const name of ["credential.eddsa.jws", "credential.ml-dsa-65.jws"]) {
    envelopes.push(await verifyCredentialJws(await readFile(new URL(name, dir), "utf8").catch(() => ""), credential, did, provider));
  }
  if (!hybridSatisfied(envelopes)) problems.push("JWS: " + JSON.stringify(envelopes.map((e) => [e.alg, e.valid, e.reason ?? ""])));
  if (problems.length) {
    failed = true;
    for (const problem of problems) console.error(module + ": " + problem);
  } else {
    console.log(module + ": " + credential.type[1] + " matches its case; EdDSA and ML-DSA-65 JWS and proof set valid");
  }
}

if (failed) process.exit(1);
