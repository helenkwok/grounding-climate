import { domainSeparatedBytes } from "./canonical.js";
import type { SignedAttestationBundle } from "./attestation.js";

// Chain-agnostic anchoring: a 32-byte digest of a signed record is committed to some public chain, so the
// record provably existed by that chain's time. Bitcoin via OpenTimestamps (ots.ts) is the first adapter;
// another chain only needs another AnchorAdapter. Adapters see the digest only, never the record.

export const ANCHOR_DOMAIN = "grounding.anchor";
export const ANCHOR_VERSION = "grounding.anchor/0.1" as const;

export type AnchorStatus = "pending" | "anchored" | "invalid";

export interface AnchorSubmission {
  proof: Uint8Array;
  /** One entry per service asked; a submission succeeds if at least one accepted it. */
  services: { url: string; ok: boolean; error?: string }[];
}

export interface AnchorUpgrade {
  proof: Uint8Array;
  changed: boolean;
  services: { url: string; status: number | string }[];
}

/** Chain data the verifier is given instead of asking the network, e.g. Bitcoin block headers by height. */
export interface AnchorEvidence {
  headers?: ReadonlyMap<number, Uint8Array>;
  /** Lowest proof-of-work difficulty a supplied header must declare. Defaults to 1 (the chain's floor). */
  minDifficulty?: number;
}

export interface AnchorVerification {
  status: AnchorStatus;
  chain: string;
  height?: number;
  blockTime?: string;
  blockHash?: string;
  /** Services still holding a pending commitment. */
  pending: string[];
  reasons: string[];
}

export interface AnchorAdapter {
  chain: string;
  format: string;
  submit(digest: Uint8Array): Promise<AnchorSubmission>;
  upgrade(proof: Uint8Array): Promise<AnchorUpgrade>;
  verify(
    proof: Uint8Array,
    digest: Uint8Array,
    evidence: AnchorEvidence,
  ): Promise<AnchorVerification>;
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(data)));
}

/**
 * The bytes an anchor commits to: the signed record (payload and the full envelope, both signatures
 * included). Status, lifecycle and challenges are left out because they change after signing.
 */
export function anchorBytes(
  signed: Pick<SignedAttestationBundle, "payload" | "envelope">,
): Uint8Array {
  return domainSeparatedBytes(ANCHOR_DOMAIN, ANCHOR_VERSION, {
    payload: signed.payload,
    envelope: signed.envelope,
  });
}

export async function anchoredDigest(
  signed: Pick<SignedAttestationBundle, "payload" | "envelope">,
): Promise<Uint8Array> {
  return sha256(anchorBytes(signed));
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})*$/i.test(hex)) {
    throw new TypeError("Invalid hex");
  }
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16));
}
