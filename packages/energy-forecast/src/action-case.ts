// The energy case: a forecast benchmark recomputed from the committed Energy-EVA series and checked against
// Energy-EVA's published values, then an operator's load-shift request checked by a coded policy that takes
// the measured forecast quality as its confidence. When the policy asks for approval, a person decides.
import {
  canonicalBytes,
  GROUNDING_SCHEMA_VERSION,
  reviewStatuses,
  reviewVerification,
} from "@grounding-climate/core";
import type {
  ClimateCaseBundle,
  ContentDigest,
  CryptoProvider,
  ReviewDecision,
  ReviewFlag,
  ReviewStatus,
} from "@grounding-climate/core";

import { runEnergyEvaDummyBenchmark } from "./forecast.js";
import { evaluateBoundedAction } from "./policy.js";
import type {
  BoundedActionDecision,
  BoundedActionPolicy,
  BoundedActionRequest,
  EnergyEvaBenchmarkResult,
  EnergySeries,
  ForecastMetrics,
} from "./types.js";

/** Energy-EVA's published values for one rolling window. */
export interface PublishedCutoff {
  model: string;
  cutoff: number;
  loadAcc: number;
  mae: number;
  mape: number;
  rmse: number;
}

/** The operator's request and the policy that bounds it, before the forecast supplies the confidence. */
export interface EnergyActionInput {
  request: Omit<BoundedActionRequest, "confidence" | "forecastDigest">;
  policy: BoundedActionPolicy;
}

/** "approve" accepts the policy's capped amount; "reject" refuses the action. */
export type ActionDecision = "approve" | "reject";

export const ENERGY_CUTOFFS = [-240, -192, -144, -96, -48];
const TOLERANCE: ForecastMetrics = { loadAcc: 1e-6, mae: 1e-3, mape: 1e-6, rmse: 1e-3 };

export function actionFlag(): ReviewFlag {
  return { id: "action:bounded-action", label: "Approval of the policy-capped load action" };
}

export async function digestEnergySeriesSet(
  series: readonly EnergySeries[],
  provider: CryptoProvider,
): Promise<ContentDigest> {
  return provider.hash(
    canonicalBytes(
      series.map(({ itemId, unit, stepMinutes, points }) => ({ itemId, unit, stepMinutes, points })),
    ),
    "SHA-256",
  );
}

