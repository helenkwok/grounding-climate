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
