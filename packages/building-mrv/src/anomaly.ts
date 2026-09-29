import {
  fitHourOfWeekMean,
  predictPoint,
} from "./baseline.js";
import type {
  AnomalyPoint,
  AnomalyResult,
  BaselineResult,
  ClassificationMetrics,
  MeterPoint,
} from "./types.js";

function median(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error("Median requires at least one value.");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const left = sorted[middle - 1];
  const right = sorted[middle];
  if (sorted.length % 2 === 0) {
    if (left === undefined || right === undefined) {
      throw new Error("Median index failure.");
    }
    return (left + right) / 2;
  }
  if (right === undefined) throw new Error("Median index failure.");
  return right;
}

export function detectResidualAnomalies(
  series: readonly MeterPoint[],
  baseline: BaselineResult,
  threshold = 6,
): AnomalyResult {
  if (!Number.isFinite(threshold) || threshold <= 0) {
    throw new Error("Anomaly threshold must be positive.");
  }

  const training = series.slice(0, baseline.split.trainingEndIndex);
  const model = fitHourOfWeekMean(training);
  const trainingResiduals = training.map(
    (point) => point.value - predictPoint(model, point),
  );
  const center = median(trainingResiduals);
  const mad = median(
    trainingResiduals.map((value) => Math.abs(value - center)),
  );
  const robustScale = Math.max(1e-9, 1.4826 * mad);

  let flaggedCount = 0;
  let flaggedEnergyKWh = 0;
  const points: AnomalyPoint[] = series.map((point) => {
    const predicted = predictPoint(model, point);
    const residual = point.value - predicted;
    const robustZ = (residual - center) / robustScale;
    const flagged = Math.abs(robustZ) >= threshold;
    if (flagged) {
      flaggedCount += 1;
      flaggedEnergyKWh += point.value;
    }
    return {
      timestamp: point.timestamp,
      value: point.value,
      predicted,
      residual,
      robustZ,
      flagged,
    };
  });

  return {
    method: "baseline-residual-mad",
    threshold,
    center,
    robustScale,
    flaggedCount,
    flaggedEnergyKWh,
    points,
  };
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export function classificationMetrics(
  labels: readonly boolean[],
  predictions: readonly boolean[],
): ClassificationMetrics {
  if (labels.length !== predictions.length || labels.length === 0) {
    throw new Error(
      "Classification metrics require equal non-empty arrays.",
    );
  }

  let truePositive = 0;
  let falsePositive = 0;
  let trueNegative = 0;
  let falseNegative = 0;

  for (let index = 0; index < labels.length; index += 1) {
    const label = labels[index];
    const predicted = predictions[index];

    if (label && predicted) truePositive += 1;
    else if (!label && predicted) falsePositive += 1;
    else if (!label && !predicted) trueNegative += 1;
    else falseNegative += 1;
  }

  const precision = ratio(truePositive, truePositive + falsePositive);
  const recall = ratio(truePositive, truePositive + falseNegative);
  const specificity = ratio(
    trueNegative,
    trueNegative + falsePositive,
  );
  const f1 =
    precision === null || recall === null || precision + recall === 0
      ? null
      : (2 * precision * recall) / (precision + recall);

  return {
    truePositive,
    falsePositive,
    trueNegative,
    falseNegative,
    precision,
    recall,
    specificity,
    f1,
  };
}

export function injectTamper(
  series: readonly MeterPoint[],
  index: number,
  multiplier: number,
): MeterPoint[] {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= series.length
  ) {
    throw new Error("Tamper index is outside the series.");
  }
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new Error("Tamper multiplier must be positive.");
  }

  return series.map((point, current) =>
    current === index
      ? { ...point, value: point.value * multiplier }
      : { ...point },
  );
}
