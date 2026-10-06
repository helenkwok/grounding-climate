import { assessLedgerNeed } from "@climatechain/core";
import type { CryptoProvider, ReviewDecision } from "@climatechain/core";
import { createRoutedModule } from "@climatechain/webmcp";
import type {
  ClimateModule,
  ModuleCommandRouter,
} from "@climatechain/webmcp";

import { buildRegistryVerification } from "./case.js";
import { normalizeRegistryCsv } from "./normalize.js";
import { buildCarbonReviewCase, digestRecords } from "./review-case.js";
import type { CommittedRegistrySource, ImportedRegistryReport } from "./review-case.js";
import { checkRetirement, reconcileRegistryTransactions } from "./reconcile.js";
import type {
  CarbonRegistryId,
  NormalizedRegistryTransaction,
  RegistrySourceRef,
  RegistryTransactionKind,
} from "./types.js";

export interface CarbonRegistryServiceOptions {
  caseId: string;
  records: NormalizedRegistryTransaction[];
  sources: RegistrySourceRef[];
  provider: CryptoProvider;
  observedAt: string;
  /** Enables the review case: the committed files the records come from, and the person's decisions. */
  review?: {
    committedSources: CommittedRegistrySource[];
    decisions: readonly ReviewDecision[];
  };
}

export class CarbonRegistryService implements ModuleCommandRouter {
  private records: NormalizedRegistryTransaction[];
  private imported: ImportedRegistryReport[] = [];

  constructor(private readonly options: CarbonRegistryServiceOptions) {
    this.records = structuredClone(options.records);
  }

  setRecords(records: NormalizedRegistryTransaction[]): void {
    this.records = structuredClone(records);
  }

  /** Committed records plus any reports the reviewer brought. */
  allRecords(): NormalizedRegistryTransaction[] {
    return [...this.records, ...this.imported.flatMap((item) => item.records)];
  }

  report() {
    return reconcileRegistryTransactions(this.allRecords());
  }

  /** Normalises a registry report the reviewer downloaded; only its digest goes into the case. */
  async importReport(input: {
    registry: CarbonRegistryId;
    kind: RegistryTransactionKind;
    csv: string;
    sourceUri: string;
    downloadedAt: string;
    reportId?: string;
  }) {
    if (input.registry === "american-carbon-registry") {
      throw new Error("ACR records are committed; bring Climate Action Reserve or Gold Standard reports.");
    }
    if (!/^https:\/\//.test(input.sourceUri)) throw new Error("sourceUri must be the https page the report came from.");
    const records = normalizeRegistryCsv({
      registry: input.registry,
      kind: input.kind,
      sourcePath: "imported:" + input.registry + ":" + input.kind + ":" + (this.imported.length + 1),
      csv: input.csv,
    });
    if (records.length === 0) throw new Error("The report has no records.");
    this.imported.push({
      registry: input.registry,
      kind: input.kind,
      sourceUri: input.sourceUri,
      downloadedAt: input.downloadedAt,
      ...(input.reportId ? { reportId: input.reportId } : {}),
      records,
    });
    return { records: records.length, digest: await digestRecords(records, this.options.provider) };
  }

  clearImports(): void {
    this.imported = [];
  }

  /** The review case over the current records and the person's decision on any coverage gap. */
  async review() {
    const review = this.options.review;
    if (!review) throw new Error("Carbon review is not configured.");
    return buildCarbonReviewCase({
      caseId: this.options.caseId,
      createdAt: this.options.observedAt,
      provider: this.options.provider,
      committed: { sources: review.committedSources, records: this.records },
      imported: this.imported,
      decisions: review.decisions,
    });
  }

  async execute(
    moduleId: string,
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    if (moduleId !== "carbon-registry") {
      throw new Error("Unknown carbon registry module: " + moduleId);
    }
    if (String(input.caseId ?? "") !== this.options.caseId) {
      throw new Error('Unknown carbon registry case "' + input.caseId + '".');
    }

    switch (toolName) {
      case "carbon_reconcile_registry_records":
        return this.report();

      case "carbon_check_retirement":
        return checkRetirement(
          this.allRecords(),
          String(input.registry) as CarbonRegistryId,
          String(input.serialRange),
        );

      case "carbon_check_duplicate_claim":
        return {
          duplicateRetirements: this.report().duplicateRetirements,
          duplicateExcessCount: this.report().duplicateExcessCount,
        };

      case "carbon_import_registry_report":
        return this.importReport({
          registry: String(input.registry) as CarbonRegistryId,
          kind: String(input.kind) as RegistryTransactionKind,
          csv: String(input.csv ?? ""),
          sourceUri: String(input.sourceUri ?? ""),
          downloadedAt: String(input.downloadedAt ?? new Date().toISOString()),
          ...(input.reportId ? { reportId: String(input.reportId) } : {}),
        });

      case "carbon_review_records": {
        const built = await this.review();
        return {
          result: built.caseBundle.verifications[0]?.result,
          claim: built.caseBundle.claims[0],
          coverageDecision: built.review[0] ?? null,
          evidence: built.caseBundle.evidence.map((item) => ({ id: item.id, access: item.access, integrity: item.integrity })),
          note: "Imported reports are kept as digests only; their records are not stored.",
        };
      }

      default:
        throw new Error('Unknown carbon registry tool "' + toolName + '".');
    }
  }

  async verification() {
    return buildRegistryVerification({
      records: this.records,
      sources: this.options.sources,
      provider: this.options.provider,
      observedAt: this.options.observedAt,
      caseId: this.options.caseId,
    });
  }

  ledgerDecision() {
    return assessLedgerNeed({
      multipleIndependentParties: true,
      noSingleTrustedOperator: false,
      externalHistoricalVerificationRequired: true,
      compactCommitmentSuitable: true,
      notes: [
        "This prototype consumes registry records through a trusted snapshot/provider and does not model cross-party transfer consensus.",
        "Use signed append-only provenance first. Revisit a shared ledger only for a deployment where independent parties must co-maintain state without one trusted record keeper.",
      ],
    });
  }
}

export function createCarbonRegistryModule(
  service: CarbonRegistryService,
): ClimateModule {
  return createRoutedModule({
    id: "carbon-registry",
    title: "Carbon Registry Reconciliation",
    capabilities: ["carbon-registry"],
    toolNames: [
      "carbon_reconcile_registry_records",
      "carbon_check_retirement",
      "carbon_check_duplicate_claim",
      "carbon_import_registry_report",
      "carbon_review_records",
    ],
    router: service,
  });
}
