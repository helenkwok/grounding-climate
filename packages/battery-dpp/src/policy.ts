import type {
  BatteryHealthEstimate,
  BatteryPassportDecision,
  BatteryPassportPolicy,
} from "./types.js";

export const DEFAULT_BATTERY_PASSPORT_POLICY: BatteryPassportPolicy = {
  reuseMinSoh: 0.85,
  reuseMinRulCycles: 200,
  repurposeMinSoh: 0.75,
  minimumFitRSquared: 0.5,
};

export function decideBatteryDisposition(
  health: BatteryHealthEstimate,
  policy: BatteryPassportPolicy = DEFAULT_BATTERY_PASSPORT_POLICY,
): BatteryPassportDecision {
  const reasons: string[] = [];

  if (
    policy.minimumFitRSquared !== undefined &&
    (health.fit.rSquared === null ||
      health.fit.rSquared < policy.minimumFitRSquared)
  ) {
    reasons.push(
      "Capacity-trend fit is below the policy confidence threshold.",
    );
    return {
      disposition: "service-review",
      permitted: false,
      reasons,
      policy,
    };
  }

  if (
    health.currentSoh >= policy.reuseMinSoh &&
    health.estimatedRulCycles !== null &&
    health.estimatedRulCycles >= policy.reuseMinRulCycles
  ) {
    reasons.push(
      "SOH and estimated remaining cycles meet the configured reuse thresholds.",
    );
    return {
      disposition: "reuse",
      permitted: true,
      reasons,
      policy,
    };
  }

  if (health.currentSoh >= policy.repurposeMinSoh) {
    reasons.push(
      "SOH clears the repurpose threshold but the reuse rule is not satisfied.",
    );
    return {
      disposition: "repurpose",
      permitted: true,
      reasons,
      policy,
    };
  }

  reasons.push(
    "SOH is below the configured repurpose threshold; route to retirement/recycling review.",
  );
  return {
    disposition: "retire-review",
    permitted: false,
    reasons,
    policy,
  };
}
