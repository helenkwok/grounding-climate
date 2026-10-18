// Browser verification shared by every module: SHA-256 and Ed25519 through WebCrypto, and ML-DSA-65
// through the browser's own WebCrypto when it has it, otherwise through noble-post-quantum.
import type {
  ContentDigest,
  CryptoProvider,
  CryptoSignature,
  KeyMetadata,
  VerificationKey,
} from "@grounding-climate/core";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";

const toBase64Url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

const fromBase64Url = (value: string) =>
  Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));

// ML-DSA-65 SPKI: a fixed 22-byte header naming id-ml-dsa-65 (2.16.840.1.101.3.4.3.18), then the raw key.
const ML_DSA_65_SPKI_HEADER = "308207b2300b0609608648016503040312038207a100";
const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** Which implementation checked the ML-DSA-65 signature on this page, once one has. */
export let mlDsaVerifier: "browser WebCrypto" | "noble-post-quantum 0.7.1 (JavaScript)" | undefined;

/**
 * ML-DSA-65 verification. Uses the browser's own WebCrypto ML-DSA when it has one (the WICG "Modern
 * Algorithms in the Web Cryptography API" draft); otherwise the pure-JavaScript noble implementation.
 */
async function verifyMlDsa65(spki: Uint8Array, signature: Uint8Array, payload: Uint8Array): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("spki", spki as BufferSource, { name: "ML-DSA-65" }, false, ["verify"]);
    const valid = await crypto.subtle.verify({ name: "ML-DSA-65" }, key, signature as BufferSource, payload as BufferSource);
    mlDsaVerifier = "browser WebCrypto";
    return valid;
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "NotSupportedError")) return false;
  }
  if (spki.length !== 1974 || hex(spki.subarray(0, 22)) !== ML_DSA_65_SPKI_HEADER) return false;
  mlDsaVerifier = "noble-post-quantum 0.7.1 (JavaScript)";
  return ml_dsa65.verify(signature, payload, spki.subarray(22));
}

/** SHA-256, Ed25519 and ML-DSA-65 verification in the browser. */
export class WebCryptoProvider implements CryptoProvider {
  async hash(data: Uint8Array, algorithm: "SHA-256"): Promise<ContentDigest> {
    return { algorithm, value: toBase64Url(await crypto.subtle.digest("SHA-256", data as BufferSource)) };
  }

  async sign(): Promise<CryptoSignature> {
    throw new Error("The demo page never signs.");
  }

  async verify(payload: Uint8Array, signature: CryptoSignature, key: VerificationKey): Promise<boolean> {
    if (signature.keyId !== key.keyId || signature.algorithm !== key.algorithm || key.encoding !== "spki-der-base64url") {
      return false;
    }
    if (key.suite === "post-quantum" && key.algorithm === "ML-DSA-65") {
      return verifyMlDsa65(fromBase64Url(key.publicKey), fromBase64Url(signature.value), payload);
    }
    if (key.suite !== "classical" || key.algorithm !== "Ed25519") return false;
    try {
      const publicKey = await crypto.subtle.importKey(
        "spki", fromBase64Url(key.publicKey) as BufferSource, { name: "Ed25519" }, false, ["verify"],
      );
      return await crypto.subtle.verify(
        "Ed25519", publicKey, fromBase64Url(signature.value) as BufferSource, payload as BufferSource,
      );
    } catch {
      return false;
    }
  }

  async describeKey(): Promise<KeyMetadata | undefined> {
    return undefined;
  }
}
