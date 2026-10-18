// Local page for deploying RetirementRegistry to Sepolia and anchoring each case, from the user's own MetaMask.
// This server never holds a key and never sends a transaction: it serves the page, hands it the forge-built
// bytecode and each case's anchored digest, and writes the transaction hashes MetaMask returns to
// reports/evm-sepolia.json. It listens on 127.0.0.1 only.
//   npm run sepolia:page          (needs `forge build --root contracts` first)
// Set CHAIN_ID=31337 to rehearse against a local anvil chain instead of Sepolia.
import { readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 8547);
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 11155111);
const OUTPUT = new URL(`../reports/${CHAIN_ID === 11155111 ? "evm-sepolia" : `evm-${CHAIN_ID}`}.json`, import.meta.url);
const ARTIFACT = new URL("../contracts/out/RetirementRegistry.sol/RetirementRegistry.json", import.meta.url);
const REPORTS = new URL("../reports/", import.meta.url);
const HEX32 = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;

const readJson = (url) => readFile(url, "utf8").then(JSON.parse, () => undefined);

async function caseDigests() {
  const cases = {};
  for (const entry of await readdir(REPORTS, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const anchor = await readJson(new URL(`${entry.name}/anchor.json`, REPORTS));
    if (anchor?.digest) cases[entry.name] = `0x${anchor.digest}`;
  }
  return cases;
}

async function bundle() {
  const artifact = await readJson(ARTIFACT);
  if (!artifact) throw new Error("No contract build: run `tools/foundry/forge build --root contracts` first");
  return {
    chainId: CHAIN_ID,
    bytecode: artifact.bytecode.object,
    cases: await caseDigests(),
    record: (await readJson(OUTPUT)) ?? null,
  };
}

/** Applies one deploy or anchor result to the record; throws on anything malformed. */
export function applyResult(record, result, cases) {
  const txHash = String(result.txHash ?? "").toLowerCase();
  if (!HEX32.test(txHash)) throw new Error("txHash must be 0x + 64 hex");
  if (result.kind === "deploy") {
    const contract = String(result.contract ?? "").toLowerCase();
    if (!ADDRESS.test(contract)) throw new Error("contract must be an address");
    return {
      version: "grounding.evm-anchor/0.1",
      chain: `eip155:${CHAIN_ID}`,
      contract,
      deployTx: txHash,
      build: { solc: "0.8.37", foundry: "v1.8.5", source: "contracts/src/RetirementRegistry.sol" },
      anchors: {},
    };
  }
  if (result.kind === "anchor") {
    if (!record?.contract) throw new Error("deploy the contract first");
    const digest = cases[result.case];
    if (!digest) throw new Error(`unknown case ${result.case}`);
    if (String(result.digest).toLowerCase() !== digest) throw new Error(`${result.case}: digest is not the case's current anchored digest`);
    return { ...record, anchors: { ...record.anchors, [result.case]: { digest, txHash } } };
  }
  throw new Error("kind must be deploy or anchor");
}

async function handle(req, res) {
  const send = (status, type, body) => {
    res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
    res.end(body);
  };
  try {
    if (req.method === "GET" && req.url === "/") {
      return send(200, "text/html; charset=utf-8", await readFile(new URL("sepolia-anchor.html", import.meta.url)));
    }
    if (req.method === "GET" && req.url === "/bundle.json") return send(200, "application/json", JSON.stringify(await bundle()));
    if (req.method === "POST" && req.url === "/record") {
      // A page on another origin could post here; only same-origin requests are accepted.
      if (req.headers.origin !== `http://127.0.0.1:${PORT}`) return send(403, "text/plain", "wrong origin");
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 10_000) return send(413, "text/plain", "too large");
      }
      const next = applyResult(await readJson(OUTPUT), JSON.parse(body), await caseDigests());
      await writeFile(OUTPUT, JSON.stringify(next, null, 2) + "\n");
      return send(200, "application/json", JSON.stringify(next));
    }
    send(404, "text/plain", "not found");
  } catch (error) {
    send(400, "text/plain", error.message);
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  createServer(handle).listen(PORT, "127.0.0.1", () => {
    console.log(`Open http://127.0.0.1:${PORT}/ in the browser that has MetaMask (chain eip155:${CHAIN_ID}).`);
  });
}
