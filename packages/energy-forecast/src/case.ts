import {
  GROUNDING_SCHEMA_VERSION,
} from "@grounding-climate/core";
import type {
  ClimateCaseBundle,
  ContentDigest,
} from "@grounding-climate/core";

import type {
  BoundedActionDecision,
  EnergySeries,
  ForecastResult,
} from "./types.js";

export function buildEnergyForecastCase(options: {
  caseId: string;
  createdAt: string;
  series: EnergySeries;
  inputDigest: ContentDigest;
  forecast: ForecastResult;
  action?: BoundedActionDecision;
  model?: {
    id: string;
    name: string;
    version: string;
    benchmarkLoadAcc?: number;
  };
}): ClimateCaseBundle {
  const { series, forecast, createdAt } = options;
  const first = series.points[0];
  const last = series.points.at(-1);
  if (!first || !last) throw new Error("Energy case requires a non-empty series.");

  const model = options.model ?? {
    id: "energy-eva-dummy",
    name: "Energy-EVA dummy_model",
    version: "Energy-EVA-2.0-semantics",
  };

  const action = options.action;
  const actionFailed = action ? !action.permitted : false;

  return {
    schemaVersion: GROUNDING_SCHEMA_VERSION,
    caseId: options.caseId,
    title: "Energy forecast — " + series.itemId,
    capabilities: [
      "renewable-forecasting",
      "claim-reconciliation",
      "pq-attestation",
    ],
    createdAt,
    claims: [
      {
        nodeType: "claim",
        id: "claim:energy-forecast-quality",
        createdAt,
        provenance: [
          {
            nodeType: "model-run",
            id: "model-run:energy-forecast",
            role: "measured-by",
          },
        ],
        subject: {
          id: "energy-series:" + series.itemId,
          kind: "dataset",
          name: series.itemId,
        },
        assertion: {
          kind: "quantitative",
          metric: "Energy-EVA LOAD_ACC",
          quantity: {
            value: forecast.metrics.loadAcc ?? 0,
            unit: "LOAD_ACC",
          },
        },
        temporalScope: {
          start: first.timestamp,
          end: last.timestamp,
        },
        assessments: [
          {
            dimension: "source-found",
            state: "confirmed",
            assessedAt: createdAt,
          },
          {
            dimension: "calculation-reproduced",
            state: "confirmed",
            assessedAt: createdAt,
          },
          {
            dimension: "evidence-integrity-confirmed",
            state: "confirmed",
            assessedAt: createdAt,
          },
        ],
      },
    ],
    evidence: [
      {
        nodeType: "evidence",
        id: "evidence:energy-series",
        createdAt,
        provenance: [],
        kind: "dataset",
        source: {
          uri: series.source.sourceUri,
          publisher: "Energy-EVA / upstream dataset publisher",
          retrievedAt: createdAt,
        },
        integrity: options.inputDigest,
        rights: {
          sourceManifestId: series.source.sourceManifestId,
          redistribution: "unclear",
          attribution:
            "Retain Energy-EVA and original upstream dataset attribution.",
        },
        temporalCoverage: {
          start: first.timestamp,
          end: last.timestamp,
        },
      },
    ],
    calculations: [],
    factors: [],
    modelRuns: [
      {
        nodeType: "model-run",
        id: "model-run:energy-forecast",
        createdAt,
        provenance: [
          {
            nodeType: "evidence",
            id: "evidence:energy-series",
            role: "forecast-input",
          },
        ],
        model: {
          id: model.id,
          name: model.name,
          version: model.version,
        },
        inputDigest: options.inputDigest,
        preprocessingVersion: "energy-forecast/0.1",
        inferenceParameters: {
          horizon: forecast.horizon,
          windowCount: forecast.windows.length,
          method: forecast.method,
        },
        output: {
          kind: "quantitative",
          metric: "Energy-EVA LOAD_ACC",
          quantity: {
            value: forecast.metrics.loadAcc ?? 0,
            unit: "LOAD_ACC",
          },
        },
        ...(model.benchmarkLoadAcc !== undefined
          ? {
              benchmark: {
                metric: "LOAD_ACC",
                value: forecast.metrics.loadAcc ?? 0,
                baselineValue: model.benchmarkLoadAcc,
                notes:
                  "Published Energy-EVA reference is retained separately from locally reproduced metrics.",
              },
            }
          : {}),
        executedAt: createdAt,
        reproducibility: {
          codeVersion: "energy-forecast/0.1",
        },
      },
    ],
    verifications: [
      {
        nodeType: "verification",
        id: "verification:energy-forecast",
        createdAt,
        provenance: [
          {
            nodeType: "claim",
            id: "claim:energy-forecast-quality",
            role: "claim-under-review",
          },
          {
            nodeType: "model-run",
            id: "model-run:energy-forecast",
            role: "forecast-run",
          },
        ],
        verifier: {
          id: "service:grounding-energy-forecast",
          kind: "service",
          name: "Grounding Energy Forecast",
        },
        profile: "energy-forecast/0.1",
        result: actionFailed ? "mismatch" : "reconciled",
        checks: [
          {
            id: "forecast-executed",
            name: "Forecast benchmark executed",
            outcome: "pass",
            detail:
              "LOAD_ACC=" +
              String(forecast.metrics.loadAcc) +
              "; MAE=" +
              forecast.metrics.mae,
          },
          ...(action
            ? [
                {
                  id: "bounded-action-policy",
                  name: "Bounded action policy",
                  outcome: action.permitted ? "pass" as const : "fail" as const,
                  detail:
                    "approvedMWh=" +
                    action.approvedMWh +
                    "; humanApproval=" +
                    action.requiresHumanApproval +
                    "; reasons=" +
                    action.reasons.join(" | "),
                },
              ]
            : []),
        ],
        findings: actionFailed
          ? ["The requested operational action was refused by deterministic policy."]
          : [],
        verifiedAt: createdAt,
      },
    ],
    attestations: [],
    anchors: [],
    extensions: {
      primaryUser: "microgrid operator",
      forecastMAE: forecast.metrics.mae,
      forecastRMSE: forecast.metrics.rmse,
      ...(action
        ? {
            boundedActionPermitted: action.permitted,
            boundedActionMWh: action.approvedMWh,
          }
        : {}),
    },
  };
}
