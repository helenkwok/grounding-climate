// Per-registry consistency checks over a whole registry export (CarbonPlan OffsetsDB), one registry at a time.
// Each check counts places where the published records disagree with themselves. A flagged item is an inconsistency in
// the published data; it may come from OffsetsDB's processing or from the registry, and it is never evidence of
// wrongdoing. Registries are listed alphabetically and never ranked or compared with each other.

/** OffsetsDB's registry names, in alphabetical order of the registry's name. */
export const SCOREBOARD_REGISTRIES = [
  "american-carbon-registry",
  "art-trees",
  "cercarbono",
  "climate-action-reserve",
  "gold-standard",
  "isometric",
  "verra",
] as const;

export type ScoreboardRegistry = (typeof SCOREBOARD_REGISTRIES)[number];

export const SCOREBOARD_REGISTRY_NAMES: Record<ScoreboardRegistry, string> = {
  "american-carbon-registry": "American Carbon Registry",
  "art-trees": "ART TREES",
  cercarbono: "Cercarbono",
  "climate-action-reserve": "Climate Action Reserve",
  "gold-standard": "Gold Standard",
  isometric: "Isometric",
  verra: "Verra",
};

export type ScoreboardKind = "issuance" | "retirement" | "cancellation";

export interface ScoreboardRow {
  registry: ScoreboardRegistry;
  projectId: string;
  vintage: number;
  kind: ScoreboardKind;
  quantity: number;
  /** ISO 8601; absent when the export has no date for the row. */
  date?: string;
}

/** A project's totals as the export's project table states them. */
export interface ProjectTotalRow {
  registry: ScoreboardRegistry;
  projectId: string;
  issued: number;
  retired: number;
}

export const INCONSISTENCY =
  "inconsistency in the published data (may come from OffsetsDB processing or the registry)";

export const SCOREBOARD_CHECKS = {
  overRetired: {
    label: "Project-vintages where retired plus cancelled credits exceed issued credits",
    basis: "ICVCM Assessment Framework v3, criterion 6.2 (no double use); one credit per tonne",
  },
  retiredBeforeIssuance: {
    label: "Retirements dated before the first issuance of their project-vintage",
    basis: "ICVCM CCP A2 (Tracking); definitions of carbon credit and retirement (issue, then track, then retire)",
  },
  issuedBeforeVintage: {
    label: "Issuances dated before their vintage year starts",
    basis: "ICVCM Assessment Framework v3, criterion 5.3 (ex-post issuance); definition of vintage",
  },
  projectTotals: {
    label: "Projects whose project-table totals differ from the sum of their credit rows",
    basis: "ICVCM CCP A2 (Tracking) and A3 (Transparency)",
  },
} as const;

// Quantities are floats in the export (e.g. 1701.4); sums are compared with this tolerance.
const EPSILON = 1e-6;
const round = (value: number): number => Math.round(value * 1e6) / 1e6;

const PREFIXES: Array<[string, ScoreboardRegistry]> = [
  ["ACR", "american-carbon-registry"],
  ["ART", "art-trees"],
  ["CCB", "cercarbono"],
  ["CAR", "climate-action-reserve"],
  ["GLD", "gold-standard"],
  ["ISO", "isometric"],
  ["VCS", "verra"],
];

/** The registry is the project ID's prefix in OffsetsDB (VCSOPR is Verra; ISO followed by letters is Isometric). */
export function registryOfProjectId(projectId: string): ScoreboardRegistry {
  const match = PREFIXES.find(([prefix]) => projectId.startsWith(prefix));
  if (!match) throw new Error("Unknown registry prefix: " + JSON.stringify(projectId));
  return match[1];
}

interface Sums {
  issued: number;
  retired: number;
  cancelled: number;
}

function sumsBy(rows: readonly ScoreboardRow[], key: (row: ScoreboardRow) => string): Map<string, Sums> {
  const sums = new Map<string, Sums>();
  for (const row of rows) {
    const current = sums.get(key(row)) ?? { issued: 0, retired: 0, cancelled: 0 };
    if (row.kind === "issuance") current.issued += row.quantity;
    else if (row.kind === "retirement") current.retired += row.quantity;
    else current.cancelled += row.quantity;
    sums.set(key(row), current);
  }
  return sums;
}

