import { assessLedgerNeed } from "@climatechain/core";
import type { CryptoProvider } from "@climatechain/core";
import { createRoutedModule } from "@climatechain/webmcp";
import type {
  ClimateModule,
  ModuleCommandRouter,
} from "@climatechain/webmcp";

import { buildRegistryVerification } from "./case.js";
import { checkRetirement, reconcileRegistryTransactions } from "./reconcile.js";
import type {
  CarbonRegistryId,
  NormalizedRegistryTransaction,
  RegistrySourceRef,
} from "./types.js";

export interface CarbonRegistryServiceOptions {
  caseId: string;
  records: NormalizedRegistryTransaction[];
  sources: RegistrySourceRef[];
  provider: CryptoProvider;
  observedAt: string;
}

export class CarbonRegistryService implements ModuleCommandRouter {
  private records: NormalizedRegistryTransaction[];

  constructor(private readonly options: CarbonRegistryServiceOptions) {
    this.records = structuredClone(options.records);
  }

  setRecords(records: NormalizedRegistryTransaction[]): void {
    this.records = structuredClone(records);
  }

  report() {
    return reconcileRegistryTransactions(this.records);
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
          this.records,
          String(input.registry) as CarbonRegistryId,
          String(input.serialRange),
        );

      case "carbon_check_duplicate_claim":
        return {
          duplicateRetirements: this.report().duplicateRetirements,
          duplicateExcessCount: this.report().duplicateExcessCount,
        };

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
    ],
    router: service,
  });
}
