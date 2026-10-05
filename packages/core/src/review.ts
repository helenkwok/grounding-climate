// The review step shared by every module: a screen raises flags, a person decides each one, and the
// decision is bound to the digest of the input it was made on. A decision on other input is stale.
// "Decided" is not "resolved": a decision records a choice, not an explanation of the cause.
import type { ContentDigest, NodeRef, Verification } from "./types.js";

export interface ReviewFlag {
  /** Stable within a case; also the id of the decision check. */
  id: string;
  /** Human-readable name of what was flagged. */
  label: string;
}

export interface ReviewDecision {
  flagId: string;
  decision: string;
  reason: string;
  decidedBy: string;
  decidedAt: string;
  /** Digest of the input the person looked at. */
  inputDigest: ContentDigest;
  /** The advice model-run shown to the person, if any. */
  adviceShown?: string;
}

export interface ReviewStatus {
  flag: ReviewFlag;
  state: "decided" | "stale" | "undecided";
  decision?: ReviewDecision;
}

const sameDigest = (a: ContentDigest, b: ContentDigest) =>
  a.algorithm === b.algorithm && a.value === b.value;

export function reviewStatuses(
  flags: readonly ReviewFlag[],
  decisions: readonly ReviewDecision[],
  currentInputDigest: ContentDigest,
): ReviewStatus[] {
  return flags.map((flag) => {
    const decision = decisions.find((item) => item.flagId === flag.id);
    if (!decision) return { flag, state: "undecided" };
    return {
      flag,
      state: sameDigest(decision.inputDigest, currentInputDigest) ? "decided" : "stale",
      decision,
    };
  });
}

/** The person's decisions as a verification node; "reconciled" only when every flag has a current decision. */
export function reviewVerification(input: {
  id: string;
  profile: string;
  statuses: readonly ReviewStatus[];
  /** The node that raised the flags. */
  flagSource: NodeRef;
  adviceRefs: readonly NodeRef[];
  createdAt: string;
  /** Explains a stale decision, e.g. "Stale: made on a different meter series. ". */
  staleNote: string;
  findings: string[];
}): Verification {
  const decided = input.statuses.filter((status) => status.state === "decided");
  const decidedBy = decided[0]?.decision?.decidedBy;
  return {
    nodeType: "verification",
    id: input.id,
    createdAt: input.createdAt,
    provenance: [input.flagSource, ...input.adviceRefs],
    verifier: decidedBy
      ? { id: decidedBy, kind: "person" }
      : { id: "person:unassigned", kind: "person", name: "No reviewer yet" },
    profile: input.profile,
    result: decided.length === input.statuses.length ? "reconciled" : "insufficient-evidence",
    checks: input.statuses.map((status) => ({
      id: status.flag.id,
      name: status.flag.label,
      outcome: status.state === "decided" ? "pass" : status.state === "stale" ? "fail" : "not-run",
      detail:
        status.state === "undecided"
          ? "No decision yet."
          : (status.state === "stale" ? input.staleNote : "") +
            status.decision?.decision +
            ": " +
            status.decision?.reason +
            " (" +
            status.decision?.decidedBy +
            ", " +
            status.decision?.decidedAt +
            ")",
    })),
    findings: input.findings,
    verifiedAt: decided.at(-1)?.decision?.decidedAt ?? input.createdAt,
  };
}
