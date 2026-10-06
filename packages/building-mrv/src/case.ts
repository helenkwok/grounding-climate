import {
  CLIMATECHAIN_SCHEMA_VERSION,
} from "@climatechain/core";
import type {
  ClimateCaseBundle,
  Evidence,
  ModelRun,
  NodeRef,
  Verification,
} from "@climatechain/core";

import { reviewVerification } from "@climatechain/core";
import type { CaseContext } from "@climatechain/core";

import { JEV_HAND_OFF } from "./advisory.js";
import { intervalFlag } from "./decisions.js";
import type { FlagStatus } from "./decisions.js";

import type {
  BuildingMrvAnalysis,
  GridEmissionFactor,
  PreparedBuildingDataset,
} from "./types.js";

export interface BuildBuildingCaseOptions {
  caseId: string;
  title?: string;
  createdAt: string;
  dataset: PreparedBuildingDataset;
  factor: GridEmissionFactor;
  analysis: BuildingMrvAnalysis;
  /** Current state of each flagged interval; without it every flag is undecided. */
  flagStatuses?: FlagStatus[];
  /** Advice model-runs. Recorded and referenced, never read by any check. */
  advice?: ModelRun[];
  /** Context evidence (e.g. modelled hazard), recorded with a finding, never read by any check. */
  context?: readonly CaseContext[];
}

function decisionVerification(
  statuses: readonly FlagStatus[],
  advice: readonly ModelRun[],
  createdAt: string,
): Verification {
  return reviewVerification({
    id: "verification:interval-decisions",
    profile: "building-mrv/interval-decisions/0.1",
    statuses: statuses.map((status) => ({
      flag: intervalFlag(status.timestamp),
      state: status.state,
      ...(status.decision
        ? {
            decision: {
              ...status.decision,
              flagId: intervalFlag(status.timestamp).id,
              inputDigest: status.decision.meterSeriesDigest,
            },
          }
        : {}),
    })),
    flagSource: { nodeType: "model-run", id: "model-run:hour-of-week-baseline", role: "flag-source" },
    adviceRefs: advice.map((run): NodeRef => ({ nodeType: "model-run", id: run.id, role: "advice-shown" })),
    createdAt,
    staleNote: "Stale: made on a different meter series. ",
    findings: [
      "A decision records what a person chose, not why the reading happened; the cause is not confirmed by site records.",
      "Advice is shown as a suggestion only at p(meter_fault) >= " + JEV_HAND_OFF.threshold + ", a threshold measured for a wrong exclusion costed at " + JEV_HAND_OFF.costRatio + " reviews (a policy choice); below it the flag needs a person. Either way a person decides.",
    ],
  });
}

function factorSourceEvidence(
  factor: GridEmissionFactor,
  createdAt: string,
): Evidence {
  return {
    nodeType: "evidence",
    id: "evidence:grid-factor-source",
    createdAt,
    provenance: [],
    kind: "calculation-input",
    source: {
      uri: factor.sourceUri,
      publisher: factor.sourceOrganisation,
      retrievedAt: factor.retrievedAt,
    },
    rights: {
      ...(factor.sourceManifestId
        ? { sourceManifestId: factor.sourceManifestId }
        : {}),
      redistribution: "unclear",
      attribution:
        factor.sourceOrganisation +
        "; retain the original factor source URL.",
    },
  };
}

