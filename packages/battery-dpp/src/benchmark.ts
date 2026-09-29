import type {
  DummyLifeBenchmark,
  DummyLifeMetrics,
  LifeLabelRecord,
} from "./types.js";

export interface BatteryLifeSplit {
  seed: 42 | 2021 | 2024;
  trainFiles: string[];
  testFiles: string[];
}

function baseName(value: string): string {
  return value.endsWith(".pkl") ? value : value + ".pkl";
}

function mean(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error("Cannot calculate a mean over an empty array.");
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdPopulation(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const avg = mean(values);
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - avg) ** 2, 0) /
      values.length,
  );
}

export function runDummyLifeSplit(options: {
  labels: readonly LifeLabelRecord[];
  split: BatteryLifeSplit;
}): DummyLifeMetrics {
  const labels = new Map(
    options.labels.map((row) => [baseName(row.batteryFile), row.lifeCycles]),
  );

  const training = options.split.trainFiles.map((name) => {
    const value = labels.get(baseName(name));
    if (value === undefined) {
      throw new Error("Missing training life label: " + name);
    }
    return value;
  });

  const testing = options.split.testFiles.map((name) => {
    const value = labels.get(baseName(name));
    if (value === undefined) {
      throw new Error("Missing testing life label: " + name);
    }
    return value;
  });

  const prediction = mean(training);
  const percentageErrors = testing.map(
    (actual) => Math.abs(prediction - actual) / actual,
  );
  const accuracyWithin15Percent =
    testing.filter(
      (actual) => Math.abs(prediction - actual) / actual <= 0.15,
    ).length / testing.length;

  return {
    seed: options.split.seed,
    trainCount: training.length,
    testCount: testing.length,
    trainMeanLifeCycles: prediction,
    mape: mean(percentageErrors),
    accuracyWithin15Percent,
  };
}

export function runCalbDummyBenchmark(options: {
  labels: readonly LifeLabelRecord[];
  splits: readonly BatteryLifeSplit[];
}): DummyLifeBenchmark {
  if (options.splits.length !== 3) {
    throw new Error("CALB benchmark expects the 42, 2021, and 2024 splits.");
  }

  const runs = options.splits
    .map((split) => runDummyLifeSplit({ labels: options.labels, split }))
    .sort((a, b) => a.seed - b.seed);

  const mapes = runs.map((run) => run.mape);
  const accuracies = runs.map((run) => run.accuracyWithin15Percent);

  return {
    dataset: "CALB",
    runs,
    meanMape: mean(mapes),
    stdMape: stdPopulation(mapes),
    meanAccuracyWithin15Percent: mean(accuracies),
    stdAccuracyWithin15Percent: stdPopulation(accuracies),
    published: {
      mapeMean: 1.811,
      mapeStd: 0.55,
      accuracyWithin15PercentMean: 0.267,
      accuracyWithin15PercentStd: 0.094,
    },
  };
}

export function compareDummyBenchmarkToPublished(
  benchmark: DummyLifeBenchmark,
): {
  mapeMeanDelta: number;
  mapeStdDelta: number;
  accuracyMeanDelta: number;
  accuracyStdDelta: number;
} {
  return {
    mapeMeanDelta: benchmark.meanMape - benchmark.published.mapeMean,
    mapeStdDelta: benchmark.stdMape - benchmark.published.mapeStd,
    accuracyMeanDelta:
      benchmark.meanAccuracyWithin15Percent -
      benchmark.published.accuracyWithin15PercentMean,
    accuracyStdDelta:
      benchmark.stdAccuracyWithin15Percent -
      benchmark.published.accuracyWithin15PercentStd,
  };
}
