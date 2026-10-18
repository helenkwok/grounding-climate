// A W3C Verifiable Credential view of a signed case, in the UN Transparency Protocol (UNTP) 0.6.0 shape. It sits
// beside the signed case record and never replaces it: the case's own hybrid attestation stays the source of truth,
// and the credential points back at it by digest and at its Bitcoin anchor by CAIP-2 chain id.
//
// - Building, energy, earth, carbon and disclosure: a UNTP Digital Conformity Credential holding what Grounding
//   rechecked and found. Findings only, never an assurance opinion, so no `conformance` verdict is set.
// - Battery: a UNTP Digital Product Passport carrying the EN 18223 passport header (Table 1) and state-of-health
//   attributes named as DIN DKE SPEC 99100 names them (6.7.2), in % against the initial state. Each attribute also
//   names its counterpart in the Battery Pass data model, io.BatteryPass.Performance 1.2.1
//   (github.com/batterypass/BatteryPassDataModel, CC BY 4.0, Battery Pass consortium); only names are reused.
// The case's Bitcoin anchor is separate `evidence`, never a `proof`: it shows the signed record existed no later than
// a block, not who made it. Records are tamper-evident (ISO 22739 wording), not immutable: they can be re-signed.
// Ed25519 is the proof other verifiers can check today; ML-DSA-65 is the second, post-quantum proof.
//
// Securing, both over the same credential and both required:
// - VC-JOSE-COSE: one compact JWS (`typ: vc+jwt`) per algorithm, `EdDSA` (RFC 8037) and `ML-DSA-65` (RFC 9964).
// - Data Integrity: a proof set of `eddsa-jcs-2022` (W3C Recommendation) and an ML-DSA-65 proof built the same way
//   as the draft's `mldsa44-jcs-2024`. No W3C suite defines ML-DSA-65, so that proof's cryptosuite name is ours.
import { canonicalBytes, canonicalize } from "./canonical.js";
import { anchoredDigest, toHex } from "./anchor.js";
import { cidFromSha256 } from "./cid.js";
import type { SignedAttestationBundle } from "./attestation.js";
import type { CryptoProvider, CryptoSignature, CryptoSuite, KeyMetadata, SigningKeyRef } from "./crypto.js";
import type { ClimateCaseBundle, ContentDigest } from "./types.js";

export const VC_V2_CONTEXT = "https://www.w3.org/ns/credentials/v2";
/** UNTP 0.6.0 contexts; both resolved (HTTP 200, application/ld+json) on 2026-10-18. 0.7.0's did not (403). */
export const UNTP_DCC_CONTEXT = "https://test.uncefact.org/vocabulary/untp/dcc/0.6.0/";
export const UNTP_DPP_CONTEXT = "https://test.uncefact.org/vocabulary/untp/dpp/0.6.0/";
/** Grounding's own terms. The vocabulary URL is a namespace, not a hosted document. */
export const GROUNDING_CONTEXT = { "@vocab": "https://helenkwok.github.io/grounding-climate/vocab#" } as const;
/** Placeholder issuer. It would resolve to https://helenkwok.github.io/grounding-climate/did.json once hosted; it is not yet. */
export const GROUNDING_ISSUER_DID = "did:web:helenkwok.github.io:grounding-climate";
/** CAIP-2 id of Bitcoin mainnet: the bip122 namespace and the first 32 hex characters of the genesis block hash. */
export const BITCOIN_MAINNET_CAIP2 = "bip122:000000000019d6689c085ae165831e93";
export const ML_DSA_65_PROOF_SUITE = "grounding-mldsa65-jcs-2026";

type JsonObject = { [key: string]: unknown };
export type VerifiableCredential = JsonObject & {
  "@context": unknown[];
  id: string;
  type: string[];
  issuer: { id: string; name: string; type?: string[] };
  validFrom: string;
  credentialSubject: JsonObject;
  proof?: DataIntegrityProof[];
};
export interface DataIntegrityProof {
  type: "DataIntegrityProof";
  cryptosuite: string;
  created: string;
  verificationMethod: string;
  proofPurpose: "assertionMethod";
  proofValue: string;
}

