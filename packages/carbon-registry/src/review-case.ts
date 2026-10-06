// The carbon case: registry issuance and retirement records reconciled by project and vintage, through the shared
// review process. Committed records (ACR) sit in the repository; a reviewer can bring others (CAR, Gold Standard)
// as a report downloaded from the registry, of which the case keeps only a digest. Duplicate serial ranges and
// over-retirement are mismatches. Retirements with no issuance in the records are a coverage gap a person decides:
// outside the sample, or to investigate, in two flags: groups the records' own dates place before the sample's
// window, and the rest. Each decision is bound to the digest of every record it was made on.
import { canonicalBytes, GROUNDING_SCHEMA_VERSION, reviewStatuses, reviewVerification } from "@grounding-climate/core";
import type {
  ClimateCaseBundle,
  ContentDigest,
  CryptoProvider,
  Evidence,
  ReviewDecision,
  ReviewFlag,
  ReviewStatus,
} from "@grounding-climate/core";

import { reconcileRegistryTransactions } from "./reconcile.js";
import type {
  CarbonRegistryId,
  NormalizedRegistryTransaction,
  RegistryReconciliationReport,
  RegistryTransactionKind,
} from "./types.js";

/** A records file committed in the repository. */
export interface CommittedRegistrySource {
  registry: CarbonRegistryId;
  kind: RegistryTransactionKind;
  /** The records' sourcePath. */
  path: string;
  /** Where the file came from. */
  uri: string;
  rightsManifestId: string;
  citation: string;
}

/** A report a reviewer downloaded from a registry and brought; its records are never stored in the case. */
export interface ImportedRegistryReport {
  registry: CarbonRegistryId;
  kind: RegistryTransactionKind;
  /** The registry page the reviewer downloaded it from. */
  sourceUri: string;
  downloadedAt: string;
  reportId?: string;
  records: NormalizedRegistryTransaction[];
}

/** "out-of-sample": the issuance is outside these records. "investigate": the gap needs looking into. */
export type CoverageDecision = "out-of-sample" | "investigate";

const REVIEWER_SUPPLIED_RIGHTS: Record<CarbonRegistryId, string> = {
  "american-carbon-registry": "acr-offsetsdb",
  "climate-action-reserve": "car-registry-reports",
  "gold-standard": "gold-standard-registry-reports",
};

/**
 * The coverage gap as two flags a person decides separately: groups whose retired credits were all issued before the
 * records' window (so their issuance is outside it), and the rest, which cannot be placed that way.
 */
export function coverageFlags(window: { groups: number; beforeWindow: number; windowStart: Record<string, string> }): ReviewFlag[] {
  const start = Object.values(window.windowStart).join(", ");
  const inside = window.groups - window.beforeWindow;
  return [
    ...(window.beforeWindow > 0
      ? [{
          id: "coverage:before-window",
          label: window.beforeWindow + " retirement group(s) with no issuance here; every retired block was issued before " + start,
        }]
      : []),
    ...(inside > 0
      ? [{ id: "coverage:inside-window", label: inside + " retirement group(s) with no issuance here, issued inside the records' window" }]
      : []),
  ];
}

/** SHA-256 of the normalised records, independent of row order, file layout and source path. */
export function digestRecords(records: readonly NormalizedRegistryTransaction[], provider: CryptoProvider) {
  const facts = records
    .map(({ sourcePath: _path, sourceRow: _row, ...fact }) => fact)
    .map((fact) => JSON.stringify(Object.fromEntries(Object.entries(fact).sort(([a], [b]) => a.localeCompare(b)))))
    .sort();
  return provider.hash(canonicalBytes(facts), "SHA-256");
}

/** Milliseconds for a registry date: "M/D/YYYY h:mm:ss AM" (as ACR writes it, read as UTC) or ISO 8601. */
export function registryTime(value: string | undefined): number {
  const match = value?.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: (\d{1,2}):(\d{2}):(\d{2}) ([AP]M))?$/);
  if (!match) return value ? Date.parse(value) : Number.NaN;
  const [, month, day, year, hour = "12", minute = "0", second = "0", half = "AM"] = match;
  const h = (Number(hour) % 12) + (half === "PM" ? 12 : 0);
  return Date.UTC(Number(year), Number(month) - 1, Number(day), h, Number(minute), Number(second));
}

/**
 * For each retirement group with no issuance in the records: whether every retired block was issued, by the
 * retirement record's own date, before the earliest issuance in the records of that registry. Such a group's
 * issuance lies outside the records' window; any other group's may or may not.
 */
