import {
  CLIMATECHAIN_SCHEMA_VERSION,
  type ClimateCaseBundle,
  type ClimateNode,
  type ContentDigest,
  type NodeRef,
  type Verification,
  type VerificationCheck,
  type VerificationResult,
} from "@climatechain/core";
import {
  ActivityLog,
  ClimateCapabilityRegistry,
  DynamicClimateWebMcp,
  createRoutedModule,
  type ClimateWorkspace,
  type ModuleCommandRouter,
} from "@climatechain/webmcp";

import {
  adviceRuns,
  buildingCaseId,
  caseRun,
  checkBuilding,
  mlDsaVerifier,
  service as buildingService,
  setTampered,
  type LiveCheck,
} from "./building-live.js";
import {
  batteryCaseId,
  batteryRun,
  batteryService,
  checkBattery,
  setBatteryTampered,
  type BatteryCheck,
} from "./battery-live.js";
import {
  checkEnergy,
  energyCaseId,
  energyRun,
  energyService,
  setEnergyTampered,
  type EnergyCheck,
} from "./energy-live.js";
import { checkEarth, earthCaseId, earthRun, earthService, setEarthTampered, type EarthCheck } from "./earth-live.js";
import batteryReport from "../../../reports/battery-dpp/batterylife-calb-smoke.json";
import carbonReport from "../../../reports/carbon-registry/carbonplan-smoke.json";
import cadi from "../../../sources/cadi-candidates.json";

type JsonObject = Record<string, any>;

type DemoModule = {
  id: string;
  title: string;
  icon: string;
  kicker: string;
  kpi: string;
  kpiLabel: string;
  source: string;
  decisionTitle: string;
  decisionCopy: string;
  limitation: string;
  metrics: Array<[string, string]>;
  /** One row per flagged reading: what the model advised and what a person decided. */
  decisions?: Array<[string, string]>;
  provenance: Array<[string, string]>;
  /** Digest the module's own smoke run recorded for its evidence; absent when none exists. */
  digest?: ContentDigest;
  /** Checks read from fields the committed report records; nothing here is recomputed in the browser. */
  checks: VerificationCheck[];
  tamper: {
    before: string;
    change: string;
    after: string;
    rootBefore?: string;
    rootAfter?: string;
  };
};

const battery = batteryReport as JsonObject;
const carbon = carbonReport as JsonObject;
const cadiData = cadi as JsonObject;
const lpl = cadiData.candidates.find((item: JsonObject) => item.id === "lpl-construction");
const lplClaim = lpl?.extractedClaims?.[0];

const short = (digest: ContentDigest) => digest.value.slice(0, 16) + "…";

function buildingModule(live: LiveCheck): DemoModule {
  const { decided, attestation } = live;
  const verification = decided.climateCase.verifications[0]!;
  const emissions = decided.analysis.emissions;
  const flags = decided.statuses;
  const decidedCount = flags.filter((flag) => flag.state === "decided").length;
  const ed25519 = attestation.signature.signatures.find((item) => item.signature.algorithm === "Ed25519");
  const mlDsa = attestation.signature.signatures.find((item) => item.signature.algorithm === "ML-DSA-65");
  return {
    id: "building",
    title: "Building MRV",
    icon: "▦",
    kicker: "Real meter → decided → signed",
    kpi: emissions.emissionsTCo2e.toFixed(2),
    kpiLabel: "tCO₂e, recomputed in this browser",
    source: "BDG2 v1.0 + EPA eGRID2016",
    decisionTitle: "Facility energy manager: " + decidedCount + " of " + flags.length + " flagged readings decided",
    decisionCopy:
      caseRun.organisingQuestion +
      " A decision model advised on each flagged reading; a person decided. The advice never sets a status.",
    decisions: flags.map((flag) => {
      const run = adviceRuns.find((item) => item.inferenceParameters.interval === flag.timestamp);
      const advice = run
        ? "Jev " + run.model.version + ": " + (run.output.kind === "qualitative" ? run.output.statement.replace("advice: ", "") : "") +
          " (" + run.confidence?.toFixed(2) + ") · " + (run.extensions?.handOff ?? "needs a person")
        : "no advice recorded";
      const decision =
        flag.state === "undecided"
          ? "undecided"
          : flag.state + ": " + flag.decision?.decision + " by " + flag.decision?.decidedBy;
      return [flag.timestamp + " · " + advice, decision];
    }),
    limitation:
      "Decided is not resolved: the cause of each zero reading is not confirmed by site records. " +
      "Signing keys are per-run demo keys, not an identity. On 296 labelled GEPIII flags the advice called 91% faults against 55% labelled bad, so it is shown as a suggestion only at p(fault) ≥ 0.97, a threshold measured for a wrong exclusion costed at 5 reviews (a policy choice).",
    metrics: [
      ["Meter rows", String(decided.analysis.anomalies.points.length)],
      ["Temporal holdout RMSLE", decided.analysis.baseline.metrics.rmsle.toFixed(4)],
      ["Flagged readings", String(flags.length)],
      ["Accepted energy", emissions.acceptedEnergyMWh.toFixed(2) + " MWh"],
      ["Excluded energy", emissions.excludedEnergyKWh.toFixed(1) + " kWh"],
      ["Location-based emissions", emissions.emissionsTCo2e.toFixed(2) + " tCO₂e"],
    ],
    provenance: [
      ["Dataset", "doi:10.5281/zenodo.3887306 (committed subset, CC BY-SA 4.0)"],
      ["Building", String(decided.climateCase.extensions?.buildingId)],
      ["Factor", decided.climateCase.factors[0]?.sourceDocument ?? ""],
      ["Meter series (now)", short(decided.digest)],
      ["Evidence root (now)", short(attestation.currentRoot)],
      ["Evidence root (signed)", short(caseRun.attestation.payload.evidenceRoot)],
      ["Signed", caseRun.runAt + " · Ed25519 + ML-DSA-65"],
    ],
    digest: decided.digest,
    checks: [
      {
        id: "source-integrity",
        name: "Committed BDG2 files match their recorded digests (checked here)",
        outcome: live.sourceIntegrityValid ? "pass" : "fail",
      },
      ...verification.checks,
      {
        id: "attestation",
        name: "Signed attestation matches the current evidence (checked here)",
        outcome: attestation.validForCurrentEvidence ? "pass" : "fail",
        detail:
          "Ed25519 " + (ed25519?.signatureValid ? "verified in this browser" : "NOT verified") +
          "; ML-DSA-65 " + (mlDsa?.signatureValid ? "verified in this browser (" + mlDsaVerifier + ")" : "NOT verified") +
          (attestation.changedRefs.length ? "; changed since signing: " + attestation.changedRefs.map((ref) => ref.id).join(", ") : ""),
      },
    ],
    tamper: {
      before: "meter series " + short(decided.digest),
      change: "×" + caseRun.tamper.multiplier + " at " + caseRun.tamper.timestamp + ", applied in this browser",
      after: "",
      rootBefore: caseRun.attestation.payload.evidenceRoot.value,
    },
  };
}