/** What a case runner writes to reports/<module>/case-run.json, as far as the credential needs it. */
export interface CaseRunRecord {
  case: ClimateCaseBundle;
  attestation: SignedAttestationBundle;
  battery?: { batteryId: string; nominalCapacityAh: number; cycles: number };
  clean?: { currentSoh?: number; estimatedRulCycles?: number; disposition?: string };
  /** Recomputed by the caller from the committed cycle history (battery-dpp `estimateBatteryHealth`). */
  health?: { initialCapacityAh: number; currentCapacityAh: number; sohVsInitial: number; currentSoh: number; observedCycle: number };
}
/** reports/<module>/anchor.json; `height` and `blockHash` are set once the proof reaches a Bitcoin block. */
export interface AnchorRecordFile {
  chain: string;
  format: string;
  digest: string;
  height?: number;
  blockHash?: string;
  submittedAt?: string;
}

/** Placeholder identifiers under the did:web domain (EN 18219 asks for a URL). Not registered GS1 or ISO/IEC 15459 ids. */
export const GROUNDING_ID_BASE = "https://helenkwok.github.io/grounding-climate/id/";
/** Where the committed files can be read by URL once the repository is public. */
export const GROUNDING_REPO_FILES = "https://github.com/helenkwok/grounding-climate/blob/main/";

// --- encodings -------------------------------------------------------------------------------------------------

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ED25519_SPKI = "302a300506032b6570032100";
const ML_DSA_65_SPKI = "308207b2300b0609608648016503040312038207a100";
const MULTICODEC = { Ed25519: [0xed, 0x01], "ML-DSA-65": [0x91, 0x24] } as const; // ed25519-pub, mldsa-65-pub (0x1211, draft)
const RAW_LENGTH = { Ed25519: 32, "ML-DSA-65": 1952 } as const;
type KeyAlgorithm = keyof typeof RAW_LENGTH;
const JOSE_ALG = { Ed25519: "EdDSA", "ML-DSA-65": "ML-DSA-65" } as const;
const SUITE: Record<KeyAlgorithm, CryptoSuite> = { Ed25519: "classical", "ML-DSA-65": "post-quantum" };

const hexBytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16));
export const toBase64Url = (bytes: Uint8Array) =>
  btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join("")).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
export function fromBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new TypeError("Not base64url");
  return Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/")), (char) => char.charCodeAt(0));
}
const utf8 = (text: string) => new TextEncoder().encode(text);
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) out.set(part, (at += part.length) - part.length);
  return out;
};

// ponytail: quadratic base58, fine for a 3.3 kB ML-DSA-65 signature; swap for a library if it ever shows in a profile.
export function base58btc(bytes: Uint8Array): string {
  const digits: number[] = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i]! * 256;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    for (; carry; carry = Math.floor(carry / 58)) digits.push(carry % 58);
  }
  let out = "";
  for (const byte of bytes) {
    if (byte !== 0) break;
    out += "1";
  }
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]!];
  return out;
}
export function fromBase58btc(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of text) {
    let carry = B58.indexOf(char);
    if (carry < 0) throw new TypeError("Not base58btc");
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i]! * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    for (; carry; carry >>= 8) bytes.push(carry & 0xff);
  }
  const zeros = text.length - text.replace(/^1+/, "").length;
  return Uint8Array.from([...new Array<number>(zeros).fill(0), ...bytes.reverse()]);
}

// --- the credential --------------------------------------------------------------------------------------------

const placeholderId = (...parts: string[]) => GROUNDING_ID_BASE + parts.map(encodeURIComponent).join("/");
const round = (value: number, places = 2) => Math.round(value * 10 ** places) / 10 ** places;

