// A person's decision on each flagged interval. "Decided" is not "resolved": excluding a reading as a
// meter fault records a choice, not an explanation of what happened at the site.
import { reviewStatuses } from "@climatechain/core";
import type { ContentDigest, ReviewFlag } from "@climatechain/core";

import { reconstructElectricityEmissions } from "./emissions.js";
import type {
  BuildingMrvAnalysis,
  GridEmissionFactor,
  MeterPoint,
} from "./types.js";

export interface IntervalDecision {
  timestamp: string;
  decision: "exclude" | "keep";
  reason: string;
  decidedBy: string;
  decidedAt: string;
  /** The meter series the person looked at. A decision on other data is stale. */
  meterSeriesDigest: ContentDigest;
  /** The advice model-run shown to the person, if any. */
  adviceShown?: string;
}

export interface FlagStatus {
  timestamp: string;
  state: "decided" | "stale" | "undecided";
  decision?: IntervalDecision;
}

/** The review flag for one flagged reading; its id is also the decision check's id. */
export function intervalFlag(timestamp: string): ReviewFlag {
  return { id: "interval:" + timestamp, label: "Decision on flagged reading at " + timestamp };
}

/** The shared review rule (core reviewStatuses), keyed by the reading's timestamp. */
export function flagStatuses(
  analysis: BuildingMrvAnalysis,
  decisions: readonly IntervalDecision[],
  currentSeriesDigest: ContentDigest,
): FlagStatus[] {
  const timestamps = analysis.anomalies.points.filter((point) => point.flagged).map((point) => point.timestamp);
  const statuses = reviewStatuses(
    timestamps.map(intervalFlag),
    decisions.map((decision) => ({
      ...decision,
      flagId: intervalFlag(decision.timestamp).id,
      inputDigest: decision.meterSeriesDigest,
    })),
    currentSeriesDigest,
  );
  return statuses.map((status, index) => {
    const timestamp = timestamps[index]!;
    const decision = decisions.find((item) => item.timestamp === timestamp);
    return status.state === "undecided" || !decision
      ? { timestamp, state: "undecided" }
      : { timestamp, state: status.state, decision };
  });
}

/**
 * Emissions after current decisions: a flagged interval is excluded unless a current decision keeps it.
 * Undecided and stale intervals stay excluded, so an unreviewed reading never inflates the claim.
 */
export function applyDecisions(
  series: readonly MeterPoint[],
  factor: GridEmissionFactor,
  analysis: BuildingMrvAnalysis,
  statuses: readonly FlagStatus[],
): BuildingMrvAnalysis {
  const kept = new Set(
    statuses
      .filter((status) => status.state === "decided" && status.decision?.decision === "keep")
      .map((status) => status.timestamp),
  );
  return {
    ...analysis,
    emissions: reconstructElectricityEmissions(series, factor, analysis.anomalies, kept),
  };
}