const vintageKey = (row: Pick<ScoreboardRow, "projectId" | "vintage">): string => row.projectId + "|" + row.vintage;
const day = (iso: string): string => new Date(iso).toISOString().slice(0, 10);

export function registryTotals(rows: readonly ScoreboardRow[]) {
  const count = (kind: ScoreboardKind) => rows.filter((row) => row.kind === kind).length;
  const credits = (kind: ScoreboardKind) =>
    round(rows.filter((row) => row.kind === kind).reduce((sum, row) => sum + row.quantity, 0));
  return {
    rows: rows.length,
    rowsByKind: { issuance: count("issuance"), retirement: count("retirement"), cancellation: count("cancellation") },
    creditsByKind: { issuance: credits("issuance"), retirement: credits("retirement"), cancellation: credits("cancellation") },
    projects: new Set(rows.map((row) => row.projectId)).size,
    projectVintages: new Set(rows.map(vintageKey)).size,
  };
}

export interface OverRetiredItem {
  projectId: string;
  vintage?: number;
  issued: number;
  retired: number;
  cancelled: number;
  excess: number;
  /** No issuance rows at all for this project-vintage: the export may simply not cover the issuance. */
  coverageGap?: boolean;
}

/**
 * Retired plus cancelled above issued, per project-vintage, split into coverage gaps (no issuance rows) and excess
 * over recorded issuance; and per project across all its vintages.
 */
export function overRetirement(rows: readonly ScoreboardRow[]) {
  const toItem = (projectId: string, sums: Sums, vintage?: number): OverRetiredItem => ({
    projectId,
    ...(vintage !== undefined ? { vintage } : {}),
    issued: round(sums.issued),
    retired: round(sums.retired),
    cancelled: round(sums.cancelled),
    excess: round(sums.retired + sums.cancelled - sums.issued),
  });
  const over = (sums: Sums) => sums.retired + sums.cancelled - sums.issued > EPSILON;

  const projectVintages: OverRetiredItem[] = [];
  for (const [key, sums] of sumsBy(rows, vintageKey)) {
    if (!over(sums)) continue;
    const [projectId = "", vintage] = key.split("|");
    projectVintages.push({ ...toItem(projectId, sums, Number(vintage)), coverageGap: sums.issued === 0 });
  }
  const projects: OverRetiredItem[] = [];
  for (const [projectId, sums] of sumsBy(rows, (row) => row.projectId)) {
    if (over(sums)) projects.push(toItem(projectId, sums));
  }
  const byId = (a: OverRetiredItem, b: OverRetiredItem) =>
    a.projectId.localeCompare(b.projectId) || (a.vintage ?? 0) - (b.vintage ?? 0);
  projectVintages.sort(byId);
  projects.sort(byId);
  return {
    coverageGaps: projectVintages.filter((item) => item.coverageGap),
    excess: projectVintages.filter((item) => !item.coverageGap),
    projects,
  };
}

export interface DatedItem {
  projectId: string;
  vintage: number;
  date: string;
  quantity: number;
  /** The project-vintage's earliest dated issuance (retirement check only). */
  firstIssuance?: string;
}

function datedSummary(items: DatedItem[]) {
  return {
    rows: items.length,
    credits: round(items.reduce((sum, item) => sum + item.quantity, 0)),
    projects: new Set(items.map((item) => item.projectId)).size,
    // A placeholder date shared by many rows shows up as a single distinct date.
    distinctDates: new Set(items.map((item) => day(item.date))).size,
    items,
  };
}

const byDate = (a: DatedItem, b: DatedItem) =>
  a.projectId.localeCompare(b.projectId) || a.vintage - b.vintage || a.date.localeCompare(b.date) || a.quantity - b.quantity;

/** Retirements dated before the earliest dated issuance of the same project-vintage. Undated rows are skipped. */
export function retirementsBeforeFirstIssuance(rows: readonly ScoreboardRow[]) {
  const first = new Map<string, string>();
  for (const row of rows) {
    if (row.kind !== "issuance" || !row.date) continue;
    const current = first.get(vintageKey(row));
    if (!current || Date.parse(row.date) < Date.parse(current)) first.set(vintageKey(row), row.date);
  }
  const items: DatedItem[] = [];
  for (const row of rows) {
    const firstIssuance = first.get(vintageKey(row));
    if (row.kind !== "retirement" || !row.date || !firstIssuance) continue;
    if (Date.parse(row.date) < Date.parse(firstIssuance)) {
      items.push({ projectId: row.projectId, vintage: row.vintage, date: row.date, quantity: row.quantity, firstIssuance });
    }
  }
  return datedSummary(items.sort(byDate));
}

