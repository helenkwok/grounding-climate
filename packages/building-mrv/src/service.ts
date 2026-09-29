import {
  createRoutedModule,
} from "@climatechain/webmcp";
import type {
  ClimateModule,
  ModuleCommandRouter,
} from "@climatechain/webmcp";

import { runBuildingMrv } from "./analysis.js";
import {
  injectTamper,
} from "./anomaly.js";
import type {
  GridEmissionFactor,
  MeterPoint,
  PreparedBuildingDataset,
} from "./types.js";

export interface BuildingMrvServiceOptions {
  caseId: string;
  dataset: PreparedBuildingDataset;
  factor: GridEmissionFactor;
  trainingFraction?: number;
  anomalyThreshold?: number;
}

export class BuildingMrvService implements ModuleCommandRouter {
  private series: MeterPoint[];

  constructor(private readonly options: BuildingMrvServiceOptions) {
    this.series = options.dataset.meter.map((point) => ({ ...point }));
  }

  setSeries(series: readonly MeterPoint[]): void {
    this.series = series.map((point) => ({ ...point }));
  }

  resetSeries(): void {
    this.series = this.options.dataset.meter.map((point) => ({ ...point }));
  }

  tamper(index: number, multiplier: number): void {
    this.series = injectTamper(this.series, index, multiplier);
  }

  analysis() {
    return runBuildingMrv(
      this.series,
      this.options.factor,
      {
        ...(this.options.trainingFraction !== undefined
          ? { trainingFraction: this.options.trainingFraction }
          : {}),
        ...(this.options.anomalyThreshold !== undefined
          ? { anomalyThreshold: this.options.anomalyThreshold }
          : {}),
      },
    );
  }

  async execute(
    moduleId: string,
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    if (moduleId !== "building-mrv") {
      throw new Error("Unknown Building MRV module: " + moduleId);
    }

    const caseId = String(input.caseId ?? "");
    if (caseId !== this.options.caseId) {
      throw new Error('Unknown Building MRV case "' + caseId + '".');
    }

    switch (toolName) {
      case "building_get_meter_series": {
        const offset = Math.max(0, Number(input.offset ?? 0));
        const limit = Math.max(
          1,
          Math.min(1000, Number(input.limit ?? 168)),
        );
        return {
          buildingId: this.options.dataset.metadata.buildingId,
          offset,
          limit,
          total: this.series.length,
          points: this.series.slice(offset, offset + limit),
        };
      }

      case "building_run_baseline": {
        const analysis = this.analysis();
        return {
          method: analysis.baseline.method,
          split: analysis.baseline.split,
          metrics: analysis.baseline.metrics,
        };
      }

      case "building_detect_anomalies": {
        const analysis = this.analysis();
        return {
          method: analysis.anomalies.method,
          threshold: analysis.anomalies.threshold,
          flaggedCount: analysis.anomalies.flaggedCount,
          flaggedEnergyKWh: analysis.anomalies.flaggedEnergyKWh,
          points: analysis.anomalies.points
            .filter((point) => point.flagged)
            .slice(0, 100),
        };
      }

      case "building_reconstruct_emissions": {
        const analysis = this.analysis();
        return {
          factor: this.options.factor,
          emissions: analysis.emissions,
          reconciliation:
            analysis.anomalies.flaggedCount === 0
              ? "reconciled"
              : "not-reconciled",
        };
      }

      default:
        throw new Error('Unknown Building MRV tool "' + toolName + '".');
    }
  }
}

export function createBuildingMrvModule(
  service: BuildingMrvService,
): ClimateModule {
  return createRoutedModule({
    id: "building-mrv",
    title: "Building MRV",
    capabilities: [
      "building-meter-mrv",
      "carbon-recalculation",
    ],
    toolNames: [
      "building_get_meter_series",
      "building_detect_anomalies",
      "building_run_baseline",
      "building_reconstruct_emissions",
    ],
    router: service,
  });
}