function batteryModule(live: BatteryCheck): DemoModule {
  const { built, attestation } = live;
  const verification = built.caseBundle.verifications[0]!;
  const passport = built.passport;
  const signOff = built.review[0];
  const boundary = built.caseBundle.claims[0]?.boundary?.accounting;
  const ed25519 = attestation.signature.signatures.find((item) => item.signature.algorithm === "Ed25519");
  const mlDsa = attestation.signature.signatures.find((item) => item.signature.algorithm === "ML-DSA-65");
  return {
    id: "battery",
    title: "Battery DPP",
    icon: "▣",
    kicker: "Cycle history → signed-off passport",
    kpi: (passport.currentSoh * 100).toFixed(1) + "%",
    kpiLabel: "state of health, recomputed in this browser",
    source: "BatteryLife / CALB (MIT)",
    decisionTitle:
      "Second-life operator: disposition " +
      passport.disposition +
      (signOff?.state === "decided" ? " (signed off)" : " (not signed off)"),
    decisionCopy:
      batteryRun.organisingQuestion +
      " The policy proposes a disposition from the measured capacity; a person signs it off or overrides it.",
    decisions: [
      [
        "Proposed by policy: " + (passport.decisionReasons.join(" ") || passport.disposition),
        signOff?.state === "undecided" || !signOff?.decision
          ? signOff?.state ?? "undecided"
          : signOff.state + ": " + signOff.decision.decision + " by " + signOff.decision.decidedBy,
      ],
      ...(signOff?.decision ? [["Reason", signOff.decision.reason] as [string, string]] : []),
      ...(boundary
        ? ([
            ["Counts", boundary.included.join("; ")],
            ["Policy choices", boundary.policyChoices.join("; ")],
            ["Not assessed", boundary.notAssessed.join("; ")],
          ] as Array<[string, string]>)
        : []),
    ],
    limitation:
      "Decision support only, not a safety certification. Signing keys are per-run demo keys. " +
      "BatteryLife's published Dummy baseline is not reproduced exactly from the pinned v1 release (recorded smoke run: MAPE " +
      battery.benchmark.reproduced.meanMape.toFixed(3) + " vs published 1.811).",
    metrics: [
      ["Battery", passport.batteryId],
      ["Observed cycles", String(passport.observedCycle)],
      ["State of health", (passport.currentSoh * 100).toFixed(2) + "%"],
      ["Remaining cycles to SoH 0.8", String(passport.estimatedRulCycles ?? "n/a")],
      ["Fit R²", (passport.model.fitRSquared ?? 0).toFixed(4)],
      ["Disposition", passport.disposition],
    ],
    provenance: [
      ["Dataset", "doi:10.5281/zenodo.19688272 (committed subset, MIT)"],
      ["Cycle history (now)", short(passport.inputDigest!)],
      ["Evidence root (now)", short(attestation.currentRoot)],
      ["Evidence root (signed)", short(batteryRun.attestation.payload.evidenceRoot)],
      ["Signed", batteryRun.runAt + " · Ed25519 + ML-DSA-65"],
    ],
    digest: passport.inputDigest!,
    checks: [
      ...verification.checks,
      {
        id: "attestation",
        name: "Signed attestation matches the current evidence (checked here)",
        outcome: attestation.validForCurrentEvidence ? "pass" : "fail",
        detail:
          "Ed25519 " + (ed25519?.signatureValid ? "verified in this browser" : "NOT verified") +
          "; ML-DSA-65 " + (mlDsa?.signatureValid ? "verified in this browser (" + mlDsaVerifier + ")" : "NOT verified") +
          (attestation.changedRefs.length ? "; changed since signing: " + attestation.changedRefs.map((ref) => ref.id).join(", ") : ""),
      },
    ],
    tamper: {
      before: "cycle history " + short(passport.inputDigest!),
      change: "Cycle " + batteryRun.tamper.cycle + " capacity " + batteryRun.tamper.from + " → " + batteryRun.tamper.to.toFixed(5) + " Ah, applied in this browser",
      after: "",
      rootBefore: batteryRun.attestation.payload.evidenceRoot.value,
    },
  };
}

