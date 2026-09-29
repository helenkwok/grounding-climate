import assert from "node:assert/strict";
import test from "node:test";

import {
  appendSignedLogRecord,
  verifySignedLog,
  type SignedLogRecord,
} from "@climatechain/core";

import { InMemoryNodeCryptoProvider } from "../src/index.js";

test("signed log verifies an intact hash chain", async () => {
  const provider = new InMemoryNodeCryptoProvider();
  const pair = provider.generateEd25519Key({
    keyId: "key:log",
    controller: "service:climatechain",
    createdAt: "2026-09-29T00:00:00Z",
  });

  const records: SignedLogRecord[] = [];

  records.push(
    await appendSignedLogRecord(records, {
      type: "attestation-created",
      attestationId: "attestation:1",
    }, {
      timestamp: "2026-09-29T01:00:00Z",
      hashProvider: provider,
      signers: [{ provider, key: pair.signingKey }],
    }),
  );

  records.push(
    await appendSignedLogRecord(records, {
      type: "attestation-challenged",
      attestationId: "attestation:1",
    }, {
      timestamp: "2026-09-29T02:00:00Z",
      hashProvider: provider,
      signers: [{ provider, key: pair.signingKey }],
    }),
  );

  const result = await verifySignedLog(records, {
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
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.invalidSequences, []);
});

test("signed log detects a modified historical event", async () => {
  const provider = new InMemoryNodeCryptoProvider();
  const pair = provider.generateEd25519Key({
    keyId: "key:log-tamper",
    controller: "service:climatechain",
    createdAt: "2026-09-29T00:00:00Z",
  });

  const records: SignedLogRecord[] = [];

  records.push(
    await appendSignedLogRecord(records, { value: 10 }, {
      timestamp: "2026-09-29T01:00:00Z",
      hashProvider: provider,
      signers: [{ provider, key: pair.signingKey }],
    }),
  );
  records.push(
    await appendSignedLogRecord(records, { value: 20 }, {
      timestamp: "2026-09-29T02:00:00Z",
      hashProvider: provider,
      signers: [{ provider, key: pair.signingKey }],
    }),
  );

  const tampered = structuredClone(records);
  const first = tampered[0];
  assert.ok(first);
  first.event = { value: 11 };

  const result = await verifySignedLog(tampered, {
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
  });

  assert.equal(result.valid, false);
  assert.equal(result.digestsValid, false);
  assert.equal(result.signaturesValid, false);
  assert.ok(result.invalidSequences.includes(0));
});
