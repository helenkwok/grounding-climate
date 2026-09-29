import {
  canonicalBytes,
  domainSeparatedBytes,
} from "@climatechain/core";
import type {
  ContentDigest,
  CryptoProvider,
} from "@climatechain/core";

import type {
  BurnScarDetectionResult,
  BurnScarScene,
} from "./types.js";

export async function digestBurnScarImage(
  scene: BurnScarScene,
  provider: CryptoProvider,
): Promise<ContentDigest> {
  return provider.hash(
    domainSeparatedBytes(
      "climatechain.earth-observation.image",
      "earth-observation/0.1",
      {
        sceneId: scene.sceneId,
        width: scene.width,
        height: scene.height,
        pixelSizeMeters: scene.pixelSizeMeters,
        bands: scene.bands,
        source: scene.source,
      },
    ),
    "SHA-256",
  );
}

export async function digestBurnScarGroundTruth(
  scene: BurnScarScene,
  provider: CryptoProvider,
): Promise<ContentDigest> {
  return provider.hash(
    domainSeparatedBytes(
      "climatechain.earth-observation.ground-truth",
      "earth-observation/0.1",
      {
        sceneId: scene.sceneId,
        width: scene.width,
        height: scene.height,
        mask: scene.groundTruth,
      },
    ),
    "SHA-256",
  );
}

export async function digestBurnScarScene(
  scene: BurnScarScene,
  provider: CryptoProvider,
): Promise<ContentDigest> {
  return provider.hash(
    domainSeparatedBytes(
      "climatechain.earth-observation.scene-bundle",
      "earth-observation/0.1",
      scene,
    ),
    "SHA-256",
  );
}

export async function digestBurnScarPrediction(
  result: BurnScarDetectionResult,
  provider: CryptoProvider,
): Promise<ContentDigest> {
  return provider.hash(
    canonicalBytes({
      method: result.method,
      threshold: result.threshold,
      sceneId: result.sceneId,
      prediction: result.prediction,
      metrics: result.metrics,
    }),
    "SHA-256",
  );
}
