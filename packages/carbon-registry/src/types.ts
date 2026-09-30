export type CarbonRegistryId =
  | "american-carbon-registry"
  | "gold-standard"
  | "climate-action-reserve";

export type RegistryTransactionKind = "issuance" | "retirement";

export interface RegistrySourceRef {
  registry: CarbonRegistryId;
  kind: RegistryTransactionKind;
  uri: string;
  path: string;
  gitBlobSha: string;
  commit: string;
}

export interface NormalizedRegistryTransaction {
  registry: CarbonRegistryId;
  kind: RegistryTransactionKind;
  projectId: string;
  vintage?: number;
  quantity: number;
  transactionDate?: string;
  serialRange?: string;
  beneficiary?: string;
  sourcePath: string;
  sourceRow: number;
}

export type ReconciliationStatus =
  | "supported"
  | "issued-not-retired"
  | "unresolved-missing-issuance"
  | "over-retired";

export interface ProjectVintageReconciliation {
  registry: CarbonRegistryId;
  projectId: string;
  vintage?: number;
  issued: number;
  retired: number;
  remaining: number;
  status: ReconciliationStatus;
}

export interface DuplicateRetirementFinding {
  registry: CarbonRegistryId;
  serialRange: string;
  occurrences: number;
  rows: Array<{
    sourcePath: string;
    sourceRow: number;
    quantity: number;
    projectId: string;
    vintage?: number;
  }>;
}

export interface RegistryReconciliationReport {
  registries: CarbonRegistryId[];
  recordCount: number;
  issuanceCount: number;
  retirementCount: number;
  reconciliations: ProjectVintageReconciliation[];
  duplicateRetirements: DuplicateRetirementFinding[];
  duplicateExcessCount: number;
  supportedCount: number;
  issuedNotRetiredCount: number;
  unresolvedMissingIssuanceCount: number;
  overRetiredCount: number;
}

export interface RetirementCheck {
  registry: CarbonRegistryId;
  serialRange: string;
  found: boolean;
  duplicate: boolean;
  occurrences: number;
  records: NormalizedRegistryTransaction[];
}
