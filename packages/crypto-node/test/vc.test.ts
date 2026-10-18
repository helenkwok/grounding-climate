import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  BITCOIN_MAINNET_CAIP2,
  addProofSet,
  base58btc,
  batteryHealthAttributes,
  caseCredential,
  fromBase58btc,
  fromBase64Url,
  hybridSatisfied,
  issuerDidDocument,
  signCredentialJws,
  toBase64Url,
  verifyCredentialJws,
  verifyProofSet,
  type VerifiableCredential,
} from "@grounding-climate/core";

import { InMemoryNodeCryptoProvider } from "../src/index.js";

const reports = new URL("../../../../reports/", import.meta.url);
const readJson = async (path: string) => JSON.parse(await readFile(new URL(path, reports), "utf8"));

async function setup() {
  const provider = new InMemoryNodeCryptoProvider();
  const createdAt = "2026-10-18T00:00:00.000Z";
  const options = { controller: "did:web:example", createdAt };
  const ed = provider.generateEd25519Key({ keyId: "key:ed", ...options });
  const pq = provider.generateMlDsa65Key({ keyId: "key:pq", ...options });
  const did = issuerDidDocument([(await provider.describeKey("key:ed"))!, (await provider.describeKey("key:pq"))!]);
  const signers = [ed, pq].map((pair) => ({ provider, key: pair.signingKey }));
  const run = await readJson("energy-forecast/case-run.json");
  const anchor = { record: await readJson("energy-forecast/anchor.json"), proofPath: "reports/energy-forecast/anchor.ots" };
  const credential = await caseCredential("energy-forecast", run, anchor);
  return { provider, did, signers, credential, createdAt };
}

