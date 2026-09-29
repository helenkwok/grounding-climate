import type {
  AnomalyResult,
  EmissionsResult,
  GridEmissionFactor,
  MeterPoint,
} from "./types.js";

export function reconstructElectricityEmissions(
  series: readonly MeterPoint[],
  factor: GridEmissionFactor,
  anomalies?: AnomalyResult,
): EmissionsResult {
  if (
    !Number.isFinite(factor.valueKgCo2ePerKwh) ||
    factor.valueKgCo2ePerKwh < 0
  ) {
    throw new Error("Emission factor must be a non-negative number.");
  }

  const flagged = new Set(
    anomalies?.points
      .filter((point) => point.flagged)
      .map((point) => point.timestamp) ?? [],
  );

  let acceptedEnergyKWh = 0;
  let excludedEnergyKWh = 0;

  for (const point of series) {
    if (flagged.has(point.timestamp)) {
      excludedEnergyKWh += point.value;
    } else {
      acceptedEnergyKWh += point.value;
    }
  }

  const emissionsKgCo2e =
    acceptedEnergyKWh * factor.valueKgCo2ePerKwh;

  return {
    acceptedEnergyKWh,
    acceptedEnergyMWh: acceptedEnergyKWh / 1000,
    excludedEnergyKWh,
    factorKgCo2ePerKwh: factor.valueKgCo2ePerKwh,
    emissionsKgCo2e,
    emissionsTCo2e: emissionsKgCo2e / 1000,
  };
}
