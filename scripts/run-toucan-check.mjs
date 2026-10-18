// Checks Toucan's bridged Verra credits on Polygon: on-chain against itself, and against Verra's own retirement
// records. Read-only eth_call over public JSON-RPC, pinned to one block; no keys, no accounts, no transactions.
//
// Published (reports/carbon-registry/toucan-onchain.json), on-chain counts only:
//   - no Verra serial range is bridged twice (two batch NFTs whose serial ranges overlap);
//   - for each TCO2 token, tokens still held plus tokens retired on chain do not exceed the confirmed batches;
// Local only (data/cache/toucan/verra-comparison.json and the terminal), because Verra's terms on derived data are
// unclear: per project-vintage, the bridged quantity against the quantity Verra records as retired to Toucan.
//   node scripts/run-toucan-check.mjs            (re-reads the chain; BLOCK=<n> to pin a block, or uses the cache)
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { csvObjects } from "@grounding-climate/carbon-registry";

import { openSnapshot } from "./lib/offsetsdb.mjs";

const RPC = process.env.POLYGON_RPC ?? "https://polygon-bor-rpc.publicnode.com";
const CACHE = new URL("../data/cache/toucan/", import.meta.url);
const OUT = new URL("../reports/carbon-registry/toucan-onchain.json", import.meta.url);
// Toucan production deployment on Polygon (github.com/ToucanProtocol/contracts, deployments/production/matic).
const FACTORY = "0x2359677e513bc83106268514c5b2de3c29c849ea"; // ToucanCarbonOffsetsFactory (Verra TCO2s)
const BATCHES = "0x8a4d7458dde3023a3b24225d62087701a88b09dd"; // CarbonOffsetBatches
const CERTS = "0x5e377f16e4ec6001652befd737341a28889af002"; // RetirementCertificates
// Selectors from `cast sig` (Foundry v1.8.5).
const SEL = {
  getContracts: "c3a2a93a",
  pvIdtoERC20: "5e813d3c",
  totalRetired: "4d8f59f0",
  batchTokenCounter: "b3057025",
  getBatchNFTData: "dff35e83",
  getSerialNumber: "9bd905f8",
  retireEventCounter: "99b00a8d",
  retirements: "61e4678b",
  symbol: "95d89b41",
  totalSupply: "18160ddd",
};
// CarbonOffsetBatchesTypes.sol, enum BatchStatus.
const STATUS = ["pending", "rejected", "confirmed", "detokenizationRequested", "detokenizationFinalized", "retirementRequested", "retirementFinalized"];
const TONNE = 10n ** 18n;

const word = (n) => BigInt(n).toString(16).padStart(64, "0");
const words = (hex) => hex.slice(2).match(/.{64}/g) ?? [];
const uint = (hex, i = 0) => BigInt("0x" + words(hex)[i]);
const address = (w) => "0x" + w.slice(24);
const string = (hex) => {
  const w = words(hex);
  const at = Number(BigInt("0x" + w[0]) / 32n);
  const length = Number(BigInt("0x" + w[at]));
  return Buffer.from(hex.slice(2 + (at + 1) * 64, 2 + (at + 1) * 64 + length * 2), "hex").toString("utf8");
};
const addresses = (hex) => {
  const w = words(hex);
  const at = Number(BigInt("0x" + w[0]) / 32n);
  return w.slice(at + 1, at + 1 + Number(BigInt("0x" + w[at]))).map(address);
};
const tonnes = (wei) => Number(wei / 10n ** 12n) / 1e6;

async function rpcBatch(calls) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(calls.map((params, id) => ({ jsonrpc: "2.0", id, ...params }))),
      });
      const replies = await res.json();
      if (!Array.isArray(replies)) throw new Error(JSON.stringify(replies).slice(0, 200));
      const byId = new Map(replies.map((r) => [r.id, r]));
      return calls.map((_, id) => {
        const r = byId.get(id);
        if (!r || r.error) throw new Error(`eth_call failed: ${JSON.stringify(r?.error ?? "no reply")}`);
        return r.result;
      });
    } catch (error) {
      if (attempt >= 6) throw error;
      await new Promise((done) => setTimeout(done, 2000 * attempt));
    }
  }
}

const MULTICALL3 = "0xca11bde05977b3631167028862be2a173976ca11"; // same address on every EVM chain
const AGGREGATE3 = "82ad56cb"; // aggregate3((address,bool,bytes)[])

