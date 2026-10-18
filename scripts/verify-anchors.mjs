// Checks each case's Bitcoin anchor offline: the anchored digest is recomputed from the committed signed
// record, and the committed proof must commit to it. An anchored proof must also reach a committed block
// header through its merkle path, and that header must carry real proof of work. A pending proof passes.
import { readFile, readdir } from "node:fs/promises";

import { anchoredDigest, fromHex, toHex, verifyOtsProof } from "@grounding-climate/core";

// Mainnet difficulty has been above 10^13 since 2020; a header declaring less is not a recent mined block.
const MIN_DIFFICULTY = 1e12;
const root = new URL("../reports/", import.meta.url);
let failed = false;
let anchored = 0;

for (const entry of await readdir(root, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dir = new URL(entry.name + "/", root);
  const run = await readFile(new URL("case-run.json", dir), "utf8").then(JSON.parse, () => undefined);
  if (!run) continue;
  const fail = (message) => {
    console.error(`${entry.name}: ${message}`);
    failed = true;
  };
  const record = await readFile(new URL("anchor.json", dir), "utf8").then(JSON.parse, () => undefined);
  if (!record) {
    fail("no anchor.json; run scripts/anchor-cases.mjs");
    continue;
  }
  const digest = toHex(await anchoredDigest(run.attestation));
  if (record.digest !== digest) {
    fail(`signed record changed since it was anchored (${record.digest} → ${digest}); run scripts/anchor-cases.mjs`);
    continue;
  }
  const headers = new Map();
  for (const name of await readdir(new URL("headers/", dir)).catch(() => [])) {
    headers.set(Number(name.replace(/\.hex$/, "")), fromHex((await readFile(new URL(`headers/${name}`, dir), "utf8")).trim()));
  }
  const proof = new Uint8Array(await readFile(new URL("anchor.ots", dir)));
  const result = await verifyOtsProof(proof, fromHex(digest), { headers, minDifficulty: MIN_DIFFICULTY });
  if (result.status === "invalid") {
    fail("anchor proof invalid: " + result.reasons.join("; "));
  } else if (result.status === "pending") {
    if (record.height !== undefined) fail(`anchor.json records block ${record.height} but the proof is still pending`);
    else console.log(`${entry.name}: pending since ${record.submittedAt} at ${result.pending.length} calendar(s); run scripts/anchor-cases.mjs --upgrade`);
  } else if (record.height !== undefined && record.height !== result.height) {
    fail(`anchor.json records block ${record.height} but the proof reaches block ${result.height}`);
  } else {
    anchored += 1;
    console.log(`${entry.name}: signed record existed by Bitcoin block ${result.height} (${result.blockTime}, ±2 h), header ${result.blockHash}`);
  }
}

if (failed) process.exit(1);
if (anchored) {
  console.log("Offline check only: it shows each header commits to the record and carries proof of work, not that the header is on the main chain. Confirm a block hash with a node or a block explorer for that.");
}
