import type {
  BurnScarDetectionResult,
  BurnScarMetrics,
  BurnScarScene,
} from "./types.js";

function validateScene(scene: BurnScarScene): void {
  const count = scene.width * scene.height;
  if (!Number.isInteger(scene.width) || scene.width <= 0) {
    throw new Error("Scene width must be a positive integer.");
  }
  if (!Number.isInteger(scene.height) || scene.height <= 0) {
    throw new Error("Scene height must be a positive integer.");
  }
  if (!Number.isFinite(scene.pixelSizeMeters) || scene.pixelSizeMeters <= 0) {
    throw new Error("Pixel size must be positive.");
  }

  const arrays = [
    scene.bands.blue,
    scene.bands.green,
    scene.bands.red,
    scene.bands.nir,
    scene.bands.swir1,
    scene.bands.swir2,
    scene.groundTruth,
  ];
  if (arrays.some((values) => values.length !== count)) {
    throw new Error("Every scene band and mask must equal width × height.");
  }
}

export function normalizedBurnRatio(nir: number, swir2: number): number {
  const denominator = nir + swir2;
  if (!Number.isFinite(nir) || !Number.isFinite(swir2) || denominator === 0) {
    return Number.NaN;
  }
  return (nir - swir2) / denominator;
}

export function calculateBurnScarMetrics(
  prediction: readonly number[],
  groundTruth: readonly number[],
  pixelSizeMeters: number,
): BurnScarMetrics {
  if (prediction.length !== groundTruth.length) {
    throw new Error("Prediction and ground-truth masks must align.");
  }

  let tp = 0;
  let tn = 0;
  let fp = 0;
  let fn = 0;

  for (let i = 0; i < groundTruth.length; i += 1) {
    const truth = groundTruth[i];
    const predicted = prediction[i];
    if (truth === -1) continue;
    if (truth !== 0 && truth !== 1) {
      throw new Error("Ground-truth mask may contain only -1, 0, or 1.");
    }
    if (predicted !== 0 && predicted !== 1) {
      throw new Error("Prediction mask may contain only 0 or 1.");
    }

    if (truth === 1 && predicted === 1) tp += 1;
    else if (truth === 0 && predicted === 0) tn += 1;
    else if (truth === 0 && predicted === 1) fp += 1;
    else fn += 1;
  }

  const validPixels = tp + tn + fp + fn;
  const union = tp + fp + fn;
  const predictedPositive = tp + fp;
  const actualPositive = tp + fn;
  const pixelHectares = (pixelSizeMeters * pixelSizeMeters) / 10_000;

  return {
    validPixels,
    burnPixelsGroundTruth: actualPositive,
    burnPixelsPredicted: predictedPositive,
    truePositive: tp,
    trueNegative: tn,
    falsePositive: fp,
    falseNegative: fn,
    iou: union === 0 ? 1 : tp / union,
    precision: predictedPositive === 0 ? (actualPositive === 0 ? 1 : 0) : tp / predictedPositive,
    recall: actualPositive === 0 ? 1 : tp / actualPositive,
    f1: 2 * tp + fp + fn === 0 ? 1 : (2 * tp) / (2 * tp + fp + fn),
    accuracy: validPixels === 0 ? 0 : (tp + tn) / validPixels,
    groundTruthHectares: actualPositive * pixelHectares,
    predictedHectares: predictedPositive * pixelHectares,
  };
}

export function runNbrBurnScarDetector(options: {
  scene: BurnScarScene;
  threshold?: number;
}): BurnScarDetectionResult {
  validateScene(options.scene);
  const threshold = options.threshold ?? 0;
  if (!Number.isFinite(threshold) || threshold < -1 || threshold > 1) {
    throw new Error("NBR threshold must be between -1 and 1.");
  }

  const prediction = options.scene.bands.nir.map((nir, index) => {
    const swir2 = options.scene.bands.swir2[index];
    if (swir2 === undefined) throw new Error("Missing SWIR2 value.");
    const nbr = normalizedBurnRatio(nir, swir2);
    return Number.isFinite(nbr) && nbr < threshold ? 1 : 0;
  });

  return {
    method: "nbr-threshold",
    threshold,
    sceneId: options.scene.sceneId,
    prediction,
    metrics: calculateBurnScarMetrics(
      prediction,
      options.scene.groundTruth,
      options.scene.pixelSizeMeters,
    ),
    provenance: {
      bandFormula: "(NIR - SWIR2) / (NIR + SWIR2)",
      burnRule: "NBR < threshold",
      ignoredGroundTruthValue: -1,
    },
  };
}
