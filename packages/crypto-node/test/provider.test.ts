import assert from "node:assert/strict";
import test from "node:test";

import {
  createSignatureEnvelope,
  verifySignatureEnvelope,
} from "@climatechain/core";

import { InMemoryNodeCryptoProvider } from "../src/index.js";

test("Ed25519 provider signs and verifies an envelope", async () => {
  const provider = new InMemoryNodeCryptoProvider();
  const pair = provider.generateEd25519Key({
    keyId: "key:org:2026-09",
    controller: "org:test",
    createdAt: "2026-09-01T00:00:00Z",
  });

  const payload = {
    claimId: "claim:scope2",
    evidenceRoot: "sha256:example",
  };

  const envelope = await createSignatureEnvelope(payload, {
    domain: "climatechain.attestation",
    schemaVersion: "0.1",
    createdAt: "2026-09-29T00:00:00Z",
    hashProvider: provider,
    signers: [{ provider, key: pair.signingKey }],
  });

  const verified = await verifySignatureEnvelope(payload, envelope, {
    hashProvider: provider,
    resolveKey: async (signature) => {
      const metadata = await provider.describeKey(signature.keyId);
      if (!metadata) return undefined;
      return {
        provider,
        key: metadata.verificationKey,
        metadata,
      };
    },
    policy: { requiredSuites: ["classical"] },
  });

  assert.equal(verified.valid, true);
  assert.equal(verified.signatures[0]?.signatureValid, true);
});

test("hybrid envelope needs both the Ed25519 and the ML-DSA-65 signature", async () => {
  const provider = new InMemoryNodeCryptoProvider();
  const options = { controller: "org:test", createdAt: "2026-09-01T00:00:00Z" };
  const classical = provider.generateEd25519Key({ keyId: "key:ed", ...options });
  const pq = provider.generateMlDsa65Key({ keyId: "key:pq", ...options });
  assert.equal(pq.verificationKey.algorithm, "ML-DSA-65");

  const payload = { claimId: "claim:scope2" };
  const envelope = await createSignatureEnvelope(payload, {
    domain: "climatechain.attestation",
    schemaVersion: "0.1",
    createdAt: "2026-09-29T00:00:00Z",
    hashProvider: provider,
    signers: [
      { provider, key: classical.signingKey },
      { provider, key: pq.signingKey },
    ],
  });
  const verify = (env: typeof envelope) =>
    verifySignatureEnvelope(payload, env, {
      hashProvider: provider,
      resolveKey: async (signature) => {
        const metadata = await provider.describeKey(signature.keyId);
        return metadata && { provider, key: metadata.verificationKey, metadata };
      },
      policy: { requiredSuites: ["classical", "post-quantum"] },
    });

  assert.equal((await verify(envelope)).valid, true);

  const withoutPq = { ...envelope, signatures: envelope.signatures.slice(0, 1) };
  assert.equal((await verify(withoutPq)).valid, false);

  const [ed, mldsa] = envelope.signatures;
  const forged = { ...envelope, signatures: [ed!, { ...mldsa!, value: ed!.value }] };
  const result = await verify(forged);
  assert.equal(result.signatures[1]?.signatureValid, false);
  assert.equal(result.valid, false);
});

test("one-byte-equivalent payload change fails signature and digest", async () => {
  const provider = new InMemoryNodeCryptoProvider();
  const pair = provider.generateEd25519Key({
    keyId: "key:tamper",
    controller: "org:test",
    createdAt: "2026-09-01T00:00:00Z",
  });

  const envelope = await createSignatureEnvelope(
    { value: "A" },
    {
      domain: "climatechain.attestation",
      schemaVersion: "0.1",
      createdAt: "2026-09-29T00:00:00Z",
      hashProvider: provider,
      signers: [{ provider, key: pair.signingKey }],
    },
  );

  const verified = await verifySignatureEnvelope(
    { value: "B" },
    envelope,
    {
      hashProvider: provider,
      resolveKey: async (signature) => {
        const metadata = await provider.describeKey(signature.keyId);
        if (!metadata) return undefined;
        return {
          provider,
          key: metadata.verificationKey,
          metadata,
        };
      },
      policy: { requiredSuites: ["classical"] },
    },
  );

  assert.equal(verified.payloadHashMatches, false);
  assert.equal(verified.signatures[0]?.signatureValid, false);
  assert.equal(verified.valid, false);
});

test("rotation preserves historical verification but disables old signing key", async () => {
  const provider = new InMemoryNodeCryptoProvider();
  const oldPair = provider.generateEd25519Key({
    keyId: "key:old",
    controller: "org:test",
    createdAt: "2026-09-01T00:00:00Z",
  });

  const payload = { statement: "historical attestation" };
  const envelope = await createSignatureEnvelope(payload, {
    domain: "climatechain.attestation",
    schemaVersion: "0.1",
    createdAt: "2026-09-29T00:00:00Z",
    hashProvider: provider,
    signers: [{ provider, key: oldPair.signingKey }],
  });

  const newPair = provider.rotateEd25519Key({
    previousKeyId: "key:old",
    newKeyId: "key:new",
    controller: "org:test",
    rotatedAt: "2026-10-01T00:00:00Z",
  });

  const oldVerified = await verifySignatureEnvelope(payload, envelope, {
    hashProvider: provider,
    resolveKey: async (signature) => {
      const metadata = await provider.describeKey(signature.keyId);
      if (!metadata) return undefined;
      return {
        provider,
        key: metadata.verificationKey,
        metadata,
      };
    },
    policy: { requiredSuites: ["classical"] },
  });

  assert.equal(oldVerified.valid, true);

  await assert.rejects(
    provider.sign(new TextEncoder().encode("new data"), oldPair.signingKey),
    /unavailable/,
  );

  const newSignature = await provider.sign(
    new TextEncoder().encode("new data"),
    newPair.signingKey,
  );
  assert.equal(newSignature.keyId, "key:new");

  const oldMetadata = await provider.describeKey("key:old");
  assert.equal(oldMetadata?.supersededBy, "key:new");
  assert.equal(oldMetadata?.validUntil, "2026-10-01T00:00:00Z");
});

test("noble-post-quantum, used by the demo page, verifies Node's ML-DSA-65 signatures", async () => {
  const { ml_dsa65 } = await import("@noble/post-quantum/ml-dsa.js");
  const provider = new InMemoryNodeCryptoProvider();
  const pair = provider.generateMlDsa65Key({ keyId: "key:pq", controller: "org:test", createdAt: "2026-09-01T00:00:00Z" });
  const message = new TextEncoder().encode("climatechain interop");
  const signature = await provider.sign(message, pair.signingKey);

  const spki = Buffer.from(pair.verificationKey.publicKey, "base64url");
  // ML-DSA-65 SPKI: a fixed 22-byte header (OID 2.16.840.1.101.3.4.3.18), then the 1,952-byte raw key.
  assert.equal(spki.subarray(0, 22).toString("hex"), "308207b2300b0609608648016503040312038207a100");
  const raw = spki.subarray(22);
  const sig = Buffer.from(signature.value, "base64url");

  assert.equal(ml_dsa65.verify(sig, message, raw), true);
  assert.equal(ml_dsa65.verify(sig, new TextEncoder().encode("climatechain interop!"), raw), false);
  const flipped = Buffer.from(sig);
  flipped[10] = flipped[10]! ^ 1;
  assert.equal(ml_dsa65.verify(flipped, message, raw), false);
});
