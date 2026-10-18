// Anchors each case's signed record in Bitcoin through OpenTimestamps calendars. Only a 32-byte digest,
// further hidden behind a random nonce, leaves the machine. No wallet, key or account is involved.
//
//   node scripts/anchor-cases.mjs            stamp every case whose anchor is missing or stale
//   node scripts/anchor-cases.mjs --upgrade  fetch finished proofs and the block headers they point to
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";

import {
  ANCHOR_VERSION,
  anchoredDigest,
  checkBitcoinHeader,
  fromHex,
  otsLeaves,
  parseOts,
  stampOts,
  toHex,
  upgradeOts,
  verifyOtsProof,
} from "@grounding-climate/core";

const root = new URL("../reports/", import.meta.url);
const upgrade = process.argv.includes("--upgrade");
const readJson = async (url) => JSON.parse(await readFile(url, "utf8"));
const writeJson = (url, value) => writeFile(url, JSON.stringify(value, null, 2) + "\n");

async function header(base, height) {
  const hash = (await (await fetch(`${base}/block-height/${height}`)).text()).trim();
  const bytes = fromHex((await (await fetch(`${base}/block/${hash}/header`)).text()).trim());
  if ((await checkBitcoinHeader(bytes)).blockHash !== hash) throw new Error(`${base}: header for ${height} does not hash to ${hash}`);
  return bytes;
}

for (const entry of await readdir(root, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dir = new URL(entry.name + "/", root);
  let run;
  try {
    run = await readJson(new URL("case-run.json", dir));
  } catch {
    continue;
  }
  const digest = toHex(await anchoredDigest(run.attestation));
  const record = await readJson(new URL("anchor.json", dir)).catch(() => undefined);

  if (!upgrade) {
    if (record?.digest === digest) {
      console.log(`${entry.name}: already stamped ${digest}`);
      continue;
    }
    const { proof, services } = await stampOts(fromHex(digest));
    await writeFile(new URL("anchor.ots", dir), proof);
    await writeJson(new URL("anchor.json", dir), {
      version: ANCHOR_VERSION,
      chain: "bitcoin",
      format: "opentimestamps",
      digest,
      calendars: services,
      submittedAt: new Date().toISOString(),
    });
    console.log(`${entry.name}: stamped ${digest} (${services.filter((s) => s.ok).length}/${services.length} calendars)`);
    continue;
  }

  if (record?.digest !== digest) {
    console.log(`${entry.name}: anchor missing or stale; stamp it first`);
    continue;
  }
  const otsUrl = new URL("anchor.ots", dir);
  const result = await upgradeOts(new Uint8Array(await readFile(otsUrl)));
  if (result.changed) await writeFile(otsUrl, result.proof);
  const headers = new Map();
  for (const leaf of await otsLeaves(parseOts(result.proof))) {
    const height = leaf.attestation.type === "bitcoin" ? leaf.attestation.height : undefined;
    if (height === undefined || headers.has(height)) continue;
    const a = await header("https://blockstream.info/api", height);
    const b = await header("https://mempool.space/api", height);
    if (toHex(a) !== toHex(b)) throw new Error(`Header sources disagree at block ${height}`);
    await mkdir(new URL("headers/", dir), { recursive: true });
    await writeFile(new URL(`headers/${height}.hex`, dir), toHex(a) + "\n");
    headers.set(height, a);
  }
  const verification = await verifyOtsProof(result.proof, fromHex(digest), { headers });
  if (verification.status === "anchored") {
    Object.assign(record, { height: verification.height, blockHash: verification.blockHash, blockTime: verification.blockTime });
    await writeJson(new URL("anchor.json", dir), record);
  }
  console.log(`${entry.name}: ${verification.status}${verification.height ? ` in block ${verification.height} (${verification.blockTime})` : ""} ${JSON.stringify(result.services.map((s) => s.status))}`);
}
