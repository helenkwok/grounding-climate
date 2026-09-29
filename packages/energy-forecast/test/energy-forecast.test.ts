import assert from "node:assert/strict";
import test from "node:test";

import {
  createEvidenceRoot,
  verifyEvidenceRoot,
} from "@climatechain/core";
import {
  InMemoryNodeCryptoProvider,
} from "@climatechain/crypto-node";

import {
  EnergyForecastService,
  buildEnergyForecastCase,
  createEnergyForecastModule,
  digestEnergySeries,
  evaluateBoundedAction,
  runEnergyEvaDummy,
} from "../src/index.js";
import type {
  BoundedActionPolicy,
  EnergySeries,
} from "../src/index.js";

function hourlySeries(days = 30): EnergySeries {
  const start = Date.UTC(2025, 0, 1, 0, 0, 0);
  const count = days * 24;
  return {
    itemId: "active-power-test",
    unit: "MW",
    stepMinutes: 60,
    points: Array.from({ length: count }, (_, index) => {
      const hour = index % 24;
      const day = Math.floor(index / 24);
      return {
        timestamp: new Date(start + index * 60 * 60 * 1000)
          .toISOString()
          .replace(".000Z", "Z"),
        value: 1000 + hour * 10 + (day % 7) * 5,
      };
    }),
    source: {
      dataset: "active_power_load",
      sourceUri: "https://data.mendeley.com/datasets/jxm8d4w4cv/1",
      sourceManifestId: "energy-eva-active-power-load",
    },
  };
}

const policy: BoundedActionPolicy = {
  enabled: true,
  allowedActionTypes: ["shift-load", "charge-storage", "discharge-storage"],
  maxActionMWh: 2,
  minimumConfidence: 0.75,
  humanApprovalAboveMWh: 0.5,
  allowedCounterparties: ["microgrid:battery-1"],
};

test("Energy-EVA dummy baseline copies the immediately preceding horizon", () => {
  const series = hourlySeries();
  const result = runEnergyEvaDummy({
    series,
    horizon: 48,
    cutoffs: [series.points.length - 48],
    maxContextLength: 512,
  });

  const window = result.windows[0];
  assert.ok(window);
  assert.deepEqual(
    window.predicted.map((point) => point.value),
    series.points
      .slice(series.points.length - 96, series.points.length - 48)
      .map((point) => point.value),
  );
});

test("Energy-EVA metric implementation produces finite LOAD_ACC, MAE and RMSE", () => {
  const series = hourlySeries();
  const result = runEnergyEvaDummy({
    series,
    horizon: 48,
    cutoffs: [
      series.points.length - 48 * 5,
      series.points.length - 48 * 4,
      series.points.length - 48 * 3,
      series.points.length - 48 * 2,
      series.points.length - 48,
    ],
    maxContextLength: 512,
  });

  assert.equal(result.windows.length, 5);
  assert.ok(result.metrics.loadAcc !== null);
  assert.ok(Number.isFinite(result.metrics.loadAcc));
  assert.ok(Number.isFinite(result.metrics.mae));
  assert.ok(Number.isFinite(result.metrics.rmse));
});

test("bounded action policy caps MWh and requires approval at threshold", async () => {
  const provider = new InMemoryNodeCryptoProvider();
  const digest = await digestEnergySeries(hourlySeries(), provider);

  const decision = evaluateBoundedAction(
    {
      actionType: "charge-storage",
      requestedMWh: 5,
      confidence: 0.9,
      counterparty: "microgrid:battery-1",
      forecastDigest: digest,
    },
    policy,
  );

  assert.equal(decision.permitted, true);
  assert.equal(decision.approvedMWh, 2);
  assert.equal(decision.requiresHumanApproval, true);
  assert.ok(decision.reasons.some((reason) => reason.includes("capped")));
});

