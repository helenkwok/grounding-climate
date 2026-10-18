// OpenTimestamps (.ots) proofs for Bitcoin, written from the format description with WebCrypto and fetch only
// (python-opentimestamps was read for the byte layout; no code was copied and no library is used).
//
// File        = MAGIC(31) | varuint major=1 | 0x08 (sha256) | digest(32) | Timestamp
// Timestamp   = ( 0xff Branch )* Branch          every branch but the last is prefixed 0xff
// Branch      = 0x00 Attestation | Op Timestamp  the op's result is the message of the child timestamp
// Op          = 0x08 sha256 | 0x02 sha1 | 0x03 ripemd160 | 0xf0 append varbytes | 0xf1 prepend varbytes
// Attestation = tag(8) varbytes(payload); pending carries varbytes(uri), bitcoin carries varuint(height)
// varuint     = unsigned LEB128; varbytes = varuint(length) | bytes
import {
  fromHex,
  sha256,
  toHex,
  type AnchorAdapter,
  type AnchorEvidence,
  type AnchorSubmission,
  type AnchorUpgrade,
  type AnchorVerification,
} from "./anchor.js";

export const OTS_MAGIC = fromHex(
  "004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294",
);
const PENDING_TAG = "83dfe30d2ef90c8e";
const BITCOIN_TAG = "0588960d73d71901";

export const OTS_CALENDARS = [
  "https://alice.btc.calendar.opentimestamps.org",
  "https://bob.btc.calendar.opentimestamps.org",
  "https://finney.calendar.eternitywall.com",
];

export type OtsOp = "sha256" | "sha1" | "ripemd160" | "append" | "prepend";

export type OtsAttestation =
  | { type: "pending"; uri: string }
  | { type: "bitcoin"; height: number }
  | { type: "unknown"; tag: string; payload: Uint8Array };

export type OtsBranch =
  | { attestation: OtsAttestation }
  | { op: OtsOp; arg?: Uint8Array; child: OtsTimestamp };

export interface OtsTimestamp {
  branches: OtsBranch[];
}

export interface OtsProof {
  digest: Uint8Array;
  timestamp: OtsTimestamp;
}

const UNARY: Record<number, OtsOp> = { 0x08: "sha256", 0x02: "sha1", 0x03: "ripemd160" };
const BINARY: Record<number, OtsOp> = { 0xf0: "append", 0xf1: "prepend" };
const OP_TAG: Record<OtsOp, number> = { sha256: 0x08, sha1: 0x02, ripemd160: 0x03, append: 0xf0, prepend: 0xf1 };
const MAX_DEPTH = 256;

class Reader {
  offset = 0;
  constructor(private readonly bytes: Uint8Array) {}

  get done(): boolean {
    return this.offset === this.bytes.length;
  }

  byte(): number {
    const value = this.bytes[this.offset];
    if (value === undefined) {
      throw new Error("Unexpected end of proof");
    }
    this.offset += 1;
    return value;
  }

  take(length: number): Uint8Array {
    if (this.offset + length > this.bytes.length) {
      throw new Error("Unexpected end of proof");
    }
    const out = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return out;
  }

  varuint(): number {
    let value = 0;
    for (let shift = 0; ; shift += 7) {
      if (shift > 49) {
        throw new Error("varuint too large");
      }
      const byte = this.byte();
      value += (byte & 0x7f) * 2 ** shift;
      if (!(byte & 0x80)) {
        return value;
      }
    }
  }

  varbytes(max: number): Uint8Array {
    const length = this.varuint();
    if (length > max) {
      throw new Error("varbytes longer than " + max);
    }
    return this.take(length);
  }
}

