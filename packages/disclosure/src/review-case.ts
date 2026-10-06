// The disclosure case: a public figure extracted from a first-party page. Nothing can be recalculated without the
// company's activity data and factors, so a person decides what the claim may rest on: the company's own statement
// (accept as attributed), a request for the underlying evidence (needs source), or rejection. The decision is bound
// to the digest of the extracted figure and its source links, so a changed figure makes it stale.
import { canonicalBytes, reviewStatuses, reviewVerification } from "@climatechain/core";
import type {
  ClimateCaseBundle,
  ContentDigest,
  CryptoProvider,
  ReviewDecision,
  ReviewStatus,
  ReviewFlag,
} from "@climatechain/core";

import { buildDisclosureCase } from "./case.js";
import type { DisclosureCandidate, ExtractedDisclosureClaim } from "./types.js";

export type DisclosureDecision = "accept-as-attributed" | "needs-source" | "reject";

export function disclosureFlag(): ReviewFlag {
  return { id: "disclosure:not-recalculable", label: "Reported value cannot be recalculated from public data" };
}

/** An extracted claim with the organisation filled in from its candidate. */
export function claimOf(candidate: DisclosureCandidate, claimId: string): ExtractedDisclosureClaim {
  const found = candidate.extractedClaims?.find((item) => item.id === claimId);
  if (!found) throw new Error('Unknown disclosure claim "' + claimId + '".');
  return { ...found, organisationId: candidate.id, organisationName: candidate.name };
}

export async function buildDisclosureReviewCase(options: {
  candidate: DisclosureCandidate;
  claimId: string;
  createdAt: string;
  provider: CryptoProvider;
  decisions?: readonly ReviewDecision[];
  /** Other figures on the same page, which the claim leaves out. */
  alsoReported?: readonly string[];
}): Promise<{
  caseBundle: ClimateCaseBundle;
  review: ReviewStatus[];
  reviewInputDigest: ContentDigest;
  decision?: DisclosureDecision;
}> {
  const { candidate, createdAt, provider } = options;
  const claim = claimOf(candidate, options.claimId);
  const { caseBundle } = await buildDisclosureCase({
    claim,
    provider,
    confirmationUrl: candidate.confirmationUrl,
    underlyingSourceUrl: candidate.underlyingSourceUrl,
    observedAt: createdAt,
  });
  const reviewInputDigest = await provider.hash(
    canonicalBytes({ claim, confirmationUrl: candidate.confirmationUrl, underlyingSourceUrl: candidate.underlyingSourceUrl }),
    "SHA-256",
  );
  const review = reviewStatuses([disclosureFlag()], options.decisions ?? [], reviewInputDigest);
  const status = review[0]!;
  const decision = status.state === "decided" ? (status.decision!.decision as DisclosureDecision) : undefined;

  // The source cannot be redistributed: the reviewer reads it where it is published.
  for (const evidence of caseBundle.evidence) {
    evidence.access = {
      mode: "link-only",
      instructions: "Open " + evidence.source.uri + " and compare the figure with the claim.",
    };
  }
  const claimNode = caseBundle.claims[0]!;
  claimNode.boundary = {
    scopes: [claim.metric],
    methodology: "Figure extracted from the company's own public page; not recalculated.",
    accounting: {
      included: [
        candidate.name + " " + claim.metric + ", " + claim.period + ", " + claim.value + " " + claim.unit + ", as the company reports it",
      ],
      excluded: [
        ...(options.alsoReported ?? []).map((item) => item + ", reported on the same page and not part of this claim"),
        "Any figure not on the company's own page, including the CaDI record itself (link-only, not mirrored)",
      ],
      policyChoices: [
        "A reported figure that cannot be recalculated needs a person's decision before the claim is accepted",
        "The organisational boundary and the method are the company's (the page cites the GHG Protocol), not ClimateChain's",
      ],
      notAssessed: [
        "The activity data and emission factors behind the figure",
        "The external verification the page attributes to Carbon Footprint Ltd",
        "Whether the CaDI record matches the page",
      ],
    },
  };

  const reviewNode = reviewVerification({
    id: "verification:disclosure-decision",
    profile: "disclosure/0.2",
    statuses: review,
    flagSource: { nodeType: "claim", id: claimNode.id },
    adviceRefs: [],
    createdAt,
    staleNote: "Stale: made on a different extracted figure or source. ",
    findings: ["Decided is not verified: a decision records what the claim may rest on, not that the figure is correct."],
  });
  const result = decision === "accept-as-attributed" ? "reconciled" : "insufficient-evidence";
  caseBundle.verifications.push(
    {
      nodeType: "verification",
      id: "verification:disclosure",
      createdAt,
      provenance: [
        { nodeType: "claim", id: claimNode.id },
        { nodeType: "verification", id: reviewNode.id },
      ],
      verifier: reviewNode.verifier,
      profile: "disclosure/0.2",
      result,
      checks: [
        { id: "source-found", name: "First-party source located", outcome: "pass", detail: candidate.underlyingSourceUrl },
        {
          id: "calculation-reproduced",
          name: "Reported value recalculated",
          outcome: "not-run",
          detail: "The activity data and emission factors are not public.",
        },
        {
          id: "third-party-assured",
          name: "Third-party assurance inspected",
          outcome: "not-run",
          detail: claim.assuranceClaim ?? "No assurance statement on the page.",
        },
        ...reviewNode.checks,
      ],
      findings: [
        decision === "accept-as-attributed"
          ? "Accepted as attributed: the claim rests on the company's own statement, not on a recalculation."
          : decision === "needs-source"
            ? "Needs source: the claim waits for the activity data or the verification statement."
            : decision === "reject"
              ? "Rejected by " + status.decision!.decidedBy + "."
              : status.state === "stale"
                ? "The decision was made on a different figure or source, so it no longer applies."
                : "No decision yet.",
      ],
      verifiedAt: reviewNode.verifiedAt,
    },
    reviewNode,
  );
  return { caseBundle, review, reviewInputDigest, ...(decision ? { decision } : {}) };
}
