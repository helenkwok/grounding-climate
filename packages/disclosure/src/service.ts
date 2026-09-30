import { createRoutedModule } from "@climatechain/webmcp";
import type {
  ClimateModule,
  ModuleCommandRouter,
} from "@climatechain/webmcp";

import { reconcileDisclosureClaim } from "./reconcile.js";
import type {
  DisclosureCandidate,
  ExtractedDisclosureClaim,
} from "./types.js";

export class DisclosureService implements ModuleCommandRouter {
  constructor(private readonly candidates: DisclosureCandidate[]) {}

  listCandidates(): DisclosureCandidate[] {
    return structuredClone(this.candidates);
  }

  getClaim(claimId: string): ExtractedDisclosureClaim {
    for (const candidate of this.candidates) {
      const claim = candidate.extractedClaims?.find(
        (item) => item.id === claimId,
      );
      if (claim) return structuredClone(claim);
    }
    throw new Error('Unknown disclosure claim "' + claimId + '".');
  }

  async execute(
    moduleId: string,
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    if (moduleId !== "disclosure") {
      throw new Error("Unknown disclosure module: " + moduleId);
    }

    switch (toolName) {
      case "disclosure_get_public_claim":
        return this.getClaim(String(input.claimId));

      case "disclosure_extract_report_claims": {
        const candidateId = String(input.candidateId);
        const candidate = this.candidates.find(
          (item) => item.id === candidateId,
        );
        if (!candidate) {
          throw new Error('Unknown disclosure candidate "' + candidateId + '".');
        }
        return {
          candidateId,
          extractionMode: "curated-source-record",
          claims: structuredClone(candidate.extractedClaims ?? []),
          caveat:
            "These are curated factual extractions from cited public sources, not an assertion that an AI extractor independently reproduced the report.",
        };
      }

      case "disclosure_reconcile_claim": {
        const claim = this.getClaim(String(input.claimId));
        return reconcileDisclosureClaim(
          claim,
          Number(input.reconstructedValue),
          input.tolerance === undefined ? 0.01 : Number(input.tolerance),
        );
      }

      default:
        throw new Error('Unknown disclosure tool "' + toolName + '".');
    }
  }
}

export function createDisclosureModule(
  service: DisclosureService,
): ClimateModule {
  return createRoutedModule({
    id: "disclosure",
    title: "Public Disclosure / CaDI",
    capabilities: ["public-disclosure", "claim-reconciliation"],
    toolNames: [
      "disclosure_get_public_claim",
      "disclosure_extract_report_claims",
      "disclosure_reconcile_claim",
    ],
    router: service,
  });
}
