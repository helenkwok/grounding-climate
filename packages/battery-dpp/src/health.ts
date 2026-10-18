import type {
  BatteryHealthEstimate,
  BatteryHistory,
} from "./types.js";

function linearRegression(
  points: readonly { x: number; y: number }[],
): { slope: number; intercept: number; rSquared: number | null } {
  if (points.length < 2) {
    throw new Error("At least two cycle-capacity points are required.");
  }

  const meanX =
    points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const meanY =
    points.reduce((sum, point) => sum + point.y, 0) / points.length;

  let covariance = 0;
  let varianceX = 0;
  let totalY = 0;
  for (const point of points) {
    covariance += (point.x - meanX) * (point.y - meanY);
    varianceX += (point.x - meanX) ** 2;
    totalY += (point.y - meanY) ** 2;
  }

  if (varianceX === 0) {
    throw new Error("Cycle numbers must not all be identical.");
  }

  const slope = covariance / varianceX;
  const intercept = meanY - slope * meanX;

  let residual = 0;
  for (const point of points) {
    const predicted = intercept + slope * point.x;
    residual += (point.y - predicted) ** 2;
  }

  const rSquared = totalY === 0 ? null : 1 - residual / totalY;
  return { slope, intercept, rSquared };
}

export function estimateBatteryHealth(options: {
  history: BatteryHistory;
  eolSohThreshold?: number;
  fitLastCycles?: number;
}): BatteryHealthEstimate {
  const { history } = options;
  if (!Number.isFinite(history.nominalCapacityAh) || history.nominalCapacityAh <= 0) {
    throw new Error("Nominal capacity must be positive.");
  }

  const eolSohThreshold = options.eolSohThreshold ?? 0.8;
  if (!(eolSohThreshold > 0 && eolSohThreshold < 1)) {
    throw new Error("EOL SOH threshold must be between 0 and 1.");
  }

  const cycles = [...history.cycles]
    .filter(
      (item) =>
        Number.isFinite(item.cycle) &&
        Number.isFinite(item.dischargeCapacityAh) &&
        item.dischargeCapacityAh > 0,
    )
    .sort((a, b) => a.cycle - b.cycle);

  if (cycles.length < 2) {
    throw new Error("At least two valid capacity observations are required.");
  }

  const fitLastCycles = options.fitLastCycles ?? Math.min(50, cycles.length);
  if (!Number.isInteger(fitLastCycles) || fitLastCycles < 2) {
    throw new Error("fitLastCycles must be an integer >= 2.");
  }

  const fitCycles = cycles.slice(-fitLastCycles);
  const fit = linearRegression(
    fitCycles.map((item) => ({
      x: item.cycle,
      y: item.dischargeCapacityAh,
    })),
  );

  const latest = cycles.at(-1);
  if (!latest) throw new Error("Battery history unexpectedly empty.");

  const currentSoh = latest.dischargeCapacityAh / history.nominalCapacityAh;
  const initialCapacityAh = cycles[0]!.dischargeCapacityAh;
  const eolCapacity = history.nominalCapacityAh * eolSohThreshold;

  let estimatedEolCycle: number | null = null;
  let estimatedRulCycles: number | null = null;

  if (fit.slope < 0) {
    estimatedEolCycle = (eolCapacity - fit.intercept) / fit.slope;
    estimatedRulCycles = Math.max(
      0,
      estimatedEolCycle - latest.cycle,
    );
  }

  const resistance = ohmicResistance(history);
  return {
    batteryId: history.batteryId,
    observedCycle: latest.cycle,
    currentCapacityAh: latest.dischargeCapacityAh,
    currentSoh,
    initialCapacityAh,
    sohVsInitial: latest.dischargeCapacityAh / initialCapacityAh,
    eolSohThreshold,
    capacitySlopeAhPerCycle: fit.slope,
    estimatedEolCycle,
    estimatedRulCycles,
    ...(resistance ? { resistance } : {}),
    fit: {
      sampleCount: fitCycles.length,
      rSquared: fit.rSquared,
      startCycle: fitCycles[0]?.cycle ?? latest.cycle,
      endCycle: latest.cycle,
    },
    limitations: [
      "Linear capacity extrapolation is a transparent baseline, not a safety or warranty prediction.",
      "Future degradation can be nonlinear and operating conditions may change.",
      "Disposition policy must not substitute for electrical, thermal, mechanical, or regulatory safety assessment.",
    ],
  };
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/**
 * Ohmic resistance (Re) at the start and end of the recorded sweeps, each the median of RESISTANCE_WINDOW sweeps
 * because single sweeps are noisy. The earliest sweep need not be at beginning of life; the method says when it was.
 */
export const RESISTANCE_WINDOW = 5;
export function ohmicResistance(history: BatteryHistory): BatteryHealthEstimate["resistance"] {
  const sweeps = (history.impedance ?? []).filter((s) => Number.isFinite(s.reOhm) && s.reOhm > 0).sort((a, b) => a.sweep - b.sweep);
  if (sweeps.length < 2 * RESISTANCE_WINDOW) return undefined;
  const first = sweeps.slice(0, RESISTANCE_WINDOW);
  const last = sweeps.slice(-RESISTANCE_WINDOW);
  const earliestOhm = median(first.map((s) => s.reOhm));
  const latestOhm = median(last.map((s) => s.reOhm));
  return {
    earliestOhm,
    earliestAfterCycle: first[0]!.afterCycle,
    latestOhm,
    latestAfterCycle: last.at(-1)!.afterCycle,
    increasePercent: ((latestOhm - earliestOhm) / earliestOhm) * 100,
    method:
      "Median ohmic resistance Re of the first and of the last " + RESISTANCE_WINDOW + " impedance sweeps (EIS fits by the data provider); " +
      "the first sweep followed cycle " + first[0]!.afterCycle + ", so this is not a beginning-of-life value",
  };
}