function varuint(value: number): Uint8Array {
  const out: number[] = [];
  do {
    let byte = value % 128;
    value = Math.floor(value / 128);
    if (value) byte |= 0x80;
    out.push(byte);
  } while (value);
  return Uint8Array.from(out);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const varbytes = (bytes: Uint8Array): Uint8Array => concat(varuint(bytes.length), bytes);
const equal = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((byte, i) => byte === b[i]);

function readAttestation(r: Reader): OtsAttestation {
  const tag = toHex(r.take(8));
  const payload = r.varbytes(8192);
  const p = new Reader(payload);
  let attestation: OtsAttestation;
  if (tag === PENDING_TAG) {
    attestation = { type: "pending", uri: new TextDecoder().decode(p.varbytes(1000)) };
  } else if (tag === BITCOIN_TAG) {
    attestation = { type: "bitcoin", height: p.varuint() };
  } else {
    return { type: "unknown", tag, payload };
  }
  if (!p.done) {
    throw new Error("Trailing bytes in attestation");
  }
  return attestation;
}

function readTimestamp(r: Reader, depth = 0): OtsTimestamp {
  if (depth > MAX_DEPTH) {
    throw new Error("Proof nested too deeply");
  }
  const node: OtsTimestamp = { branches: [] };
  const branch = (tag: number): void => {
    if (tag === 0x00) {
      node.branches.push({ attestation: readAttestation(r) });
      return;
    }
    const unary = UNARY[tag];
    const binary = BINARY[tag];
    if (unary) {
      node.branches.push({ op: unary, child: readTimestamp(r, depth + 1) });
    } else if (binary) {
      const arg = r.varbytes(4096);
      node.branches.push({ op: binary, arg, child: readTimestamp(r, depth + 1) });
    } else {
      throw new Error("Unknown op tag 0x" + tag.toString(16));
    }
  };
  let tag = r.byte();
  while (tag === 0xff) {
    branch(r.byte());
    tag = r.byte();
  }
  branch(tag);
  return node;
}

function writeAttestation(a: OtsAttestation): Uint8Array {
  const [tag, payload] =
    a.type === "pending"
      ? [PENDING_TAG, varbytes(new TextEncoder().encode(a.uri))]
      : a.type === "bitcoin"
        ? [BITCOIN_TAG, varuint(a.height)]
        : [a.tag, a.payload];
  return concat(Uint8Array.of(0x00), fromHex(tag), varbytes(payload));
}

function writeTimestamp(node: OtsTimestamp): Uint8Array {
  if (!node.branches.length) {
    throw new Error("Empty timestamp");
  }
  const parts = node.branches.map((b) =>
    "attestation" in b
      ? writeAttestation(b.attestation)
      : concat(
          Uint8Array.of(OP_TAG[b.op]),
          b.arg ? varbytes(b.arg) : new Uint8Array(),
          writeTimestamp(b.child),
        ),
  );
  return concat(...parts.map((p, i) => (i < parts.length - 1 ? concat(Uint8Array.of(0xff), p) : p)));
}

export function parseOts(bytes: Uint8Array): OtsProof {
  const r = new Reader(bytes);
  if (!equal(r.take(OTS_MAGIC.length), OTS_MAGIC)) {
    throw new Error("Not an OpenTimestamps proof");
  }
  const major = r.varuint();
  if (major !== 1) {
    throw new Error("Unsupported OpenTimestamps version " + major);
  }
  if (r.byte() !== 0x08) {
    throw new Error("Only SHA-256 file digests are supported");
  }
  const digest = r.take(32);
  const timestamp = readTimestamp(r);
  if (!r.done) {
    throw new Error("Trailing bytes after proof");
  }
  return { digest, timestamp };
}

export function serializeOts(proof: OtsProof): Uint8Array {
  return concat(OTS_MAGIC, varuint(1), Uint8Array.of(0x08), proof.digest, writeTimestamp(proof.timestamp));
}

/** A calendar answers with a bare timestamp (no file header) for the message it was given. */
export function parseCalendarResponse(bytes: Uint8Array): OtsTimestamp {
  const r = new Reader(bytes);
  const timestamp = readTimestamp(r);
  if (!r.done) {
    throw new Error("Trailing bytes in calendar response");
  }
  return timestamp;
}

async function applyOp(op: OtsOp, arg: Uint8Array | undefined, msg: Uint8Array): Promise<Uint8Array> {
  switch (op) {
    case "sha256":
      return sha256(msg);
    case "sha1":
      return new Uint8Array(await crypto.subtle.digest("SHA-1", new Uint8Array(msg)));
    case "append":
      return concat(msg, arg ?? new Uint8Array());
    case "prepend":
      return concat(arg ?? new Uint8Array(), msg);
    case "ripemd160":
      // ponytail: WebCrypto has no RIPEMD-160; calendars in use today emit only sha256/append/prepend.
      throw new Error("RIPEMD-160 is not supported by this verifier");
  }
}

export interface OtsLeaf {
  attestation: OtsAttestation;
  /** The message that reaches the attestation; for Bitcoin, the block's merkle root in header byte order. */
  message: Uint8Array;
  parent: OtsTimestamp;
  index: number;
}

/** Walks every path from the digest to an attestation, computing the message along the way. */
export async function otsLeaves(proof: OtsProof): Promise<OtsLeaf[]> {
  const out: OtsLeaf[] = [];
  const walk = async (node: OtsTimestamp, msg: Uint8Array): Promise<void> => {
    for (const [index, b] of node.branches.entries()) {
      if ("attestation" in b) {
        out.push({ attestation: b.attestation, message: msg, parent: node, index });
      } else {
        await walk(b.child, await applyOp(b.op, b.arg, msg));
      }
    }
  };
  await walk(proof.timestamp, proof.digest);
  return out;
}

// Bitcoin's largest allowed target (difficulty 1), from bits 0x1d00ffff.
const POW_LIMIT = 0xffffn << 208n;

export interface BitcoinHeaderCheck {
  blockHash: string;
  merkleRoot: Uint8Array;
  time: number;
  bits: number;
  difficulty: number;
  powValid: boolean;
}

/** Hashes an 80-byte header and checks that the hash meets the target its own bits field declares. */
export async function checkBitcoinHeader(header: Uint8Array): Promise<BitcoinHeaderCheck> {
  if (header.length !== 80) {
    throw new Error("A Bitcoin header is 80 bytes");
  }
  const view = new DataView(header.buffer, header.byteOffset, 80);
  const bits = view.getUint32(72, true);
  const exponent = bits >>> 24;
  const mantissa = BigInt(bits & 0x007fffff);
  const target =
    bits & 0x00800000
      ? 0n
      : exponent <= 3
        ? mantissa >> BigInt(8 * (3 - exponent))
        : mantissa << BigInt(8 * (exponent - 3));
  const blockHash = toHex((await sha256(await sha256(header))).reverse());
  return {
    blockHash,
    merkleRoot: header.slice(36, 68),
    time: view.getUint32(68, true),
    bits,
    difficulty: target > 0n ? Number(POW_LIMIT / target) : 0,
    powValid: target > 0n && target <= POW_LIMIT && BigInt("0x" + blockHash) <= target,
  };
}

export async function stampOts(
  digest: Uint8Array,
  calendars: string[] = OTS_CALENDARS,
): Promise<AnchorSubmission> {
  if (digest.length !== 32) {
    throw new Error("Anchor digests are 32 bytes");
  }
  // A random nonce hides our digest from the calendars: they only see sha256(digest || nonce).
  const nonce = crypto.getRandomValues(new Uint8Array(16));
  const tip = await sha256(concat(digest, nonce));
  const tipNode: OtsTimestamp = { branches: [] };
  const services: AnchorSubmission["services"] = [];
  await Promise.all(
    calendars.map(async (url) => {
      try {
        const res = await fetch(url + "/digest", {
          method: "POST",
          headers: { Accept: "application/vnd.opentimestamps.v1" },
          body: new Uint8Array(tip),
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) {
          throw new Error("HTTP " + res.status);
        }
        tipNode.branches.push(...parseCalendarResponse(new Uint8Array(await res.arrayBuffer())).branches);
        services.push({ url, ok: true });
      } catch (error) {
        services.push({ url, ok: false, error: String(error) });
      }
    }),
  );
  if (!tipNode.branches.length) {
    throw new Error("No calendar accepted the digest: " + JSON.stringify(services));
  }
  services.sort((a, b) => a.url.localeCompare(b.url));
  const proof: OtsProof = {
    digest,
    timestamp: { branches: [{ op: "append", arg: nonce, child: { branches: [{ op: "sha256", child: tipNode }] } }] },
  };
  return { proof: serializeOts(proof), services };
}

/** Asks each calendar still holding a pending commitment for its finished path, and splices it in. */
export async function upgradeOts(bytes: Uint8Array): Promise<AnchorUpgrade> {
  const proof = parseOts(bytes);
  const services: AnchorUpgrade["services"] = [];
  let changed = false;
  // Replace from the end so earlier indexes in the same parent stay valid.
  for (const leaf of (await otsLeaves(proof)).reverse()) {
    if (leaf.attestation.type !== "pending") continue;
    const url = leaf.attestation.uri.replace(/\/$/, "") + "/timestamp/" + toHex(leaf.message);
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/vnd.opentimestamps.v1" },
        signal: AbortSignal.timeout(15000),
      });
      services.push({ url: leaf.attestation.uri, status: res.status });
      if (res.status !== 200) continue;
      const done = parseCalendarResponse(new Uint8Array(await res.arrayBuffer()));
      leaf.parent.branches.splice(leaf.index, 1, ...done.branches);
      changed = true;
    } catch (error) {
      services.push({ url: leaf.attestation.uri, status: String(error) });
    }
  }
  return { proof: changed ? serializeOts(proof) : bytes, changed, services };
}

