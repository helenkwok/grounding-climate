import assert from "node:assert/strict";
import test from "node:test";

import {
  GROUNDING_SCHEMA_VERSION,
  assessLedgerNeed,
  challengeAttestation,
  createEvidenceRoot,
  createSignatureEnvelope,
  createSignedAttestation,
  resolveChallenge,
  verifyEvidenceRoot,
  verifySignedAttestation,
} from "../src/index.js";
import type {
  ClimateCaseBundle,
  CryptoProvider,
  CryptoSignature,
  KeyMetadata,
  SigningKeyRef,
  VerificationKey,
} from "../src/index.js";

class TestProvider implements CryptoProvider {
  private readonly metadata: KeyMetadata;

  constructor() {
    this.metadata = {
      keyId: "key:test",
      suite: "classical",
      algorithm: "TEST-SIGN",
      controller: "org:test",
      createdAt: "2026-09-01T00:00:00Z",
      validFrom: "2026-09-01T00:00:00Z",
      verificationKey: {
        keyId: "key:test",
        suite: "classical",
        algorithm: "TEST-SIGN",
        encoding: "raw-base64url",
        publicKey: "test-public-key",
      },
    };
  }

  async hash(
    data: Uint8Array,
  ): Promise<{ algorithm: string; value: string }> {
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
    return signature.value === expected.value;
  }

  async describeKey(keyId: string): Promise<KeyMetadata | undefined> {
    return keyId === this.metadata.keyId
      ? { ...this.metadata, verificationKey: { ...this.metadata.verificationKey } }
      : undefined;
  }

  signingKey(): SigningKeyRef {
    return {
      keyId: this.metadata.keyId,
      suite: this.metadata.suite,
      algorithm: this.metadata.algorithm,
    };
  }

  verificationKey(): VerificationKey {
    return { ...this.metadata.verificationKey };
  }
}

function bundle(): ClimateCaseBundle {
  return {
    schemaVersion: GROUNDING_SCHEMA_VERSION,
    caseId: "case:provenance",
    title: "Provenance test",
    capabilities: ["claim-reconciliation"],
    createdAt: "2026-09-29T00:00:00Z",
    claims: [
      {
        nodeType: "claim",
        id: "claim:scope2",
        createdAt: "2026-09-29T00:00:00Z",
        provenance: [
          {
            nodeType: "calculation",
            id: "calculation:scope2",
            role: "derived-by",
          },
        ],
        subject: {
          id: "site:test",
          kind: "site",
        },
        assertion: {
          kind: "quantitative",
          metric: "Scope 2 emissions",
          quantity: { value: 10, unit: "tCO2e" },
        },
        assessments: [
          {
            dimension: "calculation-reproduced",
            state: "confirmed",
          },
        ],
      },
    ],
    evidence: [
      {
        nodeType: "evidence",
        id: "evidence:meter",
        createdAt: "2026-09-29T00:00:00Z",
        provenance: [],
        kind: "meter-data",
        source: {
          localRef: "fixture.csv",
          publisher: "Test",
          retrievedAt: "2026-09-29T00:00:00Z",
        },
        integrity: {
          algorithm: "SHA-256",
          value: "source-bytes-A",
        },
        rights: {
          redistribution: "allowed",
        },
      },
    ],
    calculations: [
      {
        nodeType: "calculation",
        id: "calculation:scope2",
        createdAt: "2026-09-29T00:00:00Z",
        provenance: [
          {
            nodeType: "evidence",
            id: "evidence:meter",
            role: "activity-data",
          },
        ],
        method: {
          id: "multiply",
          name: "Test calculation",
          version: "1",
        },
        parameters: {},
        output: {
          kind: "quantitative",
          metric: "Scope 2 emissions",
          quantity: { value: 10, unit: "tCO2e" },
        },
        executedAt: "2026-09-29T00:00:00Z",
        reproducibility: {
          codeVersion: "1",
        },
      },
    ],
    factors: [],
    modelRuns: [],
    verifications: [
      {
        nodeType: "verification",
        id: "verification:scope2",
        createdAt: "2026-09-29T00:00:00Z",
        provenance: [
          {
            nodeType: "claim",
            id: "claim:scope2",
            role: "claim-under-review",
          },
        ],
        verifier: {
          id: "service:test",
          kind: "service",
        },
        profile: "test/0.1",
        result: "reconciled",
        checks: [
          {
            id: "calculation",
            name: "Calculation matches",
            outcome: "pass",
          },
        ],
        findings: [],
        verifiedAt: "2026-09-29T00:00:00Z",
      },
    ],
    attestations: [],
    anchors: [],
  };
}

test("evidence root is deterministic for root order", async () => {
  const provider = new TestProvider();
  const first = await createEvidenceRoot(
    bundle(),
    [
      { nodeType: "claim", id: "claim:scope2" },
      { nodeType: "evidence", id: "evidence:meter" },
    ],
    provider,
  );
  const second = await createEvidenceRoot(
    bundle(),
    [
      { nodeType: "evidence", id: "evidence:meter" },
      { nodeType: "claim", id: "claim:scope2" },
    ],
    provider,
  );

  assert.deepEqual(first, second);
});