/** ABI-encodes aggregate3 over (to, data) pairs, with allowFailure false so any failing call reverts the batch. */
export function encodeAggregate3(items) {
  const elements = items.map(([to, data]) => {
    const padded = data.padEnd(Math.ceil(data.length / 64) * 64, "0");
    return word(BigInt(to)) + word(0) + word(0x60) + word(data.length / 2) + padded;
  });
  let offset = items.length * 32;
  const offsets = elements.map((e) => {
    const at = offset;
    offset += e.length / 2;
    return word(at);
  });
  return AGGREGATE3 + word(0x20) + word(items.length) + offsets.join("") + elements.join("");
}

/** Decodes aggregate3's (bool success, bytes returnData)[] into the return data of each call, as 0x hex. */
export function decodeAggregate3(hex) {
  const body = hex.slice(2);
  const at = (byte) => Number(BigInt("0x" + body.slice(byte * 2, byte * 2 + 64)));
  const array = at(0);
  const n = at(array);
  return Array.from({ length: n }, (_, i) => {
    const element = array + 32 + at(array + 32 + i * 32);
    const data = element + at(element + 32);
    return "0x" + body.slice((data + 32) * 2, (data + 32 + at(data)) * 2);
  });
}

/** eth_call for many (to, data) pairs at one block, through Multicall3: 200 calls per eth_call (public nodes cap a result at 100 kB), one at a time. */
async function callAll(block, items) {
  const out = [];
  for (let i = 0; i < items.length; i += 200) {
    const [result] = await rpcBatch([{ method: "eth_call", params: [{ to: MULTICALL3, data: "0x" + encodeAggregate3(items.slice(i, i + 200)) }, block] }]);
    out.push(...decodeAggregate3(result));
  }
  return out;
}

async function readChain() {
  // Public nodes serve only recent state without an archive token, so the reads run at "latest" and the report
  // records the block range they spanned (a few minutes). BLOCK=<n> pins one block on an archive node.
  const block = process.env.BLOCK ? "0x" + BigInt(process.env.BLOCK).toString(16) : "latest";
  const [first] = await rpcBatch([{ method: "eth_blockNumber", params: [] }]);
  const [contracts, totalRetired, batchCount, certCount] = await callAll(block, [
    [FACTORY, SEL.getContracts],
    [FACTORY, SEL.totalRetired],
    [BATCHES, SEL.batchTokenCounter],
    [CERTS, SEL.retireEventCounter],
  ]);
  const tco2s = addresses(contracts);
  const symbols = await callAll(block, tco2s.map((a) => [a, SEL.symbol]));
  const supplies = await callAll(block, tco2s.map((a) => [a, SEL.totalSupply]));
  const batchIds = Array.from({ length: Number(uint(batchCount)) }, (_, i) => i + 1);
  const data = await callAll(block, batchIds.map((id) => [BATCHES, SEL.getBatchNFTData + word(id)]));
  const serials = await callAll(block, batchIds.map((id) => [BATCHES, SEL.getSerialNumber + word(id)]));
  const certIds = Array.from({ length: Number(uint(certCount)) }, (_, i) => i + 1);
  const certs = await callAll(block, certIds.map((id) => [CERTS, SEL.retirements + word(id)]));
  const pvIds = [...new Set(data.map((d) => uint(d, 0)).concat(certs.map((c) => uint(c, 3))))];
  const pvTco2 = await callAll(block, pvIds.map((pv) => [FACTORY, SEL.pvIdtoERC20 + word(pv)]));
  const [last] = await rpcBatch([{ method: "eth_blockNumber", params: [] }]);
  return {
    rpc: RPC,
    blocks: process.env.BLOCK ? [Number(BigInt(block)), Number(BigInt(block))] : [Number(BigInt(first)), Number(BigInt(last))],
    factoryTotalRetired: uint(totalRetired).toString(),
    tco2s: tco2s.map((a, i) => ({ address: a, symbol: string(symbols[i]), supply: uint(supplies[i]).toString() })),
    batches: batchIds.map((id, i) => ({
      id,
      pvId: uint(data[i], 0).toString(),
      quantity: uint(data[i], 1).toString(),
      status: STATUS[Number(uint(data[i], 2))] ?? "unknown",
      serial: string(serials[i]),
    })),
    retirements: certIds.map((id, i) => ({ id, amount: uint(certs[i], 2).toString(), pvId: uint(certs[i], 3).toString() })),
    pvToTco2: Object.fromEntries(pvIds.map((pv, i) => [pv.toString(), address(words(pvTco2[i])[0])])),
  };
}