export async function buildEnergyActionCase(options: {
  caseId: string;
  createdAt: string;
  series: readonly EnergySeries[];
  published: readonly PublishedCutoff[];
  action: EnergyActionInput;
  provider: CryptoProvider;
  decisions?: readonly ReviewDecision[];
}): Promise<{
  caseBundle: ClimateCaseBundle;
  benchmark: EnergyEvaBenchmarkResult;
  comparisons: Array<{ cutoff: number; reproduced: boolean }>;
  confidence: number;
  action: BoundedActionDecision;
  review: ReviewStatus[];
  actionInputDigest: ContentDigest;
}> {
  const { createdAt, provider } = options;
  const benchmark = runEnergyEvaDummyBenchmark({
    series: options.series,
    horizon: 48,
    cutoffs: ENERGY_CUTOFFS,
    contextLength: 512,
  });
  const comparisons = benchmark.cutoffs.map((row) => {
    const expected = options.published.find((item) => item.model === "dummy_model" && item.cutoff === row.cutoff);
    const reproduced =
      !!expected &&
      (["loadAcc", "mae", "mape", "rmse"] as const).every(
        (key) => Math.abs((row.metrics[key] ?? NaN) - expected[key]) < (TOLERANCE[key] as number),
      );
    return { cutoff: row.cutoff, reproduced };
  });
  const baselineReproduced = comparisons.every((row) => row.reproduced);
  const confidence =
    benchmark.cutoffs.reduce((sum, row) => sum + (row.metrics.loadAcc ?? 0), 0) / benchmark.cutoffs.length;

  const seriesDigest = await digestEnergySeriesSet(options.series, provider);
  const publishedDigest = await provider.hash(canonicalBytes(options.published), "SHA-256");
  const action = evaluateBoundedAction(
    { ...options.action.request, confidence, forecastDigest: seriesDigest },
    options.action.policy,
  );
  // The approval is bound to everything the person looked at: the series, the request and the policy.
  const actionInputDigest = await provider.hash(
    canonicalBytes({ series: seriesDigest, request: options.action.request, policy: options.action.policy }),
    "SHA-256",
  );
  const flags = action.requiresHumanApproval ? [actionFlag()] : [];
  const review = reviewStatuses(flags, options.decisions ?? [], actionInputDigest);
  const approval = review[0]?.state === "decided" ? review[0].decision : undefined;
  const decided = review.every((status) => status.state === "decided");

  const request = options.action.request;
  const policy = options.action.policy;
  const starts = options.series.map((item) => item.points[0]?.timestamp ?? "").sort();
  const ends = options.series.map((item) => item.points.at(-1)?.timestamp ?? "").sort();
  const temporalScope = { start: starts[0] ?? createdAt, end: ends.at(-1) ?? createdAt };
  const rows = options.series.reduce((sum, item) => sum + item.points.length, 0);

  const ids = {
    series: "evidence:energy-series-set",
    published: "evidence:energy-eva-published",
    request: "evidence:energy-action-request",
    run: "model-run:energy-forecast-benchmark",
    quality: "claim:energy-forecast-quality",
    actionClaim: "claim:energy-bounded-action",
    verification: "verification:energy-forecast",
    review: "verification:action-approval",
  };
  const outcome = !action.permitted
    ? "refused by policy"
    : !action.requiresHumanApproval
      ? "permitted without approval"
      : approval
        ? (approval.decision === "approve" ? "approved" : "rejected") + " by " + approval.decidedBy
        : review[0]?.state === "stale"
          ? "approval stale"
          : "awaiting approval";
  const result =
    !baselineReproduced || !action.permitted ? "mismatch" : decided ? "reconciled" : "insufficient-evidence";

  const caseBundle: ClimateCaseBundle = {
    schemaVersion: GROUNDING_SCHEMA_VERSION,
    caseId: options.caseId,
    title: "Energy forecast and bounded load action — Energy-EVA active power load",
    capabilities: ["renewable-forecasting", "claim-reconciliation", "pq-attestation"],
    createdAt,
    claims: [
      {
        nodeType: "claim",
        id: ids.quality,
        createdAt,
        provenance: [{ nodeType: "model-run", id: ids.run, role: "measured-by" }],
        subject: { id: "energy-series:active_power_load", kind: "dataset", name: "Energy-EVA active power load" },
        assertion: {
          kind: "quantitative",
          metric: "Energy-EVA LOAD_ACC, mean of 5 rolling 48-hour windows",
          quantity: { value: confidence, unit: "LOAD_ACC" },
        },
        temporalScope,
        boundary: {
          methodology: "Energy-EVA dummy_model (repeat the previous 48 hours) scored with Energy-EVA's LOAD_ACC.",
          accounting: {
            included: [
              "All " + options.series.length + " standardised series (" + rows + " hourly values)",
              "The last 5 rolling 48-hour windows of each series",
            ],
            excluded: ["Energy-EVA's other datasets and models"],
            policyChoices: ["Horizon 48 hours, context 512 hours and cut-offs " + ENERGY_CUTOFFS.join(", ") + ", as in Energy-EVA's load task"],
            notAssessed: ["Whether a better forecast model would change the action", "Avoided emissions"],
          },
        },
        assessments: [
          { dimension: "source-found", state: "confirmed", assessedAt: createdAt },
          { dimension: "calculation-reproduced", state: baselineReproduced ? "confirmed" : "failed", assessedAt: createdAt },
          { dimension: "evidence-integrity-confirmed", state: "confirmed", assessedAt: createdAt },
        ],
      },
      {
        nodeType: "claim",
        id: ids.actionClaim,
        createdAt,
        provenance: [
          { nodeType: "claim", id: ids.quality, role: "confidence" },
          { nodeType: "evidence", id: ids.request, role: "request" },
        ],
        subject: { id: "action:" + request.actionType, kind: "other", name: "Bounded " + request.actionType },
        assertion: {
          kind: "qualitative",
          statement:
            request.actionType + " of " + request.requestedMWh + " MWh requested; policy allows " +
            action.approvedMWh + " MWh; " + outcome + ".",
        },
        boundary: {
          methodology: "A coded policy checks the request; a person approves amounts at or above the approval threshold.",
          accounting: {
            included: ["The request: " + request.actionType + ", " + request.requestedMWh + " MWh, counterparty " + (request.counterparty ?? "none")],
            excluded: ["Submitting the action to a market or dispatching hardware: Grounding prepares, it does not act"],
            policyChoices: [
              "Cap " + policy.maxActionMWh + " MWh; approval at or above " + policy.humanApprovalAboveMWh + " MWh",
              "Minimum confidence " + policy.minimumConfidence + ", with the forecast's mean LOAD_ACC as the confidence",
              "Allowed actions " + policy.allowedActionTypes.join(", ") + "; counterparties " + policy.allowedCounterparties.join(", "),
            ],
            notAssessed: [
              "Whether the action reduces emissions",
              "Grid constraints and the counterparty's ability to deliver",
            ],
          },
        },
        assessments: [{ dimension: "source-found", state: "confirmed", assessedAt: createdAt }],
      },
    ],
    evidence: [
      {
        nodeType: "evidence",
        id: ids.series,
        createdAt,
        provenance: [],
        kind: "dataset",
        source: { uri: "https://zenodo.org/records/17099628", publisher: "Energy-EVA (EnergyTS TimeSeries Dataset)", retrievedAt: createdAt },
        integrity: seriesDigest,
        access: { mode: "committed", instructions: "data/external/energy-eva-active-power-load" },
        rights: {
          sourceManifestId: "energy-eva-active-power-load",
          licence: "CC-BY-4.0",
          redistribution: "allowed",
          commercialUse: "allowed",
          derivedData: "allowed",
          attribution: "EnergyTS TimeSeries Dataset (doi:10.5281/zenodo.17099628); original data Veeramsetty et al., doi:10.17632/jxm8d4w4cv.1.",
        },
        temporalCoverage: temporalScope,
      },
      {
        nodeType: "evidence",
        id: ids.published,
        createdAt,
        provenance: [],
        kind: "report",
        source: {
          uri: "https://github.com/antgroup/Energy-EVA",
          localRef: "packages/energy-forecast/references/energy-eva-active-power-load.json",
          publisher: "Energy-EVA",
          retrievedAt: createdAt,
        },
        integrity: publishedDigest,
        access: { mode: "committed", instructions: "packages/energy-forecast/references/energy-eva-active-power-load.json" },
      },
      {
        nodeType: "evidence",
        id: ids.request,
        createdAt,
        provenance: [],
        kind: "other",
        source: { localRef: "reports/energy-forecast/action-request.json", retrievedAt: createdAt },
        integrity: actionInputDigest,
        access: { mode: "committed", instructions: "reports/energy-forecast/action-request.json" },
      },
    ],
    calculations: [],
    factors: [],
    modelRuns: [
      {
        nodeType: "model-run",
        id: ids.run,
        createdAt,
        provenance: [{ nodeType: "evidence", id: ids.series, role: "forecast-input" }],
        model: { id: "energy-eva-dummy", name: "Energy-EVA dummy_model", version: "Energy-EVA-2.0-semantics" },
        inputDigest: seriesDigest,
        preprocessingVersion: "energy-forecast/0.1",
        inferenceParameters: { horizon: 48, contextLength: 512, cutoffs: ENERGY_CUTOFFS.join(",") },
        output: { kind: "quantitative", metric: "mean LOAD_ACC", quantity: { value: confidence, unit: "LOAD_ACC" } },
        benchmark: {
          metric: "LOAD_ACC",
          value: confidence,
          notes: "Each window compared with Energy-EVA's published dummy_model result.",
        },
        executedAt: createdAt,
        reproducibility: { codeVersion: "energy-forecast/0.1" },
      },
    ],
    verifications: [
      {
        nodeType: "verification",
        id: ids.verification,
        createdAt,
        provenance: [
          { nodeType: "claim", id: ids.actionClaim, role: "claim-under-review" },
          { nodeType: "evidence", id: ids.published, role: "published-reference" },
          { nodeType: "verification", id: ids.review, role: "human-decisions" },
        ],
        verifier: { id: "service:grounding-energy-forecast", kind: "service", name: "Grounding Energy Forecast" },
        profile: "energy-forecast/0.2",
        result,
        checks: [
          {
            id: "baseline-reproduced",
            name: "Energy-EVA's published dummy_model results reproduced",
            outcome: baselineReproduced ? "pass" : "fail",
            detail: comparisons.map((row) => row.cutoff + ": " + (row.reproduced ? "match" : "differs")).join("; "),
          },
          {
            id: "bounded-action-policy",
            name: "Bounded action policy",
            outcome: action.permitted ? "pass" : "fail",
            detail:
              "confidence " + confidence.toFixed(4) + "; allowed " + action.approvedMWh + " MWh" +
              (action.reasons.length ? "; " + action.reasons.join(" ") : ""),
          },
          {
            id: "action-approval",
            name: "Action approved by a person",
            outcome: !action.requiresHumanApproval || approval ? "pass" : "warn",
            detail: !action.requiresHumanApproval
              ? "Below the approval threshold."
              : approval
                ? approval.decision + " by " + approval.decidedBy + ": " + approval.reason
                : review[0]?.state === "stale"
                  ? "The approval was made on a different series, request or policy."
                  : "Not approved yet.",
          },
        ],
        findings: [
          "The action is prepared, not executed: nothing is sent to a market or a device.",
          "Forecast quality is not a claim of avoided emissions.",
        ],
        verifiedAt: createdAt,
      },
      reviewVerification({
        id: ids.review,
        profile: "energy-forecast/action-approval/0.1",
        statuses: review,
        flagSource: { nodeType: "claim", id: ids.actionClaim, role: "flag-source" },
        adviceRefs: [],
        createdAt,
        staleNote: "Stale: made on a different series, request or policy. ",
        findings: ["An approval records a person's decision on the capped amount; the policy still bounds it."],
      }),
    ],
    attestations: [],
    anchors: [],
  };

  return { caseBundle, benchmark, comparisons, confidence, action, review, actionInputDigest };
}
