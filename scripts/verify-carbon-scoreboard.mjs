// Checks reports/carbon-registry/scoreboard.json without the network. The ACR part (its counts and every flagged row)
// is recomputed from the committed data/external/acr-offsetsdb-full with the current code. ART TREES and Gold Standard
// counts cannot be recomputed from committed data, so the digest recorded by the run must match them and the pinned snapshot;
// the four unpublished registries must carry no counts at all;
// that catches a hand edit of a count, not a deliberate forgery of the digest. With the snapshot cached (after
// prepare-offsetsdb-snapshot.mjs), every registry is recomputed as well.
//   node scripts/verify-carbon-scoreboard.mjs
import { deepStrictEqual } from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { SCOREBOARD_REGISTRIES, countsOnly, scoreRegistry } from "@grounding-climate/carbon-registry";

import { CACHE, PUBLISHED, SNAPSHOT, countsDigest, creditRows, openSnapshot, projectRows, sha256 } from "./lib/offsetsdb.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const report = JSON.parse(await read("reports/carbon-registry/scoreboard.json"));
const manifest = JSON.parse(await read("data/external/acr-offsetsdb-full/manifest.json"));
const fail = (message) => {
  console.error("Carbon scoreboard check failed: " + message);
  process.exit(1);
};

if (report.snapshot.zipSha256 !== SNAPSHOT.zipSha256 || manifest.source.zipSha256 !== SNAPSHOT.zipSha256) {
  fail("the report or the ACR manifest names a different snapshot than the pinned " + SNAPSHOT.zipSha256);
}
const text = {};
for (const file of manifest.files) {
  text[file.path] = await read("data/external/acr-offsetsdb-full/" + file.path);
  if (sha256(text[file.path]) !== file.sha256) fail(file.path + " differs from its manifest SHA-256");
}

const acr = scoreRegistry("american-carbon-registry", creditRows(text["credits.csv"]), projectRows(text["projects.csv"]));
try {
  const { data, ...reported } = report.americanCarbonRegistry;
  deepStrictEqual(reported, JSON.parse(JSON.stringify(acr)));
  deepStrictEqual(report.registries.find((item) => item.registry === acr.registry), JSON.parse(JSON.stringify(countsOnly(acr))));
} catch {
  fail("the ACR results do not match a recomputation from data/external/acr-offsetsdb-full");
}
deepStrictEqual(report.registries.map((item) => item.registry), [...SCOREBOARD_REGISTRIES]);
for (const item of report.registries) {
  if (!PUBLISHED.includes(item.registry) && (item.countsPublished !== false || "totals" in item || "checks" in item)) {
    fail(item.name + " counts must not be published");
  }
}
if (countsDigest(report.snapshot.zipSha256, report.registries) !== report.countsDigest) {
  fail("the registry counts do not match the digest recorded by run-carbon-scoreboard.mjs");
}

let full = "ACR recomputed; ART TREES and Gold Standard checked against the recorded digest";
if (existsSync(new URL("offsets-db.csv.zip", CACHE))) {
  const dir = await openSnapshot({ download: false });
  const credits = creditRows(await readFile(new URL("credits.csv", dir), "utf8"));
  const projects = projectRows(await readFile(new URL("projects.csv", dir), "utf8"));
  const registries = PUBLISHED.map((registry) => countsOnly(scoreRegistry(registry, credits, projects)));
  try {
    deepStrictEqual(report.registries.filter((item) => PUBLISHED.includes(item.registry)), JSON.parse(JSON.stringify(registries)));
  } catch {
    fail("the registry counts do not match a recomputation from the cached snapshot");
  }
  full = "published registries recomputed from the cached snapshot";
}
console.log("Carbon scoreboard matches (" + full + ", " + SNAPSHOT.attribution + ").");
