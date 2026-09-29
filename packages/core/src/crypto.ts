import { domainSeparatedBytes } from "./canonical.js";
import type { ContentDigest } from "./types.js";

export const SIGNATURE_ENVELOPE_VERSION =
  "climatechain.signature-envelope/0.1" as const;

export type CryptoSuite = "classical" | "post-quantum";
export type SignatureEncoding = "base64url";
export type PublicKeyEncoding = "spki-der-base64url" | "raw-base64url";

export interface SigningKeyRef {
  keyId: string;
  suite: CryptoSuite;
  algorithm: string;
}

export interface VerificationKey extends SigningKeyRef {
  encoding: PublicKeyEncoding;
  publicKey: string;
}

export interface KeyMetadata {
  keyId: string;
  suite: CryptoSuite;
  algorithm: string;
  controller: string;
  createdAt: string;
  validFrom: string;
  validUntil?: string;
  revokedAt?: string;
  supersededBy?: string;
  verificationKey: VerificationKey;
}

export interface CryptoSignature {
  suite: CryptoSuite;
  algorithm: string;
  keyId: string;
  encoding: SignatureEncoding;
  value: string;
}

export interface CryptoProvider {
  hash(
    data: Uint8Array,
    algorithm: "SHA-256",
  ): Promise<ContentDigest>;

  sign(
    payload: Uint8Array,
    key: SigningKeyRef,
  ): Promise<CryptoSignature>;

  verify(
    payload: Uint8Array,
    signature: CryptoSignature,
    key: VerificationKey,
  ): Promise<boolean>;

  describeKey(keyId: string): Promise<KeyMetadata | undefined>;
}

export interface SignatureEnvelope {
  version: typeof SIGNATURE_ENVELOPE_VERSION;
  domain: string;
  schemaVersion: string;
  payloadHash: ContentDigest;
  createdAt: string;
  signatures: CryptoSignature[];
}

export interface SignaturePolicy {
  requiredSuites: CryptoSuite[];
  minimumSignatures?: number;
}

export interface EnvelopeSigner {
  provider: CryptoProvider;
  key: SigningKeyRef;
}

export interface CreateSignatureEnvelopeOptions {
  domain: string;
  schemaVersion: string;
  createdAt: string;
  hashProvider: CryptoProvider;
  signers: EnvelopeSigner[];
}

export interface ResolvedVerificationKey {
  provider: CryptoProvider;
  key: VerificationKey;
  metadata: KeyMetadata;
}

export type VerificationKeyResolver = (
  signature: CryptoSignature,
) => Promise<ResolvedVerificationKey | undefined>;

export interface SignatureVerificationResult {
  signature: CryptoSignature;
  keyFound: boolean;
  keyValidAtSigningTime: boolean;
  signatureValid: boolean;
}

export interface EnvelopeVerificationResult {
  payloadHashMatches: boolean;
  signatures: SignatureVerificationResult[];
  policySatisfied: boolean;
  valid: boolean;
}

export interface LedgerCommitmentRequest {
  evidenceRoot: ContentDigest;
  attestationDigest: ContentDigest;
  attestationRef: string;
}

export interface LedgerCommitmentReceipt {
  mechanism: string;
  network?: string;
  recordId: string;
  committedAt: string;
  status: "pending" | "confirmed" | "failed";
}

export interface LedgerAdapter {
  anchor(
    request: LedgerCommitmentRequest,
  ): Promise<LedgerCommitmentReceipt>;
}

function instant(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function isKeyValidAt(
  metadata: KeyMetadata,
  timestamp: string,
): boolean {
  const at = instant(timestamp);
  const validFrom = instant(metadata.validFrom);
  if (at === undefined || validFrom === undefined || at < validFrom) {
    return false;
  }

  if (metadata.validUntil) {
    const validUntil = instant(metadata.validUntil);
    if (validUntil === undefined || at >= validUntil) {
      return false;
    }
  }

  if (metadata.revokedAt) {
    const revokedAt = instant(metadata.revokedAt);
    if (revokedAt === undefined || at >= revokedAt) {
      return false;
    }
  }

  return true;
}

function sameDigest(left: ContentDigest, right: ContentDigest): boolean {
  return left.algorithm === right.algorithm && left.value === right.value;
}

export async function createSignatureEnvelope(
  payload: unknown,
  options: CreateSignatureEnvelopeOptions,
): Promise<SignatureEnvelope> {
  if (options.signers.length === 0) {
    throw new Error("At least one signer is required.");
  }

  const bytes = domainSeparatedBytes(
    options.domain,
    options.schemaVersion,
    payload,
  );
  const payloadHash = await options.hashProvider.hash(bytes, "SHA-256");
  const signatures: CryptoSignature[] = [];

  for (const signer of options.signers) {
    const signature = await signer.provider.sign(bytes, signer.key);

    if (
      signature.keyId !== signer.key.keyId ||
      signature.suite !== signer.key.suite ||
      signature.algorithm !== signer.key.algorithm
    ) {
      throw new Error(
        "Crypto provider returned signature metadata that does not match the signing key.",
      );
    }

    signatures.push(signature);
  }

  return {
    version: SIGNATURE_ENVELOPE_VERSION,
    domain: options.domain,
    schemaVersion: options.schemaVersion,
    payloadHash,
    createdAt: options.createdAt,
    signatures,
  };
}

export async function verifySignatureEnvelope(
  payload: unknown,
  envelope: SignatureEnvelope,
  options: {
    hashProvider: CryptoProvider;
    resolveKey: VerificationKeyResolver;
    policy: SignaturePolicy;
  },
): Promise<EnvelopeVerificationResult> {
  const bytes = domainSeparatedBytes(
    envelope.domain,
    envelope.schemaVersion,
    payload,
  );
  const currentHash = await options.hashProvider.hash(bytes, "SHA-256");
  const payloadHashMatches = sameDigest(currentHash, envelope.payloadHash);

  const signatures: SignatureVerificationResult[] = [];

  for (const signature of envelope.signatures) {
    const resolved = await options.resolveKey(signature);

    if (!resolved) {
      signatures.push({
        signature,
        keyFound: false,
        keyValidAtSigningTime: false,
        signatureValid: false,
      });
      continue;
    }

    const metadataMatches =
      resolved.key.keyId === signature.keyId &&
      resolved.key.suite === signature.suite &&
      resolved.key.algorithm === signature.algorithm &&
      resolved.metadata.keyId === signature.keyId;

    const keyValidAtSigningTime =
      metadataMatches && isKeyValidAt(resolved.metadata, envelope.createdAt);

    const signatureValid =
      keyValidAtSigningTime &&
      (await resolved.provider.verify(bytes, signature, resolved.key));

    signatures.push({
      signature,
      keyFound: true,
      keyValidAtSigningTime,
      signatureValid,
    });
  }

  const validSignatures = signatures.filter((item) => item.signatureValid);
  const minimumSignatures = options.policy.minimumSignatures ?? 1;
  const requiredSuitesPresent = options.policy.requiredSuites.every((suite) =>
    validSignatures.some((item) => item.signature.suite === suite),
  );
  const policySatisfied =
    validSignatures.length >= minimumSignatures && requiredSuitesPresent;

  return {
    payloadHashMatches,
    signatures,
    policySatisfied,
    valid: payloadHashMatches && policySatisfied,
  };
}
