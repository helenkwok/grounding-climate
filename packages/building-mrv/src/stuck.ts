// Readings a meter did not really measure: exact zeros and runs of an identical value. The residual screen
// misses these when they are long, because they sit in the training data and drag the baseline with them.
// Scored against the GEPIII rank-1 labels by scripts/kaggle/gepiii-run-screen.
import type { AnomalyResult, MeterPoint } from "./types.js";

const HOUR_MS = 3_600_000;

function instant(timestamp: string): number {
  return Date.parse(timestamp.includes("T") ? timestamp : timestamp.replace(" ", "T") + "Z");
}

/** Length of the run of identical, hourly-consecutive values each reading belongs to. */
export function runLengths(series: readonly MeterPoint[]): number[] {
  const lengths = new Array<number>(series.length).fill(1);
  let start = 0;
  for (let index = 1; index <= series.length; index += 1) {
    const previous = series[index - 1]!;
    const current = series[index];
    const continues =
      current !== undefined &&
      current.value === previous.value &&
      instant(current.timestamp) - instant(previous.timestamp) === HOUR_MS;
    if (!continues) {
      lengths.fill(index - start, start, index);
      start = index;
    }
  }
  return lengths;
}

/** Adds zero and constant-run flags to a residual screen result. */
export function addStuckReadings(
  series: readonly MeterPoint[],
  anomalies: AnomalyResult,
  minRunHours: number,
): AnomalyResult {
  if (!Number.isInteger(minRunHours) || minRunHours < 2) {
    throw new Error("minRunHours must be an integer of at least 2.");
  }
  const lengths = runLengths(series);
  let flaggedCount = 0;
  let flaggedEnergyKWh = 0;
  const points = anomalies.points.map((point, index) => {
    const reasons = [...point.reasons];
    if (point.value === 0) reasons.push("zero");
    if ((lengths[index] ?? 1) >= minRunHours) reasons.push("constant-run");
    const flagged = reasons.length > 0;
    if (flagged) {
      flaggedCount += 1;
      flaggedEnergyKWh += point.value;
    }
    return { ...point, reasons, flagged };
  });
  return {
    ...anomalies,
    method: "baseline-residual-mad+stuck-readings",
    minRunHours,
    flaggedCount,
    flaggedEnergyKWh,
    points,
  };
}
