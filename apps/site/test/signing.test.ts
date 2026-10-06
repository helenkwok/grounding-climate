// A record signed with browser-made keys verifies with only its published keys, and any change breaks it.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { InMemoryNodeCryptoProvider } from "@grounding-climate/crypto-node";
import { buildDisclosureReviewCase } from "@grounding-climate/disclosure";

import { signRecord, verifyRecord, type SignedRecord } from "../src/signing.ts";

const base = new InMemoryNodeCryptoProvider();
const cadi = JSON.parse(await readFile(new URL("../../../sources/cadi-candidates.json", import.meta.url), "utf8"));
const candidate = cadi.candidates.find((item: { id: string }) => item.id === "lpl-construction");
const signedAt = "2026-10-07T00:00:00Z";
const { caseBundle } = await buildDisclosureReviewCase({ candidate, claimId: "claim:lpl:2025:scope1", createdAt: signedAt, provider: base });
const record = await signRecord({
  climateCase: caseBundle,
  base,
  signer: { subjectId: "person:test-verifier", name: "Test verifier" },
  statement: "Test record.",
  claimRefs: [{ nodeType: "claim", id: caseBundle.claims[0]!.id }],
  verificationRef: { nodeType: "verification", id: caseBundle.verifications[0]!.id },
  signedAt,
});
const copy = (): SignedRecord => JSON.parse(JSON.stringify(record));

test("a browser-signed record verifies after a JSON round trip", async () => {
  const result = await verifyRecord(copy(), base);
  assert.equal(result.validForCurrentEvidence, true);
  assert.deepEqual(result.signature.signatures.map((item) => [item.signature.algorithm, item.signatureValid]), [["Ed25519", true], ["ML-DSA-65", true]]);
});

test("changing the claimed figure breaks the record", async () => {
  const edited = copy();
  const assertion = edited.case.claims[0]!.assertion;
  assert.equal(assertion.kind, "quantitative");
  if (assertion.kind === "quantitative") assertion.quantity.value = 6012.6;
  const result = await verifyRecord(edited, base);
  assert.equal(result.validForCurrentEvidence, false);
  assert.ok(result.changedRefs.length > 0);
});

test("changing a signature breaks the record", async () => {
  const edited = copy();
  const signature = edited.attestation.envelope.signatures[0]!;
  signature.value = signature.value.slice(0, -2) + (signature.value.endsWith("AA") ? "BB" : "AA");
  const result = await verifyRecord(edited, base);
  assert.equal(result.validForSignedEvidence, false);
});