/**
 * Verra serials, newer "8367-10851650-10851650-VCS-VCU-1423-VER-IN-1-1418-01012020-29022020-0" and older
 * "7236-378945246-378945248-VCU-034-APX-IN-1-1190-01012018-31052018-0": block, first, last, then fields that
 * end with the project id and the vintage dates, counted from "VCU".
 */
export function parseVerraSerial(serial) {
  const parts = serial.split("-");
  const vcu = parts.indexOf("VCU");
  if (vcu < 3 || parts.length < vcu + 8) return undefined;
  const start = Number(parts[1]);
  const end = Number(parts[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return undefined;
  return { key: [parts[0], ...parts.slice(3)].join("-"), start, end, projectId: "VCS" + parts[vcu + 5], vintageStart: parts[vcu + 6] };
}

/** Pairs of bridged serial ranges that overlap within the same Verra issuance block. */
export function serialOverlaps(ranges) {
  const byKey = new Map();
  for (const r of ranges) byKey.set(r.key, [...(byKey.get(r.key) ?? []), r]);
  const overlaps = [];
  for (const list of byKey.values()) {
    list.sort((a, b) => a.start - b.start);
    for (let i = 1; i < list.length; i++) if (list[i].start <= list[i - 1].end) overlaps.push([list[i - 1].id, list[i].id]);
  }
  return overlaps;
}

const symbolParts = (symbol) => {
  const [, standard, project, vintage] = symbol.split("-");
  return { standard, projectId: standard + project, vintageYear: Number(String(vintage).slice(0, 4)) };
};

function checkOnChain(chain) {
  const tco2ByAddress = new Map(chain.tco2s.map((t) => [t.address.toLowerCase(), t]));
  const live = new Set(["confirmed", "detokenizationRequested", "retirementRequested"]);
  const confirmed = new Map();
  for (const b of chain.batches) {
    if (!live.has(b.status)) continue;
    const tco2 = chain.pvToTco2[b.pvId]?.toLowerCase();
    confirmed.set(tco2, (confirmed.get(tco2) ?? 0n) + BigInt(b.quantity) * TONNE);
  }
  const retired = new Map();
  let certSum = 0n;
  for (const r of chain.retirements) {
    const tco2 = chain.pvToTco2[r.pvId]?.toLowerCase();
    retired.set(tco2, (retired.get(tco2) ?? 0n) + BigInt(r.amount));
    if (tco2ByAddress.has(tco2)) certSum += BigInt(r.amount);
  }
  const overBacked = chain.tco2s.filter((t) => {
    const a = t.address.toLowerCase();
    return BigInt(t.supply) + (retired.get(a) ?? 0n) > (confirmed.get(a) ?? 0n);
  });
  const vcsBatches = chain.batches.filter((b) => tco2ByAddress.get(chain.pvToTco2[b.pvId]?.toLowerCase())?.symbol.split("-")[1] === "VCS");
  const ranges = vcsBatches.filter((b) => b.status === "confirmed").map((b) => ({ id: b.id, ...parseVerraSerial(b.serial) })).filter((r) => r.key);
  const byStatus = {};
  for (const b of chain.batches) byStatus[b.status] = (byStatus[b.status] ?? 0) + 1;
  const byStandard = {};
  for (const t of chain.tco2s) byStandard[symbolParts(t.symbol).standard] = (byStandard[symbolParts(t.symbol).standard] ?? 0) + 1;
  return {
    confirmed,
    report: {
      tco2Tokens: chain.tco2s.length,
      tco2ByStandard: byStandard,
      batchNfts: chain.batches.length,
      batchesByStatus: byStatus,
      verraBatchesConfirmed: ranges.length,
      verraBatchSerialsUnparsed: vcsBatches.filter((b) => b.status === "confirmed").length - ranges.length,
      tonnesBridgedConfirmed: tonnes([...confirmed.values()].reduce((a, b) => a + b, 0n)),
      tonnesHeldOnChain: tonnes(chain.tco2s.reduce((a, t) => a + BigInt(t.supply), 0n)),
      retirementCertificates: chain.retirements.filter((r) => tco2ByAddress.has(chain.pvToTco2[r.pvId]?.toLowerCase())).length,
      tonnesRetiredOnChain: tonnes(certSum),
      checks: {
        serialRangeBridgedTwice: {
          label: "Confirmed batch NFTs whose Verra serial ranges overlap another confirmed batch",
          basis: "ICVCM Assessment Framework v3, criterion 6.2 (no double use): a credit is tokenised at most once",
          pairs: serialOverlaps(ranges).length,
        },
        tokensExceedBatches: {
          label: "TCO2 tokens whose supply plus on-chain retirements exceed their confirmed batches",
          basis: "ICVCM CCP A2 (Tracking): every token traces to a credit retired off-chain to back it",
          tokens: overBacked.length,
        },
      },
    },
  };
}

/** Local only: per Verra project-vintage, the quantity bridged on chain against Verra's retirements to Toucan. */
async function compareWithVerra(chain, confirmed) {
  const dir = await openSnapshot({ download: false });
  const toucan = new Map();
  for (const row of csvObjects(await readFile(new URL("credits.csv", dir), "utf8"))) {
    if (!row.project_id.startsWith("VCS") || row.transaction_type !== "retirement") continue;
    const text = [row.retirement_account, row.retirement_beneficiary, row.retirement_beneficiary_harmonized, row.retirement_note].join(" ");
    if (!/toucan/i.test(text)) continue;
    const key = `${row.project_id}:${row.vintage}`;
    toucan.set(key, (toucan.get(key) ?? 0) + Number(row.quantity));
  }
  const bridged = new Map();
  for (const t of chain.tco2s) {
    const s = symbolParts(t.symbol);
    if (s.standard !== "VCS") continue;
    const key = `${s.projectId}:${s.vintageYear}`;
    bridged.set(key, (bridged.get(key) ?? 0) + tonnes(confirmed.get(t.address.toLowerCase()) ?? 0n));
  }
  const keys = new Set([...toucan.keys(), ...bridged.keys()]);
  const rows = [...keys].sort().map((key) => ({ key, verraRetiredToToucan: toucan.get(key) ?? 0, bridgedOnChain: bridged.get(key) ?? 0 }));
  const tally = { equal: 0, bridgedMoreThanVerraRetired: 0, verraRetiredMoreThanBridged: 0 };
  for (const r of rows) {
    const d = r.bridgedOnChain - r.verraRetiredToToucan;
    tally[Math.abs(d) < 1e-6 ? "equal" : d > 0 ? "bridgedMoreThanVerraRetired" : "verraRetiredMoreThanBridged"]++;
  }
  return { projectVintages: rows.length, tally, rows };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const cached = new URL("onchain.json", CACHE);
  const chain = process.env.REFRESH || process.env.BLOCK
    ? await readChain()
    : await readFile(cached, "utf8").then(JSON.parse, () => readChain());
  await mkdir(CACHE, { recursive: true });
  await writeFile(cached, JSON.stringify(chain));

  const { confirmed, report } = checkOnChain(chain);
  await writeFile(
    OUT,
    JSON.stringify(
      {
        schemaVersion: "grounding.toucan-onchain/0.1",
        question: "Do Toucan's bridged Verra credits on Polygon agree with themselves on chain?",
        chain: "eip155:137",
        blocks: chain.blocks,
        contracts: { factory: FACTORY, batches: BATCHES, retirementCertificates: CERTS, source: "https://github.com/ToucanProtocol/contracts" },
        finding: "Counts describe on-chain state only. They are not a finding of error or wrongdoing by Toucan or Verra.",
        ...report,
        verraComparison: "Computed locally by node scripts/run-toucan-check.mjs against the OffsetsDB snapshot; not published while Verra's terms on derived data are unclear.",
        limitations: [
          "OffsetsDB has no Verra serial numbers, so the local comparison with Verra is by quantity per project and vintage year, not serial by serial.",
          "Only the Verra TCO2 factory is read; other Toucan factories (for example Puro) are out of scope.",
          "Retired tonnes come from the RetirementCertificates records. The factory's totalRetired() is not used: Toucan's source marks that counter deprecated (DEPRECATED_TotalRetired), and it no longer moves.",
        "Two TCO2 symbols carry no vintage (TCO2-VCU-1764-, TCO2-VCU-92-); they are counted under VCU.",
        "Verra stopped allowing retired credits to be tokenised on 25 May 2022, so Verra bridging is historical.",
        ],
      },
      null,
      2,
    ) + "\n",
  );

  const comparison = await compareWithVerra(chain, confirmed);
  await writeFile(new URL("verra-comparison.json", CACHE), JSON.stringify(comparison, null, 1));
  console.log(`Polygon blocks ${chain.blocks.join("-")}: ${JSON.stringify(report.checks)}`);
  console.log(`Local only (not published): ${comparison.projectVintages} Verra project-vintages, ${JSON.stringify(comparison.tally)}`);
}