function energyModule(live: EnergyCheck): DemoModule {
  const { built, attestation } = live;
  const verification = built.caseBundle.verifications[0]!;
  const approval = built.review[0];
  const actionClaim = built.caseBundle.claims[1]!;
  const boundary = actionClaim.boundary?.accounting;
  const ed25519 = attestation.signature.signatures.find((item) => item.signature.algorithm === "Ed25519");
  const mlDsa = attestation.signature.signatures.find((item) => item.signature.algorithm === "ML-DSA-65");
  const rows = built.caseBundle.claims[0]!.boundary?.accounting?.included[0] ?? "";
  return {
    id: "energy",
    title: "Renewable / Load Forecast",
    icon: "↯",
    kicker: "Forecast quality → bounded action → approval",
    kpi: built.confidence.toFixed(3),
    kpiLabel: "mean LOAD_ACC, recomputed in this browser",
    source: "Energy-EVA / IEX load (CC BY 4.0)",
    decisionTitle:
      "Operator: " + built.action.approvedMWh + " MWh " + built.caseBundle.claims[1]!.subject.name!.replace("Bounded ", "") +
      (approval ? " (" + (approval.state === "decided" ? approval.decision!.decision + "d" : approval.state === "stale" ? "approval stale" : "awaiting approval") + ")" : ""),
    decisionCopy:
      energyRun.organisingQuestion +
      " The policy takes the measured forecast quality as its confidence and caps the amount; a person approves amounts above the threshold.",
    decisions: [
      [
        "Proposed by policy: " + (actionClaim.assertion.kind === "qualitative" ? actionClaim.assertion.statement : ""),
        !approval
          ? "no approval needed"
          : approval.state === "undecided" || !approval.decision
            ? approval.state
            : approval.state + ": " + approval.decision.decision + " by " + approval.decision.decidedBy,
      ],
      ...(approval?.decision ? [["Reason", approval.decision.reason] as [string, string]] : []),
      ...(boundary
        ? ([
            ["Counts", boundary.included.join("; ")],
            ["Policy choices", boundary.policyChoices.join("; ")],
            ["Not assessed", boundary.notAssessed.join("; ")],
          ] as Array<[string, string]>)
        : []),
    ],
    limitation:
      "The forecast is Energy-EVA's dummy baseline and the request and policy are illustrative. The action is prepared, not sent anywhere. " +
      "Forecast quality is not a claim of avoided emissions. Signing keys are per-run demo keys.",
    metrics: [
      ["Series", rows],
      ["Forecast horizon", "48 h · 5 rolling windows"],
      ["Published results reproduced", built.comparisons.filter((row) => row.reproduced).length + " of " + built.comparisons.length],
      ["Mean LOAD_ACC", built.confidence.toFixed(4)],
      ["Allowed by policy", built.action.approvedMWh + " MWh"],
    ],
    provenance: [
      ["Dataset", "doi:10.5281/zenodo.17099628 (committed, CC BY 4.0)"],
      ["Original data", "doi:10.17632/jxm8d4w4cv.1"],
      ["Series (now)", short(built.caseBundle.evidence[0]!.integrity!)],
      ["Evidence root (now)", short(attestation.currentRoot)],
      ["Evidence root (signed)", short(energyRun.attestation.payload.evidenceRoot)],
      ["Signed", energyRun.runAt + " · Ed25519 + ML-DSA-65"],
    ],
    digest: built.caseBundle.evidence[0]!.integrity!,
    checks: [
      ...verification.checks,
      {
        id: "attestation",
        name: "Signed attestation matches the current evidence (checked here)",
        outcome: attestation.validForCurrentEvidence ? "pass" : "fail",
        detail:
          "Ed25519 " + (ed25519?.signatureValid ? "verified in this browser" : "NOT verified") +
          "; ML-DSA-65 " + (mlDsa?.signatureValid ? "verified in this browser (" + mlDsaVerifier + ")" : "NOT verified") +
          (attestation.changedRefs.length ? "; changed since signing: " + attestation.changedRefs.map((ref) => ref.id).join(", ") : ""),
      },
    ],
    tamper: {
      before: "series " + short(built.caseBundle.evidence[0]!.integrity!),
      change:
        "Series " + energyRun.tamper.item + " at " + energyRun.tamper.timestamp + ": " + energyRun.tamper.from + " → " +
        energyRun.tamper.to.toFixed(3) + " MW, applied in this browser",
      after: "",
      rootBefore: energyRun.attestation.payload.evidenceRoot.value,
    },
  };
}

function earthModule(live: EarthCheck): DemoModule {
  const { built, attestation } = live;
  const m = built.result.metrics;
  const verification = built.caseBundle.verifications[0]!;
  const claim = built.caseBundle.claims[0]!;
  const boundary = claim.boundary?.accounting;
  const status = built.review[0];
  const ed25519 = attestation.signature.signatures.find((item) => item.signature.algorithm === "Ed25519");
  const mlDsa = attestation.signature.signatures.find((item) => item.signature.algorithm === "ML-DSA-65");
  const ha = (value: number) => Math.round(value).toLocaleString("en-US") + " ha";
  const reported =
    claim.assertion.kind === "quantitative"
      ? ha(claim.assertion.quantity.value) + (claim.assertion.quantity.uncertainty?.note ? " · " + claim.assertion.quantity.uncertainty.note : "")
      : "not stated";
  return {
    id: "earth",
    title: "Earth Observation",
    icon: "◉",
    kicker: "Satellite scene → detected area → decision",
    kpi: m.iou.toFixed(3),
    kpiLabel: "burn-class IoU, recomputed in this browser",
    source: "IBM/NASA HLS Burn Scars (CC BY 4.0)",
    decisionTitle:
      "Land-management analyst: area " +
      (!status ? "within tolerance" : status.state === "decided" ? status.decision!.decision : status.state === "stale" ? "decision stale" : "awaiting decision"),
    decisionCopy:
      earthRun.organisingQuestion +
      " The detector's area is compared with the labelled area; past the tolerance, a person decides which one the claim reports.",
    decisions: [
      [
        "Detected " + ha(m.predictedHectares) + " vs labelled " + ha(m.groundTruthHectares) + " (" + (built.areaGap * 100).toFixed(1) + "%)",
        !status ? "no decision needed" : status.state === "undecided" || !status.decision ? status.state : status.state + ": " + status.decision.decision + " by " + status.decision.decidedBy,
      ],
      ...(status?.decision ? [["Reason", status.decision.reason] as [string, string]] : []),
      ["Claim reports", reported],
      ...(boundary
        ? ([
            ["Counts", boundary.included.join("; ")],
            ["Policy choices", boundary.policyChoices.join("; ")],
            ["Not assessed", boundary.notAssessed.join("; ")],
          ] as Array<[string, string]>)
        : []),
    ],
    limitation:
      "One scene, and the dataset's split is random, so accuracy elsewhere is not established. NBR is a CPU baseline, not Prithvi; the labels are MTBS-derived. Signing keys are per-run demo keys.",
    metrics: [
      ["Pixels recomputed", m.validPixels.toLocaleString("en-US") + " (512×512)"],
      ["Pinned Python run reproduced", built.reproduced ? "yes, every pixel count" : "no"],
      ["Precision", m.precision.toFixed(4)],
      ["Recall", m.recall.toFixed(4)],
      ["Missed burn", ha(m.falseNegative * 0.09)],
    ],
    provenance: [
      ["Scene", earthRun.scene.id + " · doi:10.57967/hf/0956 (committed, CC BY 4.0)"],
      ["NIR (now)", short(built.caseBundle.evidence[0]!.integrity!)],
      ["SWIR2 (now)", short(built.caseBundle.evidence[1]!.integrity!)],
      ["Evidence root (now)", short(attestation.currentRoot)],
      ["Evidence root (signed)", short(earthRun.attestation.payload.evidenceRoot)],
      ["Signed", earthRun.runAt + " · Ed25519 + ML-DSA-65"],
    ],
    digest: built.caseBundle.evidence[0]!.integrity!,
    checks: [
      ...verification.checks,
      {
        id: "attestation",
        name: "Signed attestation matches the current evidence (checked here)",
        outcome: attestation.validForCurrentEvidence ? "pass" : "fail",
        detail:
          "Ed25519 " + (ed25519?.signatureValid ? "verified in this browser" : "NOT verified") +
          "; ML-DSA-65 " + (mlDsa?.signatureValid ? "verified in this browser (" + mlDsaVerifier + ")" : "NOT verified") +
          (attestation.changedRefs.length ? "; changed since signing: " + attestation.changedRefs.map((ref) => ref.id).join(", ") : ""),
      },
    ],
    tamper: {
      before: "NIR " + short(built.caseBundle.evidence[0]!.integrity!),
      change:
        "NIR at row " + earthRun.tamper.row + ", column " + earthRun.tamper.column + ": " + earthRun.tamper.from.toFixed(4) +
        " → " + earthRun.tamper.to.toFixed(4) + ", applied in this browser",
      after: "",
      rootBefore: earthRun.attestation.payload.evidenceRoot.value,
    },
  };
}

