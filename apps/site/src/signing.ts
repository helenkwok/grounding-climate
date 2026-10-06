// Signing in the reader's browser: a fresh Ed25519 key (WebCrypto) and a fresh ML-DSA-65 key (noble-post-quantum)
// made for one record. The keys identify that record's signing, not a person: the public halves travel with the
// record, so a valid signature shows the record has not changed since it was signed, not who signed it.
import {
  HYBRID_SIGNATURE_POLICY,
  createSignedAttestation,
  publishedKeyResolver,
  verifySignedAttestation,
  type ClimateCaseBundle,
  type ContentDigest,
  type CryptoProvider,
  type CryptoSignature,
  type KeyMetadata,
  type NodeRef,
  type SignedAttestationBundle,
  type SignedAttestationVerification,
  type SigningKeyRef,
  type VerificationKey,
} from "@climatechain/core";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";

export const SIGNED_RECORD_FORMAT = "climatechain-signed-record/0.1";

/** What a reader downloads and anyone can check: the case, its attestation, and the public keys that signed it. */
export interface SignedRecord {
  format: typeof SIGNED_RECORD_FORMAT;
  case: ClimateCaseBundle;
  attestation: SignedAttestationBundle;
  publishedKeys: KeyMetadata[];
}

const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
// ML-DSA-65 SPKI: a fixed 22-byte header naming id-ml-dsa-65 (2.16.840.1.101.3.4.3.18), then the raw key.
const ML_DSA_65_SPKI_HEADER = Uint8Array.from(
  "308207b2300b0609608648016503040312038207a100".match(/../g)!.map((pair) => parseInt(pair, 16)),
);

/** Signs with keys it makes itself; hashing and verification come from the provider it is given. */
export class BrowserSigner implements CryptoProvider {
  private readonly ed = new Map<string, CryptoKey>();
  private readonly pq = new Map<string, Uint8Array>();
  private readonly keys = new Map<string, KeyMetadata>();

  private readonly base: Pick<CryptoProvider, "hash" | "verify">;

  constructor(base: Pick<CryptoProvider, "hash" | "verify">) {
    this.base = base;
  }

  hash(data: Uint8Array, algorithm: "SHA-256"): Promise<ContentDigest> {
    return this.base.hash(data, algorithm);
  }

  verify(payload: Uint8Array, signature: CryptoSignature, key: VerificationKey): Promise<boolean> {
    return this.base.verify(payload, signature, key);
  }

  async describeKey(keyId: string): Promise<KeyMetadata | undefined> {
    return this.keys.get(keyId);
  }

  /** One Ed25519 and one ML-DSA-65 key, valid from `createdAt`. */
  async generateKeys(controller: string, createdAt: string): Promise<SigningKeyRef[]> {
    const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const edSpki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
    const pq = ml_dsa65.keygen();
    const pqSpki = new Uint8Array(ML_DSA_65_SPKI_HEADER.length + pq.publicKey.length);
    pqSpki.set(ML_DSA_65_SPKI_HEADER);
    pqSpki.set(pq.publicKey, ML_DSA_65_SPKI_HEADER.length);

    const refs: SigningKeyRef[] = [
      { keyId: "key:browser-ed25519:" + createdAt, suite: "classical", algorithm: "Ed25519" },
      { keyId: "key:browser-ml-dsa-65:" + createdAt, suite: "post-quantum", algorithm: "ML-DSA-65" },
    ];
    this.ed.set(refs[0]!.keyId, pair.privateKey);
    this.pq.set(refs[1]!.keyId, pq.secretKey);
    for (const [ref, spki] of [[refs[0]!, edSpki], [refs[1]!, pqSpki]] as const) {
      this.keys.set(ref.keyId, {
        ...ref,
        controller,
        createdAt,
        validFrom: createdAt,
        verificationKey: { ...ref, encoding: "spki-der-base64url", publicKey: toBase64Url(spki) },
      });
    }
    return refs;
  }

  async sign(payload: Uint8Array, key: SigningKeyRef): Promise<CryptoSignature> {
    const signature = (value: Uint8Array): CryptoSignature => ({
      suite: key.suite,
      algorithm: key.algorithm,
      keyId: key.keyId,
      encoding: "base64url",
      value: toBase64Url(value),
    });
    const ed = this.ed.get(key.keyId);
    if (ed) return signature(new Uint8Array(await crypto.subtle.sign("Ed25519", ed, payload as BufferSource)));
    const pq = this.pq.get(key.keyId);
    if (pq) return signature(ml_dsa65.sign(payload, pq));
    throw new Error('No signing key "' + key.keyId + '" in this browser.');
  }
}

/** Signs a case in this browser and returns the record to download. */
export async function signRecord(options: {
  climateCase: ClimateCaseBundle;
  base: Pick<CryptoProvider, "hash" | "verify">;
  signer: { subjectId: string; name: string };
  statement: string;
  claimRefs: NodeRef[];
  verificationRef: NodeRef;
  signedAt: string;
}): Promise<SignedRecord> {
  const provider = new BrowserSigner(options.base);
  const keys = await provider.generateKeys(options.signer.subjectId, options.signedAt);
  const attestation = await createSignedAttestation(options.climateCase, {
    id: "attestation:browser:" + options.signedAt,
    attester: options.signer,
    statement: options.statement,
    claimRefs: options.claimRefs,
    verificationRef: options.verificationRef,
    issuedAt: options.signedAt,
    hashProvider: provider,
    signers: keys.map((key) => ({ provider, key })),
  });
  const publishedKeys = await Promise.all(keys.map(async (key) => (await provider.describeKey(key.keyId))!));
  return { format: SIGNED_RECORD_FORMAT, case: options.climateCase, attestation, publishedKeys };
}

/** Checks a record against its own published keys, under the hybrid policy (both signatures must verify). */
export async function verifyRecord(
  record: SignedRecord,
  base: Pick<CryptoProvider, "hash" | "verify">,
): Promise<SignedAttestationVerification> {
  if (record.format !== SIGNED_RECORD_FORMAT) throw new Error("Not a ClimateChain signed record.");
  const provider = new BrowserSigner(base);
  return verifySignedAttestation(record.case, record.attestation, {
    hashProvider: provider,
    resolveKey: publishedKeyResolver(record.publishedKeys, provider),
    policy: HYBRID_SIGNATURE_POLICY,
  });
}
