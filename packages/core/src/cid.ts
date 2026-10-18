// IPFS content addresses for single-block files: a CIDv1 with the raw codec (0x55) and a sha2-256 multihash
// (0x12, 32 bytes), in lower-case base32 with the multibase prefix "b". Its digest is the file's own SHA-256, so
// a recorded SHA-256 converts to the CID and back with no network and no dependency. This holds only while the
// file is one IPFS block: publish with `--cid-version=1 --chunker=size-1048576` (files up to 1 MiB).
import type { ContentDigest } from "./types.js";

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
const PREFIX = [0x01, 0x55, 0x12, 0x20]; // CIDv1, raw, sha2-256, 32 bytes

/** A SHA-256 digest as Grounding records it: `{ algorithm: "SHA-256", value }` or `"SHA-256:<value>"`, value in base64url. */
export type Sha256DigestInput = ContentDigest | string;

function sha256Bytes(digest: Sha256DigestInput): Uint8Array {
  const [algorithm, value] =
    typeof digest === "string" ? [digest.slice(0, digest.indexOf(":")), digest.slice(digest.indexOf(":") + 1)] : [digest.algorithm, digest.value];
  if (algorithm !== "SHA-256") throw new TypeError("Only SHA-256 digests have a raw CID, not " + JSON.stringify(algorithm));
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new TypeError("Not a base64url SHA-256 value: " + JSON.stringify(value));
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + "=");
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** The CIDv1 (raw, sha2-256, base32) of a single-block file whose SHA-256 is `digest`. */
export function cidFromSha256(digest: Sha256DigestInput): string {
  let bits = 0;
  let acc = 0;
  let out = "b";
  for (const byte of [...PREFIX, ...sha256Bytes(digest)]) {
    acc = ((acc << 8) | byte) & 0xfff;
    bits += 8;
    while (bits >= 5) out += BASE32[(acc >>> (bits -= 5)) & 31];
  }
  return bits ? out + BASE32[(acc << (5 - bits)) & 31] : out;
}

/** The SHA-256 inside a raw sha2-256 CIDv1, as a ContentDigest. Rejects any other CID. */
export function sha256FromCid(cid: string): ContentDigest {
  if (!/^b[a-z2-7]{58}$/.test(cid)) throw new TypeError("Not a base32 CIDv1 of a raw sha2-256 block: " + JSON.stringify(cid));
  const bytes: number[] = [];
  let bits = 0;
  let acc = 0;
  for (const char of cid.slice(1)) {
    acc = ((acc << 5) | BASE32.indexOf(char)) & 0xfff;
    bits += 5;
    if (bits >= 8) bytes.push((acc >>> (bits -= 8)) & 0xff);
  }
  if (PREFIX.some((byte, index) => bytes[index] !== byte) || bytes.length !== 36) {
    throw new TypeError("Not a CIDv1 of a raw sha2-256 block: " + JSON.stringify(cid));
  }
  const value = btoa(String.fromCharCode(...bytes.slice(4))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  const digest = { algorithm: "SHA-256", value };
  if (cidFromSha256(digest) !== cid) throw new TypeError("Non-canonical CID: " + JSON.stringify(cid));
  return digest;
}
