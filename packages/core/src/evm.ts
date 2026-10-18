// EVM anchor adapter for contracts/src/RetirementRegistry.sol, over raw JSON-RPC (fetch) with the few ABI
// encodings it needs written by hand. It never holds a key: submit() returns an unsigned transaction request
// for the caller's wallet (EIP-1193, e.g. MetaMask) to send, and verify() reads the receipt and logs back.
// The chain is named by CAIP-2: eip155:<chainId>.
import {
  toHex,
  type AnchorAdapter,
  type AnchorSubmission,
  type AnchorUpgrade,
  type AnchorVerification,
} from "./anchor.js";

// keccak256 of the signatures, computed with `cast keccak` / `cast sig` (Foundry v1.8.5) and fixed here so the
// adapter needs no keccak implementation. The integration test checks them against a live contract.
export const ANCHORED_TOPIC = "0xfe2289542f7a0110ac112c3a4d712afdcaaf2900a1326f4e6f340b563a0e8734";
export const RETIRED_TOPIC = "0xf8e3c475cf3d1ec74d2cf49045b5b4c15c64c043ed13aa21abd5862bbc91bbd9";
const ANCHOR_SELECTOR = "eecdf927"; // anchor(bytes32)
const RETIRE_SELECTOR = "3b486429"; // retire(string,string,uint256,uint256,uint256,bytes32,bytes32)
export const ALREADY_RETIRED_SELECTOR = "0x5d061932"; // AlreadyRetired(bytes32,uint256,uint256)

export interface EvmTxRequest {
  to: string;
  data: string;
}

/** The proof an EVM anchor keeps: where to look, and the transaction once the wallet has sent it. */
export interface EvmAnchorProof {
  chain: string;
  contract: string;
  /** The anchored digest, hex with 0x. */
  digest: string;
  txHash?: string;
}

export interface EvmAnchorSubmission extends AnchorSubmission {
  request: EvmTxRequest;
}

export interface EvmLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber?: string;
  transactionHash?: string;
}

export interface RetiredEvent {
  unitKey: string;
  claimDigest: string;
  recorder: string;
  time: number;
}

export interface RetireCall {
  registry: string;
  series: string;
  first: bigint;
  last: bigint;
  /** First serial of the retired range just below this one in the series, or 0n if none. */
  hintPrev: bigint;
  claimDigest: Uint8Array;
  evidence: Uint8Array;
}

const word = (hex: string): string => hex.padStart(64, "0");

function uint(value: bigint): string {
  if (value < 0n || value >= 1n << 256n) throw new RangeError("uint256 out of range");
  return word(value.toString(16));
}

function bytes32(value: Uint8Array): string {
  if (value.length !== 32) throw new TypeError("Expected 32 bytes");
  return toHex(value);
}

function abiString(value: string): string {
  const hex = toHex(new TextEncoder().encode(value));
  return uint(BigInt(hex.length / 2)) + hex.padEnd(Math.ceil(hex.length / 64) * 64, "0");
}

export function encodeAnchor(digest: Uint8Array): string {
  return `0x${ANCHOR_SELECTOR}${bytes32(digest)}`;
}

export function encodeRetire(call: RetireCall): string {
  const registry = abiString(call.registry);
  const series = abiString(call.series);
  const head = 7 * 32;
  return (
    `0x${RETIRE_SELECTOR}` +
    uint(BigInt(head)) +
    uint(BigInt(head + registry.length / 2)) +
    uint(call.first) +
    uint(call.last) +
    uint(call.hintPrev) +
    bytes32(call.claimDigest) +
    bytes32(call.evidence) +
    registry +
    series
  );
}

const strip = (hex: string): string => hex.replace(/^0x/, "").toLowerCase();
const dataWord = (data: string, i: number): string => strip(data).slice(i * 64, (i + 1) * 64);

export function decodeRetiredLog(log: EvmLog): RetiredEvent {
  if (log.topics[0]?.toLowerCase() !== RETIRED_TOPIC || log.topics.length !== 2) {
    throw new TypeError("Not a Retired log");
  }
  return {
    unitKey: log.topics[1]!.toLowerCase(),
    claimDigest: `0x${dataWord(log.data, 0)}`,
    recorder: `0x${dataWord(log.data, 1).slice(24)}`,
    time: Number(BigInt(`0x${dataWord(log.data, 2)}`)),
  };
}

export async function jsonRpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await response.json()) as { result?: T; error?: { message: string; data?: unknown } };
  if (body.error) {
    const error = new Error(`${method}: ${body.error.message}`) as Error & { data?: unknown };
    error.data = body.error.data;
    throw error;
  }
  return body.result as T;
}

export function encodeEvmProof(proof: EvmAnchorProof): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(proof));
}