const modules: DemoModule[] = [
  buildingModule(await checkBuilding()),
  energyModule(await checkEnergy()),
  earthModule(await checkEarth()),
  batteryModule(await checkBattery()),
  {
    id: "carbon",
    title: "Carbon Registry",
    icon: "◎",
    kicker: "Multi-registry reconciliation",
    kpi: String(carbon.clean.recordCount),
    kpiLabel: "real records checked",
    source: "CarbonPlan OffsetsDB",
    decisionTitle: "Carbon-market auditor / verifier",
    decisionCopy:
      "Reconcile issuance and retirement records across a bounded multi-registry snapshot with deterministic, explainable checks.",
    limitation:
      "Missing issuance in the bounded subset is unresolved evidence, not automatically fraud. The duplicate row is injected only for the integrity demo.",
    metrics: [
      ["Registries", String(carbon.clean.registries.length)],
      ["Records", String(carbon.clean.recordCount)],
      ["Supported groups", String(carbon.clean.supportedCount)],
      ["Missing-issuance groups", String(carbon.clean.unresolvedMissingIssuanceCount)],
      ["Duplicate serials", String(carbon.clean.duplicateExcessCount)],
      ["Clean result", carbon.clean.verificationResult],
    ],
    provenance: [
      ["Pinned commit", carbon.source.commit],
      ["Source files", String(carbon.source.fileCount)],
      ["Source bytes", carbon.source.totalBytes.toLocaleString()],
      ["Evidence root", carbon.clean.evidenceRoot.value],
      ["Ledger decision", carbon.ledgerDecision.decision],
    ],
    digest: carbon.clean.evidenceRoot,
    checks: [
      {
        id: "duplicate-serials",
        name: "No duplicate serial excess",
        outcome: carbon.clean.duplicateExcessCount === 0 ? "pass" : "fail",
      },
      {
        id: "issuance-coverage",
        name: "Every retirement group has matching issuance",
        outcome: carbon.clean.unresolvedMissingIssuanceCount === 0 ? "pass" : "warn",
        detail:
          carbon.clean.unresolvedMissingIssuanceCount +
          " groups lack issuance in the bounded snapshot (report result: " +
          carbon.clean.verificationResult +
          ")",
      },
    ],
    tamper: {
      before:
        carbon.tamperDemo.originalQuantity +
        " credits; root " +
        carbon.tamperDemo.originalEvidenceRoot.value,
      change:
        carbon.tamperDemo.originalQuantity +
        " → " +
        carbon.tamperDemo.changedQuantity,
      after: "Evidence root changes; duplicate injection also produces mismatch",
      rootBefore: carbon.tamperDemo.originalEvidenceRoot.value,
      rootAfter: carbon.tamperDemo.changedEvidenceRoot.value,
    },
  },
  {
    id: "disclosure",
    title: "Public Disclosure",
    icon: "◫",
    kicker: "Public claim ≠ verified truth",
    kpi: lplClaim ? String(lplClaim.value) : "—",
    kpiLabel: lplClaim ? lplClaim.unit + " Scope 1" : "source-only",
    source: "CaDI-confirmed first-party sources",
    decisionTitle: "Sustainability manager / verifier",
    decisionCopy:
      "Locate a real public climate claim, preserve the original source, and keep disclosure, calculation reproduction, factor tracing, and assurance as separate assessment dimensions.",
    limitation:
      "LPL's external-verification statement is retained as an attributed source claim. ClimateChain has not independently audited that assurance engagement.",
    metrics: [
      ["Confirmed CaDI candidates", String(cadiData.candidates.length)],
      ["Numeric case", lpl?.name ?? "none"],
      ["Period", lplClaim?.period ?? "—"],
      ["Metric", lplClaim?.metric ?? "—"],
      ["Reported value", lplClaim ? lplClaim.value + " " + lplClaim.unit : "—"],
      ["Calculation reproduced", "not assessed"],
    ],
    provenance: [
      ["Organisation", lpl?.name ?? "—"],
      ["Claim ID", lplClaim?.id ?? "—"],
      ["Source", lpl?.underlyingSourceUrl ?? "—"],
      ["CaDI status", lpl?.confirmationStatus ?? "—"],
      ["Rights policy", cadiData.rightsManifestId],
    ],
    checks: [
      { id: "source-found", name: "Public first-party source located", outcome: lpl ? "pass" : "fail" },
      { id: "calculation-reproduced", name: "Reported value recalculated", outcome: "not-run" },
      { id: "factor-traced", name: "Emission factors traced", outcome: "not-run" },
      { id: "assurance", name: "Third-party assurance assessed", outcome: "not-run" },
    ],
    tamper: {
      before: lplClaim ? lplClaim.value + " " + lplClaim.unit : "public source",
      change: "Change extracted claim value/source bytes",
      after: "Current evidence commitment changes; old provenance remains tied to old bytes",
    },
  },
];

const moduleById = new Map(modules.map((item) => [item.id, item]));

function reportEvidence(id: string, source: string, digest?: ContentDigest) {
  return {
    nodeType: "evidence" as const,
    id: "evidence:demo:" + id,
    createdAt: "2026-09-30T00:00:00Z",
    provenance: [],
    kind: "dataset" as const,
    source: {
      localRef: "committed measured report",
      publisher: source,
      retrievedAt: "2026-09-30T00:00:00Z",
    },
    ...(digest ? { integrity: digest } : {}),
    rights: {
      redistribution: "allowed" as const,
      attribution: source,
    },
  };
}

const demoEvidence = modules.map((item) =>
  reportEvidence(item.id, item.source, item.digest),
);

