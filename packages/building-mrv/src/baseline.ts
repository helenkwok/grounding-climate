import type {
  BaselineMetrics,
  BaselinePrediction,
  BaselineResult,
  MeterPoint,
  TemporalSplit,
} from "./types.js";

function slotOf(timestamp: string): number {
  const normalized = timestamp.includes("T")
    ? timestamp
    : timestamp.replace(" ", "T") + "Z";
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid timestamp: " + timestamp);
  }
  return date.getUTCDay() * 24 + date.getUTCHours();
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function rmsle(
  actual: readonly number[],
  predicted: readonly number[],
): number {
  if (actual.length !== predicted.length || actual.length === 0) {
    throw new Error("RMSLE requires equal non-empty arrays.");
  }

  let squared = 0;
  for (let index = 0; index < actual.length; index += 1) {
    const a = actual[index];
    const p = predicted[index];
    if (a === undefined || p === undefined || a < 0 || p < 0) {
      throw new Error("RMSLE requires non-negative finite values.");
    }
    const delta = Math.log1p(p) - Math.log1p(a);
    squared += delta * delta;
  }

  return Math.sqrt(squared / actual.length);
}

export function mae(
  actual: readonly number[],
  predicted: readonly number[],
): number {
  if (actual.length !== predicted.length || actual.length === 0) {
    throw new Error("MAE requires equal non-empty arrays.");
  }

  let total = 0;
  for (let index = 0; index < actual.length; index += 1) {
    const a = actual[index];
    const p = predicted[index];
    if (a === undefined || p === undefined) {
      throw new Error("MAE arrays are incomplete.");
    }
    total += Math.abs(a - p);
  }
  return total / actual.length;
}

export interface HourOfWeekModel {
  slotMean: ReadonlyMap<number, number>;
  fallbackMean: number;
}

export function fitHourOfWeekMean(
  training: readonly MeterPoint[],
): HourOfWeekModel {
  if (training.length < 168) {
    throw new Error(
      "Hour-of-week baseline requires at least 168 training rows.",
    );
  }

  const buckets = new Map<number, number[]>();
  for (const point of training) {
    const slot = slotOf(point.timestamp);
    const bucket = buckets.get(slot) ?? [];
    bucket.push(point.value);
    buckets.set(slot, bucket);
  }

  const slotMean = new Map<number, number>();
  for (const [slot, values] of buckets) {
    slotMean.set(slot, mean(values));
  }

  return {
    slotMean,
    fallbackMean: mean(training.map((point) => point.value)),
  };
}

export function predictPoint(
  model: HourOfWeekModel,
  point: MeterPoint,
): number {
  return model.slotMean.get(slotOf(point.timestamp)) ?? model.fallbackMean;
}

export function createTemporalSplit(
  series: readonly MeterPoint[],
  trainingFraction = 0.8,
): TemporalSplit {
  if (
    !Number.isFinite(trainingFraction) ||
    trainingFraction <= 0 ||
    trainingFraction >= 1
  ) {
    throw new Error("trainingFraction must be between 0 and 1.");
  }
  if (series.length < 336) {
    throw new Error(
      "Temporal baseline requires at least 336 hourly observations.",
    );
  }

  const trainingEndIndex = Math.max(
    168,
    Math.min(series.length - 1, Math.floor(series.length * trainingFraction)),
  );
  const train = series.slice(0, trainingEndIndex);
  const test = series.slice(trainingEndIndex);

  const firstTrain = train[0];
  const lastTrain = train.at(-1);
  const firstTest = test[0];
  const lastTest = test.at(-1);
  if (!firstTrain || !lastTrain || !firstTest || !lastTest) {
    throw new Error("Temporal split produced an empty partition.");
  }

  return {
    trainingEndIndex,
    trainingRows: train.length,
    testRows: test.length,
    trainingStart: firstTrain.timestamp,
    trainingEnd: lastTrain.timestamp,
    testStart: firstTest.timestamp,
    testEnd: lastTest.timestamp,
  };
}

export function runHourOfWeekBaseline(
  series: readonly MeterPoint[],
  trainingFraction = 0.8,
): BaselineResult {
  const split = createTemporalSplit(series, trainingFraction);
  const training = series.slice(0, split.trainingEndIndex);
  const test = series.slice(split.trainingEndIndex);
  const model = fitHourOfWeekMean(training);

  const predictions: BaselinePrediction[] = test.map((point) => {
    const predicted = predictPoint(model, point);
    return {
      timestamp: point.timestamp,
      actual: point.value,
      predicted,
      residual: point.value - predicted,
    };
  });

  const metrics: BaselineMetrics = {
    rmsle: rmsle(
      predictions.map((point) => point.actual),
      predictions.map((point) => point.predicted),
    ),
    mae: mae(
      predictions.map((point) => point.actual),
      predictions.map((point) => point.predicted),
    ),
  };

  return {
    method: "hour-of-week-mean",
    split,
    metrics,
    predictions,
    fallbackMean: model.fallbackMean,
  };
}
