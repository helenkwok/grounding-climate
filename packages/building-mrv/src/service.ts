import {
  createRoutedModule,
} from "@climatechain/webmcp";
import type {
  ClimateModule,
  ModuleCommandRouter,
} from "@climatechain/webmcp";

import type { CryptoProvider, ModelRun } from "@climatechain/core";

import { runBuildingMrv } from "./analysis.js";
import { buildDecidedBuildingCase } from "./decided-case.js";
import type { IntervalDecision } from "./decisions.js";
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
  /** Recorded advice and decisions; with them the service serves the decided case. */
  review?: {
    createdAt: string;
    advice: ModelRun[];
    decisions: IntervalDecision[];
    hashProvider: CryptoProvider;
  };
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

  /** The decided case for the current series. Needs the review option. */
  async decidedCase() {
    const review = this.options.review;
    if (!review) throw new Error("This Building MRV service has no recorded review.");
    return buildDecidedBuildingCase({
      caseId: this.options.caseId,
      createdAt: review.createdAt,
      dataset: this.options.dataset,
      meter: this.series,
      factor: this.options.factor,
      advice: review.advice,
      decisions: review.decisions,
      hashProvider: review.hashProvider,
    });
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
        if (this.options.review) {
          const decided = await this.decidedCase();
          return {
            factor: this.options.factor,
            emissions: decided.analysis.emissions,
            reconciliation: decided.climateCase.verifications[0]?.result,
          };
        }
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

      case "building_review_flags": {
        const decided = await this.decidedCase();
        const advice = this.options.review?.advice ?? [];
        return {
          meterSeriesDigest: decided.digest,
          result: decided.climateCase.verifications[0]?.result,
          note: "Advice is recorded and shown; it never sets a status. A decision is not an explanation of the cause.",
          flags: decided.statuses.map((status) => {
            const run = advice.find((item) => item.inferenceParameters.interval === status.timestamp);
            return {
              timestamp: status.timestamp,
              state: status.state,
              decision: status.decision ?? null,
              advice: run
                ? { modelRun: run.id, model: run.model.version, output: run.output, confidence: run.confidence, handOff: run.extensions?.handOff ?? null }
                : null,
            };
          }),
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
      "building_review_flags",
    ],
    router: service,
  });
}
