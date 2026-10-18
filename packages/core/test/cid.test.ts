import assert from "node:assert/strict";
import test from "node:test";

import { cidFromSha256, sha256FromCid } from "../src/index.js";

// Expected CIDs were computed by multiformats@14.0.5 (CID.create(1, 0x55, sha2-256)) in the content-address spike.
const vectors = [
  // The empty raw block, as published by IPFS.
  ["47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU", "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku"],
  // data/external/bdg2/meter.csv
  ["XwcVNyhhcl2ZiLd2kJsJAlKmcGga7PsW-7w1cspHQ6o", "bafkreic7a4ktokdbojoztcfxo2ijwcickktha2a25t5rn654gvzmur2dvi"],
  // data/external/acr-offsetsdb-full/credits.csv (736,536 bytes: one 1 MiB block)
  ["AcTDGBemGKDgCCq6KC2--mUQcC3eCj30hYn7waiFMLU", "bafkreiabytbrqf5gdcqoacbkxiuc3px2muihalo6bi67jbmj7pa2rbjqwu"],
] as const;

test("a SHA-256 digest maps to the raw CIDv1 that multiformats computes", () => {
  for (const [value, cid] of vectors) {
    assert.equal(cidFromSha256({ algorithm: "SHA-256", value }), cid);
    assert.equal(cidFromSha256("SHA-256:" + value), cid);
  }
});

test("a CID round-trips back to the same digest", () => {
  for (const [value, cid] of vectors) {
    assert.deepEqual(sha256FromCid(cid), { algorithm: "SHA-256", value });
  }
});

test("other algorithms and malformed input are rejected", () => {
  const [value, cid] = vectors[1];
  assert.throws(() => cidFromSha256({ algorithm: "SHA-512", value }), /Only SHA-256/);
  assert.throws(() => cidFromSha256("sha256:" + value), /Only SHA-256/);
  assert.throws(() => cidFromSha256(value), /Only SHA-256/);
  assert.throws(() => cidFromSha256("SHA-256:" + value.slice(1)), /Not a base64url/);
  assert.throws(() => cidFromSha256("SHA-256:" + value.slice(1) + "+"), /Not a base64url/);
  assert.throws(() => sha256FromCid(cid.toUpperCase()), /Not a base32/);
  assert.throws(() => sha256FromCid(cid.slice(0, -1)), /Not a base32/);
  // dag-pb (0x70) instead of raw: a UnixFS root, whose digest is not the file's SHA-256.
  assert.throws(() => sha256FromCid("bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku"), /raw sha2-256/);
  // Same bytes, but the unused trailing bits set: not the canonical encoding.
  assert.throws(() => sha256FromCid(cid.slice(0, -1) + "j"), /Non-canonical|raw sha2-256/);
});
