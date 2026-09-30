export type DisclosureEvidenceState =
  | "confirmed"
  | "not-assessed"
  | "failed"
  | "attributed";

export interface ExtractedDisclosureClaim {
  id: string;
  organisationId: string;
  organisationName: string;
  period: string;
  metric: string;
  value: number;
  unit: string;
  basis: "reported" | "location-based" | "market-based" | "other";
  sourceUrl: string;
  sourceRetrievedAt: string;
  assuranceClaim?: string;
}

export interface DisclosureCandidate {
  id: string;
  name: string;
  confirmationStatus: "confirmed-on-cadi";
  confirmationUrl: string;
  underlyingSourceUrl: string;
  usableClaim: string;
  numericClaimReady: boolean;
  extractedClaims?: ExtractedDisclosureClaim[];
}

export interface DisclosureAssessment {
  disclosedOnCadi: DisclosureEvidenceState;
  sourceLocated: DisclosureEvidenceState;
  calculationReproduced: DisclosureEvidenceState;
  factorsTraced: DisclosureEvidenceState;
  evidenceIntegrityConfirmed: DisclosureEvidenceState;
  thirdPartyAssurance: DisclosureEvidenceState;
}

export interface DisclosureReconciliation {
  claimId: string;
  disclosedValue: number;
  reconstructedValue: number;
  absoluteDifference: number;
  relativeDifference: number;
  tolerance: number;
  reconciled: boolean;
  caveat: string;
}
