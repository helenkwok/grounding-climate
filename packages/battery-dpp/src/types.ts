import type { ContentDigest } from "@climatechain/core";

export interface BatteryCycleCapacity {
  cycle: number;
  dischargeCapacityAh: number;
}

export interface BatteryHistory {
  batteryId: string;
  chemistry?: string;
  formFactor?: string;
  nominalCapacityAh: number;
  cycles: BatteryCycleCapacity[];
  source: {
    uri: string;
    sourceManifestId: string;
    dataset: string;
    datasetVersion?: string;
  };
}

export interface BatteryHealthEstimate {
  batteryId: string;
  observedCycle: number;
  currentCapacityAh: number;
  currentSoh: number;
  eolSohThreshold: number;
  capacitySlopeAhPerCycle: number;
  estimatedEolCycle: number | null;
  estimatedRulCycles: number | null;
  fit: {
    sampleCount: number;
    rSquared: number | null;
    startCycle: number;
    endCycle: number;
  };
  limitations: string[];
}

export interface BatteryPassportPolicy {
  reuseMinSoh: number;
  reuseMinRulCycles: number;
  repurposeMinSoh: number;
  minimumFitRSquared?: number;
}

export type BatteryDisposition =
  | "reuse"
  | "repurpose"
  | "service-review"
  | "retire-review";

export interface BatteryPassportDecision {
  disposition: BatteryDisposition;
  permitted: boolean;
  reasons: string[];
  policy: BatteryPassportPolicy;
}

export interface BatteryPassportClaim {
  version: "climatechain.battery-passport/0.1";
  batteryId: string;
  sourceDataset: string;
  chemistry?: string;
  formFactor?: string;
  nominalCapacityAh: number;
  observedCycle: number;
  currentSoh: number;
  estimatedRulCycles: number | null;
  disposition: BatteryDisposition;
  decisionReasons: string[];
  inputDigest?: ContentDigest;
  model: {
    id: "linear-capacity-rul";
    version: "battery-dpp/0.1";
    eolSohThreshold: number;
    fitRSquared: number | null;
  };
  caveat: string;
}

export interface LifeLabelRecord {
  batteryFile: string;
  lifeCycles: number;
}

export interface DummyLifeMetrics {
  seed: 42 | 2021 | 2024;
  trainCount: number;
  testCount: number;
  trainMeanLifeCycles: number;
  mape: number;
  accuracyWithin15Percent: number;
}

export interface DummyLifeBenchmark {
  dataset: "CALB";
  runs: DummyLifeMetrics[];
  meanMape: number;
  stdMape: number;
  meanAccuracyWithin15Percent: number;
  stdAccuracyWithin15Percent: number;
  published: {
    mapeMean: 1.811;
    mapeStd: 0.55;
    accuracyWithin15PercentMean: 0.267;
    accuracyWithin15PercentStd: 0.094;
  };
}