export function decodeEvmProof(proof: Uint8Array): EvmAnchorProof {
  return JSON.parse(new TextDecoder().decode(proof)) as EvmAnchorProof;
}

interface Receipt {
  status: string;
  blockNumber: string;
  blockHash: string;
  logs: EvmLog[];
}

/**
 * submit() hands back the unsigned request; the caller's wallet sends it and records the hash with
 * `withTransaction`. upgrade() can also find the transaction itself from the contract's Anchored logs.
 */
export function evmAnchorAdapter(options: { chainId: number; contract: string; rpcUrl: string }): Omit<AnchorAdapter, "submit"> & {
  submit(digest: Uint8Array): Promise<EvmAnchorSubmission>;
  withTransaction(proof: Uint8Array, txHash: string): Uint8Array;
} {
  const chain = `eip155:${options.chainId}`;
  const contract = options.contract.toLowerCase();
  const { rpcUrl } = options;

  async function checkChain(): Promise<string | undefined> {
    const id = await jsonRpc<string>(rpcUrl, "eth_chainId", []);
    return BigInt(id) === BigInt(options.chainId) ? undefined : `RPC is on eip155:${BigInt(id)}, not ${chain}`;
  }

  async function findTx(digestHex: string): Promise<string | undefined> {
    const logs = await jsonRpc<EvmLog[]>(rpcUrl, "eth_getLogs", [
      { address: contract, topics: [ANCHORED_TOPIC, digestHex], fromBlock: "earliest", toBlock: "latest" },
    ]);
    return logs[0]?.transactionHash;
  }

  return {
    chain,
    format: "grounding.evm-anchor/0.1",

    async submit(digest) {
      return {
        proof: encodeEvmProof({ chain, contract, digest: `0x${toHex(digest)}` }),
        services: [{ url: rpcUrl, ok: true }],
        request: { to: contract, data: encodeAnchor(digest) },
      };
    },

    withTransaction(proof, txHash) {
      return encodeEvmProof({ ...decodeEvmProof(proof), txHash });
    },

    async upgrade(proofBytes): Promise<AnchorUpgrade> {
      // Finds the transaction from the contract's Anchored logs when the wallet's hash was not recorded.
      const proof = decodeEvmProof(proofBytes);
      const txHash = proof.txHash ?? (await findTx(proof.digest));
      const found = !proof.txHash && txHash ? txHash : undefined;
      return {
        proof: found ? encodeEvmProof({ ...proof, txHash: found }) : proofBytes,
        changed: Boolean(found),
        services: [{ url: rpcUrl, status: txHash ? "found" : "pending" }],
      };
    },

    async verify(proofBytes, digest): Promise<AnchorVerification> {
      const proof = decodeEvmProof(proofBytes);
      const digestHex = `0x${toHex(digest)}`;
      const base = { chain, pending: [] as string[], reasons: [] as string[] };
      if (proof.chain !== chain || proof.contract.toLowerCase() !== contract) {
        return { ...base, status: "invalid", reasons: [`Proof names ${proof.chain} ${proof.contract}`] };
      }
      if (proof.digest.toLowerCase() !== digestHex) {
        return { ...base, status: "invalid", reasons: ["Proof is for another digest"] };
      }
      const wrongChain = await checkChain();
      if (wrongChain) return { ...base, status: "invalid", reasons: [wrongChain] };

      const txHash = proof.txHash ?? (await findTx(digestHex));
      if (!txHash) return { ...base, status: "pending", pending: [rpcUrl], reasons: ["No Anchored log yet"] };
      const receipt = await jsonRpc<Receipt | null>(rpcUrl, "eth_getTransactionReceipt", [txHash]);
      if (!receipt) return { ...base, status: "pending", pending: [rpcUrl], reasons: [`${txHash} not mined`] };
      if (BigInt(receipt.status) !== 1n) return { ...base, status: "invalid", reasons: [`${txHash} reverted`] };
      const log = receipt.logs.find(
        (l) =>
          l.address.toLowerCase() === contract &&
          l.topics[0]?.toLowerCase() === ANCHORED_TOPIC &&
          l.topics[1]?.toLowerCase() === digestHex,
      );
      if (!log) return { ...base, status: "invalid", reasons: [`${txHash} has no Anchored log for the digest`] };
      const block = await jsonRpc<{ timestamp: string; hash: string }>(rpcUrl, "eth_getBlockByNumber", [
        receipt.blockNumber,
        false,
      ]);
      return {
        ...base,
        status: "anchored",
        height: Number(BigInt(receipt.blockNumber)),
        blockHash: block.hash,
        blockTime: new Date(Number(BigInt(block.timestamp)) * 1000).toISOString(),
      };
    },
  };
}
