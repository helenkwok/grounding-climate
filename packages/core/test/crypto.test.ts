import assert from "node:assert/strict";
import test from "node:test";

import {
  createSignatureEnvelope,
  isKeyValidAt,
  verifySignatureEnvelope,
} from "../src/index.js";
import type {
  CryptoProvider,
  CryptoSignature,
  KeyMetadata,
  SigningKeyRef,
  VerificationKey,
} from "../src/index.js";

class DeterministicTestProvider implements CryptoProvider {
  constructor(private readonly keys: Map<string, KeyMetadata>) {}

  async hash(data: Uint8Array): Promise<{ algorithm: string; value: string }> {
    let state = 2166136261;
    for (const byte of data) {
      state ^= byte;
      state = Math.imul(state, 16777619);
    }
    return {
      algorithm: "SHA-256",
      value: (state >>> 0).toString(16).padStart(8, "0"),
    };
  }

  async sign(
    payload: Uint8Array,
    key: SigningKeyRef,
  ): Promise<CryptoSignature> {
    const digest = await this.hash(payload);
    return {
      suite: key.suite,
      algorithm: key.algorithm,
      keyId: key.keyId,
      encoding: "base64url",
      value: key.keyId + "." + digest.value,
    };
  }

  async verify(
    payload: Uint8Array,
    signature: CryptoSignature,
    key: VerificationKey,
  ): Promise<boolean> {
    const expected = await this.sign(payload, key);
    return expected.value === signature.value;
  }

  async describeKey(keyId: string): Promise<KeyMetadata | undefined> {
    return this.keys.get(keyId);
  }
}

function key(
  keyId: string,
  suite: "classical" | "post-quantum",
  algorithm: string,
): KeyMetadata {
  return {
    keyId,
    suite,
    algorithm,
    controller: "org:test",
    createdAt: "2026-09-01T00:00:00Z",
    validFrom: "2026-09-01T00:00:00Z",
    verificationKey: {
      keyId,
      suite,
      algorithm,
      encoding: "raw-base64url",
      publicKey: "test-only-" + keyId,
    },
  };
}

test("dual-suite policy requires both valid signatures", async () => {
  const classical = key("key:classical", "classical", "Ed25519");
  const pq = key("key:pq", "post-quantum", "ML-DSA-65");
  const keys = new Map([
    [classical.keyId, classical],
    [pq.keyId, pq],
  ]);
  const provider = new DeterministicTestProvider(keys);
  const payload = { claimId: "claim:1", evidenceRoot: "abc" };

  const envelope = await createSignatureEnvelope(payload, {
    domain: "climatechain.attestation",
    schemaVersion: "0.1",
    createdAt: "2026-09-29T00:00:00Z",
    hashProvider: provider,
    signers: [
      { provider, key: classical.verificationKey },
      { provider, key: pq.verificationKey },
    ],
  });

  const result = await verifySignatureEnvelope(payload, envelope, {
    hashProvider: provider,
    resolveKey: async (signature) => {
      const metadata = keys.get(signature.keyId);
      if (!metadata) return undefined;
      return {
        provider,
        key: metadata.verificationKey,
        metadata,
      };
    },
    policy: {
      requiredSuites: ["classical", "post-quantum"],
      minimumSignatures: 2,
    },
  });

  assert.equal(result.valid, true);
  assert.equal(result.signatures.length, 2);
});

test("changing one payload value fails the envelope", async () => {
  const classical = key("key:classical", "classical", "Ed25519");
  const keys = new Map([[classical.keyId, classical]]);
  const provider = new DeterministicTestProvider(keys);

  const envelope = await createSignatureEnvelope(
    { amount: 10 },
    {
      domain: "climatechain.attestation",
      schemaVersion: "0.1",
      createdAt: "2026-09-29T00:00:00Z",
      hashProvider: provider,
      signers: [{ provider, key: classical.verificationKey }],
    },
  );

  const result = await verifySignatureEnvelope(
    { amount: 11 },
    envelope,
    {
      hashProvider: provider,
      resolveKey: async () => ({
        provider,
        key: classical.verificationKey,
        metadata: classical,
      }),
      policy: { requiredSuites: ["classical"] },
    },
  );

  assert.equal(result.payloadHashMatches, false);
  assert.equal(result.signatures[0]?.signatureValid, false);
  assert.equal(result.valid, false);
});

test("historical signature time remains valid before key rotation", () => {
  const metadata = key("key:old", "classical", "Ed25519");
  metadata.validUntil = "2026-10-01T00:00:00Z";
  metadata.supersededBy = "key:new";

  assert.equal(
    isKeyValidAt(metadata, "2026-09-29T00:00:00Z"),
    true,
  );
  assert.equal(
    isKeyValidAt(metadata, "2026-10-02T00:00:00Z"),
    false,
  );
});

test("review statuses: current decision is decided, other input is stale, none is undecided", async () => {
  const { reviewStatuses, reviewVerification } = await import("../src/index.js");
  const digest = { algorithm: "SHA-256", value: "now" };
  const flags = [{ id: "flag:a", label: "A" }, { id: "flag:b", label: "B" }, { id: "flag:c", label: "C" }];
  const decision = (flagId: string, value: string) => ({
    flagId, decision: "exclude", reason: "test", decidedBy: "person:test", decidedAt: "2026-10-06T00:00:00Z",
    inputDigest: { algorithm: "SHA-256", value },
  });
  const statuses = reviewStatuses(flags, [decision("flag:a", "now"), decision("flag:b", "before")], digest);
  assert.deepEqual(statuses.map((status) => status.state), ["decided", "stale", "undecided"]);

  const node = reviewVerification({
    id: "verification:review", profile: "test/0.1", statuses,
    flagSource: { nodeType: "model-run", id: "model-run:screen" }, adviceRefs: [],
    createdAt: "2026-10-06T00:00:00Z", staleNote: "Stale. ", findings: [],
  });
  assert.equal(node.result, "insufficient-evidence");
  assert.deepEqual(node.checks.map((check) => check.outcome), ["pass", "fail", "not-run"]);
  assert.equal(node.verifier.id, "person:test");

  const allDecided = reviewStatuses(flags.slice(0, 1), [decision("flag:a", "now")], digest);
  assert.equal(reviewVerification({ ...{ id: "v", profile: "p", flagSource: { nodeType: "model-run", id: "m" }, adviceRefs: [], createdAt: "t", staleNote: "", findings: [] }, statuses: allDecided }).result, "reconciled");
});