/**
 * State of health as DIN DKE SPEC 99100 6.7 names it, each value with its Battery Pass (io.BatteryPass.Performance
 * 1.2.1, CC BY 4.0) counterpart where one exists, whether it is static or dynamic, and its information level.
 */
export function batteryHealthAttributes(
  battery: { nominalCapacityAh: number; cycles: number },
  health: NonNullable<CaseRunRecord["health"]>,
  measuredAt: string,
) {
  const method =
    "Discharge capacity of recorded laboratory cycle " + health.observedCycle + " (" + battery.cycles + " cycles recorded), BatteryLife processed data";
  return {
    stateOfHealth: {
      value: round(health.sohVsInitial * 100), unit: "%", basis: "remaining capacity relative to the first recorded cycle (initial state)",
      specId: "DIN DKE SPEC 99100 6.7.1", dynamic: true, level: "item", measuredAt, method,
    },
    capacityFade: {
      value: Math.round((1 - health.sohVsInitial) * 100), unit: "%", basis: "1 - C(now) / C(initial), as an integer",
      specId: "DIN DKE SPEC 99100 6.7.2.4", batteryPass: "capacityFade", dynamic: true, level: "item", measuredAt, method,
    },
    ratedCapacity: {
      value: battery.nominalCapacityAh, unit: "Ah", basis: "the dataset's nominal capacity; no reference test conditions recorded",
      specId: "DIN DKE SPEC 99100 6.7.2.2", batteryPass: "ratedCapacity", dynamic: false, level: "model",
    },
    remainingCapacity: {
      value: round(health.currentCapacityAh, 3), unit: "Ah", basis: "measured discharge capacity",
      specId: "DIN DKE SPEC 99100 6.7.2.3", batteryPass: "remainingCapacity", dynamic: true, level: "item", measuredAt, method,
    },
    stateOfHealthVsRated: {
      value: round(health.currentSoh * 100), unit: "%", basis: "remaining capacity relative to rated capacity; the disposition policy reads this one",
      dynamic: true, level: "item", measuredAt, method,
    },
  };
}

