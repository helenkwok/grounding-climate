// Integration on a local anvil dev chain only: deploys RetirementRegistry with anvil's first well-known, unlocked
// dev account (eth_sendTransaction, so no key is handled here), anchors the building case's digest, verifies it
// through evm.ts, and checks that a second retirement of the same unit reverts. Skips when forge or anvil is not
// installed (scripts/install-foundry.sh); REQUIRE_ANVIL=1 (npm run contracts:test) turns the skip into a failure.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ALREADY_RETIRED_SELECTOR,
  decodeRetiredLog,
  encodeRetire,
  evmAnchorAdapter,
  fromHex,
  jsonRpc,
  sha256,
  type EvmLog,
} from "../src/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const contracts = join(root, "contracts");

function tool(name: string): string | undefined {
  const pinned = join(root, "tools/foundry", name);
  if (existsSync(pinned)) return pinned;
  try {
    execFileSync(name, ["--version"], { stdio: "ignore" });
    return name;
  } catch {
    return undefined;
  }
}

const forge = tool("forge");
const anvil = tool("anvil");
const missing = !forge || !anvil ? "forge or anvil not installed (scripts/install-foundry.sh)" : false;
if (missing && process.env.REQUIRE_ANVIL === "1") throw new Error(missing);

interface Receipt {
  status: string;
  contractAddress: string | null;
  blockNumber: string;
  logs: EvmLog[];
}

test("RetirementRegistry on a local anvil chain", { skip: missing }, async (t) => {
  execFileSync(forge!, ["build", "--root", contracts], { stdio: "ignore" });
  const artifact = JSON.parse(
    readFileSync(join(contracts, "out/RetirementRegistry.sol/RetirementRegistry.json"), "utf8"),
  ) as { bytecode: { object: string } };

  const port = 20_000 + Math.floor(Math.random() * 20_000);
  const chainId = 31337;
  const node = spawn(anvil!, ["--port", String(port), "--chain-id", String(chainId), "--silent"], {
    stdio: "ignore",
  });
  t.after(() => node.kill());
  const rpc = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
    try {
      await jsonRpc(rpc, "eth_chainId", []);
      break;
    } catch (error) {
      if (i > 100) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  const [from] = await jsonRpc<string[]>(rpc, "eth_accounts", []);
  async function send(tx: { to?: string; data: string; gas?: string }): Promise<Receipt> {
    const hash = await jsonRpc<string>(rpc, "eth_sendTransaction", [{ from, ...tx }]);
    return mined(hash);
  }
  async function mined(hash: string): Promise<Receipt> {
    for (let i = 0; i < 100; i++) {
      const receipt = await jsonRpc<Receipt | null>(rpc, "eth_getTransactionReceipt", [hash]);
      if (receipt) return receipt;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`${hash} not mined`);
  }

  const deployed = await send({ data: artifact.bytecode.object });
  const contract = deployed.contractAddress!;
  console.log(`# deployed RetirementRegistry at ${contract} on eip155:${chainId} from ${from}`);

  // Anchor the building case's digest (the one the Bitcoin anchor also commits to).
  const anchorRecord = JSON.parse(readFileSync(join(root, "reports/building-mrv/anchor.json"), "utf8")) as {
    digest: string;
  };
  const digest = fromHex(anchorRecord.digest);
  const adapter = evmAnchorAdapter({ chainId, contract, rpcUrl: rpc });
  assert.equal(adapter.chain, "eip155:31337");
  const submission = await adapter.submit(digest);
  assert.equal((await adapter.verify(submission.proof, digest, {})).status, "pending");

  const hash = await jsonRpc<string>(rpc, "eth_sendTransaction", [{ from, ...submission.request }]);
  await mined(hash);
  const proof = adapter.withTransaction(submission.proof, hash);
  const verified = await adapter.verify(proof, digest, {});
  assert.equal(verified.status, "anchored", verified.reasons.join("; "));
  console.log(`# Anchored(${anchorRecord.digest}) in tx ${hash}, block ${verified.height} at ${verified.blockTime}`);

  // Without the wallet's hash, upgrade() finds the transaction from the Anchored log.
  const upgraded = await adapter.upgrade(submission.proof);
  assert.ok(upgraded.changed);
  assert.equal((await adapter.verify(upgraded.proof, digest, {})).status, "anchored");
  // Another digest is not anchored.
  const other = await sha256(digest);
  assert.equal((await adapter.verify(proof, other, {})).status, "invalid");

  // Retire 100 credits once; the second retirement of the same unit reverts.
  const call = {
    registry: "acr",
    series: "ACR123-2020-batch-1",
    first: 1n,
    last: 100n,
    hintPrev: 0n,
    claimDigest: await sha256(new TextEncoder().encode("beneficiary claim")),
    evidence: digest,
  };
  const retired = await send({ to: contract, data: encodeRetire(call) });
  assert.equal(BigInt(retired.status), 1n);
  assert.equal(retired.logs.length, 1);
  const event = decodeRetiredLog(retired.logs[0]!);
  assert.equal(event.recorder, from!.toLowerCase());
  assert.equal(event.claimDigest, `0x${Buffer.from(call.claimDigest).toString("hex")}`);
  console.log(`# Retired(unitKey ${event.unitKey}, claim ${event.claimDigest}, recorder ${event.recorder}, time ${event.time})`);

  for (const again of [call, { ...call, first: 50n, last: 150n }]) {
    await assert.rejects(
      jsonRpc(rpc, "eth_call", [{ from, to: contract, data: encodeRetire(again) }, "latest"]),
      (error: Error & { data?: unknown }) => String(error.data).startsWith(ALREADY_RETIRED_SELECTOR),
    );
    // Sent anyway (explicit gas skips the estimate), it is mined as a reverted transaction with no Retired log.
    const sent = await send({ to: contract, data: encodeRetire(again), gas: "0x100000" });
    assert.equal(BigInt(sent.status), 0n);
    assert.equal(sent.logs.length, 0);
  }
  console.log("# second retirement of serials 1-100 and an overlap 50-150 reverted with AlreadyRetired");
});