export function buildBuildingMrvCase(
  options: BuildBuildingCaseOptions,
): ClimateCaseBundle {
  const {
    caseId,
    createdAt,
    dataset,
    factor,
    analysis,
  } = options;

  const flagged = analysis.anomalies.flaggedCount;
  const statuses: FlagStatus[] =
    options.flagStatuses ??
    analysis.anomalies.points
      .filter((point) => point.flagged)
      .map((point) => ({ timestamp: point.timestamp, state: "undecided" }));
  const open = statuses.filter((status) => status.state !== "decided");
  const needsReview = open.length > 0;
  const kept = statuses.filter((status) => status.decision?.decision === "keep" && status.state === "decided").length;
  const advice = options.advice ?? [];
  const decisions = flagged > 0 ? [decisionVerification(statuses, advice, createdAt)] : [];
  const firstMeter = dataset.meter[0];
  const lastMeter = dataset.meter.at(-1);
  if (!firstMeter || !lastMeter) {
    throw new Error("Building MRV case requires a non-empty meter series.");
  }

  const meterEvidence: Evidence = {
    nodeType: "evidence",
    id: "evidence:bdg2-electricity",
    createdAt,
    provenance: [],
    kind: "meter-data",
    source: {
      uri: dataset.source.zenodoRecord,
      localRef: "meter.csv",
      publisher: "Building Data Genome Project / BUDS Lab",
      retrievedAt: dataset.source.preparedAt,
    },
    integrity: {
      algorithm:
        (dataset.source.meterSeriesDigest ?? dataset.source.meterDigest)
          .algorithm,
      value:
        (dataset.source.meterSeriesDigest ?? dataset.source.meterDigest)
          .value,
    },
    extensions: {
      preparedMeterFileDigest:
        dataset.source.meterDigest.algorithm +
        ":" +
        dataset.source.meterDigest.value,
    },
    rights: {
      sourceManifestId: "bdg2",
      licence: "CC-BY-SA-4.0",
      termsUri:
        "https://github.com/buds-lab/building-data-genome-project-2/blob/master/LICENSE",
      redistribution: "allowed",
      commercialUse: "allowed",
      derivedData: "allowed",
      attribution:
        "Building Data Genome Project 2 / BUDS Lab, CC-BY-SA-4.0.",
    },
    temporalCoverage: {
      start: firstMeter.timestamp,
      end: lastMeter.timestamp,
    },
  };

  return {
    schemaVersion: CLIMATECHAIN_SCHEMA_VERSION,
    caseId,
    title:
      options.title ??
      "Building MRV — " + dataset.metadata.buildingId,
    capabilities: [
      "building-meter-mrv",
      "carbon-recalculation",
      "claim-reconciliation",
      "pq-attestation",
    ],
    createdAt,
    claims: [
      {
        nodeType: "claim",
        id: "claim:building-electricity-emissions",
        createdAt,
        provenance: [
          {
            nodeType: "calculation",
            id: "calculation:electricity-emissions",
            role: "derived-by",
          },
        ],
        subject: {
          id: "building:" + dataset.metadata.buildingId,
          kind: "asset",
          name: dataset.metadata.buildingId,
        },
        assertion: {
          kind: "quantitative",
          metric: "Location-based electricity emissions",
          quantity: {
            value: analysis.emissions.emissionsTCo2e,
            unit: "tCO2e",
          },
        },
        temporalScope: {
          start: firstMeter.timestamp,
          end: lastMeter.timestamp,
        },
        boundary: {
          scopes: ["Scope 2"],
          methodology:
            "Accepted electricity kWh multiplied by a traced location-based grid factor.",
          notes:
            "Flagged meter intervals are excluded from the accepted measurement set and reported separately.",
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
            dimension: "factor-traced",
            state: "confirmed",
            assessedAt: createdAt,
          },
          {
            dimension: "evidence-integrity-confirmed",
            state: "confirmed",
            assessedAt: createdAt,
          },
          {
            dimension: "disputed",
            state: needsReview ? "challenged" : "not-applicable",
            assessedAt: createdAt,
            note: needsReview
              ? open.length + " of " + flagged + " flagged meter intervals have no current decision."
              : flagged > 0
                ? "All " + flagged + " flagged intervals decided by a person; decided is not explained."
                : "No intervals failed the configured anomaly screen.",
          },
        ],
      },
    ],
    evidence: [
      meterEvidence,
      factorSourceEvidence(factor, createdAt),
      ...(options.context ?? []).map((item) => item.evidence),
    ],
    calculations: [
      {
        nodeType: "calculation",
        id: "calculation:electricity-emissions",
        createdAt,
        provenance: [
          {
            nodeType: "evidence",
            id: "evidence:bdg2-electricity",
            role: "accepted-activity-data",
          },
          {
            nodeType: "factor",
            id: "factor:grid-electricity",
            role: "emission-factor",
          },
        ],
        method: {
          id: "electricity-location-based",
          name: "Electricity activity data × location-based grid factor",
          version: "0.1",
        },
        parameters: {
          anomalyMethod: analysis.anomalies.method,
          anomalyThreshold: analysis.anomalies.threshold,
          excludedEnergyKWh: analysis.emissions.excludedEnergyKWh,
          acceptedEnergyKWh: analysis.emissions.acceptedEnergyKWh,
        },
        output: {
          kind: "quantitative",
          metric: "Location-based electricity emissions",
          quantity: {
            value: analysis.emissions.emissionsTCo2e,
            unit: "tCO2e",
          },
        },
        executedAt: createdAt,
        reproducibility: {
          codeVersion: "building-mrv/0.1",
        },
      },
    ],
    factors: [
      {
        nodeType: "factor",
        id: "factor:grid-electricity",
        createdAt,
        provenance: [
          {
            nodeType: "evidence",
            id: "evidence:grid-factor-source",
            role: "published-source",
          },
        ],
        factorType: "grid-electricity",
        value: factor.valueKgCo2ePerKwh,
        unit: "kgCO2e/kWh",
        geography: factor.geography,
        ...(factor.effectivePeriod
          ? { effectivePeriod: factor.effectivePeriod }
          : {}),
        sourceOrganisation: factor.sourceOrganisation,
        sourceDocument: factor.sourceDocument ?? factor.sourceUri,
        method: "location-based",
        accountingBasis: "location-based",
        retrievedAt: factor.retrievedAt,
      },
    ],
    modelRuns: [
      ...advice,
      {
        nodeType: "model-run",
        id: "model-run:hour-of-week-baseline",
        createdAt,
        provenance: [
          {
            nodeType: "evidence",
            id: "evidence:bdg2-electricity",
            role: "meter-series",
          },
        ],
        model: {
          id: "hour-of-week-mean",
          name: "Hour-of-week mean baseline",
          version: "0.1",
        },
        preprocessingVersion: "building-mrv/0.1",
        inferenceParameters: {
          trainingRows: analysis.baseline.split.trainingRows,
          testRows: analysis.baseline.split.testRows,
        },
        output: {
          kind: "quantitative",
          metric: "Temporal holdout RMSLE",
          quantity: {
            value: analysis.baseline.metrics.rmsle,
            unit: "RMSLE",
          },
        },
        benchmark: {
          metric: "RMSLE",
          value: analysis.baseline.metrics.rmsle,
          splitRef:
            analysis.baseline.split.trainingEnd +
            " -> " +
            analysis.baseline.split.testStart,
          notes:
            "ClimateChain local baseline; do not confuse with the published ALDI++ GEPIII results.",
        },
        executedAt: createdAt,
        reproducibility: {
          codeVersion: "building-mrv/0.1",
        },
      },
    ],
    verifications: [
      {
        nodeType: "verification",
        id: "verification:building-mrv",
        createdAt,
        provenance: [
          {
            nodeType: "claim",
            id: "claim:building-electricity-emissions",
            role: "claim-under-review",
          },
          {
            nodeType: "model-run",
            id: "model-run:hour-of-week-baseline",
            role: "baseline-check",
          },
          ...decisions.map((node): NodeRef => ({
            nodeType: "verification",
            id: node.id,
            role: "human-decisions",
          })),
        ],
        verifier: {
          id: "service:climatechain-building-mrv",
          kind: "service",
          name: "ClimateChain Building MRV",
        },
        profile: "building-mrv/0.1",
        result: needsReview ? "insufficient-evidence" : "reconciled",
        checks: [
          {
            id: "temporal-holdout",
            name: "Temporal baseline evaluated",
            outcome: "pass",
            detail:
              "RMSLE=" +
              analysis.baseline.metrics.rmsle.toFixed(6) +
              "; MAE=" +
              analysis.baseline.metrics.mae.toFixed(6),
          },
          {
            id: "anomaly-screen",
            name: "Meter anomaly screen",
            outcome: needsReview ? "warn" : "pass",
            detail:
              flagged +
              " interval(s) flagged; " +
              (flagged - open.length) +
              " decided (" +
              kept +
              " kept), " +
              open.length +
              " without a current decision; " +
              analysis.emissions.excludedEnergyKWh.toFixed(3) +
              " kWh excluded from accepted activity data.",
          },
          {
            id: "factor-provenance",
            name: "Emission factor source recorded",
            outcome: "pass",
            detail:
              factor.valueKgCo2ePerKwh +
              " kgCO2e/kWh; " +
              factor.geography +
              "; " +
              factor.sourceUri,
          },
        ],
        findings: (needsReview
          ? [
              "The current meter series contains intervals outside the configured robust residual threshold.",
              "The emissions claim is not reconciled until a person decides each flagged interval on this meter series.",
            ]
          : flagged > 0
            ? [
                "Every flagged interval has a current decision by a person; the claim uses those decisions.",
                "Decided is not resolved: the cause of each flagged reading is not confirmed by site records.",
              ]
            : [
                "The current meter series passed the configured residual anomaly screen.",
              ]).concat((options.context ?? []).map((item) => item.finding)),
        verifiedAt: createdAt,
      },
      ...decisions,
    ],
    attestations: [],
    anchors: [],
    extensions: {
      primaryUser: "building/facility energy manager",
      buildingId: dataset.metadata.buildingId,
      siteId: dataset.metadata.siteId,
      flaggedIntervals: analysis.anomalies.flaggedCount,
      acceptedEnergyMWh: analysis.emissions.acceptedEnergyMWh,
    },
  };
}
