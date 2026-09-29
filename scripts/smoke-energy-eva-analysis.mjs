import { readFile } from "node:fs/promises";

import {
  runEnergyEvaDummyBenchmark,
} from "../packages/energy-forecast/dist/src/index.js";

const dataPath = process.argv[2];
if (!dataPath) {
  throw new Error("Usage: node scripts/smoke-energy-eva-analysis.mjs <series.json>");
}

const input = JSON.parse(await readFile(dataPath, "utf8"));
const reference = JSON.parse(
  await readFile(
    new URL(
      "../packages/energy-forecast/references/energy-eva-active-power-load.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

const result = runEnergyEvaDummyBenchmark({
  series: input.series,
  horizon: 48,
  cutoffs: [-240, -192, -144, -96, -48],
  contextLength: 512,
});

const published = new Map(
  reference.energyEva.publishedResults
    .filter((row) => row.model === "dummy_model")
    .map((row) => [row.cutoff, row]),
);

const comparisons = result.cutoffs.map((row) => {
  const expected = published.get(row.cutoff);
  if (!expected) throw new Error("Missing published cutoff " + row.cutoff);

  const delta = {
    loadAcc: row.metrics.loadAcc - expected.loadAcc,
    mae: row.metrics.mae - expected.mae,
    mape: row.metrics.mape - expected.mape,
    rmse: row.metrics.rmse - expected.rmse,
  };

  const withinTolerance =
    Math.abs(delta.loadAcc) < 1e-6 &&
    Math.abs(delta.mae) < 1e-3 &&
    Math.abs(delta.mape) < 1e-6 &&
    Math.abs(delta.rmse) < 1e-3;

  if (!withinTolerance) {
    throw new Error(
      "Energy-EVA dummy reproduction mismatch at cutoff " +
        row.cutoff +
        ": " +
        JSON.stringify(delta),
    );
  }

  return {
    cutoff: row.cutoff,
    reproduced: row.metrics,
    published: {
      loadAcc: expected.loadAcc,
      mae: expected.mae,
      mape: expected.mape,
      rmse: expected.rmse,
    },
    delta,
    withinTolerance,
  };
});

console.log(
  "CLIMATECHAIN_ENERGY_EVA_REPRODUCTION=" +
    JSON.stringify({
      dataset: "active_power_load",
      horizonHours: 48,
      contextLength: 512,
      itemCount: input.series.length,
      comparisons,
      reproducedAll: comparisons.every((row) => row.withinTolerance),
    }),
);