/** Maps a signed case to a W3C VC 2.0 credential (unsecured). Deterministic: the same files give the same credential. */
export async function caseCredential(
  module: string,
  run: CaseRunRecord,
  anchor?: { record: AnchorRecordFile; proofPath: string },
): Promise<VerifiableCredential> {
  const { case: bundle, attestation } = run;
  const payload = attestation.payload;
  const claim = bundle.claims.find((node) => node.id === payload.claimRefs[0]?.id);
  const recheck = bundle.verifications.find((node) => node.id === payload.verificationRef?.id);
  if (!claim || !recheck) throw new Error(module + ": the attestation names no claim or verification in its case");
  const recordDigest = await anchoredDigest(attestation);
  const recordSha256 = toHex(recordDigest);

  const subject: JsonObject = {
    id: placeholderId(module, claim.subject.id),
    claim: {
      id: claim.id,
      subject: claim.subject.name ?? claim.subject.id,
      statement:
        claim.assertion.kind === "qualitative"
          ? claim.assertion.statement
          : claim.assertion.metric + " = " + claim.assertion.quantity.value + " " + claim.assertion.quantity.unit,
    },
    recheck: {
      by: recheck.verifier.name ?? recheck.verifier.id,
      at: recheck.verifiedAt,
      status: recheck.result,
      checks: recheck.checks.map((check) => ({ id: check.id, name: check.name, outcome: check.outcome, ...(check.detail ? { detail: check.detail } : {}) })),
      findings: recheck.findings,
    },
    scope: "Rechecked by Grounding: what was recomputed and found. Findings only; not an assurance or certification opinion.",
    signedRecord: {
      attestation: payload.id,
      note: "The tamper-evident signed case record (Ed25519 + ML-DSA-65) this credential is a view of.",
      url: GROUNDING_REPO_FILES + "reports/" + module + "/case-run.json",
      sha256: recordSha256,
      cid: cidFromSha256({ algorithm: "SHA-256", value: toBase64Url(recordDigest) }),
    },
    identifierNote: "Identifiers under " + GROUNDING_ID_BASE + " are placeholders, not registered GS1 or ISO/IEC 15459 identifiers.",
  };

  const evidence: JsonObject[] = bundle.evidence.flatMap((node) => {
    if (node.integrity?.algorithm !== "SHA-256") return [];
    const cid = cidFromSha256(node.integrity);
    const https = node.source.uri?.startsWith("https://") ? node.source.uri : undefined;
    return [{
      id: https ?? "ipfs://" + cid,
      type: ["Evidence"],
      name: node.id,
      ...(https ? { url: https } : {}),
      cid,
      contentAddress: "ipfs://" + cid,
      sha256: node.integrity.value,
      ...(node.rights?.licence ? { licence: node.rights.licence } : {}),
    }];
  });
  if (anchor) {
    const { record } = anchor;
    const anchored = record.height !== undefined;
    evidence.push({
      id: GROUNDING_REPO_FILES + anchor.proofPath,
      type: ["Evidence", "TimestampAnchor"],
      name: "Bitcoin anchor of the signed case record",
      chain: record.chain === "bitcoin" ? BITCOIN_MAINNET_CAIP2 : record.chain,
      method: record.format,
      digest: record.digest,
      digestOf: "the signed case record (payload and both signatures); SHA-256 " + recordSha256,
      status: anchored ? "anchored" : "pending",
      ...(anchored ? { blockHeight: record.height } : {}),
      ...(record.blockHash ? { blockHash: record.blockHash } : {}),
      statement: anchored
        ? "The signed case record existed no later than Bitcoin block " + record.height + "."
        : "Submitted to OpenTimestamps calendars" + (record.submittedAt ? " at " + record.submittedAt : "") + "; not yet in a block.",
    });
  }

  const battery = run.battery;
  if (battery) {
    if (!run.health) throw new Error(module + ": a battery passport needs the health recomputed from its cycle history");
    const productId = placeholderId("battery", battery.batteryId);
    Object.assign(subject, {
      type: ["ProductPassport"],
      id: productId,
      // EN 18223 Table 1 passport header.
      digitalProductPassportId: placeholderId("dpp", "battery", battery.batteryId),
      uniqueProductIdentifier: productId,
      granularity: "item",
      dppSchemaVersion: "untp-dpp/0.6.0 grounding-battery/0.1",
      dppStatus: "active",
      lastUpdated: payload.issuedAt,
      economicOperatorId: placeholderId("operator", "grounding-demo"),
      dynamic: true,
      product: { type: ["Product"], id: productId, name: battery.batteryId, serialNumber: battery.batteryId },
      performance: batteryHealthAttributes(battery, run.health, payload.issuedAt),
      ...(run.clean?.estimatedRulCycles === undefined ? {} : { estimatedRemainingCycles: run.clean.estimatedRulCycles }),
      ...(run.clean?.disposition ? { proposedDisposition: run.clean.disposition } : {}),
    });
  } else {
    subject.type = ["ConformityAttestation"];
  }

  return {
    "@context": [VC_V2_CONTEXT, battery ? UNTP_DPP_CONTEXT : UNTP_DCC_CONTEXT, GROUNDING_CONTEXT],
    id: "urn:grounding:credential:" + module + ":" + payload.issuedAt,
    type: ["VerifiableCredential", battery ? "DigitalProductPassport" : "DigitalConformityCredential"],
    name: bundle.title,
    issuer: { type: ["CredentialIssuer"], id: GROUNDING_ISSUER_DID, name: "Grounding (demo issuer; did:web not yet hosted)" },
    validFrom: payload.issuedAt,
    credentialSubject: subject,
    evidence,
  };
}

