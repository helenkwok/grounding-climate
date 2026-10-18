// Checks the committed EVM anchors (reports/evm-sepolia.json) against a public RPC: the deployed code must equal
// the forge build of the pinned source, and each case's anchor transaction must carry the case's current anchored
// digest in an Anchored log from that contract. Needs the network, so it is not part of `npm run check`.
//   npm run evm:verify                       (SEPOLIA_RPC to use another node; CHAIN_ID=31337 RPC=... for anvil)
import { readFile } from "node:fs/promises";

import { anchoredDigest, encodeEvmProof, evmAnchorAdapter, fromHex, jsonRpc, toHex } from "@grounding-climate/core";

const CHAIN_ID = Number(process.env.CHAIN_ID ?? 11155111);
const RPC = process.env.RPC ?? process.env.SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";
const file = new URL(`../reports/${CHAIN_ID === 11155111 ? "evm-sepolia" : `evm-${CHAIN_ID}`}.json`, import.meta.url);
const readJson = (url) => readFile(url, "utf8").then(JSON.parse, () => undefined);

const record = await readJson(file);
if (!record) {
  console.log(`No ${file.pathname.split("/").pop()} yet: deploy and anchor with npm run sepolia:page.`);
  process.exit(0);
}
let failed = false;
const fail = (message) => {
  console.error(message);
  failed = true;
};

const artifact = await readJson(new URL("../contracts/out/RetirementRegistry.sol/RetirementRegistry.json", import.meta.url));
const code = await jsonRpc(RPC, "eth_getCode", [record.contract, "latest"]);
if (!artifact) console.log("Bytecode not compared: run `tools/foundry/forge build --root contracts` first.");
else if (code.toLowerCase() !== artifact.deployedBytecode.object.toLowerCase()) fail(`${record.contract}: deployed code differs from the build`);
else console.log(`${record.chain} ${record.contract}: deployed code matches the build of ${record.build.source}`);

const adapter = evmAnchorAdapter({ chainId: CHAIN_ID, contract: record.contract, rpcUrl: RPC });
for (const [name, anchor] of Object.entries(record.anchors)) {
  const run = await readJson(new URL(`../reports/${name}/case-run.json`, import.meta.url));
  const digest = run && `0x${toHex(await anchoredDigest(run.attestation))}`;
  if (digest !== anchor.digest) {
    fail(`${name}: signed record changed since it was anchored (${anchor.digest} → ${digest}); anchor it again`);
    continue;
  }
  const proof = encodeEvmProof({ chain: record.chain, contract: record.contract, digest, txHash: anchor.txHash });
  const result = await adapter.verify(proof, fromHex(digest.slice(2)));
  if (result.status === "anchored") console.log(`${name}: anchored in block ${result.height} at ${result.blockTime}`);
  else if (result.status === "pending") console.log(`${name}: pending (${result.reasons.join("; ")})`);
  else fail(`${name}: ${result.reasons.join("; ")}`);
}
process.exit(failed ? 1 : 0);