/**
 * Offline verification against supplied block headers. "anchored" means: the proof commits to this
 * digest, a Bitcoin attestation's merkle root matches the supplied header, and that header carries the
 * proof of work its bits declare. It does not show the header is on the main chain; that needs a node.
 */
export async function verifyOtsProof(
  bytes: Uint8Array,
  digest: Uint8Array,
  evidence: AnchorEvidence = {},
): Promise<AnchorVerification> {
  const result: AnchorVerification = { status: "invalid", chain: "bitcoin", pending: [], reasons: [] };
  let proof: OtsProof;
  let leaves: OtsLeaf[];
  try {
    proof = parseOts(bytes);
    leaves = await otsLeaves(proof);
  } catch (error) {
    result.reasons.push(String(error));
    return result;
  }
  if (!equal(proof.digest, digest)) {
    result.reasons.push("Proof commits to " + toHex(proof.digest) + ", not " + toHex(digest));
    return result;
  }
  let failed = false;
  for (const leaf of leaves) {
    const a = leaf.attestation;
    if (a.type === "pending") {
      result.pending.push(a.uri);
      continue;
    }
    if (a.type !== "bitcoin") continue;
    const header = evidence.headers?.get(a.height);
    if (!header) {
      failed = true;
      result.reasons.push("No header supplied for Bitcoin block " + a.height);
      continue;
    }
    const check = await checkBitcoinHeader(header);
    if (!equal(check.merkleRoot, leaf.message)) {
      failed = true;
      result.reasons.push("Merkle root of block " + a.height + " does not match the proof");
    } else if (!check.powValid || check.difficulty < (evidence.minDifficulty ?? 1)) {
      failed = true;
      result.reasons.push("Header for block " + a.height + " lacks the required proof of work");
    } else if (result.height === undefined || a.height < result.height) {
      result.height = a.height;
      result.blockHash = check.blockHash;
      result.blockTime = new Date(check.time * 1000).toISOString();
    }
  }
  if (result.height !== undefined && !failed) {
    result.status = "anchored";
  } else if (!failed && result.pending.length) {
    result.status = "pending";
  } else if (!failed) {
    result.reasons.push("No Bitcoin or pending attestation in proof");
  }
  return result;
}

export const bitcoinOtsAdapter: AnchorAdapter = {
  chain: "bitcoin",
  format: "opentimestamps",
  submit: (digest) => stampOts(digest),
  upgrade: upgradeOts,
  verify: verifyOtsProof,
};
