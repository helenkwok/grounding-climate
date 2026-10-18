import {
  createRoutedModule,
} from "@grounding-climate/webmcp";
import type {
  ClimateModule,
  ModuleCommandRouter,
} from "@grounding-climate/webmcp";
import type { CryptoProvider, ReviewDecision } from "@grounding-climate/core";

import { buildEnergyActionCase } from "./action-case.js";
import type { EnergyActionInput, PublishedCutoff } from "./action-case.js";

import {
  runEnergyEvaDummy,
} from "./forecast.js";
import {
  digestEnergySeries,
} from "./integrity.js";
import {
  evaluateBoundedAction,
} from "./policy.js";
import type {
  BoundedActionPolicy,
  EnergySeries,
} from "./types.js";

export interface EnergyForecastServiceOptions {
  caseId: string;
  series: EnergySeries;
  provider: CryptoProvider;
  horizon?: number;
  cutoffs: number[];
  maxContextLength?: number;
  policy: BoundedActionPolicy;
}

export class EnergyForecastService implements ModuleCommandRouter {
  private series: EnergySeries;

  constructor(private readonly options: EnergyForecastServiceOptions) {
    this.series = structuredClone(options.series);
  }

  setSeries(series: EnergySeries): void {
    this.series = structuredClone(series);
  }

  forecast() {
    return runEnergyEvaDummy({
      series: this.series,
      horizon: this.options.horizon ?? 48,
      cutoffs: this.options.cutoffs,
      ...(this.options.maxContextLength !== undefined
        ? { maxContextLength: this.options.maxContextLength }
        : {}),
    });
  }

  async execute(
    moduleId: string,
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    if (moduleId !== "energy-forecast") {
      throw new Error("Unknown Energy Forecast module: " + moduleId);
    }
    if (String(input.caseId ?? "") !== this.options.caseId) {
      throw new Error('Unknown Energy Forecast case "' + input.caseId + '".');
    }

    switch (toolName) {
      case "energy_run_forecast": {
        const forecast = this.forecast();
        return {
          method: forecast.method,
          horizon: forecast.horizon,
          metrics: forecast.metrics,
          inputDigest: await digestEnergySeries(
            this.series,
            this.options.provider,
          ),
        };
      }
      case "energy_compare_baseline": {
        const forecast = this.forecast();
        return {
          local: forecast.metrics,
          publishedReference: {
            dataset: "active_power_load",
            baseline: "Energy-EVA dummy_model",
            contextLength: 512,
            note:
              "Use packages/energy-forecast/references/energy-eva-active-power-load.json for exact published rolling-window values.",
          },
        };
      }
      case "energy_prepare_bounded_action": {
        const requestedMWh = Number(input.requestedMWh);
        const confidence = Number(input.confidence);
        const actionType = String(input.actionType) as
          | "shift-load"
          | "charge-storage"
          | "discharge-storage";

        return evaluateBoundedAction(
          {
            actionType,
            requestedMWh,
            confidence,
            ...(typeof input.counterparty === "string"
              ? { counterparty: input.counterparty }
              : {}),
            forecastDigest: await digestEnergySeries(
              this.series,
              this.options.provider,
            ),
          },
          this.options.policy,
        );
      }
      default:
        throw new Error('Unknown Energy Forecast tool "' + toolName + '".');
    }
  }
}

export interface EnergyCaseServiceOptions {
  caseId: string;
  series: EnergySeries[];
  published: PublishedCutoff[];
  action: EnergyActionInput;
  provider: CryptoProvider;
  observedAt: string;
  /** Recorded approval decisions; with them the case is served as approved or rejected. */
  decisions?: ReviewDecision[];
}

/** The committed energy case: the multi-series benchmark, the operator's request and a person's approval. */
export class EnergyCaseService implements ModuleCommandRouter {
  private series: EnergySeries[];

  constructor(private readonly options: EnergyCaseServiceOptions) {
    this.series = structuredClone(options.series);
  }

  resetSeries(): void {
    this.series = structuredClone(this.options.series);
  }

  /** Multiplies one load value, as the recorded tamper run does. */
  tamperValue(itemIndex: number, pointIndex: number, multiplier: number): void {
    const point = this.series[itemIndex]?.points.at(pointIndex);
    if (!point) throw new Error("No load value at " + itemIndex + "/" + pointIndex + ".");
    point.value *= multiplier;
  }

  build() {
    return buildEnergyActionCase({
      caseId: this.options.caseId,
      createdAt: this.options.observedAt,
      series: this.series,
      published: this.options.published,
      action: this.options.action,
      provider: this.options.provider,
      decisions: this.options.decisions ?? [],
    });
  }

  async execute(
    moduleId: string,
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    if (moduleId !== "energy-forecast") {
      throw new Error("Unknown Energy Forecast module: " + moduleId);
    }
    if (String(input.caseId ?? "") !== this.options.caseId) {
      throw new Error('Unknown Energy Forecast case "' + input.caseId + '".');
    }
    const built = await this.build();
    switch (toolName) {
      case "energy_run_forecast":
        return { benchmark: built.benchmark, meanLoadAcc: built.confidence };
      case "energy_compare_baseline":
        return { comparisons: built.comparisons, published: this.options.published };
      case "energy_prepare_bounded_action": {
        const verification = built.caseBundle.verifications[0];
        return {
          result: verification?.result,
          action: built.action,
          approval: built.review.map(({ flag, state, decision }) => ({ flag: flag.id, state, decision: decision?.decision ?? null })),
          accountingBoundary: built.caseBundle.claims[1]?.boundary?.accounting,
          submitted: false,
        };
      }
      default:
        throw new Error('Unknown Energy Forecast tool "' + toolName + '".');
    }
  }
}

export function createEnergyForecastModule(
  service: ModuleCommandRouter,
): ClimateModule {
  return createRoutedModule({
    id: "energy-forecast",
    title: "Renewable / Load Forecasting",
    capabilities: ["renewable-forecasting"],
    toolNames: [
      "energy_run_forecast",
      "energy_compare_baseline",
      "energy_prepare_bounded_action",
    ],
    router: service,
  });
}