test("a case credential has the required VC 2.0 fields and UNTP DCC shape", async () => {
  const { credential } = await setup();
  assert.equal(credential["@context"][0], "https://www.w3.org/ns/credentials/v2");
  assert.deepEqual(credential.type, ["VerifiableCredential", "DigitalConformityCredential"]);
  assert.match(credential.issuer.id, /^did:web:/);
  assert.ok(!Number.isNaN(Date.parse(credential.validFrom)));
  assert.match(String(credential.credentialSubject.id), /^https:\/\//);
  assert.deepEqual(credential.credentialSubject.type, ["ConformityAttestation"]);
  const evidence = credential.evidence as Array<Record<string, unknown>>;
  assert.ok(evidence.some((item) => typeof item.cid === "string" && /^b[a-z2-7]{58}$/.test(item.cid)));
  const anchor = evidence.find((item) => (item.type as string[]).includes("TimestampAnchor"))!;
  assert.equal(anchor.chain, BITCOIN_MAINNET_CAIP2);
  assert.ok(!("anchor" in credential.credentialSubject) && !("proof" in credential));
});

test("both JWS verify, tampering one field breaks both, and the policy needs both", async () => {
  const { provider, did, signers, credential } = await setup();
  const jws = await Promise.all(signers.map((signer) => signCredentialJws(credential, signer)));
  const checks = await Promise.all(jws.map((item) => verifyCredentialJws(item, credential, did, provider)));
  assert.deepEqual(checks.map((check) => [check.alg, check.valid]), [["EdDSA", true], ["ML-DSA-65", true]]);
  assert.ok(hybridSatisfied(checks));
  assert.ok(!hybridSatisfied([checks[0]!]));

  // The same field changed inside each envelope's payload: both signatures fail.
  const tampered = structuredClone(credential);
  tampered.validFrom = "2020-01-01T00:00:00.000Z";
  for (const item of jws) {
    const [header, , signature] = item.split(".");
    const forged = header + "." + toBase64Url(new TextEncoder().encode(JSON.stringify(tampered))) + "." + signature;
    const check = await verifyCredentialJws(forged, tampered, did, provider);
    assert.equal(check.signatureValid, false);
  }
  // An unchanged envelope checked against a changed credential: the payload no longer matches.
  assert.equal((await verifyCredentialJws(jws[0]!, tampered, did, provider)).valid, false);
});

test("an alg that does not match the key named by kid is rejected", async () => {
  const { provider, did, signers, credential } = await setup();
  const jws = await signCredentialJws(credential, signers[0]!);
  const [header, payload, signature] = jws.split(".");
  const swapped = JSON.parse(new TextDecoder().decode(fromBase64Url(header!)));
  swapped.alg = "ML-DSA-65";
  const check = await verifyCredentialJws(toBase64Url(new TextEncoder().encode(JSON.stringify(swapped))) + "." + payload + "." + signature, credential, did, provider);
  assert.equal(check.valid, false);
  assert.match(check.reason ?? "", /does not match/);
  swapped.alg = "none";
  const none = await verifyCredentialJws(toBase64Url(new TextEncoder().encode(JSON.stringify(swapped))) + "." + payload + ".", credential, did, provider);
  assert.equal(none.valid, false);
});

test("the Data Integrity proof set verifies and breaks on a tamper", async () => {
  const { provider, did, signers, credential, createdAt } = await setup();
  const secured = await addProofSet(credential, signers, createdAt);
  assert.deepEqual(secured.proof!.map((proof) => proof.cryptosuite), ["eddsa-jcs-2022", "grounding-mldsa65-jcs-2026"]);
  assert.ok(hybridSatisfied(await verifyProofSet(secured, did, provider)));
  const tampered: VerifiableCredential = { ...secured, name: "changed" };
  assert.deepEqual((await verifyProofSet(tampered, did, provider)).map((check) => check.valid), [false, false]);
});

test("the battery passport maps state of health to DIN DKE SPEC 99100 names in %", async () => {
  const health = { initialCapacityAh: 50, currentCapacityAh: 45, sohVsInitial: 0.9, currentSoh: 45 / 58, observedCycle: 100 };
  const attributes = batteryHealthAttributes({ nominalCapacityAh: 58, cycles: 100 }, health, "2026-10-18T00:00:00Z");
  assert.deepEqual(attributes.stateOfHealth.value, 90);
  assert.equal(attributes.stateOfHealth.unit, "%");
  assert.deepEqual([attributes.capacityFade.value, attributes.capacityFade.batteryPass], [10, "capacityFade"]);
  assert.deepEqual([attributes.ratedCapacity.value, attributes.ratedCapacity.unit, attributes.ratedCapacity.dynamic], [58, "Ah", false]);
  assert.deepEqual([attributes.remainingCapacity.value, attributes.remainingCapacity.level], [45, "item"]);
  assert.equal(attributes.stateOfHealthVsRated.value, 77.59);

  const run = await readJson("battery-dpp/case-run.json");
  const credential = await caseCredential("battery-dpp", { ...run, health });
  const subject = credential.credentialSubject;
  assert.deepEqual(credential.type, ["VerifiableCredential", "DigitalProductPassport"]);
  for (const field of ["digitalProductPassportId", "uniqueProductIdentifier", "granularity", "dppSchemaVersion", "dppStatus", "lastUpdated", "economicOperatorId"]) {
    assert.ok(subject[field], field);
  }
  assert.equal(subject.granularity, "item");
  assert.equal(subject.id, subject.uniqueProductIdentifier);
  await assert.rejects(caseCredential("battery-dpp", run), /health/);
});

test("each credential's status matches the claim's status on the site, and keeps the recorded result beside it", async () => {
  // The site: building, energy and battery Rechecked; earth, carbon and disclosure Needs evidence.
  const expected: Record<string, [status: string, recorded: string]> = {
    "building-mrv": ["reconciled", "reconciled"],
    "energy-forecast": ["reconciled", "reconciled"],
    "battery-dpp": ["reconciled", "reconciled"],
    "earth-observation": ["insufficient-evidence", "reconciled"],
    "carbon-registry": ["insufficient-evidence", "insufficient-evidence"],
    disclosure: ["insufficient-evidence", "reconciled"],
  };
  for (const [module, [status, recorded]] of Object.entries(expected)) {
    const run = await readJson(module + "/case-run.json");
    // The passport needs recomputed health; the status does not depend on it.
    const health = { initialCapacityAh: 50, currentCapacityAh: 45, sohVsInitial: 0.9, currentSoh: 45 / 58, observedCycle: 100 };
    const credential = await caseCredential(module, module === "battery-dpp" ? { ...run, health } : run);
    const recheck = (credential.credentialSubject as { recheck: { status: string; recordedResult: string } }).recheck;
    assert.deepEqual([recheck.status, recheck.recordedResult], [status, recorded], module);
  }
});

test("base58btc round-trips, leading zeros included", () => {
  for (const bytes of [new Uint8Array([0, 0, 1, 2, 255]), new Uint8Array(0), crypto.getRandomValues(new Uint8Array(3309))]) {
    assert.deepEqual(fromBase58btc(base58btc(bytes)), bytes);
  }
  assert.equal(base58btc(new TextEncoder().encode("hello world")), "StV1DL6CwTryKyV");
});
