import {
  createSignatureEnvelope,
  verifySignatureEnvelope,
} from "./crypto.js";
import {
  createEvidenceRoot,
  verifyEvidenceRoot,
  type EvidenceManifest,
  type EvidenceRootBundle,
  EVIDENCE_MANIFEST_VERSION,
} from "./provenance.js";
import type {
  CreateSignatureEnvelopeOptions,
  EnvelopeVerificationResult,
  SignatureEnvelope,
  SignaturePolicy,
  VerificationKeyResolver,
} from "./crypto.js";
import type {
  AttestationStatus,
  ClimateCaseBundle,
  ContentDigest,
  NodeRef,
} from "./types.js";

export const ATTESTATION_PAYLOAD_VERSION =
  "climatechain.attestation/0.1" as const;

export type AttestationChallengeKind =
  | "changed-source"
  | "conflicting-evidence"
  | "recalculation-mismatch"
  | "model-disagreement"
  | "methodological-dispute";

export interface AttestationPayload {
  version: typeof ATTESTATION_PAYLOAD_VERSION;
  id: string;
  attester: {
    subjectId: string;
    name?: string;
  };
  statement: string;
  claimRefs: NodeRef[];
  verificationRef?: NodeRef;
  evidenceRoot: ContentDigest;
  manifestVersion: typeof EVIDENCE_MANIFEST_VERSION;
  issuedAt: string;
}

export interface AttestationLifecycleEvent {
  from: AttestationStatus;
  to: AttestationStatus;
  actor: string;
  at: string;
  reason?: string;
  evidenceRefs: NodeRef[];
}

export interface AttestationChallenge {
  id: string;
  kind: AttestationChallengeKind;
  raisedBy: string;
  raisedAt: string;
  reason: string;
  evidenceRefs: NodeRef[];
  resolvedAt?: string;
  resolution?: string;
}

export interface SignedAttestationBundle {
  payload: AttestationPayload;
  evidence: EvidenceRootBundle;
  envelope: SignatureEnvelope;
  status: AttestationStatus;
  lifecycle: AttestationLifecycleEvent[];
  challenges: AttestationChallenge[];
}

export interface CreateSignedAttestationOptions {
  id: string;
  attester: {
    subjectId: string;
    name?: string;
  };
  statement: string;
  claimRefs: NodeRef[];
  verificationRef?: NodeRef;
  evidenceRootRefs?: NodeRef[];
  issuedAt: string;
  hashProvider: CreateSignatureEnvelopeOptions["hashProvider"];
  signers: CreateSignatureEnvelopeOptions["signers"];
}

export interface SignedAttestationVerification {
  signature: EnvelopeVerificationResult;
  manifestRootMatchesPayload: boolean;
  currentEvidenceMatches: boolean;
  currentRoot: ContentDigest;
  changedRefs: NodeRef[];
  missingRefs: NodeRef[];
  unexpectedRefs: NodeRef[];
  validForSignedEvidence: boolean;
  validForCurrentEvidence: boolean;
}

function sameDigest(left: ContentDigest, right: ContentDigest): boolean {
  return left.algorithm === right.algorithm && left.value === right.value;
}

function copyRef(ref: NodeRef): NodeRef {
  return ref.role
    ? { nodeType: ref.nodeType, id: ref.id, role: ref.role }
    : { nodeType: ref.nodeType, id: ref.id };
}

export async function createSignedAttestation(
  bundle: ClimateCaseBundle,
  options: CreateSignedAttestationOptions,
): Promise<SignedAttestationBundle> {
  if (options.claimRefs.length === 0) {
    throw new Error("Attestation requires at least one claim reference.");
  }

  const evidenceRootRefs =
    options.evidenceRootRefs ??
    (options.verificationRef
      ? [options.verificationRef]
      : options.claimRefs);

  const evidence = await createEvidenceRoot(
    bundle,
    evidenceRootRefs,
    options.hashProvider,
  );

  const payload: AttestationPayload = {
    version: ATTESTATION_PAYLOAD_VERSION,
    id: options.id,
    attester: options.attester.name
      ? {
          subjectId: options.attester.subjectId,
          name: options.attester.name,
        }
      : {
          subjectId: options.attester.subjectId,
        },
    statement: options.statement,
    claimRefs: options.claimRefs.map(copyRef),
    ...(options.verificationRef
      ? { verificationRef: copyRef(options.verificationRef) }
      : {}),
    evidenceRoot: evidence.root,
    manifestVersion: EVIDENCE_MANIFEST_VERSION,
    issuedAt: options.issuedAt,
  };

  const envelope = await createSignatureEnvelope(payload, {
    domain: "climatechain.attestation",
    schemaVersion: payload.version,
    createdAt: options.issuedAt,
    hashProvider: options.hashProvider,
    signers: options.signers,
  });

  return {
    payload,
    evidence,
    envelope,
    status: "attested",
    lifecycle: [
      {
        from: "pending",
        to: "attested",
        actor: options.attester.subjectId,
        at: options.issuedAt,
        reason: "Signed attestation issued.",
        evidenceRefs: evidence.manifest.rootRefs.map(copyRef),
      },
    ],
    challenges: [],
  };
}

