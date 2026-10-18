import assert from "node:assert/strict";
import test from "node:test";

import { decodeRetiredLog, encodeAnchor, encodeRetire, fromHex, RETIRED_TOPIC } from "../src/index.js";

// Reference calldata from `cast calldata` (Foundry v1.8.5) for the same arguments.
const CAST_RETIRE =
  "0x3b486429" +
  "00000000000000000000000000000000000000000000000000000000000000e0" +
  "0000000000000000000000000000000000000000000000000000000000000120" +
  "0000000000000000000000000000000000000000000000000000000000000001" +
  "0000000000000000000000000000000000000000000000000000000000000064" +
  "0000000000000000000000000000000000000000000000000000000000000000" +
  "aa".repeat(32) +
  "bb".repeat(32) +
  "0000000000000000000000000000000000000000000000000000000000000003" +
  "6163720000000000000000000000000000000000000000000000000000000000" +
  "000000000000000000000000000000000000000000000000000000000000000b" +
  "4143523132332d32303230000000000000000000000000000000000000000000";

test("encodeRetire matches the ABI encoding cast produces", () => {
  const data = encodeRetire({
    registry: "acr",
    series: "ACR123-2020",
    first: 1n,
    last: 100n,
    hintPrev: 0n,
    claimDigest: fromHex("aa".repeat(32)),
    evidence: fromHex("bb".repeat(32)),
  });
  assert.equal(data, CAST_RETIRE);
});

test("encodeAnchor is the selector and the digest", () => {
  assert.equal(encodeAnchor(fromHex("11".repeat(32))), `0xeecdf927${"11".repeat(32)}`);
  assert.throws(() => encodeAnchor(new Uint8Array(31)));
});

test("decodeRetiredLog reads the indexed key and the data words", () => {
  const event = decodeRetiredLog({
    address: "0x5fbdb2315678afecb367f032d93f642f64180aa3",
    topics: [RETIRED_TOPIC, `0x${"cc".repeat(32)}`],
    data: `0x${"aa".repeat(32)}${"0".repeat(24)}${"f3".repeat(20)}${(1_790_000_000).toString(16).padStart(64, "0")}`,
  });
  assert.deepEqual(event, {
    unitKey: `0x${"cc".repeat(32)}`,
    claimDigest: `0x${"aa".repeat(32)}`,
    recorder: `0x${"f3".repeat(20)}`,
    time: 1_790_000_000,
  });
  assert.throws(() => decodeRetiredLog({ address: "0x", topics: [`0x${"00".repeat(32)}`], data: "0x" }));
});
