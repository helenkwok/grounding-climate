import type { CaseContext, CryptoProvider, ReviewDecision } from "@climatechain/core";
import {
  createRoutedModule,
} from "@climatechain/webmcp";
import type {
  ClimateModule,
  ModuleCommandRouter,
} from "@climatechain/webmcp";

import { buildBurnScarCase } from "./case.js";
import { runNbrBurnScarDetector } from "./detector.js";
import {
  digestBurnScarGroundTruth,
  digestBurnScarImage,
  digestBurnScarPrediction,
} from "./integrity.js";
import { buildBurnScarOverlay } from "./overlay.js";
import { buildEarthReviewCase } from "./review-case.js";
import type { AreaPolicy, HlsSceneArrays } from "./review-case.js";
import type {
  BurnScarMetrics,
  BurnScarScene,
  PublishedBurnScarReference,
} from "./types.js";

export interface EarthObservationServiceOptions {
  caseId: string;
  scene: BurnScarScene;
  provider: CryptoProvider;
  threshold?: number;
  publishedReference?: PublishedBurnScarReference;
}

export class EarthObservationService implements ModuleCommandRouter {
  private scene: BurnScarScene;

  constructor(private readonly options: EarthObservationServiceOptions) {
    this.scene = structuredClone(options.scene);
  }

  setScene(scene: BurnScarScene): void {
    this.scene = structuredClone(scene);
  }

  detect() {
    return runNbrBurnScarDetector({
      scene: this.scene,
      ...(this.options.threshold !== undefined
        ? { threshold: this.options.threshold }
        : {}),
    });
  }

  async caseBundle() {
    const result = this.detect();
    const [imageDigest, groundTruthDigest, predictionDigest] =
      await Promise.all([
        digestBurnScarImage(this.scene, this.options.provider),
        digestBurnScarGroundTruth(this.scene, this.options.provider),
        digestBurnScarPrediction(result, this.options.provider),
      ]);

    return buildBurnScarCase({
      caseId: this.options.caseId,
      createdAt: new Date().toISOString(),
      scene: this.scene,
      imageDigest,
      groundTruthDigest,
      predictionDigest,
      result,
      ...(this.options.publishedReference
        ? { publishedReference: this.options.publishedReference }
        : {}),
    });
  }

  async execute(
    moduleId: string,
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    if (moduleId !== "earth-observation") {
      throw new Error("Unknown Earth Observation module: " + moduleId);
    }
    if (String(input.caseId ?? "") !== this.options.caseId) {
      throw new Error('Unknown Earth Observation case "' + input.caseId + '".');
    }

    switch (toolName) {
      case "earth_run_detector": {
        const result = this.detect();
        return {
          method: result.method,
          threshold: result.threshold,
          sceneId: result.sceneId,
          metrics: result.metrics,
          inputDigest: await digestBurnScarImage(
            this.scene,
            this.options.provider,
          ),
          outputDigest: await digestBurnScarPrediction(
            result,
            this.options.provider,
          ),
        };
      }
      case "earth_compare_ground_truth": {
        const result = this.detect();
        return {
          sceneId: result.sceneId,
          metrics: result.metrics,
          overlay: buildBurnScarOverlay(this.scene, result),
          publishedReference: this.options.publishedReference ?? null,
          limitations: [
            "The NBR threshold is a CPU baseline and is not Prithvi.",
            "The source dataset uses a random train/validation split; this does not establish held-out geographic generalisation.",
          ],
        };
      }
      case "earth_get_scene_provenance":
        return this.caseBundle();
      default:
        throw new Error('Unknown Earth Observation tool "' + toolName + '".');
    }
  }
}

export function createEarthObservationModule(
  service: ModuleCommandRouter,
): ClimateModule {
  return createRoutedModule({
    id: "earth-observation",
    title: "Earth Observation",
    capabilities: ["earth-observation"],
    toolNames: [
      "earth_run_detector",
      "earth_compare_ground_truth",
      "earth_get_scene_provenance",
    ],
    router: service,
  });
}

export interface EarthCaseServiceOptions {
  caseId: string;
  scene: HlsSceneArrays;
  pinned: BurnScarMetrics;
  policy: AreaPolicy;
  provider: CryptoProvider;
  observedAt: string;
  decisions?: readonly ReviewDecision[];
  publishedPrithviIoU?: number;
  context?: readonly CaseContext[];
}

/** Serves the earth review case from the committed scene arrays; the arrays can be changed to show a tamper. */
export class EarthCaseService implements ModuleCommandRouter {
  private nir: Float32Array;

  constructor(private readonly options: EarthCaseServiceOptions) {
    this.nir = Float32Array.from(options.scene.nir);
  }

  resetScene(): void {
    this.nir = Float32Array.from(this.options.scene.nir);
  }

  /** Sets one NIR value; the pinned run and any decision no longer match. */
  setNir(index: number, value: number): void {
    this.nir[index] = value;
  }

  build() {
    return buildEarthReviewCase({
      caseId: this.options.caseId,
      createdAt: this.options.observedAt,
      scene: { ...this.options.scene, nir: this.nir },
      pinned: this.options.pinned,
      policy: this.options.policy,
      provider: this.options.provider,
      decisions: this.options.decisions ?? [],
      ...(this.options.context ? { context: this.options.context } : {}),
      ...(this.options.publishedPrithviIoU !== undefined ? { publishedPrithviIoU: this.options.publishedPrithviIoU } : {}),
    });
  }

  async execute(moduleId: string, toolName: string, input: Record<string, unknown>): Promise<unknown> {
    if (moduleId !== "earth-observation") throw new Error("Unknown Earth Observation module: " + moduleId);
    if (String(input.caseId ?? "") !== this.options.caseId) {
      throw new Error('Unknown Earth Observation case "' + input.caseId + '".');
    }
    const built = await this.build();
    const { metrics } = built.result;
    const verification = built.caseBundle.verifications[0]!;
    switch (toolName) {
      case "earth_run_detector":
        return {
          method: built.result.method,
          threshold: built.result.threshold,
          sceneId: built.result.sceneId,
          metrics,
          inputDigest: built.caseBundle.modelRuns[0]!.inputDigest,
          reproducedPinnedRun: built.reproduced,
        };
      case "earth_compare_ground_truth":
        return {
          sceneId: built.result.sceneId,
          // Pixel-level overlay codes are not returned: 262,144 values. The counts are the overlay's totals.
          overlayCounts: {
            trueBurn: metrics.truePositive,
            falseBurn: metrics.falsePositive,
            missedBurn: metrics.falseNegative,
            correctNotBurned: metrics.trueNegative,
          },
          areaGap: built.areaGap,
          areaDecision: built.review.map(({ flag, state, decision }) => ({ flag: flag.id, state, decision: decision ?? null })),
          result: verification.result,
          accountingBoundary: built.caseBundle.claims[0]!.boundary?.accounting ?? null,
          publishedPrithviIoU: this.options.publishedPrithviIoU ?? null,
        };
      case "earth_get_scene_provenance":
        return built.caseBundle;
      default:
        throw new Error('Unknown Earth Observation tool "' + toolName + '".');
    }
  }
}
