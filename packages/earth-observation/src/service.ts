import type { CryptoProvider } from "@climatechain/core";
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
import type {
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
  service: EarthObservationService,
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
