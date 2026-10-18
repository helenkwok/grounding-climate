import type { ContentDigest } from "@grounding-climate/core";

export interface MeterPoint {
  timestamp: string;
  value: number;
}

export interface WeatherPoint {
  timestamp: string;
  airTemperature: number;
}

export interface BuildingMetadata {
  buildingId: string;
  siteId: string;
  primarySpaceUsage?: string;
  floorAreaM2?: number;
  timezone?: string;
  latitude?: number;
  longitude?: number;
  climateZone?: string;
}

export interface PreparedBuildingDataset {
  metadata: BuildingMetadata;
  meter: MeterPoint[];
  weather?: WeatherPoint[];
  source: {
    sourceManifestId: "bdg2";
    zenodoRecord: string;
    doi: string;
    archiveName: string;
    publishedArchiveMd5: string;
    meterMember: string;
    metadataMember: string;
    weatherMember: string;
    preparedAt: string;
    meterDigest: ContentDigest;
    meterSeriesDigest?: ContentDigest;
    metadataDigest: ContentDigest;
    weatherDigest?: ContentDigest;
  };
}

export interface TemporalSplit {
  trainingEndIndex: number;
  trainingRows: number;
  testRows: number;
  trainingStart: string;
  trainingEnd: string;
  testStart: string;
  testEnd: string;
}

export interface BaselinePrediction {
  timestamp: string;
  actual: number;
  predicted: number;
  residual: number;
}

export interface BaselineMetrics {
  rmsle: number;
  mae: number;
}

export interface BaselineResult {
  method: "hour-of-week-mean";
  split: TemporalSplit;
  metrics: BaselineMetrics;
  predictions: BaselinePrediction[];
  fallbackMean: number;
}

export interface AnomalyPoint {
  timestamp: string;
  value: number;
  predicted: number;
  residual: number;
  robustZ: number;
  flagged: boolean;
  /** Why the reading was flagged; empty when it was not. */
  reasons: Array<"residual" | "zero" | "constant-run">;
}

export interface AnomalyResult {
  method: "baseline-residual-mad" | "baseline-residual-mad+stuck-readings";
  threshold: number;
  /** Shortest run of identical hourly readings that is flagged; absent when runs are not screened. */
  minRunHours?: number;
  center: number;
  robustScale: number;
  flaggedCount: number;
  flaggedEnergyKWh: number;
  points: AnomalyPoint[];
}

export interface ClassificationMetrics {
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
  precision: number | null;
  recall: number | null;
  specificity: number | null;
  f1: number | null;
}

export interface GridEmissionFactor {
  id: string;
  valueKgCo2ePerKwh: number;
  geography: string;
  sourceOrganisation: string;
  sourceUri: string;
  sourceDocument?: string;
  retrievedAt: string;
  effectivePeriod?: {
    start?: string;
    end?: string;
    label?: string;
  };
  sourceManifestId?: string;
}

export interface EmissionsResult {
  acceptedEnergyKWh: number;
  acceptedEnergyMWh: number;
  excludedEnergyKWh: number;
  factorKgCo2ePerKwh: number;
  emissionsKgCo2e: number;
  emissionsTCo2e: number;
}

export interface BuildingMrvAnalysis {
  baseline: BaselineResult;
  anomalies: AnomalyResult;
  emissions: EmissionsResult;
}