// --- keys: a did:web document ----------------------------------------------------------------------------------

export interface DidDocument {
  "@context": string[];
  id: string;
  verificationMethod: VerificationMethod[];
  assertionMethod: string[];
}
export interface VerificationMethod {
  id: string;
  type: "JsonWebKey" | "Multikey";
  controller: string;
  publicKeyJwk?: { kty: string; crv?: string; alg?: string; x?: string; pub?: string };
  publicKeyMultibase?: string;
}

function rawPublicKey(metadata: KeyMetadata): { algorithm: KeyAlgorithm; raw: Uint8Array } {
  const algorithm = metadata.algorithm as KeyAlgorithm;
  if (!(algorithm in RAW_LENGTH) || metadata.verificationKey.encoding !== "spki-der-base64url") {
    throw new Error("Unsupported key " + metadata.keyId);
  }
  const spki = fromBase64Url(metadata.verificationKey.publicKey);
  return { algorithm, raw: spki.subarray(spki.length - RAW_LENGTH[algorithm]) };
}
const fragment = (algorithm: KeyAlgorithm) => (algorithm === "Ed25519" ? "ed25519" : "ml-dsa-65");

/** The DID document for the issuer's keys: each key as a JsonWebKey (for JWS `kid`) and a Multikey (for Data Integrity). */
export function issuerDidDocument(keys: readonly KeyMetadata[], did = GROUNDING_ISSUER_DID): DidDocument {
  const methods = keys.flatMap((key): VerificationMethod[] => {
    const { algorithm, raw } = rawPublicKey(key);
    const jwk = algorithm === "Ed25519"
      ? { kty: "OKP", crv: "Ed25519", x: toBase64Url(raw) }
      : { kty: "AKP", alg: "ML-DSA-65", pub: toBase64Url(raw) };
    return [
      { id: did + "#" + fragment(algorithm) + "-jwk", type: "JsonWebKey", controller: did, publicKeyJwk: jwk },
      { id: did + "#" + fragment(algorithm) + "-multikey", type: "Multikey", controller: did, publicKeyMultibase: "z" + base58btc(concat(Uint8Array.from(MULTICODEC[algorithm]), raw)) },
    ];
  });
  return {
    "@context": ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/jwk/v1", "https://w3id.org/security/multikey/v1"],
    id: did,
    verificationMethod: methods,
    assertionMethod: methods.map((method) => method.id),
  };
}

/** The method's algorithm and SPKI key, or undefined when the document has no such method. */
function resolveMethod(did: DidDocument, id: string): { algorithm: KeyAlgorithm; spki: string } | undefined {
  const method = did.verificationMethod.find((item) => item.id === id);
  if (!method || !did.assertionMethod.includes(id)) return undefined;
  let algorithm: KeyAlgorithm | undefined;
  let raw: Uint8Array | undefined;
  const jwk = method.publicKeyJwk;
  if (method.type === "JsonWebKey" && jwk) {
    if (jwk.kty === "OKP" && jwk.crv === "Ed25519" && jwk.x) [algorithm, raw] = ["Ed25519", fromBase64Url(jwk.x)];
    if (jwk.kty === "AKP" && jwk.alg === "ML-DSA-65" && jwk.pub) [algorithm, raw] = ["ML-DSA-65", fromBase64Url(jwk.pub)];
  } else if (method.type === "Multikey" && method.publicKeyMultibase?.startsWith("z")) {
    const bytes = fromBase58btc(method.publicKeyMultibase.slice(1));
    for (const name of Object.keys(MULTICODEC) as KeyAlgorithm[]) {
      const [a, b] = MULTICODEC[name];
      if (bytes[0] === a && bytes[1] === b) [algorithm, raw] = [name, bytes.subarray(2)];
    }
  }
  if (!algorithm || !raw || raw.length !== RAW_LENGTH[algorithm]) return undefined;
  return { algorithm, spki: toBase64Url(concat(hexBytes(algorithm === "Ed25519" ? ED25519_SPKI : ML_DSA_65_SPKI), raw)) };
}

