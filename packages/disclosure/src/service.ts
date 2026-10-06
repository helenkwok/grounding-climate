import { createRoutedModule } from "@climatechain/webmcp";
import type {
  ClimateModule,
  ModuleCommandRouter,
} from "@climatechain/webmcp";

import type { CryptoProvider, ReviewDecision } from "@climatechain/core";

import { reconcileDisclosureClaim } from "./reconcile.js";
import { buildDisclosureReviewCase } from "./review-case.js";
import type {
  DisclosureCandidate,
  ExtractedDisclosureClaim,
} from "./types.js";

export interface DisclosureReviewOptions {
  candidateId: string;
  claimId: string;
  provider: CryptoProvider;
  observedAt: string;
  decisions: readonly ReviewDecision[];
  alsoReported?: readonly string[];
}

export class DisclosureService implements ModuleCommandRouter {
  private readonly original: DisclosureCandidate[];

  constructor(
    private candidates: DisclosureCandidate[],
    private readonly reviewOptions?: DisclosureReviewOptions,
  ) {
    this.original = structuredClone(candidates);
  }

  /** Changes the extracted value of the reviewed claim, as an extraction error would. */
  setReviewedValue(value: number): void {
    const claim = this.candidates
      .find((item) => item.id === this.reviewOptions?.candidateId)
      ?.extractedClaims?.find((item) => item.id === this.reviewOptions?.claimId);
    if (!claim) throw new Error("No reviewed claim configured.");
    claim.value = value;
  }

  resetCandidates(): void {
    this.candidates = structuredClone(this.original);
  }

  /** The reviewed claim with the person's decision, built from the current candidates. */
  async review() {
    const options = this.reviewOptions;
    if (!options) throw new Error("Disclosure review is not configured.");
    const candidate = this.candidates.find((item) => item.id === options.candidateId);
    if (!candidate) throw new Error('Unknown disclosure candidate "' + options.candidateId + '".');
    return buildDisclosureReviewCase({
      candidate,
      claimId: options.claimId,
      createdAt: options.observedAt,
      provider: options.provider,
      decisions: options.decisions,
      ...(options.alsoReported ? { alsoReported: options.alsoReported } : {}),
    });
  }

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

      case "disclosure_review_claim": {
        const built = await this.review();
        return {
          claim: built.caseBundle.claims[0],
          result: built.caseBundle.verifications[0]?.result,
          decision: built.review[0] ?? null,
          accountingBoundary: built.caseBundle.claims[0]?.boundary?.accounting,
          note: "Decided is not verified: nothing here recalculates the figure.",
        };
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
      "disclosure_review_claim",
    ],
    router: service,
  });
}