test("bounded action policy refuses low confidence and unlisted counterparty", async () => {
  const provider = new InMemoryNodeCryptoProvider();
  const digest = await digestEnergySeries(hourlySeries(), provider);

  const decision = evaluateBoundedAction(
    {
      actionType: "shift-load",
      requestedMWh: 1,
      confidence: 0.5,
      counterparty: "market:unknown",
      forecastDigest: digest,
    },
    policy,
  );

  assert.equal(decision.permitted, false);
  assert.equal(decision.approvedMWh, 0);
  assert.equal(decision.requiresHumanApproval, false);
  assert.equal(decision.reasons.length, 2);
});

test("kill switch refuses an otherwise valid action", async () => {
  const provider = new InMemoryNodeCryptoProvider();
  const digest = await digestEnergySeries(hourlySeries(), provider);

  const decision = evaluateBoundedAction(
    {
      actionType: "discharge-storage",
      requestedMWh: 0.25,
      confidence: 0.95,
      counterparty: "microgrid:battery-1",
      forecastDigest: digest,
    },
    { ...policy, enabled: false },
  );

  assert.equal(decision.permitted, false);
  assert.ok(decision.reasons.some((reason) => reason.includes("kill switch")));
});

test("input change produces a different forecast evidence root", async () => {
  const provider = new InMemoryNodeCryptoProvider();
  const clean = hourlySeries();
  const cleanForecast = runEnergyEvaDummy({
    series: clean,
    horizon: 48,
    cutoffs: [clean.points.length - 48],
    maxContextLength: 512,
  });
  const cleanDigest = await digestEnergySeries(clean, provider);
  const cleanCase = buildEnergyForecastCase({
    caseId: "case:energy:test",
    createdAt: "2026-09-29T00:00:00Z",
    series: clean,
    inputDigest: cleanDigest,
    forecast: cleanForecast,
  });
  const cleanRoot = await createEvidenceRoot(
    cleanCase,
    [{ nodeType: "verification", id: "verification:energy-forecast" }],
    provider,
  );

  const changed = structuredClone(clean);
  const last = changed.points.at(-1);
  assert.ok(last);
  last.value *= 3;

  const changedForecast = runEnergyEvaDummy({
    series: changed,
    horizon: 48,
    cutoffs: [changed.points.length - 48],
    maxContextLength: 512,
  });
  const changedDigest = await digestEnergySeries(changed, provider);
  const changedCase = buildEnergyForecastCase({
    caseId: "case:energy:test",
    createdAt: "2026-09-29T00:00:00Z",
    series: changed,
    inputDigest: changedDigest,
    forecast: changedForecast,
  });

  assert.notEqual(changedDigest.value, cleanDigest.value);

  const verification = await verifyEvidenceRoot(
    changedCase,
    cleanRoot,
    provider,
  );
  assert.equal(verification.currentEvidenceMatches, false);
  assert.ok(
    verification.changedRefs.some(
      (ref) => ref.id === "evidence:energy-series",
    ),
  );
});

test("Energy WebMCP tools use the same forecast and policy service", async () => {
  const provider = new InMemoryNodeCryptoProvider();
  const series = hourlySeries();
  const service = new EnergyForecastService({
    caseId: "case:energy:test",
    series,
    provider,
    horizon: 48,
    cutoffs: [series.points.length - 48],
    maxContextLength: 512,
    policy,
  });
  const module = createEnergyForecastModule(service);

  assert.deepEqual(
    module.tools.map((tool) => tool.name).sort(),
    [
      "energy_compare_baseline",
      "energy_prepare_bounded_action",
      "energy_run_forecast",
    ],
  );

  const forecast = await service.execute(
    "energy-forecast",
    "energy_run_forecast",
    { caseId: "case:energy:test" },
  ) as { horizon: number; metrics: { mae: number } };
  assert.equal(forecast.horizon, 48);
  assert.ok(Number.isFinite(forecast.metrics.mae));

  const action = await service.execute(
    "energy-forecast",
    "energy_prepare_bounded_action",
    {
      caseId: "case:energy:test",
      actionType: "charge-storage",
      requestedMWh: 1,
      confidence: 0.9,
      counterparty: "microgrid:battery-1",
    },
  ) as { permitted: boolean; requiresHumanApproval: boolean };

  assert.equal(action.permitted, true);
  assert.equal(action.requiresHumanApproval, true);
});
