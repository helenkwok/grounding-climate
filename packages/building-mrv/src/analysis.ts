import {
  detectResidualAnomalies,
} from "./anomaly.js";
import { runHourOfWeekBaseline } from "./baseline.js";
import { addStuckReadings } from "./stuck.js";
import {
  reconstructElectricityEmissions,
} from "./emissions.js";
import type {
  BuildingMrvAnalysis,
  GridEmissionFactor,
  MeterPoint,
} from "./types.js";

/** Chosen on held-out GEPIII buildings; see reports/building-mrv/gepiii-run-screen.json. */
export const DEFAULT_MIN_RUN_HOURS = 168;

export interface RunBuildingMrvOptions {
  trainingFraction?: number;
  anomalyThreshold?: number;
  /** Flag zeros and runs of at least this many identical hourly readings; 0 turns it off. */
  minRunHours?: number;
}

export function runBuildingMrv(
  series: readonly MeterPoint[],
  factor: GridEmissionFactor,
  options: RunBuildingMrvOptions = {},
): BuildingMrvAnalysis {
  const baseline = runHourOfWeekBaseline(
    series,
    options.trainingFraction ?? 0.8,
  );
  const residual = detectResidualAnomalies(
    series,
    baseline,
    options.anomalyThreshold ?? 6,
  );
  const minRunHours = options.minRunHours ?? DEFAULT_MIN_RUN_HOURS;
  const anomalies =
    minRunHours > 0 ? addStuckReadings(series, residual, minRunHours) : residual;
  const emissions = reconstructElectricityEmissions(
    series,
    factor,
    anomalies,
  );

  return {
    baseline,
    anomalies,
    emissions,
  };
}
