// Attacks on the signature envelope and the signed log, with real Ed25519 keys.
import assert from "node:assert/strict";
import test from "node:test";

import {
  appendSignedLogRecord,
  createSignatureEnvelope,
  verifySignatureEnvelope,
  verifySignedLog,
  type SignatureEnvelope,
  type SignaturePolicy,
  type SignedLogRecord,
} from "@climatechain/core";

import { InMemoryNodeCryptoProvider } from "../src/index.js";

const payload = { claimId: "claim:scope2", evidenceRoot: "sha256:example" };

async function setup() {
  const provider = new InMemoryNodeCryptoProvider();
  const pair = provider.generateEd25519Key({
    keyId: "key:org",
    controller: "org:test",
    createdAt: "2026-01-01T00:00:00Z",
  });
  const envelope = await createSignatureEnvelope(payload, {
    domain: "climatechain.attestation",
    schemaVersion: "0.1",
    createdAt: "2026-09-01T00:00:00Z",
    hashProvider: provider,
    signers: [{ provider, key: pair.signingKey }],
  });
  const verify = (env: SignatureEnvelope, policy: SignaturePolicy = { requiredSuites: ["classical"] }) =>
    verifySignatureEnvelope(payload, env, {
      hashProvider: provider,
      resolveKey: async (signature) => {
        const metadata = await provider.describeKey(signature.keyId);
        return metadata && { provider, key: metadata.verificationKey, metadata };
      },
      policy,
    });
  return { provider, envelope, verify };
}

test("backdating createdAt to before a revocation no longer passes", async () => {
  const { provider, envelope, verify } = await setup();
  assert.equal((await verify(envelope)).valid, true);

  // The key is later found compromised from June: a September signature must fail.
  provider.revokeKey("key:org", "2026-06-01T00:00:00Z");
  assert.equal((await verify(envelope)).valid, false);

  // Moving createdAt to before the revocation used to make it pass. createdAt is now signed.
  const backdated = { ...envelope, createdAt: "2026-02-01T00:00:00Z" };
  const result = await verify(backdated);
  assert.equal(result.signatures[0]?.keyValidAtSigningTime, true);
  assert.equal(result.signatures[0]?.signatureValid, false);
  assert.equal(result.payloadHashMatches, false);
  assert.equal(result.valid, false);
});

test("one signature copied twice counts once toward a two-signature policy", async () => {
  const { envelope, verify } = await setup();
  const signature = envelope.signatures[0]!;
  const duplicated = { ...envelope, signatures: [signature, { ...signature }] };
  const result = await verify(duplicated, { requiredSuites: ["classical"], minimumSignatures: 2 });

  assert.ok(result.signatures.every((item) => item.signatureValid));
  assert.deepEqual(result.duplicateKeyIds, ["key:org"]);
  assert.equal(result.policySatisfied, false);
  assert.equal(result.valid, false);
});

test("two different keys satisfy a two-signature policy", async () => {
  const { provider, verify } = await setup();
  const second = provider.generateEd25519Key({ keyId: "key:second", controller: "org:other", createdAt: "2026-01-01T00:00:00Z" });
  const envelope = await createSignatureEnvelope(payload, {
    domain: "climatechain.attestation",
    schemaVersion: "0.1",
    createdAt: "2026-09-01T00:00:00Z",
    hashProvider: provider,
    signers: [
      { provider, key: { keyId: "key:org", suite: "classical", algorithm: "Ed25519" } },
      { provider, key: second.signingKey },
    ],
  });
  const result = await verify(envelope, { requiredSuites: ["classical"], minimumSignatures: 2 });
  assert.deepEqual(result.duplicateKeyIds, []);
  assert.equal(result.valid, true);
});

test("an envelope claiming the old unsigned-time version is refused", async () => {
  const { envelope, verify } = await setup();
  const old = { ...envelope, version: "climatechain.signature-envelope/0.1" } as unknown as SignatureEnvelope;
  const result = await verify(old);
  assert.equal(result.versionSupported, false);
  assert.equal(result.valid, false);
});

test("a signed-log record made after its key was revoked fails", async () => {
  const provider = new InMemoryNodeCryptoProvider();
  const pair = provider.generateEd25519Key({ keyId: "key:log", controller: "service:test", createdAt: "2026-01-01T00:00:00Z" });
  const records: SignedLogRecord[] = [];
  for (const timestamp of ["2026-05-01T00:00:00Z", "2026-07-01T00:00:00Z"]) {
    records.push(
      await appendSignedLogRecord(records, { type: "event", at: timestamp }, {
        timestamp,
        hashProvider: provider,
        signers: [{ provider, key: pair.signingKey }],
      }),
    );
  }
  const verify = () =>
    verifySignedLog(records, {
      hashProvider: provider,
      resolveKey: async (signature) => {
        const metadata = await provider.describeKey(signature.keyId);
        return metadata && { provider, key: metadata.verificationKey, metadata };
      },
    });

  assert.equal((await verify()).valid, true);
  provider.revokeKey("key:log", "2026-06-01T00:00:00Z");
  const result = await verify();
  assert.equal(result.valid, false);
  assert.deepEqual(result.invalidSequences, [1]);
});
