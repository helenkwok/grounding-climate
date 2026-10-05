import {
  CLIMATECHAIN_SCHEMA_VERSION,
  createEvidenceRoot,
  reviewStatuses,
  reviewVerification,
} from "@climatechain/core";
import type {
  ClimateCaseBundle,
  CryptoProvider,
  ReviewDecision,
  ReviewFlag,
  ReviewStatus,
} from "@climatechain/core";

import { estimateBatteryHealth } from "./health.js";
import { digestBatteryHistory } from "./integrity.js";
import {
  decideBatteryDisposition,
  DEFAULT_BATTERY_PASSPORT_POLICY,
} from "./policy.js";
import type {
  BatteryHistory,
  BatteryPassportClaim,
  BatteryPassportPolicy,
} from "./types.js";

/** A person signs off the disposition the policy proposes for a cell; its id is the decision check's id. */
export function dispositionFlag(batteryId: string): ReviewFlag {
  return { id: "disposition:" + batteryId, label: "Sign-off of the proposed disposition for " + batteryId };
}

/** "approve" keeps the policy's disposition; any other value is the disposition the person chose instead. */
export type DispositionDecision = "approve" | "reuse" | "repurpose" | "recycle" | "service-review";

export async function buildBatteryPassport(options: {
  history: BatteryHistory;
  provider: CryptoProvider;
  policy?: BatteryPassportPolicy;
  observedAt: string;
  fitLastCycles?: number;
  eolSohThreshold?: number;
  /** Sign-off decisions; without a current one the disposition is only proposed. */
  decisions?: ReviewDecision[];
}): Promise<{
  passport: BatteryPassportClaim;
  caseBundle: ClimateCaseBundle;
  evidenceRoot: Awaited<ReturnType<typeof createEvidenceRoot>>;
  review: ReviewStatus[];
}> {
  const health = estimateBatteryHealth({
    history: options.history,
    ...(options.fitLastCycles !== undefined
      ? { fitLastCycles: options.fitLastCycles }
      : {}),
    ...(options.eolSohThreshold !== undefined
      ? { eolSohThreshold: options.eolSohThreshold }
      : {}),
  });
  const policy =
    options.policy ?? DEFAULT_BATTERY_PASSPORT_POLICY;
  const decision = decideBatteryDisposition(health, policy);
  const inputDigest = await digestBatteryHistory(
    options.history,
    options.provider,
  );

  const flag = dispositionFlag(options.history.batteryId);
  const review = reviewStatuses([flag], options.decisions ?? [], inputDigest);
  const signOff = review[0]?.state === "decided" ? review[0].decision : undefined;
  const finalDisposition =
    signOff && signOff.decision !== "approve" ? signOff.decision : decision.disposition;

  const passport: BatteryPassportClaim = {
    version: "climatechain.battery-passport/0.1",
    batteryId: options.history.batteryId,
    sourceDataset: options.history.source.dataset,
    ...(options.history.chemistry
      ? { chemistry: options.history.chemistry }
      : {}),
    ...(options.history.formFactor
      ? { formFactor: options.history.formFactor }
      : {}),
    nominalCapacityAh: options.history.nominalCapacityAh,
    observedCycle: health.observedCycle,
    currentSoh: health.currentSoh,
    estimatedRulCycles: health.estimatedRulCycles,
    disposition: finalDisposition as BatteryPassportClaim["disposition"],
    decisionReasons: decision.reasons,
    inputDigest,
    model: {
      id: "linear-capacity-rul",
      version: "battery-dpp/0.1",
      eolSohThreshold: health.eolSohThreshold,
      fitRSquared: health.fit.rSquared,
    },
    caveat:
      "Decision-support claim only. Battery reuse/repurpose decisions also require electrical, thermal, mechanical, regulatory, and safety assessment.",
  };

  const caseId = "case:battery:" + options.history.batteryId;
  const sourceEvidenceId =
    "evidence:battery-history:" + options.history.batteryId;
  const modelRunId =
    "model-run:battery-health:" + options.history.batteryId;
  const claimId =
    "claim:battery-passport:" + options.history.batteryId;
  const verificationId =
    "verification:battery-passport:" + options.history.batteryId;
  const reviewId = "verification:disposition-sign-off:" + options.history.batteryId;
  const signedOff = review.every((status) => status.state === "decided");

  const caseBundle: ClimateCaseBundle = {
    schemaVersion: CLIMATECHAIN_SCHEMA_VERSION,
    caseId,
    title: "Battery passport — " + options.history.batteryId,
    capabilities: ["battery-dpp", "pq-attestation"],
    createdAt: options.observedAt,
    claims: [
      {
        nodeType: "claim",
        id: claimId,
        createdAt: options.observedAt,
        provenance: [
          {
            nodeType: "model-run",
            id: modelRunId,
            role: "derived-by",
          },
        ],
        subject: {
          id: "battery:" + options.history.batteryId,
          kind: "asset",
          name: options.history.batteryId,
        },
        assertion: {
          kind: "qualitative",
          statement:
            "Battery disposition: " +
            passport.disposition +
            (signOff
              ? " (policy proposed " + decision.disposition + "; signed off by " + signOff.decidedBy + ")"
              : " (proposed by policy; not signed off)") +
            "; SOH=" +
            passport.currentSoh.toFixed(4) +
            "; estimated RUL=" +
            (passport.estimatedRulCycles === null
              ? "unavailable"
              : passport.estimatedRulCycles.toFixed(1) + " cycles"),
        },
        boundary: {
          methodology: "Linear capacity trend over the recorded cycles; disposition by a fixed policy, signed off by a person.",
          accounting: {
            included: [
              "Discharge capacity of cycles 1 to " + health.observedCycle + " of cell " + options.history.batteryId,
              "State of health relative to the nominal capacity of " + options.history.nominalCapacityAh + " Ah",
            ],
            excluded: [
              "Cycles after " + health.observedCycle,
              "Calendar ageing between recorded cycles",
            ],
            policyChoices: [
              "End of first life at state of health " + health.eolSohThreshold,
              "Reuse needs state of health of at least " + policy.reuseMinSoh + " and " + policy.reuseMinRulCycles +
                " remaining cycles; repurpose needs at least " + policy.repurposeMinSoh,
              "Remaining life from a straight line through the last " + health.fit.sampleCount + " cycles",
              "A person signs off the proposed disposition",
            ],
            notAssessed: [
              "Electrical, thermal, mechanical and safety condition",
              "The battery's carbon footprint and other EU Battery Regulation passport fields",
              "BatteryLife's published life-prediction models",
            ],
          },
        },
        assessments: [
          {
            dimension: "source-found",
            state: "confirmed",
            assessedAt: options.observedAt,
          },
          {
            dimension: "calculation-reproduced",
            state: "confirmed",
            assessedAt: options.observedAt,
          },
          {
            dimension: "evidence-integrity-confirmed",
            state: "confirmed",
            assessedAt: options.observedAt,
          },
        ],
      },
    ],
    evidence: [
      {
        nodeType: "evidence",
        id: sourceEvidenceId,
        createdAt: options.observedAt,
        provenance: [],
        kind: "dataset",
        source: {
          uri: options.history.source.uri,
          publisher: "BatteryLife",
          retrievedAt: options.observedAt,
        },
        integrity: inputDigest,
        access: { mode: "committed", instructions: "data/external/batterylife-processed" },
        rights: {
          sourceManifestId: options.history.source.sourceManifestId,
          licence: "MIT",
          redistribution: "allowed",
          commercialUse: "allowed",
          derivedData: "allowed",
          attribution:
            "BatteryLife dataset; preserve BatteryLife and original experiment citations.",
        },
      },
    ],
    calculations: [],
    factors: [],
    modelRuns: [
      {
        nodeType: "model-run",
        id: modelRunId,
        createdAt: options.observedAt,
        provenance: [
          {
            nodeType: "evidence",
            id: sourceEvidenceId,
            role: "cycle-capacity-history",
          },
        ],
        model: {
          id: "linear-capacity-rul",
          name: "Transparent linear capacity trend baseline",
          version: "battery-dpp/0.1",
        },
        inputDigest,
        preprocessingVersion: "battery-dpp/0.1",
        inferenceParameters: {
          eolSohThreshold: health.eolSohThreshold,
          fitLastCycles:
            health.fit.sampleCount,
        },
        output: {
          kind: "quantitative",
          metric: "estimated remaining useful life",
          quantity: {
            value: health.estimatedRulCycles ?? 0,
            unit: "cycles",
          },
        },
        ...(health.fit.rSquared === null
          ? {}
          : {
              confidence: Math.max(
                0,
                Math.min(1, health.fit.rSquared),
              ),
            }),
        benchmark: {
          metric: "R² of local linear capacity fit",
          value: health.fit.rSquared ?? 0,
          notes:
            "This is a transparent passport decision-support baseline, not the published BatteryLife life-prediction model.",
        },
        executedAt: options.observedAt,
        reproducibility: {
          codeVersion: "battery-dpp/0.1",
        },
      },
    ],
    verifications: [
      {
        nodeType: "verification",
        id: verificationId,
        createdAt: options.observedAt,
        provenance: [
          {
            nodeType: "claim",
            id: claimId,
            role: "claim-under-review",
          },
          {
            nodeType: "evidence",
            id: sourceEvidenceId,
            role: "input-evidence",
          },
          { nodeType: "verification", id: reviewId, role: "human-decisions" },
        ],
        verifier: {
          id: "service:climatechain:battery-dpp",
          kind: "service",
          name: "ClimateChain Battery DPP",
        },
        profile: "battery-passport/0.1",
        result: signedOff ? "reconciled" : "insufficient-evidence",
        checks: [
          {
            id: "history-digest",
            name: "Battery cycle history digest captured",
            outcome: "pass",
          },
          {
            id: "policy-decision",
            name: "Disposition rule evaluated",
            outcome: "pass",
            detail: decision.reasons.join(" "),
          },
          {
            id: "disposition-sign-off",
            name: "Proposed disposition signed off by a person",
            outcome: signedOff ? "pass" : "warn",
            detail: signOff
              ? signOff.decision + " by " + signOff.decidedBy + ": " + signOff.reason
              : review[0]?.state === "stale"
                ? "The sign-off was made on a different cycle history."
                : "Not signed off yet.",
          },
        ],
        findings: health.limitations,
        verifiedAt: options.observedAt,
      },
    ],
    attestations: [],
    anchors: [],
  };
  caseBundle.verifications.push(
    reviewVerification({
      id: reviewId,
      profile: "battery-passport/disposition-sign-off/0.1",
      statuses: review,
      flagSource: { nodeType: "model-run", id: modelRunId, role: "flag-source" },
      adviceRefs: [],
      createdAt: options.observedAt,
      staleNote: "Stale: made on a different cycle history. ",
      findings: [
        "A sign-off records a person's decision on the proposed disposition; it does not replace the safety and condition assessments the claim lists as not assessed.",
      ],
    }),
  );

  const evidenceRoot = await createEvidenceRoot(
    caseBundle,
    [
      {
        nodeType: "verification",
        id: verificationId,
      },
    ],
    options.provider,
  );

  return {
    passport,
    caseBundle,
    evidenceRoot,
    review,
  };
}
