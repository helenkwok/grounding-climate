import assert from "node:assert/strict";
import test from "node:test";

import { decodeAggregate3, encodeAggregate3, parseVerraSerial, serialOverlaps } from "./run-toucan-check.mjs";

test("parses both Verra serial layouts", () => {
  assert.deepEqual(parseVerraSerial("8367-10851650-10851650-VCS-VCU-1423-VER-IN-1-1418-01012020-29022020-0"), {
    key: "8367-VCS-VCU-1423-VER-IN-1-1418-01012020-29022020-0", start: 10851650, end: 10851650, projectId: "VCS1418", vintageStart: "01012020",
  });
  assert.equal(parseVerraSerial("7236-378945246-378945248-VCU-034-APX-IN-1-1190-01012018-31052018-0").projectId, "VCS1190");
  assert.equal(parseVerraSerial("926aeaf2-5603_6430-6430"), undefined);
  assert.equal(parseVerraSerial("1-9-5-VCU-034-APX-IN-1-1190-01012018-31052018-0"), undefined); // last < first
});

test("finds overlapping ranges only within one issuance block", () => {
  const r = (id, key, start, end) => ({ id, key, start, end });
  assert.deepEqual(serialOverlaps([r(1, "a", 1, 10), r(2, "a", 11, 20), r(3, "b", 5, 6)]), []);
  assert.deepEqual(serialOverlaps([r(1, "a", 1, 10), r(2, "a", 10, 20)]), [[1, 2]]);
});

test("aggregate3 encoding round-trips through a hand-built reply", () => {
  const data = encodeAggregate3([["0x" + "11".repeat(20), "95d89b41"]]);
  assert.ok(data.startsWith("82ad56cb"));
  assert.equal(data.length, 8 + 64 * 8); // array offset, length, element offset, target, flag, bytes offset, bytes length, 1 data word
  const w = (n) => BigInt(n).toString(16).padStart(64, "0");
  const reply = "0x" + w(0x20) + w(1) + w(0x20) + w(1) + w(0x40) + w(2) + "abcd".padEnd(64, "0");
  assert.deepEqual(decodeAggregate3(reply), ["0xabcd"]);
});