/** Issuances dated before 1 January (UTC) of their vintage year. */
export function issuancesBeforeVintage(rows: readonly ScoreboardRow[]) {
  const items: DatedItem[] = rows
    .filter((row) => row.kind === "issuance" && row.date && Date.parse(row.date) < Date.UTC(row.vintage, 0, 1))
    .map((row) => ({ projectId: row.projectId, vintage: row.vintage, date: row.date as string, quantity: row.quantity }));
  return datedSummary(items.sort(byDate));
}

export interface ProjectTotalItem {
  projectId: string;
  stated: { issued: number; retired: number };
  fromCredits: { issued: number; retired: number };
}

/** The project table's issued and retired totals against the sums of issuance and retirement rows. */
export function projectTotalsVsCredits(rows: readonly ScoreboardRow[], projects: readonly ProjectTotalRow[]) {
  const sums = sumsBy(rows, (row) => row.projectId);
  const stated = new Map(projects.map((project) => [project.projectId, project]));
  const ids = [...new Set([...sums.keys(), ...stated.keys()])].sort();
  const items: ProjectTotalItem[] = [];
  for (const projectId of ids) {
    const fromCredits = sums.get(projectId) ?? { issued: 0, retired: 0, cancelled: 0 };
    const table = stated.get(projectId) ?? { issued: 0, retired: 0 };
    if (Math.abs(table.issued - fromCredits.issued) > EPSILON || Math.abs(table.retired - fromCredits.retired) > EPSILON) {
      items.push({
        projectId,
        stated: { issued: round(table.issued), retired: round(table.retired) },
        fromCredits: { issued: round(fromCredits.issued), retired: round(fromCredits.retired) },
      });
    }
  }
  return { projectsCompared: ids.length, mismatches: items.length, items };
}

/** Every check for one registry, with its flagged items. */
export function scoreRegistry(
  registry: ScoreboardRegistry,
  rows: readonly ScoreboardRow[],
  projects: readonly ProjectTotalRow[],
) {
  const own = rows.filter((row) => row.registry === registry);
  const over = overRetirement(own);
  return {
    registry,
    name: SCOREBOARD_REGISTRY_NAMES[registry],
    totals: registryTotals(own),
    checks: {
      overRetired: {
        ...SCOREBOARD_CHECKS.overRetired,
        finding: INCONSISTENCY,
        projectVintages: over.coverageGaps.length + over.excess.length,
        coverageGaps: over.coverageGaps.length,
        excessOverIssued: over.excess.length,
        projectsOverIssued: over.projects.length,
        items: over,
      },
      retiredBeforeIssuance: {
        ...SCOREBOARD_CHECKS.retiredBeforeIssuance,
        finding: INCONSISTENCY,
        ...retirementsBeforeFirstIssuance(own),
      },
      issuedBeforeVintage: {
        ...SCOREBOARD_CHECKS.issuedBeforeVintage,
        finding: INCONSISTENCY,
        ...issuancesBeforeVintage(own),
      },
      projectTotals: {
        ...SCOREBOARD_CHECKS.projectTotals,
        finding: INCONSISTENCY,
        ...projectTotalsVsCredits(own, projects.filter((project) => project.registry === registry)),
      },
    },
  };
}

export type RegistryScore = ReturnType<typeof scoreRegistry>;

/** The same result with every list of flagged items removed: counts only, no project IDs. */
export function countsOnly(score: RegistryScore) {
  const { items: _over, ...overRetired } = score.checks.overRetired;
  const { items: _retired, ...retiredBeforeIssuance } = score.checks.retiredBeforeIssuance;
  const { items: _issued, ...issuedBeforeVintage } = score.checks.issuedBeforeVintage;
  const { items: _totals, ...projectTotals } = score.checks.projectTotals;
  return { ...score, checks: { overRetired, retiredBeforeIssuance, issuedBeforeVintage, projectTotals } };
}
