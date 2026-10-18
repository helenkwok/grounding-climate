import assert from "node:assert/strict";
import test from "node:test";

import {
  anchoredDigest,
  checkBitcoinHeader,
  fromHex,
  otsLeaves,
  parseOts,
  serializeOts,
  sha256,
  toHex,
  verifyOtsProof,
} from "../src/index.js";
import type { OtsProof, SignedAttestationBundle } from "../src/index.js";

// Mainnet block 358391 fetched from blockstream.info and mempool.space,
// which agreed byte for byte. Block headers are public chain data. All proof trees below are synthetic:
// the OpenTimestamps reference examples have no clear licence, so none are vendored.
const HEADER_358391 = fromHex(
  "02000000b96394585a281b7e5f438fd1c9ed492645a1fd61cb3802040000000000000000007ee445d23ad061af4a36b809501fab1ac4f2d7e7a739817dd0cbb7ec661b8a1e376755f58616186272def6",
);

const digest = fromHex("11".repeat(32));
const nonce = fromHex("22".repeat(16));

function syntheticProof(): OtsProof {
  return {
    digest: new Uint8Array(digest),
    timestamp: {
      branches: [
        {
          op: "append",
          arg: new Uint8Array(nonce),
          child: {
            branches: [
              {
                op: "sha256",
                child: {
                  branches: [
                    { attestation: { type: "pending", uri: "https://calendar.example" } },
                    { op: "sha1", child: { branches: [{ attestation: { type: "unknown", tag: "0102030405060708", payload: Uint8Array.of(9) } }] } },
                    {
                      op: "prepend",
                      arg: fromHex("aa"),
                      child: { branches: [{ op: "sha256", child: { branches: [{ attestation: { type: "bitcoin", height: 358391 } }] } }] },
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    },
  };
}

// A header with mainnet-looking bits whose merkle root is set to the given message; it was never mined.
function forgedHeader(merkleRoot: Uint8Array): Uint8Array {
  const header = new Uint8Array(HEADER_358391);
  header.set(merkleRoot, 36);
  return header;
}

test("ots proofs round-trip byte for byte", () => {
  const bytes = serializeOts(syntheticProof());
  assert.deepEqual(serializeOts(parseOts(bytes)), bytes);
  assert.throws(() => parseOts(bytes.slice(0, -1)), /end of proof/);
  assert.throws(() => parseOts(Uint8Array.of(...bytes, 0)), /Trailing/);
  assert.throws(() => parseOts(Uint8Array.of(0xff, ...bytes.slice(1))), /Not an OpenTimestamps/);
});

test("merkle walk applies append, sha256 and prepend in order", async () => {
  const leaves = await otsLeaves(syntheticProof());
  const bitcoin = leaves.find((l) => l.attestation.type === "bitcoin");
  const tip = await sha256(Uint8Array.of(...digest, ...nonce));
  assert.equal(toHex(leaves[0]!.message), toHex(tip));
  assert.equal(toHex(bitcoin!.message), toHex(await sha256(Uint8Array.of(0xaa, ...tip))));
});

test("proof of work passes for a mined header and fails for forged ones", async () => {
  const real = await checkBitcoinHeader(HEADER_358391);
  assert.equal(real.blockHash, "000000000000000003e892881a8cdcdc117c06d444057c98b6f04a9ee75a2319");
  assert.equal(real.powValid, true);
  assert.equal(new Date(real.time * 1000).toISOString(), "2015-05-28T15:41:18.000Z");
  assert.ok(real.difficulty > 4e10);

  assert.equal((await checkBitcoinHeader(forgedHeader(fromHex("00".repeat(32))))).powValid, false);
  const easy = new Uint8Array(HEADER_358391);
  new DataView(easy.buffer).setUint32(72, 0x207fffff, true); // regtest-style bits: above the mainnet limit
  assert.equal((await checkBitcoinHeader(easy)).powValid, false);
});

test("verification reports pending, rejects a flipped byte and a forged header", async () => {
  const proof = syntheticProof();
  const bytes = serializeOts(proof);
  const root = (await otsLeaves(proof)).find((l) => l.attestation.type === "bitcoin")!.message;

  const noHeader = await verifyOtsProof(bytes, digest);
  assert.equal(noHeader.status, "invalid");
  assert.match(noHeader.reasons.join(), /No header supplied for Bitcoin block 358391/);

  const forged = await verifyOtsProof(bytes, digest, { headers: new Map([[358391, forgedHeader(root)]]) });
  assert.equal(forged.status, "invalid");
  assert.match(forged.reasons.join(), /proof of work/);

  const flipped = new Uint8Array(bytes);
  flipped[flipped.indexOf(0x22)]! ^= 1; // first byte of the nonce
  const tampered = await verifyOtsProof(flipped, digest, { headers: new Map([[358391, forgedHeader(root)]]) });
  assert.match(tampered.reasons.join(), /Merkle root of block 358391 does not match/);

  assert.match((await verifyOtsProof(bytes, fromHex("33".repeat(32)))).reasons.join(), /Proof commits to 1111/);

  const pendingOnly: OtsProof = {
    digest,
    timestamp: { branches: [{ attestation: { type: "pending", uri: "https://calendar.example" } }] },
  };
  const pending = await verifyOtsProof(serializeOts(pendingOnly), digest);
  assert.equal(pending.status, "pending");
  assert.deepEqual(pending.pending, ["https://calendar.example"]);
});

test("anchored digest covers the signed record but not its mutable status", async () => {
  const signed = {
    payload: { version: "grounding.attestation/0.1", claim: "x" },
    envelope: { signatures: [{ value: "a" }, { value: "b" }] },
    status: "verified",
    lifecycle: [],
  } as unknown as SignedAttestationBundle;
  const base = toHex(await anchoredDigest(signed));
  assert.equal(toHex(await anchoredDigest({ ...signed, status: "challenged", lifecycle: [{}] } as unknown as SignedAttestationBundle)), base);
  const resigned = { ...signed, envelope: { signatures: [{ value: "a" }, { value: "c" }] } } as unknown as SignedAttestationBundle;
  assert.notEqual(toHex(await anchoredDigest(resigned)), base);
});
