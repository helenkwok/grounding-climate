import {
  detectResidualAnomalies,
} from "./anomaly.js";
import { runHourOfWeekBaseline } from "./baseline.js";
import {
  reconstructElectricityEmissions,
} from "./emissions.js";
import type {
  BuildingMrvAnalysis,
  GridEmissionFactor,
  MeterPoint,
} from "./types.js";

export interface RunBuildingMrvOptions {
  trainingFraction?: number;
  anomalyThreshold?: number;
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
  const anomalies = detectResidualAnomalies(
    series,
    baseline,
    options.anomalyThreshold ?? 6,
  );
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