async function verifyWith(
  provider: Pick<CryptoProvider, "verify">,
  did: DidDocument,
  methodId: string,
  algorithm: KeyAlgorithm,
  data: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  const method = resolveMethod(did, methodId);
  if (!method || method.algorithm !== algorithm) return false;
  const ref = { keyId: methodId, suite: SUITE[algorithm], algorithm };
  const sig: CryptoSignature = { ...ref, encoding: "base64url", value: toBase64Url(signature) };
  return provider.verify(data, sig, { ...ref, encoding: "spki-der-base64url", publicKey: method.spki });
}

/** A signer: a provider holding the private key, the key, and the DID verification method ids that name it. */
export interface CredentialSigner {
  provider: Pick<CryptoProvider, "sign">;
  key: SigningKeyRef;
}
const methodId = (did: string, algorithm: KeyAlgorithm, kind: "jwk" | "multikey") => did + "#" + fragment(algorithm) + "-" + kind;
const keyAlgorithm = (key: SigningKeyRef): KeyAlgorithm => {
  if (!(key.algorithm in RAW_LENGTH)) throw new Error("Unsupported signing algorithm " + key.algorithm);
  return key.algorithm as KeyAlgorithm;
};
const unsecured = (credential: VerifiableCredential): VerifiableCredential => {
  const { proof: _proof, ...rest } = credential;
  return rest as VerifiableCredential;
};

// --- VC-JOSE-COSE: one compact JWS per algorithm ---------------------------------------------------------------

export async function signCredentialJws(credential: VerifiableCredential, signer: CredentialSigner): Promise<string> {
  const algorithm = keyAlgorithm(signer.key);
  const header = { alg: JOSE_ALG[algorithm], kid: methodId(credential.issuer.id, algorithm, "jwk"), typ: "vc+jwt" };
  const input = toBase64Url(utf8(JSON.stringify(header))) + "." + toBase64Url(utf8(JSON.stringify(unsecured(credential))));
  const signature = await signer.provider.sign(utf8(input), signer.key);
  return input + "." + signature.value;
}

export interface JwsCheck {
  alg: string;
  kid: string;
  /** The payload is the credential that was expected, compared in canonical form. */
  payloadMatches: boolean;
  signatureValid: boolean;
  valid: boolean;
  reason?: string;
}

/** Checks one compact JWS against the issuer's DID document, and its payload against the expected credential. */
export async function verifyCredentialJws(
  jws: string,
  expected: VerifiableCredential,
  did: DidDocument,
  provider: Pick<CryptoProvider, "verify">,
): Promise<JwsCheck> {
  const parts = jws.trim().split(".");
  const fail = (reason: string, alg = "", kid = ""): JwsCheck => ({ alg, kid, payloadMatches: false, signatureValid: false, valid: false, reason });
  if (parts.length !== 3) return fail("not a compact JWS");
  let header: { alg?: string; kid?: string; typ?: string; crit?: unknown };
  let payload: unknown;
  try {
    header = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[0]!)));
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[1]!)));
  } catch {
    return fail("header or payload is not base64url JSON");
  }
  const alg = String(header.alg ?? "");
  const kid = String(header.kid ?? "");
  const algorithm = (Object.keys(JOSE_ALG) as KeyAlgorithm[]).find((name) => JOSE_ALG[name] === alg);
  if (!algorithm) return fail("alg " + JSON.stringify(alg) + " is not EdDSA or ML-DSA-65", alg, kid);
  if (header.typ !== "vc+jwt" || header.crit !== undefined) return fail("typ must be vc+jwt, with no crit", alg, kid);
  const method = resolveMethod(did, kid);
  if (!method) return fail("kid is not an assertion method of " + did.id, alg, kid);
  if (method.algorithm !== algorithm) return fail("alg " + alg + " does not match the " + method.algorithm + " key named by kid", alg, kid);
  const payloadMatches = canonicalize(payload) === canonicalize(unsecured(expected));
  const signatureValid = await verifyWith(provider, did, kid, algorithm, utf8(parts[0] + "." + parts[1]), fromBase64Url(parts[2]!));
  return { alg, kid, payloadMatches, signatureValid, valid: payloadMatches && signatureValid, ...(payloadMatches ? {} : { reason: "payload differs from the credential" }) };
}

