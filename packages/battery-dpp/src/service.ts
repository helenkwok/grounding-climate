import {
  createRoutedModule,
} from "@grounding-climate/webmcp";
import type {
  ClimateModule,
  ModuleCommandRouter,
} from "@grounding-climate/webmcp";
import type { CryptoProvider, ReviewDecision } from "@grounding-climate/core";

import { runCalbDummyBenchmark } from "./benchmark.js";
import { estimateBatteryHealth } from "./health.js";
import { buildBatteryPassport } from "./passport.js";
import {
  decideBatteryDisposition,
  DEFAULT_BATTERY_PASSPORT_POLICY,
} from "./policy.js";
import type {
  BatteryHistory,
  BatteryPassportPolicy,
  LifeLabelRecord,
} from "./types.js";
import type { BatteryLifeSplit } from "./benchmark.js";

export interface BatteryDppServiceOptions {
  caseId: string;
  history: BatteryHistory;
  provider: CryptoProvider;
  observedAt: string;
  policy?: BatteryPassportPolicy;
  benchmarkLabels?: LifeLabelRecord[];
  benchmarkSplits?: BatteryLifeSplit[];
  /** Recorded sign-off decisions; with them the passport tool serves the signed-off case. */
  decisions?: ReviewDecision[];
}

export class BatteryDppService implements ModuleCommandRouter {
  private history: BatteryHistory;

  constructor(private readonly options: BatteryDppServiceOptions) {
    this.history = structuredClone(options.history);
  }

  setHistory(history: BatteryHistory): void {
    this.history = structuredClone(history);
  }

  resetHistory(): void {
    this.history = structuredClone(this.options.history);
  }

  /** Multiplies the capacity of the last recorded cycle, as the recorded tamper run does. */
  tamperLastCycle(multiplier: number): void {
    const last = this.history.cycles.at(-1);
    if (!last) throw new Error("Battery history is empty.");
    last.dischargeCapacityAh *= multiplier;
  }

  /** The passport case for the current history, with the recorded sign-off decisions. */
  passport() {
    return buildBatteryPassport({
      history: this.history,
      provider: this.options.provider,
      observedAt: this.options.observedAt,
      policy: this.options.policy ?? DEFAULT_BATTERY_PASSPORT_POLICY,
      decisions: this.options.decisions ?? [],
    });
  }

  health() {
    return estimateBatteryHealth({ history: this.history });
  }

  async execute(
    moduleId: string,
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    if (moduleId !== "battery-dpp") {
      throw new Error("Unknown Battery DPP module: " + moduleId);
    }
    if (String(input.caseId ?? "") !== this.options.caseId) {
      throw new Error('Unknown Battery DPP case "' + input.caseId + '".');
    }

    switch (toolName) {
      case "battery_predict_health":
        return this.health();

      case "battery_compare_baseline":
        if (!this.options.benchmarkLabels || !this.options.benchmarkSplits) {
          return {
            local: this.health(),
            publishedReference: {
              dataset: "CALB",
              benchmark: "BatteryLife Dummy",
              mape: "1.811±0.550",
              accuracyWithin15Percent: "0.267±0.094",
              reproducedByGrounding: false,
            },
          };
        }
        return runCalbDummyBenchmark({
          labels: this.options.benchmarkLabels,
          splits: this.options.benchmarkSplits,
        });

      case "battery_build_passport_claim": {
        const built = await this.passport();
        return {
          passport: built.passport,
          result: built.caseBundle.verifications[0]?.result,
          signOff: built.review,
          accountingBoundary: built.caseBundle.claims[0]?.boundary?.accounting,
          evidenceRoot: built.evidenceRoot.root,
        };
      }

      default:
        throw new Error('Unknown Battery DPP tool "' + toolName + '".');
    }
  }

  decision() {
    return decideBatteryDisposition(
      this.health(),
      this.options.policy ?? DEFAULT_BATTERY_PASSPORT_POLICY,
    );
  }
}

export function createBatteryDppModule(
  service: BatteryDppService,
): ClimateModule {
  return createRoutedModule({
    id: "battery-dpp",
    title: "Battery Digital Product Passport",
    capabilities: ["battery-dpp"],
    toolNames: [
      "battery_predict_health",
      "battery_compare_baseline",
      "battery_build_passport_claim",
    ],
    router: service,
  });
}
