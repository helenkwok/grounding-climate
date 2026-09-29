import type {
  EnergyPoint,
  EnergySeries,
  ForecastMetrics,
  ForecastResult,
  ForecastWindow,
} from "./types.js";

function validateSeries(series: EnergySeries): void {
  if (series.points.length < 2) {
    throw new Error("Energy series needs at least two points.");
  }
  let previous = Number.NEGATIVE_INFINITY;
  for (const point of series.points) {
    const time = Date.parse(point.timestamp);
    if (!Number.isFinite(time)) {
      throw new Error("Invalid timestamp: " + point.timestamp);
    }
    if (time <= previous) {
      throw new Error("Energy timestamps must be strictly increasing.");
    }
    if (!Number.isFinite(point.value)) {
      throw new Error("Energy values must be finite.");
    }
    previous = time;
  }
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function calculateMetrics(windows: readonly ForecastWindow[]): ForecastMetrics {
  const actual: number[] = [];
  const predicted: number[] = [];

  for (const window of windows) {
    actual.push(...window.actual.map((point) => point.value));
    predicted.push(...window.predicted.map((point) => point.value));
  }

  if (actual.length === 0 || actual.length !== predicted.length) {
    throw new Error("Forecast metrics require aligned predictions.");
  }

  const errors = actual.map((value, index) => {
    const prediction = predicted[index];
    if (prediction === undefined) throw new Error("Missing prediction.");
    return prediction - value;
  });

  const mae = mean(errors.map(Math.abs));
  const rmse = Math.sqrt(mean(errors.map((error) => error * error)));
  const mapeTerms = actual
    .map((value, index) => {
      const prediction = predicted[index];
      if (prediction === undefined || value === 0) return undefined;
      return Math.abs((prediction - value) / value);
    })
    .filter((value): value is number => value !== undefined);

  // Energy-EVA LOAD_ACC is computed per calendar day/instance:
  // 1 - min(RMSE(day) / (max(day)-min(day)), 1), then averaged.
  const days = new Map<string, Array<{ actual: number; predicted: number }>>();
  for (const window of windows) {
    for (let i = 0; i < window.actual.length; i += 1) {
      const actualPoint = window.actual[i];
      const predictedPoint = window.predicted[i];
      if (!actualPoint || !predictedPoint) continue;
      const day = actualPoint.timestamp.slice(0, 10);
      const values = days.get(day) ?? [];
      values.push({ actual: actualPoint.value, predicted: predictedPoint.value });
      days.set(day, values);
    }
  }

  const dailyScores: number[] = [];
  for (const values of days.values()) {
    const actualValues = values.map((value) => value.actual);
    const capacity = Math.max(...actualValues) - Math.min(...actualValues);
    if (capacity === 0) continue;
    const dayRmse = Math.sqrt(
      mean(values.map((value) => {
        const error = value.predicted - value.actual;
        return error * error;
      })),
    );
    dailyScores.push(1 - Math.min(dayRmse / capacity, 1));
  }

  return {
    loadAcc: dailyScores.length ? mean(dailyScores) : null,
    mae,
    rmse,
    mape: mapeTerms.length ? mean(mapeTerms) : null,
  };
}

export function runEnergyEvaDummy(options: {
  series: EnergySeries;
  horizon: number;
  cutoffs: number[];
  maxContextLength?: number;
}): ForecastResult {
  const { series, horizon } = options;
  validateSeries(series);

  if (!Number.isInteger(horizon) || horizon <= 0) {
    throw new Error("Forecast horizon must be a positive integer.");
  }

  const windows: ForecastWindow[] = [];

  for (const cutoffIndex of options.cutoffs) {
    if (!Number.isInteger(cutoffIndex)) {
      throw new Error("Cutoff indexes must be integers.");
    }
    if (cutoffIndex < horizon || cutoffIndex + horizon > series.points.length) {
      throw new Error("Cutoff does not have enough history/future.");
    }

    const contextStart = Math.max(
      0,
      cutoffIndex - (options.maxContextLength ?? cutoffIndex),
    );
    const context = series.points.slice(contextStart, cutoffIndex);
    const mostRecentCycle = context.slice(-horizon);
    if (mostRecentCycle.length !== horizon) {
      throw new Error("Context is shorter than forecast horizon.");
    }

    const actual = series.points.slice(cutoffIndex, cutoffIndex + horizon);
    const predicted = actual.map((point, index) => {
      const source = mostRecentCycle[index];
      if (!source) throw new Error("Missing dummy baseline source point.");
      return {
        timestamp: point.timestamp,
        value: source.value,
      };
    });

    windows.push({
      cutoffIndex,
      horizon,
      context,
      actual,
      predicted,
    });
  }

  return {
    method: "energy-eva-dummy",
    horizon,
    windows,
    metrics: calculateMetrics(windows),
    provenance: {
      implementation: "Energy-EVA dummy_model semantics",
      sourceRepository: "https://github.com/antgroup/Energy-EVA",
      sourcePath: "time_series_portal/evaluation_methods/dummy_methods.py",
    },
  };
}

export function runEnergyEvaDummyBenchmark(options: {
  series: readonly EnergySeries[];
  horizon: number;
  cutoffs: readonly number[];
  contextLength: number;
}): import("./types.js").EnergyEvaBenchmarkResult {
  if (options.series.length === 0) {
    throw new Error("Energy-EVA benchmark requires at least one series.");
  }
  if (!Number.isInteger(options.horizon) || options.horizon <= 0) {
    throw new Error("Energy-EVA benchmark horizon must be a positive integer.");
  }
  if (!Number.isInteger(options.contextLength) || options.contextLength < options.horizon) {
    throw new Error("Energy-EVA context length must be >= horizon.");
  }

  const cutoffs = options.cutoffs.map((cutoff) => {
    const instanceResults = options.series.map((series) => {
      validateSeries(series);
      const absoluteCutoff =
        cutoff < 0 ? series.points.length + cutoff : cutoff;

      const result = runEnergyEvaDummy({
        series,
        horizon: options.horizon,
        cutoffs: [absoluteCutoff],
        maxContextLength: options.contextLength,
      });
      const window = result.windows[0];
      if (!window) throw new Error("Energy-EVA benchmark produced no window.");
      return { result, window };
    });

    const actual: number[] = [];
    const predicted: number[] = [];
    const loadAcc: number[] = [];

    for (const item of instanceResults) {
      actual.push(...item.window.actual.map((point) => point.value));
      predicted.push(...item.window.predicted.map((point) => point.value));
      if (item.result.metrics.loadAcc !== null) {
        loadAcc.push(item.result.metrics.loadAcc);
      }
    }

    if (actual.length === 0 || actual.length !== predicted.length) {
      throw new Error("Energy-EVA benchmark produced unaligned values.");
    }

    const errors = actual.map((value, index) => {
      const prediction = predicted[index];
      if (prediction === undefined) throw new Error("Missing benchmark prediction.");
      return prediction - value;
    });
    const mapeTerms = actual.flatMap((value, index) => {
      const prediction = predicted[index];
      if (prediction === undefined || value === 0) return [];
      return [Math.abs((prediction - value) / value)];
    });

    return {
      cutoff,
      horizon: options.horizon,
      itemCount: instanceResults.length,
      metrics: {
        loadAcc: loadAcc.length ? mean(loadAcc) : null,
        mae: mean(errors.map(Math.abs)),
        rmse: Math.sqrt(mean(errors.map((error) => error * error))),
        mape: mapeTerms.length ? mean(mapeTerms) : null,
      },
    };
  });

  return {
    method: "energy-eva-dummy",
    horizon: options.horizon,
    contextLength: options.contextLength,
    cutoffs,
  };
}