test("changed evidence invalidates current root but preserves old manifest", async () => {
  const provider = new TestProvider();
  const original = bundle();
  const root = await createEvidenceRoot(
    original,
    [{ nodeType: "claim", id: "claim:scope2" }],
    provider,
  );

  const changed = bundle();
  const evidence = changed.evidence[0];
  assert.ok(evidence);
  evidence.integrity = {
    algorithm: "SHA-256",
    value: "source-bytes-B",
  };

  const result = await verifyEvidenceRoot(changed, root, provider);

  assert.equal(result.manifestRootMatches, true);
  assert.equal(result.currentEvidenceMatches, false);
  assert.deepEqual(
    result.changedRefs.map((ref) => ref.id),
    ["evidence:meter"],
  );
  assert.notEqual(result.currentRoot.value, root.root.value);
});

test("signed attestation distinguishes historical validity from current evidence", async () => {
  const provider = new TestProvider();
  const original = bundle();

  const signed = await createSignedAttestation(original, {
    id: "attestation:scope2",
    attester: { subjectId: "org:test" },
    statement: "Claim reconciled against the recorded evidence root.",
    claimRefs: [{ nodeType: "claim", id: "claim:scope2" }],
    verificationRef: {
      nodeType: "verification",
      id: "verification:scope2",
    },
    issuedAt: "2026-09-29T01:00:00Z",
    hashProvider: provider,
    signers: [{ provider, key: provider.signingKey() }],
  });

  const changed = bundle();
  const evidence = changed.evidence[0];
  assert.ok(evidence);
  evidence.integrity = {
    algorithm: "SHA-256",
    value: "source-bytes-changed",
  };

  const verified = await verifySignedAttestation(changed, signed, {
    hashProvider: provider,
    resolveKey: async () => {
      const metadata = await provider.describeKey("key:test");
      assert.ok(metadata);
      return {
        provider,
        key: provider.verificationKey(),
        metadata,
      };
    },
    policy: {
      requiredSuites: ["classical"],
    },
  });

  assert.equal(verified.signature.valid, true);
  assert.equal(verified.validForSignedEvidence, true);
  assert.equal(verified.currentEvidenceMatches, false);
  assert.equal(verified.validForCurrentEvidence, false);
});

test("challenge can resolve by superseding an attestation", async () => {
  const provider = new TestProvider();
  const signed = await createSignedAttestation(bundle(), {
    id: "attestation:scope2",
    attester: { subjectId: "org:test" },
    statement: "Claim reconciled.",
    claimRefs: [{ nodeType: "claim", id: "claim:scope2" }],
    issuedAt: "2026-09-29T01:00:00Z",
    hashProvider: provider,
    signers: [{ provider, key: provider.signingKey() }],
  });

  const challenged = challengeAttestation(signed, {
    id: "challenge:1",
    kind: "changed-source",
    raisedBy: "auditor:test",
    raisedAt: "2026-09-30T00:00:00Z",
    reason: "Upstream source changed.",
    evidenceRefs: [{ nodeType: "evidence", id: "evidence:meter" }],
  });

  assert.equal(challenged.status, "challenged");

  const superseded = resolveChallenge(challenged, "challenge:1", {
    actor: "org:test",
    at: "2026-09-30T01:00:00Z",
    outcome: "superseded",
    note: "A replacement attestation will be issued for the new evidence.",
  });

  assert.equal(superseded.status, "superseded");
  assert.equal(superseded.challenges[0]?.resolvedAt, "2026-09-30T01:00:00Z");
  assert.throws(
    () =>
      resolveChallenge(superseded, "challenge:1", {
        actor: "org:test",
        at: "2026-09-30T02:00:00Z",
        outcome: "revoked",
        note: "Duplicate resolution",
      }),
    /already resolved/,
  );
});

test("ledger gate defers until every trust criterion is met", () => {
  const deferred = assessLedgerNeed({
    multipleIndependentParties: true,
    noSingleTrustedOperator: false,
    externalHistoricalVerificationRequired: true,
    compactCommitmentSuitable: true,
    notes: ["A trusted operator currently exists."],
  });
  assert.equal(deferred.decision, "defer-ledger");
  assert.equal(deferred.unmet.length, 1);

  const useLedger = assessLedgerNeed({
    multipleIndependentParties: true,
    noSingleTrustedOperator: true,
    externalHistoricalVerificationRequired: true,
    compactCommitmentSuitable: true,
    notes: [],
  });
  assert.equal(useLedger.decision, "use-ledger");
  assert.equal(useLedger.unmet.length, 0);
});

test("an envelope signed for another domain does not verify as an attestation", async () => {
  const provider = new TestProvider();
  const signed = await createSignedAttestation(bundle(), {
    id: "attestation:scope2",
    attester: { subjectId: "org:test" },
    statement: "Claim reconciled.",
    claimRefs: [{ nodeType: "claim", id: "claim:scope2" }],
    issuedAt: "2026-09-29T01:00:00Z",
    hashProvider: provider,
    signers: [{ provider, key: provider.signingKey() }],
  });
  // The same payload, validly signed, but for a different kind of message.
  const envelope = await createSignatureEnvelope(signed.payload, {
    domain: "grounding.other",
    schemaVersion: signed.payload.version,
    createdAt: signed.envelope.createdAt,
    hashProvider: provider,
    signers: [{ provider, key: provider.signingKey() }],
  });
  const verified = await verifySignedAttestation(bundle(), { ...signed, envelope }, {
    hashProvider: provider,
    resolveKey: async () => {
      const metadata = await provider.describeKey("key:test");
      assert.ok(metadata);
      return { provider, key: provider.verificationKey(), metadata };
    },
    policy: { requiredSuites: ["classical"] },
  });
  assert.equal(verified.signature.valid, true);
  assert.equal(verified.domainMatches, false);
  assert.equal(verified.validForSignedEvidence, false);
});