const demoClaims = modules.map((item) => ({
  nodeType: "claim" as const,
  id: "claim:demo:" + item.id,
  createdAt: "2026-09-30T00:00:00Z",
  provenance: [
    {
      nodeType: "evidence" as const,
      id: "evidence:demo:" + item.id,
      role: "measured-report",
    },
  ],
  subject: {
    id: "demo:" + item.id,
    kind: "other" as const,
    name: item.title,
  },
  assertion: {
    kind: "qualitative" as const,
    statement: item.kicker + "; key measured result: " + item.kpi + " " + item.kpiLabel,
  },
  assessments: [
    { dimension: "source-found" as const, state: "confirmed" as const },
    item.digest
      ? {
          dimension: "evidence-integrity-confirmed" as const,
          state: "confirmed" as const,
          note: item.digest.algorithm + " digest recorded by the module's smoke run",
        }
      : { dimension: "evidence-integrity-confirmed" as const, state: "not-assessed" as const },
  ],
}));

function deriveResult(checks: VerificationCheck[]): VerificationResult {
  if (checks.some((check) => check.outcome === "fail")) return "mismatch";
  if (checks.some((check) => check.outcome !== "pass")) return "insufficient-evidence";
  return "reconciled";
}

const demoVerifications: Verification[] = modules.map((item) => ({
  nodeType: "verification",
  id: "verification:demo:" + item.id,
  createdAt: "2026-09-30T00:00:00Z",
  provenance: [
    {
      nodeType: "claim",
      id: "claim:demo:" + item.id,
      role: "claim-under-review",
    },
  ],
  verifier: {
    id: "service:climatechain-demo",
    kind: "service",
    name: "ClimateChain measured-report workspace",
  },
  profile: "demo-report/0.1",
  result: deriveResult(item.checks),
  checks: item.checks,
  findings: [item.limitation],
  verifiedAt: "2026-09-30T00:00:00Z",
}));

const demoCase: ClimateCaseBundle = {
  schemaVersion: CLIMATECHAIN_SCHEMA_VERSION,
  caseId: "case:climatechain-demo",
  title: "ClimateChain multi-capability evidence workspace",
  capabilities: [
    "building-meter-mrv",
    "carbon-recalculation",
    "renewable-forecasting",
    "earth-observation",
    "battery-dpp",
    "carbon-registry",
    "public-disclosure",
    "claim-reconciliation",
  ],
  createdAt: "2026-09-30T00:00:00Z",
  claims: demoClaims,
  evidence: demoEvidence,
  calculations: [],
  factors: [],
  modelRuns: [],
  verifications: demoVerifications,
  attestations: [],
  anchors: [],
};

class DemoWorkspace implements ClimateWorkspace {
  async getCase(caseId?: string): Promise<ClimateCaseBundle | undefined> {
    if (caseId === buildingCaseId) return (await buildingService.decidedCase()).climateCase;
    if (caseId === batteryCaseId) return (await batteryService.passport()).caseBundle;
    if (caseId === energyCaseId) return (await energyService.build()).caseBundle;
    if (caseId === earthCaseId) return (await earthService.build()).caseBundle;
    return !caseId || caseId === demoCase.caseId ? demoCase : undefined;
  }

  async listCases(): Promise<ClimateCaseBundle[]> {
    return [
      demoCase,
      (await buildingService.decidedCase()).climateCase,
      (await batteryService.passport()).caseBundle,
      (await energyService.build()).caseBundle,
      (await earthService.build()).caseBundle,
    ];
  }

  async getNode(
    caseId: string,
    ref: NodeRef,
  ): Promise<ClimateNode | undefined> {
    const bundle = await this.getCase(caseId);
    if (!bundle) return undefined;
    const groups: ClimateNode[][] = [
      bundle.claims,
      bundle.evidence,
      bundle.calculations,
      bundle.factors,
      bundle.modelRuns,
      bundle.verifications,
      bundle.attestations,
      bundle.anchors,
    ];
    return groups.flat().find(
      (node) => node.nodeType === ref.nodeType && node.id === ref.id,
    );
  }

  async listChecks(caseId: string): Promise<Verification[]> {
    return (await this.getCase(caseId))?.verifications ?? [];
  }

  async compareClaims(
    caseId: string,
    leftClaimId: string,
    rightClaimId: string,
  ) {
    if (caseId !== demoCase.caseId) throw new Error("Unknown demo case.");
    return {
      left: demoCase.claims.find((claim) => claim.id === leftClaimId) ?? null,
      right: demoCase.claims.find((claim) => claim.id === rightClaimId) ?? null,
      note: "Comparison preserves module-specific limitations; unlike metrics are not collapsed into one score.",
    };
  }
}

const reportPaths: Record<string, string> = {
  carbon: "reports/carbon-registry/carbonplan-smoke.json",
  disclosure: "sources/cadi-candidates.json",
};

const router: ModuleCommandRouter = {
  async execute(moduleId, toolName, input) {
    const item = moduleById.get(moduleId);
    if (!item) throw new Error("Unknown demo module: " + moduleId);
    // Building runs the real service on the committed data, the same one the page renders from.
    if (moduleId === "building") return buildingService.execute("building-mrv", toolName, input);
    if (moduleId === "battery") return batteryService.execute("battery-dpp", toolName, input);
    if (moduleId === "energy") return energyService.execute("energy-forecast", toolName, input);
    if (moduleId === "earth") return earthService.execute("earth-observation", toolName, input);
    if (input.caseId !== demoCase.caseId) {
      throw new Error(
        "Unknown case " + JSON.stringify(input.caseId ?? null) + "; this demo holds only " + demoCase.caseId + ".",
      );
    }

    // ponytail: replays committed reports; real per-case execution is the next step (shared case workflow).
    return {
      replayedFrom: reportPaths[moduleId],
      note: "Recorded output of an offline run, replayed unchanged. Inputs other than caseId are not used.",
      result: recordedOutput(toolName),
    };
  },
};

function recordedOutput(toolName: string): unknown {
  switch (toolName) {
    case "carbon_reconcile_registry_records":
      return { clean: carbon.clean, ledgerDecision: carbon.ledgerDecision };
    case "carbon_check_retirement":
      return { duplicateDemo: carbon.duplicateDemo, clean: carbon.clean };
    case "carbon_check_duplicate_claim":
      return carbon.duplicateDemo;

    case "disclosure_get_public_claim":
    case "disclosure_extract_report_claims":
      return { organisation: lpl, claim: lplClaim, policy: cadiData.policy };
    case "disclosure_reconcile_claim":
      return {
        disclosed: true,
        sourceFound: true,
        calculationReproduced: false,
        factorsTraced: false,
        thirdPartyAssurance: "attributed-not-independently-assessed",
        claim: lplClaim,
      };
    default:
      throw new Error("Unsupported demo tool: " + toolName);
  }
}

