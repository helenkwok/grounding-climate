// Runs the per-registry consistency checks over the pinned CarbonPlan OffsetsDB export (all seven registries) and
// writes reports/carbon-registry/scoreboard.json: counts for each registry, listed alphabetically and never ranked, and
// the flagged rows for the American Carbon Registry only (its terms allow reproduction with citation). Counts are published
// for ACR, ART TREES and Gold Standard; the other four registries are checked by the same code, but their counts go only to
// a local, gitignored file while their terms on derived data are unclear. Anyone can compute them with these two scripts.
//   node scripts/prepare-offsetsdb-snapshot.mjs   # downloads and pins the export once
//   node scripts/run-carbon-scoreboard.mjs
import { readFile, writeFile } from "node:fs/promises";


import { INCONSISTENCY, SCOREBOARD_REGISTRIES, countsOnly, scoreRegistry } from "@grounding-climate/carbon-registry";

import { PUBLISHED, SNAPSHOT, countsDigest, creditRows, openSnapshot, projectRows } from "./lib/offsetsdb.mjs";

const OUT = new URL("../reports/carbon-registry/scoreboard.json", import.meta.url);
const LOCAL = new URL("../data/cache/offsetsdb/scoreboard-all-registries.json", import.meta.url);

const dir = await openSnapshot({ download: false });
const credits = creditRows(await readFile(new URL("credits.csv", dir), "utf8"));
const projects = projectRows(await readFile(new URL("projects.csv", dir), "utf8"));
const scores = SCOREBOARD_REGISTRIES.map((registry) => scoreRegistry(registry, credits, projects));
const all = scores.map(countsOnly);
const registries = all.map((item) =>
  PUBLISHED.includes(item.registry)
    ? item
    : { registry: item.registry, name: item.name, countsPublished: false, run: "node scripts/run-carbon-scoreboard.mjs" },
);

const report = {
  schemaVersion: "grounding.carbon-scoreboard/0.1",
  question: "Do each registry's published records agree with themselves?",
  snapshot: SNAPSHOT,
  attribution: SNAPSHOT.attribution + ". Terms: " + SNAPSHOT.termsUrl,
  finding: "Every flagged item is an " + INCONSISTENCY + ", never a finding of error or wrongdoing.",
  order: "Registries are listed alphabetically by name. They are not ranked or compared with each other.",
  creditRows: credits.length,
  registries,
  countsDigest: countsDigest(SNAPSHOT.zipSha256, registries),
  americanCarbonRegistry: {
    data: "data/external/acr-offsetsdb-full",
    ...scores.find((score) => score.registry === "american-carbon-registry"),
  },
  limitations: [
    "The export has no serial numbers, so credits retired twice cannot be checked at this scale; only quantities are compared.",
    "Verra issuance figures in OffsetsDB are inferred by CarbonPlan, not published by Verra as issuance records.",
    "ACR's retirements dated before their first issuance all share the date 2022-11-01, which suggests a migration or pipeline artefact. That is an inference, not checked against the registry.",
    "Counts show inconsistencies in published data. They do not show that a program meets, or fails, any ICVCM criterion.",
    "ACR is shown in full; ART TREES and Gold Standard as counts. Climate Action Reserve, Cercarbono, Isometric and Verra are checked by the same code, but their counts are not published while their terms on derived data are unclear; the two scripts compute them locally for anyone.",
    "OffsetsDB updates are paused upstream; the snapshot is from 2026-06-01.",
  ],
};
await writeFile(OUT, JSON.stringify(report, null, 2) + "\n");
await writeFile(LOCAL, JSON.stringify({ snapshot: SNAPSHOT, registries: all }, null, 2) + "\n");
console.log("Published counts: " + PUBLISHED.join(", ") + ". All seven: " + LOCAL.pathname);
console.log(JSON.stringify(all.map(({ name, totals, checks }) => ({
  name,
  rows: totals.rowsByKind,
  projects: totals.projects,
  projectVintages: totals.projectVintages,
  overRetired: [checks.overRetired.coverageGaps, checks.overRetired.excessOverIssued, checks.overRetired.projectsOverIssued],
  retiredBeforeIssuance: [checks.retiredBeforeIssuance.rows, checks.retiredBeforeIssuance.credits, checks.retiredBeforeIssuance.projects, checks.retiredBeforeIssuance.distinctDates],
  issuedBeforeVintage: checks.issuedBeforeVintage.rows,
  projectTotalMismatches: checks.projectTotals.mismatches,
})), null, 1));
