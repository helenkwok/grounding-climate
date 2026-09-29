export interface LedgerTrustAssessment {
  multipleIndependentParties: boolean;
  noSingleTrustedOperator: boolean;
  externalHistoricalVerificationRequired: boolean;
  compactCommitmentSuitable: boolean;
  notes: string[];
}

export interface LedgerDecision {
  decision: "use-ledger" | "defer-ledger";
  satisfied: string[];
  unmet: string[];
  notes: string[];
}

const criteria = [
  [
    "multipleIndependentParties",
    "Multiple independent parties need the same state.",
  ],
  [
    "noSingleTrustedOperator",
    "No single trusted operator can serve as record keeper.",
  ],
  [
    "externalHistoricalVerificationRequired",
    "External parties must verify historical state later.",
  ],
  [
    "compactCommitmentSuitable",
    "The required shared state fits a compact ledger commitment.",
  ],
] as const;

export function assessLedgerNeed(
  assessment: LedgerTrustAssessment,
): LedgerDecision {
  const satisfied: string[] = [];
  const unmet: string[] = [];

  for (const [field, description] of criteria) {
    if (assessment[field]) {
      satisfied.push(description);
    } else {
      unmet.push(description);
    }
  }

  return {
    decision: unmet.length === 0 ? "use-ledger" : "defer-ledger",
    satisfied,
    unmet,
    notes: [...assessment.notes],
  };
}