const registry = new ClimateCapabilityRegistry()
  .register(
    createRoutedModule({
      id: "building",
      title: "Building MRV",
      capabilities: ["building-meter-mrv", "carbon-recalculation"],
      toolNames: [
        "building_get_meter_series",
        "building_detect_anomalies",
        "building_run_baseline",
        "building_reconstruct_emissions",
        "building_review_flags",
      ],
      router,
    }),
  )
  .register(
    createRoutedModule({
      id: "energy",
      title: "Renewable / load forecasting",
      capabilities: ["renewable-forecasting"],
      toolNames: [
        "energy_run_forecast",
        "energy_compare_baseline",
        "energy_prepare_bounded_action",
      ],
      router,
    }),
  )
  .register(
    createRoutedModule({
      id: "earth",
      title: "Earth observation",
      capabilities: ["earth-observation"],
      toolNames: [
        "earth_run_detector",
        "earth_compare_ground_truth",
        "earth_get_scene_provenance",
      ],
      router,
    }),
  )
  .register(
    createRoutedModule({
      id: "battery",
      title: "Battery DPP",
      capabilities: ["battery-dpp"],
      toolNames: [
        "battery_predict_health",
        "battery_compare_baseline",
        "battery_build_passport_claim",
      ],
      router,
    }),
  )
  .register(
    createRoutedModule({
      id: "carbon",
      title: "Carbon registry",
      capabilities: ["carbon-registry"],
      toolNames: [
        "carbon_reconcile_registry_records",
        "carbon_check_retirement",
        "carbon_check_duplicate_claim",
      ],
      router,
    }),
  )
  .register(
    createRoutedModule({
      id: "disclosure",
      title: "Public disclosure",
      capabilities: ["public-disclosure", "claim-reconciliation"],
      toolNames: [
        "disclosure_get_public_claim",
        "disclosure_extract_report_claims",
        "disclosure_reconcile_claim",
      ],
      router,
    }),
  );

const activity = new ActivityLog();
const workspace = new DemoWorkspace();

const webmcp = new DynamicClimateWebMcp({
  registry,
  workspace,
  approve: async (summary) =>
    window.confirm(
      "ClimateChain requires your approval before this consequential operation.\n\n" +
        summary.title +
        "\n" +
        summary.tool +
        "\n\n" +
        summary.args,
    ),
  activity: activity.sink,
});

const surface = webmcp.activate(demoCase.capabilities);

const badge = document.querySelector<HTMLDivElement>("#webmcp-badge");
if (badge) {
  if (!surface.available) {
    badge.textContent = "WebMCP unavailable · fallback ready";
  } else {
    badge.textContent = "WebMCP · registering…";
    void surface.registration.then(({ registered, failed }) => {
      badge.textContent = failed.length
        ? "WebMCP · " + registered.length + "/" + surface.toolNames.length + " tools registered · fallback ready"
        : "WebMCP · " + registered.length + " tools";
      if (failed.length) badge.title = failed.map((item) => item.name + ": " + item.error).join("\n");
    });
  }
}

let activeId = "building";

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderModules(): void {
  const grid = document.querySelector<HTMLDivElement>("#module-grid");
  if (!grid) return;
  grid.innerHTML = modules
    .map(
      (item) => `
      <button class="module-card ${item.id === activeId ? "active" : ""}" data-module="${escapeHtml(item.id)}">
        <div class="module-icon">${escapeHtml(item.icon)}</div>
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(item.kicker)}</p>
        <div class="module-kpi">
          <strong>${escapeHtml(item.kpi)}</strong>
          <span>${escapeHtml(item.kpiLabel)}</span>
        </div>
      </button>`,
    )
    .join("");

  grid.querySelectorAll<HTMLButtonElement>("[data-module]").forEach((button) => {
    button.addEventListener("click", () => {
      activeId = button.dataset.module ?? "building";
      renderModules();
      renderDetail();
    });
  });
}

function renderDetail(): void {
  const item = moduleById.get(activeId);
  if (!item) return;

  const title = document.querySelector("#detail-title");
  const source = document.querySelector("#detail-source");
  const metrics = document.querySelector("#metric-list");
  const decisionTitle = document.querySelector("#decision-title");
  const decisionCopy = document.querySelector("#decision-copy");
  const limitations = document.querySelector("#limitations");
  const provenance = document.querySelector("#provenance-list");

  if (title) title.textContent = item.title;
  if (source) source.textContent = item.source;
  if (decisionTitle) decisionTitle.textContent = item.decisionTitle;
  if (decisionCopy) decisionCopy.textContent = item.decisionCopy;
  if (limitations) limitations.textContent = item.limitation;

  if (metrics) {
    metrics.innerHTML = item.metrics
      .map(
        ([name, value]) =>
          `<div class="metric-row"><span>${escapeHtml(name)}</span><strong>${escapeHtml(value)}</strong></div>`,
      )
      .join("");
  }

  const checks = document.querySelector("#check-list");
  if (checks) {
    checks.innerHTML =
      `<div class="metric-row"><span>Overall result (all checks below)</span><strong>${escapeHtml(deriveResult(item.checks))}</strong></div>` +
      item.checks
        .map(
          (check) =>
            `<div class="metric-row"><span>${escapeHtml(check.name)}${check.detail ? `<br><small class="muted">${escapeHtml(check.detail)}</small>` : ""}</span><strong>${escapeHtml(check.outcome)}</strong></div>`,
        )
        .join("");
  }

  const decisionList = document.querySelector("#decision-list");
  if (decisionList) {
    decisionList.innerHTML = (item.decisions ?? [])
      .map(
        ([name, value]) =>
          `<div class="metric-row"><span>${escapeHtml(name)}</span><strong>${escapeHtml(value)}</strong></div>`,
      )
      .join("");
  }

  if (provenance) {
    provenance.innerHTML = item.provenance
      .map(
        ([name, value]) =>
          `<div class="provenance-item"><span>${escapeHtml(name)}</span><code>${escapeHtml(value)}</code></div>`,
      )
      .join("");
  }
}

