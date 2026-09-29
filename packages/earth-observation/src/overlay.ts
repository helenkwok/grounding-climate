import type { BurnScarDetectionResult, BurnScarScene } from "./types.js";

export type OverlayCode = -1 | 0 | 1 | 2 | 3;

export interface BurnScarOverlay {
  width: number;
  height: number;
  legend: {
    missing: -1;
    correctNotBurned: 0;
    trueBurn: 1;
    falseBurn: 2;
    missedBurn: 3;
  };
  pixels: OverlayCode[];
}

export function buildBurnScarOverlay(
  scene: BurnScarScene,
  result: BurnScarDetectionResult,
): BurnScarOverlay {
  if (result.prediction.length !== scene.groundTruth.length) {
    throw new Error("Prediction and ground truth must align.");
  }

  const pixels = scene.groundTruth.map((truth, index): OverlayCode => {
    const predicted = result.prediction[index];
    if (truth === -1) return -1;
    if (truth === 1 && predicted === 1) return 1;
    if (truth === 0 && predicted === 1) return 2;
    if (truth === 1 && predicted === 0) return 3;
    return 0;
  });

  return {
    width: scene.width,
    height: scene.height,
    legend: {
      missing: -1,
      correctNotBurned: 0,
      trueBurn: 1,
      falseBurn: 2,
      missedBurn: 3,
    },
    pixels,
  };
}
