import { canonicalBytes } from "./canonical.js";
import { isKeyValidAt } from "./crypto.js";
import type {
  CryptoProvider,
  CryptoSignature,
  EnvelopeSigner,
  VerificationKeyResolver,
} from "./crypto.js";
import type { ContentDigest } from "./types.js";

export const SIGNED_LOG_VERSION = "grounding.signed-log/0.1" as const;

export interface SignedLogRecord<T = unknown> {
  version: typeof SIGNED_LOG_VERSION;
  sequence: number;
  timestamp: string;
  previousRecordDigest?: ContentDigest;
  event: T;
  recordDigest: ContentDigest;
  signatures: CryptoSignature[];
}

export interface SignedLogVerificationResult {
  valid: boolean;
  chainIntact: boolean;
  digestsValid: boolean;
  signaturesValid: boolean;
  invalidSequences: number[];
}

async function digestRecordBody<T>(
  record: Omit<SignedLogRecord<T>, "recordDigest" | "signatures">,
  provider: CryptoProvider,
): Promise<ContentDigest> {
  return provider.hash(canonicalBytes(record), "SHA-256");
}

export async function appendSignedLogRecord<T>(
  existing: readonly SignedLogRecord<T>[],
  event: T,
  options: {
    timestamp: string;
    hashProvider: CryptoProvider;
    signers: EnvelopeSigner[];
  },
): Promise<SignedLogRecord<T>> {
  if (options.signers.length === 0) {
    throw new Error("Signed log requires at least one signer.");
  }

  const previous = existing.at(-1);
  const body = {
    version: SIGNED_LOG_VERSION,
    sequence: existing.length,
    timestamp: options.timestamp,
    ...(previous ? { previousRecordDigest: previous.recordDigest } : {}),
    event,
  } as const;

  const recordDigest = await digestRecordBody(body, options.hashProvider);
  const payload = canonicalBytes({
    domain: "grounding.signed-log-record",
    body,
    recordDigest,
  });

  const signatures: CryptoSignature[] = [];
  for (const signer of options.signers) {
    signatures.push(await signer.provider.sign(payload, signer.key));
  }

  return {
    ...body,
    recordDigest,
    signatures,
  };
}

export async function verifySignedLog<T>(
  records: readonly SignedLogRecord<T>[],
  options: {
    hashProvider: CryptoProvider;
    resolveKey: VerificationKeyResolver;
  },
): Promise<SignedLogVerificationResult> {
  let chainIntact = true;
  let digestsValid = true;
  let signaturesValid = true;
  const invalidSequences = new Set<number>();

  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (!record) continue;

    const expectedPrevious = i === 0 ? undefined : records[i - 1]?.recordDigest;
    const previousMatches =
      expectedPrevious === undefined
        ? record.previousRecordDigest === undefined
        : record.previousRecordDigest?.algorithm === expectedPrevious.algorithm &&
          record.previousRecordDigest?.value === expectedPrevious.value;

    if (!previousMatches) {
      chainIntact = false;
      invalidSequences.add(record.sequence);
    }

    const body = {
      version: record.version,
      sequence: record.sequence,
      timestamp: record.timestamp,
      ...(record.previousRecordDigest
        ? { previousRecordDigest: record.previousRecordDigest }
        : {}),
      event: record.event,
    };

    const digest = await digestRecordBody(body, options.hashProvider);
    const digestMatches =
      digest.algorithm === record.recordDigest.algorithm &&
      digest.value === record.recordDigest.value;

    if (!digestMatches) {
      digestsValid = false;
      invalidSequences.add(record.sequence);
    }

    const payload = canonicalBytes({
      domain: "grounding.signed-log-record",
      body,
      recordDigest: record.recordDigest,
    });

    if (record.signatures.length === 0) {
      signaturesValid = false;
      invalidSequences.add(record.sequence);
      continue;
    }

    for (const signature of record.signatures) {
      const resolved = await options.resolveKey(signature);
      // The timestamp is part of the signed body, so it can be trusted for the key-validity check.
      if (
        !resolved ||
        resolved.key.keyId !== signature.keyId ||
        resolved.metadata.keyId !== signature.keyId ||
        !isKeyValidAt(resolved.metadata, record.timestamp) ||
        !(await resolved.provider.verify(payload, signature, resolved.key))
      ) {
        signaturesValid = false;
        invalidSequences.add(record.sequence);
      }
    }
  }

  return {
    valid: chainIntact && digestsValid && signaturesValid,
    chainIntact,
    digestsValid,
    signaturesValid,
    invalidSequences: [...invalidSequences].sort((a, b) => a - b),
  };
}