export async function verifySignedAttestation(
  bundle: ClimateCaseBundle,
  signed: SignedAttestationBundle,
  options: {
    hashProvider: CreateSignatureEnvelopeOptions["hashProvider"];
    resolveKey: VerificationKeyResolver;
    policy: SignaturePolicy;
  },
): Promise<SignedAttestationVerification> {
  const signature = await verifySignatureEnvelope(
    signed.payload,
    signed.envelope,
    options,
  );

  const evidenceVerification = await verifyEvidenceRoot(
    bundle,
    signed.evidence,
    options.hashProvider,
  );

  const manifestRootMatchesPayload =
    evidenceVerification.manifestRootMatches &&
    sameDigest(signed.evidence.root, signed.payload.evidenceRoot);

  const validForSignedEvidence =
    signature.valid && manifestRootMatchesPayload;

  return {
    signature,
    manifestRootMatchesPayload,
    currentEvidenceMatches: evidenceVerification.currentEvidenceMatches,
    currentRoot: evidenceVerification.currentRoot,
    changedRefs: evidenceVerification.changedRefs,
    missingRefs: evidenceVerification.missingRefs,
    unexpectedRefs: evidenceVerification.unexpectedRefs,
    validForSignedEvidence,
    validForCurrentEvidence:
      validForSignedEvidence &&
      evidenceVerification.currentEvidenceMatches,
  };
}

const allowedTransitions: Record<AttestationStatus, AttestationStatus[]> = {
  pending: ["attested", "revoked"],
  attested: ["challenged", "superseded", "revoked", "final"],
  challenged: ["attested", "superseded", "revoked", "final"],
  final: ["challenged", "superseded", "revoked"],
  superseded: [],
  revoked: [],
};

export function transitionAttestation(
  signed: SignedAttestationBundle,
  next: AttestationStatus,
  event: Omit<AttestationLifecycleEvent, "from" | "to">,
): SignedAttestationBundle {
  if (!allowedTransitions[signed.status].includes(next)) {
    throw new Error(
      "Illegal attestation transition: " + signed.status + " -> " + next,
    );
  }

  return {
    ...signed,
    status: next,
    lifecycle: [
      ...signed.lifecycle,
      {
        from: signed.status,
        to: next,
        actor: event.actor,
        at: event.at,
        ...(event.reason ? { reason: event.reason } : {}),
        evidenceRefs: event.evidenceRefs.map(copyRef),
      },
    ],
  };
}

export function challengeAttestation(
  signed: SignedAttestationBundle,
  challenge: AttestationChallenge,
): SignedAttestationBundle {
  const challenged =
    signed.status === "challenged"
      ? signed
      : transitionAttestation(signed, "challenged", {
          actor: challenge.raisedBy,
          at: challenge.raisedAt,
          reason: challenge.reason,
          evidenceRefs: challenge.evidenceRefs,
        });

  return {
    ...challenged,
    challenges: [
      ...challenged.challenges,
      {
        ...challenge,
        evidenceRefs: challenge.evidenceRefs.map(copyRef),
      },
    ],
  };
}

export function resolveChallenge(
  signed: SignedAttestationBundle,
  challengeId: string,
  resolution: {
    actor: string;
    at: string;
    outcome: "attested" | "superseded" | "revoked" | "final";
    note: string;
    evidenceRefs?: NodeRef[];
  },
): SignedAttestationBundle {
  const challenge = signed.challenges.find(
    (item) => item.id === challengeId,
  );

  if (!challenge) {
    throw new Error("Unknown attestation challenge: " + challengeId);
  }
  if (challenge.resolvedAt) {
    throw new Error("Challenge is already resolved: " + challengeId);
  }

  const updatedChallenges = signed.challenges.map((item) =>
    item.id === challengeId
      ? {
          ...item,
          resolvedAt: resolution.at,
          resolution: resolution.note,
        }
      : item,
  );

  const withResolution = {
    ...signed,
    challenges: updatedChallenges,
  };

  return transitionAttestation(withResolution, resolution.outcome, {
    actor: resolution.actor,
    at: resolution.at,
    reason: resolution.note,
    evidenceRefs:
      resolution.evidenceRefs ?? challenge.evidenceRefs,
  });
}

export function attestationManifest(
  signed: SignedAttestationBundle,
): EvidenceManifest {
  return signed.evidence.manifest;
}