export function coverageWindow(records: readonly NormalizedRegistryTransaction[], report: RegistryReconciliationReport) {
  const start = new Map<CarbonRegistryId, number>();
  for (const record of records) {
    if (record.kind !== "issuance") continue;
    const time = registryTime(record.transactionDate);
    if (Number.isFinite(time) && time < (start.get(record.registry) ?? Infinity)) start.set(record.registry, time);
  }
  const gaps = report.reconciliations.filter((item) => item.status === "unresolved-missing-issuance");
  const beforeWindow = gaps.filter((group) => {
    const windowStart = start.get(group.registry);
    const retired = records.filter(
      (record) => record.kind === "retirement" && record.registry === group.registry &&
        record.projectId === group.projectId && record.vintage === group.vintage,
    );
    return windowStart !== undefined && retired.every((record) => registryTime(record.creditsIssuedAt) < windowStart);
  });
  return {
    groups: gaps.length,
    beforeWindow: beforeWindow.length,
    windowStart: Object.fromEntries([...start].map(([registry, time]) => [registry, new Date(time).toISOString().slice(0, 10)])),
  };
}

export async function buildCarbonReviewCase(options: {
  caseId: string;
  createdAt: string;
  provider: CryptoProvider;
  committed: { sources: readonly CommittedRegistrySource[]; records: readonly NormalizedRegistryTransaction[] };
  imported?: readonly ImportedRegistryReport[];
  decisions?: readonly ReviewDecision[];
}): Promise<{
  caseBundle: ClimateCaseBundle;
  report: RegistryReconciliationReport;
  review: ReviewStatus[];
  reviewInputDigest: ContentDigest;
  coverage: ReturnType<typeof coverageWindow>;
  decisions: Record<string, CoverageDecision>;
}> {
  const { createdAt, provider } = options;
  const imported = options.imported ?? [];
  const records = [...options.committed.records, ...imported.flatMap((item) => item.records)];
  const report = reconcileRegistryTransactions(records);
  const reviewInputDigest = await digestRecords(records, provider);
  const gap = report.unresolvedMissingIssuanceCount;
  const window = coverageWindow(records, report);
  const flags = coverageFlags(window);
  const review = reviewStatuses(flags, options.decisions ?? [], reviewInputDigest);
  const decisions = Object.fromEntries(
    review.filter((status) => status.state === "decided").map((status) => [status.flag.id, status.decision!.decision as CoverageDecision]),
  );
  const allOutOfSample = review.every((status) => decisions[status.flag.id] === "out-of-sample");
  const conflict = report.duplicateExcessCount > 0 || report.overRetiredCount > 0;
  const result = conflict
    ? "mismatch"
    : allOutOfSample
      ? "reconciled"
      : "insufficient-evidence";

  const evidence: Evidence[] = [];
  for (const source of options.committed.sources) {
    const slice = options.committed.records.filter((record) => record.sourcePath === source.path);
    evidence.push({
      nodeType: "evidence",
      id: "evidence:carbon:" + source.registry + ":" + source.kind,
      createdAt,
      provenance: [],
      kind: "registry-record",
      source: { uri: source.uri, localRef: source.path, publisher: source.registry, retrievedAt: createdAt },
      integrity: await digestRecords(slice, provider),
      access: { mode: "committed" },
      rights: {
        sourceManifestId: source.rightsManifestId,
        redistribution: "allowed",
        derivedData: "allowed",
        attribution: source.citation,
      },
      extensions: { records: slice.length },
    });
  }
  for (const [index, item] of imported.entries()) {
    evidence.push({
      nodeType: "evidence",
      id: "evidence:carbon:imported:" + item.registry + ":" + item.kind + ":" + (index + 1),
      createdAt,
      provenance: [],
      kind: "registry-record",
      source: { uri: item.sourceUri, publisher: item.registry, retrievedAt: item.downloadedAt },
      integrity: await digestRecords(item.records, provider),
      access: {
        mode: "reviewer-supplied",
        instructions:
          "Open " + item.sourceUri + ", download the report with the registry's own CSV button and bring it. " +
          "Grounding compares the digest of its normalised records; a different digest means the source changed.",
      },
      rights: {
        sourceManifestId: REVIEWER_SUPPLIED_RIGHTS[item.registry],
        redistribution: "prohibited",
        attribution: "Report downloaded by the reviewer from " + item.registry + "; records not stored.",
      },
      extensions: { records: item.records.length, ...(item.reportId ? { reportId: item.reportId } : {}) },
    });
  }

  const reviewNode = reviewVerification({
    id: "verification:coverage-decision",
    profile: "carbon-registry/0.2",
    statuses: review,
    flagSource: { nodeType: "claim", id: "claim:carbon-registry-reconciliation", role: "flag-source" },
    adviceRefs: [],
    createdAt,
    staleNote: "Stale: made on different registry records. ",
    findings: ["Decided is not resolved: out-of-sample records a choice about this sample, not that the issuance exists."],
  });
  const registries = report.registries.join(", ");
  const caseBundle: ClimateCaseBundle = {
    schemaVersion: GROUNDING_SCHEMA_VERSION,
    caseId: options.caseId,
    title: "Carbon registry reconciliation",
    capabilities: ["carbon-registry", "claim-reconciliation", "pq-attestation"],
    createdAt,
    claims: [
      {
        nodeType: "claim",
        id: "claim:carbon-registry-reconciliation",
        createdAt,
        provenance: evidence.map((item) => ({ nodeType: "evidence" as const, id: item.id, role: "registry-source" })),
        subject: { id: "dataset:registry-records", kind: "dataset", name: "Registry records: " + registries },
        assertion: {
          kind: "qualitative",
          statement:
            report.recordCount + " records (" + registries + "): " + report.supportedCount + " project-vintages with " +
            "retirements within issuance, " + report.issuedNotRetiredCount + " issued and not retired, " + gap +
            " retirement groups with no issuance in the records, " + report.overRetiredCount + " over-retired, " +
            report.duplicateExcessCount + " duplicate serial ranges.",
        },
        boundary: {
          methodology: "Exact reconciliation by registry, project and vintage; exact serial-range match for duplicates.",
          accounting: {
            included: [
              ...options.committed.sources.map(
                (source) => source.registry + " " + source.kind + " records committed in " + source.path,
              ),
              ...imported.map((item) => item.registry + " " + item.kind + " report brought by the reviewer (" + item.records.length + " records, digest only)"),
            ],
            excluded: [
              "Registry records outside these files: the committed ACR records are a 100-row test sample",
              ...(imported.length === 0 ? ["Climate Action Reserve and Gold Standard records, until a reviewer brings a report"] : []),
              "Claims of the same credit outside the registries",
            ],
            policyChoices: [
              "Records are grouped by registry, project and vintage; identifiers are not matched across registries",
              "A retirement with no issuance in the records is a coverage gap for a person to decide, not an over-retirement",
              "Duplicates are exact serial-range matches; overlapping ranges written differently are not compared",
            ],
            notAssessed: [
              "Durability of the stored carbon",
              "Additionality, leakage and the quality of each project",
              "Whether a retirement was used for the claim its beneficiary makes",
            ],
          },
        },
        assessments: [
          { dimension: "source-found", state: "confirmed" },
          { dimension: "calculation-reproduced", state: "confirmed" },
          ...(conflict ? [{ dimension: "disputed" as const, state: "confirmed" as const }] : []),
        ],
      },
    ],
    evidence,
    calculations: [],
    factors: [],
    modelRuns: [],
    verifications: [
      {
        nodeType: "verification",
        id: "verification:carbon-registry",
        createdAt,
        provenance: [
          { nodeType: "claim", id: "claim:carbon-registry-reconciliation" },
          { nodeType: "verification", id: reviewNode.id },
        ],
        verifier: { id: "service:grounding:carbon-registry", kind: "service", name: "Grounding Carbon Registry" },
        profile: "carbon-registry/0.2",
        result,
        checks: [
          {
            id: "duplicate-retirements",
            name: "No serial range retired twice",
            outcome: report.duplicateExcessCount === 0 ? "pass" : "fail",
            detail: report.duplicateRetirements.map((item) => item.registry + " " + item.serialRange + " x" + item.occurrences).join("; ") || "none",
          },
          {
            id: "over-retirement",
            name: "Retirements do not exceed issuance",
            outcome: report.overRetiredCount === 0 ? "pass" : "fail",
            detail: report.overRetiredCount + " over-retired project-vintage group(s).",
          },
          ...(flags.length === 0
            ? [{ id: "coverage", name: "Every retirement has issuance in the records", outcome: "pass" as const }]
            : [
                {
                  id: "coverage-window",
                  name: "Retired credits' issue dates compared with the issuance records' window",
                  outcome: "pass" as const,
                  detail:
                    window.beforeWindow + " of " + window.groups + " groups: every retired block was issued before the " +
                    "earliest issuance in these records (" + Object.values(window.windowStart).join(", ") + "), so its " +
                    "issuance is outside them. The other " + (window.groups - window.beforeWindow) + " cannot be placed this way.",
                },
                ...reviewNode.checks,
              ]),
        ],
        findings: [
          conflict
            ? "Conflicting records: a serial range retired twice or more retired than issued."
            : flags.length === 0
              ? "Every retirement is within its issuance in these records."
              : "No conflict in these records. Coverage gap: " +
                review
                  .map((status) => status.flag.label + ": " + (decisions[status.flag.id] ?? (status.state === "stale" ? "decision stale" : "no decision")))
                  .join("; ") + ".",
        ],
        verifiedAt: reviewNode.verifiedAt,
      },
      reviewNode,
    ],
    attestations: [],
    anchors: [],
  };
  return { caseBundle, report, review, reviewInputDigest, coverage: window, decisions };
}
