import type { ContentDigest } from "@climatechain/core";

export interface SpectralBands {
  blue: number[];
  green: number[];
  red: number[];
  nir: number[];
  swir1: number[];
  swir2: number[];
}

export interface BurnScarScene {
  sceneId: string;
  width: number;
  height: number;
  pixelSizeMeters: number;
  bands: SpectralBands;
  groundTruth: number[];
  source: {
    dataset: "hls_burn_scars" | string;
    uri: string;
    sourceManifestId: string;
    acquiredAt?: string;
    geography?: string;
  };
}

export interface BurnScarMetrics {
  validPixels: number;
  burnPixelsGroundTruth: number;
  burnPixelsPredicted: number;
  truePositive: number;
  trueNegative: number;
  falsePositive: number;
  falseNegative: number;
  iou: number;
  precision: number;
  recall: number;
  f1: number;
  accuracy: number;
  groundTruthHectares: number;
  predictedHectares: number;
}

export interface BurnScarDetectionResult {
  method: "nbr-threshold";
  threshold: number;
  sceneId: string;
  prediction: number[];
  metrics: BurnScarMetrics;
  inputDigest?: ContentDigest;
  outputDigest?: ContentDigest;
  provenance: {
    bandFormula: "(NIR - SWIR2) / (NIR + SWIR2)";
    burnRule: "NBR < threshold";
    ignoredGroundTruthValue: -1;
  };
}

export interface PublishedBurnScarReference {
  model: string;
  dataset: string;
  burnClassIoU: number;
  overallAccuracy: number;
  source: string;
  locallyReproduced: boolean;
}
