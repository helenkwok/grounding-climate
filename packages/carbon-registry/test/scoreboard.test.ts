import assert from "node:assert/strict";
import test from "node:test";

import {
  INCONSISTENCY,
  SCOREBOARD_REGISTRIES,
  countsOnly,
  issuancesBeforeVintage,
  overRetirement,
  projectTotalsVsCredits,
  registryOfProjectId,
  registryTotals,
  retirementsBeforeFirstIssuance,
  scoreRegistry,
} from "../src/index.js";
import type { ScoreboardKind, ScoreboardRow } from "../src/index.js";

const row = (projectId: string, vintage: number, kind: ScoreboardKind, quantity: number, date?: string): ScoreboardRow => ({
  registry: registryOfProjectId(projectId),
  projectId,
  vintage,
  kind,
  quantity,
  ...(date ? { date } : {}),
});

test("registry comes from the project ID prefix, including VCSOPR and lettered ISO prefixes", () => {
  assert.equal(registryOfProjectId("ACR123"), "american-carbon-registry");
  assert.equal(registryOfProjectId("ART101"), "art-trees");
  assert.equal(registryOfProjectId("CCB9999"), "cercarbono");
  assert.equal(registryOfProjectId("CAR9"), "climate-action-reserve");
  assert.equal(registryOfProjectId("GLD7"), "gold-standard");
  assert.equal(registryOfProjectId("ISOX9999"), "isometric");
  assert.equal(registryOfProjectId("VCSOPR2"), "verra");
  assert.throws(() => registryOfProjectId("XYZ1"));
  // Listed alphabetically by the registry's name, never by any result.
  assert.deepEqual([...SCOREBOARD_REGISTRIES], [...SCOREBOARD_REGISTRIES].sort());
});

test("totals count rows and credits by kind, projects and project-vintages", () => {
  const totals = registryTotals([
    row("ACR1", 2020, "issuance", 100),
    row("ACR1", 2021, "issuance", 50),
    row("ACR1", 2020, "retirement", 30),
    row("ACR2", 2020, "cancellation", 5),
  ]);
  assert.deepEqual(totals, {
    rows: 4,
    rowsByKind: { issuance: 2, retirement: 1, cancellation: 1 },
    creditsByKind: { issuance: 150, retirement: 30, cancellation: 5 },
    projects: 2,
    projectVintages: 3,
  });
});

test("over-retirement counts cancellations, splits coverage gaps from excess, and checks projects", () => {
  const result = overRetirement([
    row("ACR1", 2020, "issuance", 100),
    row("ACR1", 2020, "retirement", 90),
    row("ACR1", 2020, "cancellation", 20), // 110 > 100: excess
    row("ACR1", 2021, "issuance", 500), // project as a whole is not over-issued
    row("ACR2", 2020, "retirement", 10), // no issuance rows: coverage gap
    row("ACR3", 2020, "issuance", 10),
    row("ACR3", 2020, "retirement", 10), // exactly equal: fine
  ]);
  assert.deepEqual(result.excess, [
    { projectId: "ACR1", vintage: 2020, issued: 100, retired: 90, cancelled: 20, excess: 10, coverageGap: false },
  ]);
  assert.deepEqual(result.coverageGaps.map((item) => item.projectId), ["ACR2"]);
  assert.deepEqual(result.projects.map((item) => item.projectId), ["ACR2"]);
});

test("over-retirement tolerates float sums", () => {
  const result = overRetirement([
    row("ISOX1", 2024, "issuance", 0.3),
    row("ISOX1", 2024, "retirement", 0.1),
    row("ISOX1", 2024, "retirement", 0.2),
  ]);
  assert.equal(result.excess.length + result.coverageGaps.length + result.projects.length, 0);
});

test("retirements before the first issuance count rows, credits, projects and distinct dates", () => {
  const result = retirementsBeforeFirstIssuance([
    row("CAR1", 2019, "issuance", 100, "2020-03-01T00:00:00Z"),
    row("CAR1", 2019, "issuance", 100, "2019-06-01T00:00:00Z"),
    row("CAR1", 2019, "retirement", 5, "2019-01-01T00:00:00Z"), // before the earliest issuance
    row("CAR1", 2019, "retirement", 5, "2019-07-01T00:00:00Z"), // after it
    row("CAR2", 2019, "issuance", 100, "2020-01-01T00:00:00Z"),
    row("CAR2", 2019, "retirement", 7, "2019-01-01T12:00:00Z"), // same day as CAR1's: one distinct date
    row("CAR2", 2019, "retirement", 7), // undated: skipped
    row("CAR3", 2019, "retirement", 9, "2010-01-01T00:00:00Z"), // no issuance: a coverage gap, not this check
    row("CAR4", 2019, "issuance", 9), // undated issuance gives no first date
    row("CAR4", 2019, "retirement", 9, "2010-01-01T00:00:00Z"),
  ]);
  assert.equal(result.rows, 2);
  assert.equal(result.credits, 12);
  assert.equal(result.projects, 2);
  assert.equal(result.distinctDates, 1);
  assert.equal(result.items[0]?.firstIssuance, "2019-06-01T00:00:00Z");
});

test("issuances before the vintage year starts; the first of January itself is not flagged", () => {
  const result = issuancesBeforeVintage([
    row("GLD1", 2021, "issuance", 10, "2020-12-31T23:59:59Z"),
    row("GLD1", 2021, "issuance", 10, "2021-01-01T00:00:00Z"),
    row("GLD1", 2021, "issuance", 10),
    row("GLD1", 2020, "retirement", 10, "2010-01-01T00:00:00Z"),
  ]);
  assert.equal(result.rows, 1);
  assert.equal(result.items[0]?.date, "2020-12-31T23:59:59Z");
});

test("project-table totals are compared with issuance and retirement sums, not cancellations", () => {
  const credits = [
    row("ACR1", 2020, "issuance", 100),
    row("ACR1", 2020, "retirement", 40),
    row("ACR1", 2020, "cancellation", 5),
    row("ACR2", 2020, "issuance", 10),
  ];
  const result = projectTotalsVsCredits(credits, [
    { registry: "american-carbon-registry", projectId: "ACR1", issued: 100, retired: 40 },
    { registry: "american-carbon-registry", projectId: "ACR2", issued: 11, retired: 0 },
    { registry: "american-carbon-registry", projectId: "ACR3", issued: 0, retired: 0 }, // listed, no credits
  ]);
  assert.equal(result.projectsCompared, 3);
  assert.deepEqual(result.items, [
    { projectId: "ACR2", stated: { issued: 11, retired: 0 }, fromCredits: { issued: 10, retired: 0 } },
  ]);
});

test("a registry's score keeps only its own rows, labels findings plainly, and counts-only drops every project ID", () => {
  const rows = [row("ACR1", 2020, "retirement", 10, "2021-01-01T00:00:00Z"), row("GLD1", 2020, "retirement", 10)];
  const score = scoreRegistry("american-carbon-registry", rows, []);
  assert.equal(score.totals.rows, 1);
  assert.equal(score.checks.overRetired.coverageGaps, 1);
  assert.equal(score.checks.overRetired.finding, INCONSISTENCY);
  assert.match(score.checks.overRetired.basis, /6\.2/);
  assert.match(score.checks.issuedBeforeVintage.basis, /5\.3/);
  assert.doesNotMatch(JSON.stringify(score), /fraud|error|wrongdoing/i);
  const counts = JSON.stringify(countsOnly(score));
  assert.doesNotMatch(counts, /ACR1/);
  assert.match(counts, /"coverageGaps":1/);
});
