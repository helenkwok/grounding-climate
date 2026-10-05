// A person's decision on each flagged interval. "Decided" is not "resolved": excluding a reading as a
// meter fault records a choice, not an explanation of what happened at the site.
import type { ContentDigest } from "@climatechain/core";

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

const sameDigest = (a: ContentDigest, b: ContentDigest) =>
  a.algorithm === b.algorithm && a.value === b.value;

export function flagStatuses(
  analysis: BuildingMrvAnalysis,
  decisions: readonly IntervalDecision[],
  currentSeriesDigest: ContentDigest,
): FlagStatus[] {
  return analysis.anomalies.points
    .filter((point) => point.flagged)
    .map((point) => {
      const decision = decisions.find((item) => item.timestamp === point.timestamp);
      if (!decision) return { timestamp: point.timestamp, state: "undecided" };
      return {
        timestamp: point.timestamp,
        state: sameDigest(decision.meterSeriesDigest, currentSeriesDigest) ? "decided" : "stale",
        decision,
      };
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
