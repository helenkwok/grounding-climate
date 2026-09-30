import type {
  DisclosureReconciliation,
  ExtractedDisclosureClaim,
} from "./types.js";

export function reconcileDisclosureClaim(
  claim: ExtractedDisclosureClaim,
  reconstructedValue: number,
  tolerance = 0.01,
): DisclosureReconciliation {
  if (!Number.isFinite(reconstructedValue) || reconstructedValue < 0) {
    throw new Error("Reconstructed emissions must be a finite non-negative number.");
  }
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error("Tolerance must be a finite non-negative fraction.");
  }

  const absoluteDifference = reconstructedValue - claim.value;
  const relativeDifference =
    claim.value === 0
      ? reconstructedValue === 0
        ? 0
        : Number.POSITIVE_INFINITY
      : Math.abs(absoluteDifference) / Math.abs(claim.value);

  return {
    claimId: claim.id,
    disclosedValue: claim.value,
    reconstructedValue,
    absoluteDifference,
    relativeDifference,
    tolerance,
    reconciled: relativeDifference <= tolerance,
    caveat:
      "Reconciliation compares numeric values only. It does not by itself establish that organisational boundary, activity data, emission factors, or assurance scope are equivalent.",
  };
}
