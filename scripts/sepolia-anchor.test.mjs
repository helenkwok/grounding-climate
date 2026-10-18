import assert from "node:assert/strict";
import test from "node:test";

import { applyResult } from "./sepolia-anchor.mjs";

const tx = "0x" + "a".repeat(64);
const digest = "0x" + "b".repeat(64);
const cases = { "building-mrv": digest };

test("records a deploy, then only anchors of a case's current digest", () => {
  assert.throws(() => applyResult(null, { kind: "anchor", case: "building-mrv", digest, txHash: tx }, cases), /deploy the contract first/);
  const deployed = applyResult(null, { kind: "deploy", contract: "0x" + "C".repeat(40), txHash: tx }, cases);
  assert.equal(deployed.chain, "eip155:11155111");
  assert.equal(deployed.contract, "0x" + "c".repeat(40));
  assert.throws(() => applyResult(deployed, { kind: "anchor", case: "building-mrv", digest: "0x" + "0".repeat(64), txHash: tx }, cases), /current anchored digest/);
  assert.throws(() => applyResult(deployed, { kind: "anchor", case: "../x", digest, txHash: tx }, cases), /unknown case/);
  assert.throws(() => applyResult(deployed, { kind: "anchor", case: "building-mrv", digest, txHash: "0x1" }, cases), /txHash/);
  const anchored = applyResult(deployed, { kind: "anchor", case: "building-mrv", digest, txHash: tx }, cases);
  assert.deepEqual(anchored.anchors, { "building-mrv": { digest, txHash: tx } });
});
