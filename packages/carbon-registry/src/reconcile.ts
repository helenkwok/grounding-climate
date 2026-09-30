import type {
  CarbonRegistryId,
  DuplicateRetirementFinding,
  NormalizedRegistryTransaction,
  ProjectVintageReconciliation,
  RegistryReconciliationReport,
  RetirementCheck,
} from "./types.js";

function projectVintageKey(
  transaction: Pick<
    NormalizedRegistryTransaction,
    "registry" | "projectId" | "vintage"
  >,
): string {
  return (
    transaction.registry +
    "|" +
    transaction.projectId +
    "|" +
    (transaction.vintage ?? "unknown")
  );
}

function duplicateKey(transaction: NormalizedRegistryTransaction): string | undefined {
  if (transaction.kind !== "retirement" || !transaction.serialRange) {
    return undefined;
  }
  return transaction.registry + "|" + transaction.serialRange;
}

export function reconcileRegistryTransactions(
  records: readonly NormalizedRegistryTransaction[],
): RegistryReconciliationReport {
  const totals = new Map<
    string,
    {
      registry: CarbonRegistryId;
      projectId: string;
      vintage?: number;
      issued: number;
      retired: number;
    }
  >();

  for (const record of records) {
    const key = projectVintageKey(record);
    const current = totals.get(key) ?? {
      registry: record.registry,
      projectId: record.projectId,
      ...(record.vintage !== undefined ? { vintage: record.vintage } : {}),
      issued: 0,
      retired: 0,
    };

    if (record.kind === "issuance") current.issued += record.quantity;
    else current.retired += record.quantity;
    totals.set(key, current);
  }

  const reconciliations: ProjectVintageReconciliation[] = [...totals.values()]
    .map((item) => {
      const remaining = item.issued - item.retired;
      const status =
        item.issued === 0 && item.retired > 0
          ? "unresolved-missing-issuance"
          : item.retired > item.issued
            ? "over-retired"
            : item.retired === 0
              ? "issued-not-retired"
              : "supported";

      return {
        ...item,
        remaining,
        status,
      } as ProjectVintageReconciliation;
    })
    .sort((a, b) =>
      (a.registry + a.projectId + String(a.vintage)).localeCompare(
        b.registry + b.projectId + String(b.vintage),
      ),
    );

  const duplicateGroups = new Map<string, NormalizedRegistryTransaction[]>();
  for (const record of records) {
    const key = duplicateKey(record);
    if (!key) continue;
    const group = duplicateGroups.get(key) ?? [];
    group.push(record);
    duplicateGroups.set(key, group);
  }

  const duplicateRetirements: DuplicateRetirementFinding[] = [
    ...duplicateGroups.values(),
  ]
    .filter((rows) => rows.length > 1)
    .map((rows) => {
      const first = rows[0];
      if (!first?.serialRange) {
        throw new Error("Duplicate retirement group has no serial range.");
      }
      return {
        registry: first.registry,
        serialRange: first.serialRange,
        occurrences: rows.length,
        rows: rows.map((row) => ({
          sourcePath: row.sourcePath,
          sourceRow: row.sourceRow,
          quantity: row.quantity,
          projectId: row.projectId,
          ...(row.vintage !== undefined ? { vintage: row.vintage } : {}),
        })),
      };
    })
    .sort((a, b) =>
      (a.registry + a.serialRange).localeCompare(b.registry + b.serialRange),
    );

  return {
    registries: [...new Set(records.map((record) => record.registry))].sort(),
    recordCount: records.length,
    issuanceCount: records.filter((record) => record.kind === "issuance").length,
    retirementCount: records.filter((record) => record.kind === "retirement").length,
    reconciliations,
    duplicateRetirements,
    duplicateExcessCount: duplicateRetirements.reduce(
      (sum, finding) => sum + finding.occurrences - 1,
      0,
    ),
    supportedCount: reconciliations.filter((item) => item.status === "supported").length,
    issuedNotRetiredCount: reconciliations.filter(
      (item) => item.status === "issued-not-retired",
    ).length,
    unresolvedMissingIssuanceCount: reconciliations.filter(
      (item) => item.status === "unresolved-missing-issuance",
    ).length,
    overRetiredCount: reconciliations.filter(
      (item) => item.status === "over-retired",
    ).length,
  };
}

export function checkRetirement(
  records: readonly NormalizedRegistryTransaction[],
  registry: CarbonRegistryId,
  serialRange: string,
): RetirementCheck {
  const matching = records.filter(
    (record) =>
      record.registry === registry &&
      record.kind === "retirement" &&
      record.serialRange === serialRange,
  );

  return {
    registry,
    serialRange,
    found: matching.length > 0,
    duplicate: matching.length > 1,
    occurrences: matching.length,
    records: matching.map((record) => structuredClone(record)),
  };
}