// --- Data Integrity: a proof set ---------------------------------------------------------------------------------

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data as BufferSource));
}
/** eddsa-jcs-2022 §3.3 hashing (and the draft's mldsa44-jcs-2024, the same): SHA-256(JCS(proof config)) ‖ SHA-256(JCS(document)). */
async function proofHashData(document: VerifiableCredential, proof: Omit<DataIntegrityProof, "proofValue">): Promise<Uint8Array> {
  const config = { ...proof, "@context": document["@context"] };
  return concat(await sha256(canonicalBytes(config)), await sha256(canonicalBytes(unsecured(document))));
}

/** Adds a proof set: each proof is made over the credential without proofs, independently of the others. */
export async function addProofSet(credential: VerifiableCredential, signers: CredentialSigner[], created: string): Promise<VerifiableCredential> {
  const document = unsecured(credential);
  const proof: DataIntegrityProof[] = [];
  for (const signer of signers) {
    const algorithm = keyAlgorithm(signer.key);
    const options = {
      type: "DataIntegrityProof" as const,
      cryptosuite: algorithm === "Ed25519" ? "eddsa-jcs-2022" : ML_DSA_65_PROOF_SUITE,
      created,
      verificationMethod: methodId(document.issuer.id, algorithm, "multikey"),
      proofPurpose: "assertionMethod" as const,
    };
    const signature = await signer.provider.sign(await proofHashData(document, options), signer.key);
    proof.push({ ...options, proofValue: "z" + base58btc(fromBase64Url(signature.value)) });
  }
  return { ...document, proof };
}

export interface ProofCheck {
  cryptosuite: string;
  verificationMethod: string;
  valid: boolean;
}

export async function verifyProofSet(credential: VerifiableCredential, did: DidDocument, provider: Pick<CryptoProvider, "verify">): Promise<ProofCheck[]> {
  const checks: ProofCheck[] = [];
  for (const proof of credential.proof ?? []) {
    const algorithm: KeyAlgorithm | undefined =
      proof.cryptosuite === "eddsa-jcs-2022" ? "Ed25519" : proof.cryptosuite === ML_DSA_65_PROOF_SUITE ? "ML-DSA-65" : undefined;
    const { proofValue, ...options } = proof;
    const valid =
      algorithm !== undefined &&
      proof.type === "DataIntegrityProof" &&
      proof.proofPurpose === "assertionMethod" &&
      proofValue.startsWith("z") &&
      (await verifyWith(provider, did, proof.verificationMethod, algorithm, await proofHashData(credential, options), fromBase58btc(proofValue.slice(1))));
    checks.push({ cryptosuite: proof.cryptosuite, verificationMethod: proof.verificationMethod, valid });
  }
  return checks;
}

/** Both algorithms must be present and valid, as for the signed cases. */
export function hybridSatisfied(items: { valid: boolean; alg?: string; cryptosuite?: string }[]): boolean {
  const ok = items.filter((item) => item.valid);
  const classical = ok.some((item) => item.alg === "EdDSA" || item.cryptosuite === "eddsa-jcs-2022");
  const pq = ok.some((item) => item.alg === "ML-DSA-65" || item.cryptosuite === ML_DSA_65_PROOF_SUITE);
  return classical && pq && ok.length === items.length;
}
