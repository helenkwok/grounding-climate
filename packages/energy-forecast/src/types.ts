import type { ContentDigest } from "@grounding-climate/core";

export interface EnergyPoint {
  timestamp: string;
  value: number;
}

export interface EnergySeries {
  itemId: string;
  unit: string;
  stepMinutes: number;
  points: EnergyPoint[];
  source: {
    dataset: string;
    sourceUri: string;
    sourceManifestId: string;
    digest?: ContentDigest;
  };
}

export interface ForecastWindow {
  cutoffIndex: number;
  horizon: number;
  context: EnergyPoint[];
  actual: EnergyPoint[];
  predicted: EnergyPoint[];
}

export interface ForecastMetrics {
  loadAcc: number | null;
  mae: number;
  rmse: number;
  mape: number | null;
}

export interface ForecastResult {
  method: "energy-eva-dummy";
  horizon: number;
  windows: ForecastWindow[];
  metrics: ForecastMetrics;
  provenance: {
    implementation: "Energy-EVA dummy_model semantics";
    sourceRepository: "https://github.com/antgroup/Energy-EVA";
    sourcePath: "time_series_portal/evaluation_methods/dummy_methods.py";
  };
}

export interface PublishedBenchmarkReference {
  dataset: "active_power_load";
  model: string;
  horizon: 48;
  contextLength: number;
  cutoff: number;
  loadAcc: number;
  mae: number;
  rmse: number;
  mape: number;
  reproducedByGrounding: boolean;
  sourceRepository: string;
  sourcePath: string;
}

export interface BoundedActionPolicy {
  enabled: boolean;
  allowedActionTypes: Array<"shift-load" | "charge-storage" | "discharge-storage">;
  maxActionMWh: number;
  minimumConfidence: number;
  humanApprovalAboveMWh: number;
  allowedCounterparties: string[];
}

export interface BoundedActionRequest {
  actionType: "shift-load" | "charge-storage" | "discharge-storage";
  requestedMWh: number;
  confidence: number;
  counterparty?: string;
  forecastDigest: ContentDigest;
}

export interface BoundedActionDecision {
  permitted: boolean;
  requiresHumanApproval: boolean;
  approvedMWh: number;
  reasons: string[];
  request: BoundedActionRequest;
}

export interface EnergyEvaBenchmarkCutoffResult {
  cutoff: number;
  horizon: number;
  itemCount: number;
  metrics: ForecastMetrics;
}

export interface EnergyEvaBenchmarkResult {
  method: "energy-eva-dummy";
  horizon: number;
  contextLength: number;
  cutoffs: EnergyEvaBenchmarkCutoffResult[];
}
