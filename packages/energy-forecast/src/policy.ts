import type {
  BoundedActionDecision,
  BoundedActionPolicy,
  BoundedActionRequest,
} from "./types.js";

export function evaluateBoundedAction(
  request: BoundedActionRequest,
  policy: BoundedActionPolicy,
): BoundedActionDecision {
  const reasons: string[] = [];

  if (!policy.enabled) {
    reasons.push("Policy kill switch is disabled.");
  }

  if (!policy.allowedActionTypes.includes(request.actionType)) {
    reasons.push("Action type is not allowed by policy.");
  }

  if (!Number.isFinite(request.requestedMWh) || request.requestedMWh <= 0) {
    reasons.push("Requested MWh must be positive.");
  }

  if (!Number.isFinite(request.confidence) || request.confidence < 0 || request.confidence > 1) {
    reasons.push("Confidence must be between 0 and 1.");
  } else if (request.confidence < policy.minimumConfidence) {
    reasons.push(
      "Forecast confidence " +
        request.confidence +
        " is below policy minimum " +
        policy.minimumConfidence +
        ".",
    );
  }

  if (
    request.counterparty &&
    !policy.allowedCounterparties.includes(request.counterparty)
  ) {
    reasons.push("Counterparty is not on the policy allow-list.");
  }

  const hardFailure = reasons.length > 0;
  const approvedMWh = hardFailure
    ? 0
    : Math.min(request.requestedMWh, policy.maxActionMWh);

  if (!hardFailure && request.requestedMWh > policy.maxActionMWh) {
    reasons.push(
      "Requested MWh was capped from " +
        request.requestedMWh +
        " to " +
        policy.maxActionMWh +
        ".",
    );
  }

  const requiresHumanApproval =
    !hardFailure && approvedMWh >= policy.humanApprovalAboveMWh;

  return {
    permitted: !hardFailure,
    requiresHumanApproval,
    approvedMWh,
    reasons,
    request,
  };
}
