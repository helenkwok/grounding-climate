import {
  createRoutedModule,
} from "@climatechain/webmcp";
import type {
  ClimateModule,
  ModuleCommandRouter,
} from "@climatechain/webmcp";
import type { CryptoProvider } from "@climatechain/core";

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

export function createEnergyForecastModule(
  service: EnergyForecastService,
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
