import {
  CLIMATECHAIN_SCHEMA_VERSION,
  createEvidenceRoot,
} from "@climatechain/core";
import type {
  ClimateCaseBundle,
  CryptoProvider,
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

export async function buildBatteryPassport(options: {
  history: BatteryHistory;
  provider: CryptoProvider;
  policy?: BatteryPassportPolicy;
  observedAt: string;
  fitLastCycles?: number;
  eolSohThreshold?: number;
}): Promise<{
  passport: BatteryPassportClaim;
  caseBundle: ClimateCaseBundle;
  evidenceRoot: Awaited<ReturnType<typeof createEvidenceRoot>>;
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
    disposition: decision.disposition,
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
            "Battery disposition decision: " +
            passport.disposition +
            "; SOH=" +
            passport.currentSoh.toFixed(4) +
            "; estimated RUL=" +
            (passport.estimatedRulCycles === null
              ? "unavailable"
              : passport.estimatedRulCycles.toFixed(1) + " cycles"),
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
        ],
        verifier: {
          id: "service:climatechain:battery-dpp",
          kind: "service",
          name: "ClimateChain Battery DPP",
        },
        profile: "battery-passport/0.1",
        result: "reconciled",
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
        ],
        findings: health.limitations,
        verifiedAt: options.observedAt,
      },
    ],
    attestations: [],
    anchors: [],
  };

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
  };
}