function renderTamperSelect(): void {
  const select = document.querySelector<HTMLSelectElement>("#tamper-module");
  if (!select) return;
  select.innerHTML = modules
    .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)}</option>`)
    .join("");
}

function tamperLines(rows: Array<[string, string]>): string {
  return rows
    .map(([label, value]) => `<div class="tamper-line"><span class="label">${label}</span><span>${value}</span></div>`)
    .join("");
}

async function refreshBuilding(): Promise<LiveCheck> {
  const live = await checkBuilding();
  const item = buildingModule(live);
  modules[modules.findIndex((entry) => entry.id === "building")] = item;
  moduleById.set("building", item);
  renderModules();
  renderDetail();
  return live;
}

/** Building tamper is real: the reading changes in this browser and everything downstream is recomputed. */
async function renderBuildingTamper(injected: boolean): Promise<void> {
  const output = document.querySelector<HTMLDivElement>("#tamper-output");
  if (!output) return;
  setTampered(injected);
  const live = await refreshBuilding();
  const result = live.decided.climateCase.verifications[0]!.result;
  const stale = live.decided.statuses.filter((flag) => flag.state === "stale").length;
  const undecided = live.decided.statuses.filter((flag) => flag.state === "undecided").length;
  const valid = live.attestation.validForCurrentEvidence;
  const point = buildingService.analysis().anomalies.points[caseRun.tamper.index];
  const tag = (good: boolean, text: string) => '<span class="' + (good ? "good" : "bad") + '">' + escapeHtml(text) + "</span>";
  output.innerHTML = tamperLines([
    ...(injected ? [["mutation", escapeHtml("×" + caseRun.tamper.multiplier + " at " + caseRun.tamper.timestamp + ": now " + point?.value + " kWh, applied in this browser")] as [string, string]] : []),
    ["meter series", escapeHtml(live.decided.digest.value)],
    ["flags", escapeHtml(live.decided.statuses.length + " flagged · " + stale + " decisions stale (made on other data) · " + undecided + " undecided")],
    ["case verification", tag(result === "reconciled", result)],
    ["overall (with signature check)", tag(deriveResult(moduleById.get("building")!.checks) === "reconciled", deriveResult(moduleById.get("building")!.checks))],
    ["signed attestation", tag(valid, valid ? "matches the current evidence (Ed25519 and ML-DSA-65 checked here)" : "no longer matches the current evidence")],
    ...(valid ? [] : [["changed since signing", escapeHtml(live.attestation.changedRefs.map((ref) => ref.id).join(", "))] as [string, string]]),
    ["action", injected ? "Reset restores the committed reading; the signed attestation then matches again." : "Choose “Show tamper result” to change one reading in this browser."],
  ]);
}

/** Battery tamper is real: the last cycle's capacity changes in this browser and the passport is recomputed. */
async function renderBatteryTamper(injected: boolean): Promise<void> {
  const output = document.querySelector<HTMLDivElement>("#tamper-output");
  if (!output) return;
  setBatteryTampered(injected);
  const live = await checkBattery();
  const item = batteryModule(live);
  modules[modules.findIndex((entry) => entry.id === "battery")] = item;
  moduleById.set("battery", item);
  renderModules();
  renderDetail();
  const { built, attestation } = live;
  const result = built.caseBundle.verifications[0]!.result;
  const valid = attestation.validForCurrentEvidence;
  const tag = (good: boolean, text: string) => '<span class="' + (good ? "good" : "bad") + '">' + escapeHtml(text) + "</span>";
  output.innerHTML = tamperLines([
    ...(injected ? [["mutation", escapeHtml(item.tamper.change)] as [string, string]] : []),
    ["cycle history", escapeHtml(built.passport.inputDigest!.value)],
    ["state of health", escapeHtml((built.passport.currentSoh * 100).toFixed(2) + "% · disposition " + built.passport.disposition)],
    ["sign-off", escapeHtml(built.review[0]?.state + (built.review[0]?.state === "stale" ? " (made on a different cycle history)" : ""))],
    ["case verification", tag(result === "reconciled", result)],
    ["overall (with signature check)", tag(deriveResult(item.checks) === "reconciled", deriveResult(item.checks))],
    ["signed attestation", tag(valid, valid ? "matches the current evidence (Ed25519 and ML-DSA-65 checked here)" : "no longer matches the current evidence")],
    ...(valid ? [] : [["changed since signing", escapeHtml(attestation.changedRefs.map((ref) => ref.id).join(", "))] as [string, string]]),
    ["action", injected ? "Reset restores the committed history; the signed attestation then matches again." : "Choose “Show tamper result” to change one cycle in this browser."],
  ]);
}

/** Energy tamper is real: one load value changes in this browser and the case is recomputed. */
async function renderEnergyTamper(injected: boolean): Promise<void> {
  const output = document.querySelector<HTMLDivElement>("#tamper-output");
  if (!output) return;
  setEnergyTampered(injected);
  const live = await checkEnergy();
  const item = energyModule(live);
  modules[modules.findIndex((entry) => entry.id === "energy")] = item;
  moduleById.set("energy", item);
  renderModules();
  renderDetail();
  const { built, attestation } = live;
  const result = built.caseBundle.verifications[0]!.result;
  const valid = attestation.validForCurrentEvidence;
  const reproduced = built.comparisons.filter((row) => row.reproduced).length;
  const tag = (good: boolean, text: string) => '<span class="' + (good ? "good" : "bad") + '">' + escapeHtml(text) + "</span>";
  output.innerHTML = tamperLines([
    ...(injected ? [["mutation", escapeHtml(item.tamper.change)] as [string, string]] : []),
    ["series", escapeHtml(built.caseBundle.evidence[0]!.integrity!.value)],
    ["forecast", escapeHtml("mean LOAD_ACC " + built.confidence.toFixed(6) + " · published results reproduced " + reproduced + " of " + built.comparisons.length)],
    ["approval", escapeHtml((built.review[0]?.state ?? "not needed") + (built.review[0]?.state === "stale" ? " (made on a different series)" : ""))],
    ["case verification", tag(result === "reconciled", result)],
    ["overall (with signature check)", tag(deriveResult(item.checks) === "reconciled", deriveResult(item.checks))],
    ["signed attestation", tag(valid, valid ? "matches the current evidence (Ed25519 and ML-DSA-65 checked here)" : "no longer matches the current evidence")],
    ...(valid ? [] : [["changed since signing", escapeHtml(attestation.changedRefs.map((ref) => ref.id).join(", "))] as [string, string]]),
    ["action", injected ? "Reset restores the committed series; the signed attestation then matches again." : "Choose “Show tamper result” to change one load value in this browser."],
  ]);
}

/** Earth tamper is real: one NIR value changes in this browser and the case is recomputed. */
async function renderEarthTamper(injected: boolean): Promise<void> {
  const output = document.querySelector<HTMLDivElement>("#tamper-output");
  if (!output) return;
  setEarthTampered(injected);
  const live = await checkEarth();
  const item = earthModule(live);
  modules[modules.findIndex((entry) => entry.id === "earth")] = item;
  moduleById.set("earth", item);
  renderModules();
  renderDetail();
  const { built, attestation } = live;
  const result = built.caseBundle.verifications[0]!.result;
  const valid = attestation.validForCurrentEvidence;
  const tag = (good: boolean, text: string) => '<span class="' + (good ? "good" : "bad") + '">' + escapeHtml(text) + "</span>";
  output.innerHTML = tamperLines([
    ...(injected ? [["mutation", escapeHtml(item.tamper.change)] as [string, string]] : []),
    ["NIR", escapeHtml(built.caseBundle.evidence[0]!.integrity!.value)],
    ["detector", escapeHtml("detected " + built.result.metrics.predictedHectares.toFixed(2) + " ha · pinned run reproduced: " + (built.reproduced ? "yes" : "no"))],
    ["area decision", escapeHtml((built.review[0]?.state ?? "not needed") + (built.review[0]?.state === "stale" ? " (made on different arrays)" : ""))],
    ["case verification", tag(result === "reconciled", result)],
    ["overall (with signature check)", tag(deriveResult(item.checks) === "reconciled", deriveResult(item.checks))],
    ["signed attestation", tag(valid, valid ? "matches the current evidence (Ed25519 and ML-DSA-65 checked here)" : "no longer matches the current evidence")],
    ...(valid ? [] : [["changed since signing", escapeHtml(attestation.changedRefs.map((ref) => ref.id).join(", "))] as [string, string]]),
    ["action", injected ? "Reset restores the committed arrays; the signed attestation then matches again." : "Choose “Show tamper result” to change one NIR value in this browser."],
  ]);
}

function renderTamper(id: string, injected: boolean): void {
  if (id === "earth") {
    void renderEarthTamper(injected);
    return;
  }
  if (id === "energy") {
    void renderEnergyTamper(injected);
    return;
  }
  if (id === "building") {
    void renderBuildingTamper(injected);
    return;
  }
  if (id === "battery") {
    void renderBatteryTamper(injected);
    return;
  }
  const item = moduleById.get(id);
  const output = document.querySelector<HTMLDivElement>("#tamper-output");
  if (!item || !output) return;
  const recorded = Boolean(item.tamper.rootAfter);
  const result = deriveResult(item.checks);

  if (!injected) {
    output.innerHTML = tamperLines([
      ["input", escapeHtml(item.tamper.before)],
      ["verification", '<span class="' + (result === "reconciled" ? "good" : "bad") + '">' + escapeHtml(result) + "</span>"],
      [
        "action",
        recorded
          ? "Choose “Show tamper result” to see what the recorded tamper run produced."
          : "No tamper run is recorded for this module yet; “Show tamper result” describes the expected effect only.",
      ],
    ]);
    return;
  }

  if (!recorded) {
    output.innerHTML = tamperLines([
      ["mutation", escapeHtml(item.tamper.change)],
      ["expected effect", escapeHtml(item.tamper.after)],
      ["status", "not run: no recorded tamper result for this module"],
    ]);
    return;
  }

  output.innerHTML = tamperLines([
    ["recorded mutation", escapeHtml(item.tamper.change)],
    ["recorded result", '<span class="bad">' + escapeHtml(item.tamper.after) + "</span>"],
    ["original digest", escapeHtml(item.tamper.rootBefore ?? "")],
    ["tampered digest", '<span class="bad">' + escapeHtml(item.tamper.rootAfter ?? "") + "</span>"],
    ["meaning", "anything committed to the original digest no longer matches the changed evidence"],
  ]);
}

function renderActivity(): void {
  const container = document.querySelector<HTMLDivElement>("#activity-log");
  if (!container) return;
  const entries = activity.list().slice(-30).reverse();
  container.innerHTML = entries.length
    ? entries
        .map(
          (event) => `
          <div class="activity-entry">
            <time>${escapeHtml(event.at.slice(11, 19))}</time>
            <strong>${escapeHtml(event.tool)}</strong>
            <em>${escapeHtml(event.phase)}</em>
          </div>`,
        )
        .join("")
    : '<p class="muted">No tool calls yet. Run the guided audit or use WebMCP.</p>';
}

async function guidedAudit(): Promise<void> {
  const calls: Array<[string, Record<string, unknown>]> = [
    ["climate_list_capabilities", { caseId: demoCase.caseId }],
    ["building_run_baseline", { caseId: buildingCaseId }],
    ["building_review_flags", { caseId: buildingCaseId }],
    ["building_reconstruct_emissions", { caseId: buildingCaseId }],
    ["carbon_reconcile_registry_records", { caseId: demoCase.caseId }],
    ["disclosure_get_public_claim", { caseId: demoCase.caseId }],
  ];

  for (const [tool, input] of calls) {
    await surface.executeFallback(tool, input);
    renderActivity();
  }

  activeId = "building";
  renderModules();
  renderDetail();
  document.querySelector("#agent")?.scrollIntoView({ behavior: "smooth" });
}

document.querySelector("#tamper-button")?.addEventListener("click", () => {
  const select = document.querySelector<HTMLSelectElement>("#tamper-module");
  renderTamper(select?.value ?? "building", true);
});

document.querySelector("#reset-button")?.addEventListener("click", () => {
  const select = document.querySelector<HTMLSelectElement>("#tamper-module");
  renderTamper(select?.value ?? "building", false);
});

document.querySelector("#tamper-module")?.addEventListener("change", (event) => {
  renderTamper((event.target as HTMLSelectElement).value, false);
});

document.querySelector("#run-agent-audit")?.addEventListener("click", () => void guidedAudit());
document.querySelector("#run-agent-audit-2")?.addEventListener("click", () => void guidedAudit());
document.querySelector("#clear-activity")?.addEventListener("click", () => {
  activity.clear();
  renderActivity();
});

renderModules();
renderDetail();
renderTamperSelect();
renderTamper("building", false);
renderActivity();
