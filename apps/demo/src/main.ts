import {
  CLIMATECHAIN_SCHEMA_VERSION,
  type ClimateCaseBundle,
  type ClimateNode,
  type ContentDigest,
  type NodeRef,
  type Claim,
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
import { renderCaseMap } from "./map-view.js";
import {
  carbonCaseId,
  carbonRun,
  carbonService,
  checkCarbon,
  setCarbonTampered,
  type CarbonCheck,
} from "./carbon-live.js";
import {
  checkDisclosure,
  disclosureCaseId,
  disclosureInput,
  disclosureRun,
  disclosureService,
  setDisclosureTampered,
  type DisclosureCheck,
} from "./disclosure-live.js";
import { checkEarth, earthCaseId, earthRun, earthService, setEarthTampered, type EarthCheck } from "./earth-live.js";
import batteryReport from "../../../reports/battery-dpp/batterylife-calb-smoke.json";
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
const cadiData = cadi as JsonObject;

const short = (digest: ContentDigest) => digest.value.slice(0, 16) + "…";

/** The case's own result as a check, so the overall status never reads better than the case does. */
function caseCheck(verification: Verification): VerificationCheck {
  const { result } = verification;
  return {
    id: "case-result",
    name: "Case result: " + result,
    outcome: result === "reconciled" ? "pass" : result === "insufficient-evidence" ? "warn" : "fail",
    detail: verification.findings[0],
  };
}

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
    title: "Building emissions",
    icon: "▦",
    kicker: "Meter readings rebuilt into emissions; flagged readings decided by a person",
    kpi: emissions.emissionsTCo2e.toFixed(2),
    kpiLabel: "tCO₂e, recomputed in this browser",
    source: "BDG2 v1.0 + EPA eGRID2016",
    decisionTitle: "Facility energy manager: " + decidedCount + " of " + flags.length + " flagged readings decided",
    decisionCopy:
      caseRun.organisingQuestion +
      " A decision model advised on each flagged reading; a person decided. The advice never sets a status.",
    decisions: [
      ...flags.map((flag): [string, string] => {
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
      ...contextRows(verification),
      ...boundaryRows(decided.climateCase.claims[0]!),
    ],
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
      caseCheck(verification),
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
    title: "Battery passport",
    icon: "▣",
    kicker: "Cycle history rebuilt into state of health; reuse signed off by a person",
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
            ["Counts", boundary.included.join("\n")],
            ["Policy choices", boundary.policyChoices.join("\n")],
            ["Not assessed", boundary.notAssessed.join("\n")],
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
      caseCheck(verification),
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
    title: "Energy forecast",
    icon: "↯",
    kicker: "Published forecast accuracy reproduced; a capped action approved by a person",
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
            ["Counts", boundary.included.join("\n")],
            ["Policy choices", boundary.policyChoices.join("\n")],
            ["Not assessed", boundary.notAssessed.join("\n")],
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
      caseCheck(verification),
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

/** Context findings (e.g. Open Climate Risk) as rows: modelled values that no check reads. */
function boundaryRows(claim: Claim): Array<[string, string]> {
  const boundary = claim.boundary?.accounting;
  return boundary
    ? [
        ["Counts", boundary.included.join("\n")],
        ["Leaves out", boundary.excluded.join("\n")],
        ["Policy choices", boundary.policyChoices.join("\n")],
        ["Not assessed", boundary.notAssessed.join("\n")],
      ]
    : [];
}

function contextRows(verification: Verification): Array<[string, string]> {
  return verification.findings
    .filter((finding) => finding.startsWith("Context, not evidence"))
    .map((finding) => ["Wildfire context", finding.replace("Context, not evidence: ", "")]);
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
    title: "Burn scar from satellite",
    icon: "◉",
    kicker: "Burned area detected pixel by pixel and compared with the reference map",
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
      ...contextRows(built.caseBundle.verifications[0]!),
      ...(boundary
        ? ([
            ["Counts", boundary.included.join("\n")],
            ["Policy choices", boundary.policyChoices.join("\n")],
            ["Not assessed", boundary.notAssessed.join("\n")],
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
      caseCheck(verification),
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

function disclosureModule(live: DisclosureCheck): DemoModule {
  const { built, attestation } = live;
  const verification = built.caseBundle.verifications[0]!;
  const claim = built.caseBundle.claims[0]!;
  const status = built.review[0]!;
  const value = claim.assertion.kind === "quantitative" ? claim.assertion.quantity : undefined;
  const source = built.caseBundle.evidence[1]!.source.uri ?? "";
  const ed25519 = attestation.signature.signatures.find((item) => item.signature.algorithm === "Ed25519");
  const mlDsa = attestation.signature.signatures.find((item) => item.signature.algorithm === "ML-DSA-65");
  return {
    id: "disclosure",
    title: "Company disclosure",
    icon: "◫",
    kicker: "A reported figure that cannot be recalculated; a person decides what it may rest on",
    kpi: value ? String(value.value) : "—",
    kpiLabel: value ? value.unit + " Scope 1, as reported" : "source-only",
    source: "CaDI-confirmed first-party sources",
    decisionTitle:
      "Sustainability reviewer: " +
      (status.state === "decided" ? status.decision!.decision : status.state === "stale" ? "decision stale" : "awaiting decision"),
    decisionCopy:
      disclosureRun.organisingQuestion +
      " The figure cannot be recalculated from public data, so a person decides what the claim rests on.",
    decisions: [
      [
        claim.subject.name + " " + (value ? value.value + " " + value.unit : ""),
        status.state === "undecided" || !status.decision ? status.state : status.state + ": " + status.decision.decision + " by " + status.decision.decidedBy,
      ],
      ...(status.decision ? [["Reason", status.decision.reason] as [string, string]] : []),
      ...boundaryRows(claim),
    ],
    limitation:
      "Accepted as attributed means the claim rests on the company's own statement: nothing is recalculated, and the verification the page attributes to Carbon Footprint Ltd is not inspected. The page is link-only and may change. Signing keys are per-run demo keys.",
    metrics: [
      ["Confirmed CaDI candidates", String(cadiData.candidates.length)],
      ["Numeric case", claim.subject.name ?? "—"],
      ["Period", claim.temporalScope?.label ?? "—"],
      ["Reported value", value ? value.value + " " + value.unit : "—"],
      ["Calculation reproduced", "not assessed"],
    ],
    provenance: [
      ["Claim ID", claim.id],
      ["Source (link-only)", source],
      ["Evidence root (now)", short(attestation.currentRoot)],
      ["Evidence root (signed)", short(disclosureRun.attestation.payload.evidenceRoot)],
      ["Signed", disclosureRun.runAt + " · Ed25519 + ML-DSA-65"],
    ],
    checks: [
      caseCheck(verification),
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
      before: disclosureInput.tamper.from + " tCO2e",
      change:
        "Extracted value " + disclosureInput.tamper.from + " → " + disclosureInput.tamper.to + " tCO2e (" +
        disclosureInput.tamper.note.toLowerCase() + "), applied in this browser",
      after: "",
      rootBefore: disclosureRun.attestation.payload.evidenceRoot.value,
    },
  };
}

function carbonModule(live: CarbonCheck): DemoModule {
  const { built, attestation } = live;
  const report = built.report;
  const verification = built.caseBundle.verifications[0]!;
  const claim = built.caseBundle.claims[0]!;
  const ed25519 = attestation.signature.signatures.find((item) => item.signature.algorithm === "Ed25519");
  const mlDsa = attestation.signature.signatures.find((item) => item.signature.algorithm === "ML-DSA-65");
  const imported = built.caseBundle.evidence.filter((item) => item.access?.mode === "reviewer-supplied");
  return {
    id: "carbon",
    title: "Carbon registry records",
    icon: "◎",
    kicker: "Issuances and retirements reconciled; record gaps decided by a person",
    kpi: String(report.recordCount),
    kpiLabel: "registry records reconciled in this browser",
    source: "ACR public reports via CarbonPlan OffsetsDB",
    decisionTitle:
      "Carbon-market auditor: " +
      built.review.map((status) => (status.state === "decided" ? status.decision!.decision : status.state)).join(" / "),
    decisionCopy:
      carbonRun.organisingQuestion +
      " Duplicates and over-retirement are mismatches; a retirement with no issuance in the records is a gap a person decides.",
    decisions: [
      ...built.review.map((status): [string, string] => [
        status.flag.label,
        status.state === "undecided" || !status.decision ? status.state : status.state + ": " + status.decision.decision + " by " + status.decision.decidedBy,
      ]),
      ...built.review.flatMap((status) => (status.decision ? [["Reason", status.decision.reason] as [string, string]] : [])),
      ...boundaryRows(claim),
    ],
    limitation:
      "The ACR records are a 100-row test sample, not the full registry. Duplicates are exact serial-range matches. Durability, additionality and project quality are not assessed. Reports a reviewer brings are kept as digests only. Signing keys are per-run demo keys.",
    metrics: [
      ["Records", String(report.recordCount)],
      ["Retirements within issuance", String(report.supportedCount)],
      ["Issued, not retired", String(report.issuedNotRetiredCount)],
      ["Retirement groups without issuance", report.unresolvedMissingIssuanceCount + " (" + built.coverage.beforeWindow + " issued before " + Object.values(built.coverage.windowStart).join(", ") + ")"],
      ["Duplicate serial ranges", String(report.duplicateExcessCount)],
      ["Reports brought by the reviewer", String(imported.length)],
    ],
    provenance: [
      ["Records", "data/external/acr-offsetsdb (ACR public reports, cited per ACR's terms)"],
      ...imported.map((item): [string, string] => ["Brought (digest only)", item.source.uri + " · " + short(item.integrity!)]),
      ["Evidence root (now)", short(attestation.currentRoot)],
      ["Evidence root (signed)", short(carbonRun.attestation.payload.evidenceRoot)],
      ["Signed", carbonRun.runAt + " · Ed25519 + ML-DSA-65"],
    ],
    checks: [
      caseCheck(verification),
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
      before: report.duplicateExcessCount + " duplicate serial ranges",
      change: "Retirement " + carbonRun.tamper.duplicated + " appears twice, applied in this browser",
      after: "",
      rootBefore: carbonRun.attestation.payload.evidenceRoot.value,
    },
  };
}

const modules: DemoModule[] = [
  buildingModule(await checkBuilding()),
  energyModule(await checkEnergy()),
  earthModule(await checkEarth()),
  batteryModule(await checkBattery()),
  carbonModule(await checkCarbon()),
  disclosureModule(await checkDisclosure()),
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
    if (caseId === carbonCaseId) return (await carbonService.review()).caseBundle;
    if (caseId === disclosureCaseId) return (await disclosureService.review()).caseBundle;
    return !caseId || caseId === demoCase.caseId ? demoCase : undefined;
  }

  async listCases(): Promise<ClimateCaseBundle[]> {
    return [
      demoCase,
      (await buildingService.decidedCase()).climateCase,
      (await batteryService.passport()).caseBundle,
      (await energyService.build()).caseBundle,
      (await earthService.build()).caseBundle,
      (await disclosureService.review()).caseBundle,
      (await carbonService.review()).caseBundle,
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


const router: ModuleCommandRouter = {
  async execute(moduleId, toolName, input) {
    const item = moduleById.get(moduleId);
    if (!item) throw new Error("Unknown demo module: " + moduleId);
    // Building runs the real service on the committed data, the same one the page renders from.
    if (moduleId === "building") return buildingService.execute("building-mrv", toolName, input);
    if (moduleId === "battery") return batteryService.execute("battery-dpp", toolName, input);
    if (moduleId === "energy") return energyService.execute("energy-forecast", toolName, input);
    if (moduleId === "earth") return earthService.execute("earth-observation", toolName, input);
    if (moduleId === "disclosure") {
      return disclosureService.execute("disclosure", toolName, {
        candidateId: disclosureInput.candidateId,
        claimId: disclosureInput.claimId,
        ...input,
      });
    }
    if (moduleId === "carbon") return carbonService.execute("carbon-registry", toolName, { ...input, caseId: carbonCaseId });
    throw new Error("Unknown demo module: " + moduleId);
  },
};

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
        "carbon_import_registry_report",
        "carbon_review_records",
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
        "disclosure_review_claim",
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
    badge.textContent = "No WebMCP in this browser · guided audit ready";
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

const RESULT_WORDS: Record<string, string> = {
  reconciled: "Verified",
  "insufficient-evidence": "Needs evidence",
  mismatch: "Mismatch",
  "source-changed": "Source changed",
};

/** A status as a word with a colour; the word carries the meaning, the colour only reinforces it. */
function stateHtml(tone: "good" | "bad" | "warn", text: string): string {
  return '<strong class="state ' + tone + '">' + escapeHtml(text) + "</strong>";
}

function resultHtml(result: string): string {
  return stateHtml(result === "reconciled" ? "good" : result === "insufficient-evidence" ? "warn" : "bad", RESULT_WORDS[result] ?? result);
}

/** A definition list; a value holding several lines becomes a bulleted list. */
function dlHtml(rows: Array<[string, string]>): string {
  return rows
    .map(([name, value]) => {
      const lines = value.split("\n").filter(Boolean);
      const body = lines.length > 1 ? "<ul>" + lines.map((line) => "<li>" + escapeHtml(line) + "</li>").join("") + "</ul>" : escapeHtml(value);
      return "<div><dt>" + escapeHtml(name) + "</dt><dd>" + body + "</dd></div>";
    })
    .join("");
}

function claimSummary(item: DemoModule): string {
  return (
    '<span class="claim-title">' + escapeHtml(item.title) + "</span>" +
    '<span class="claim-what">' + escapeHtml(item.kicker) +
    '<span class="claim-figure">' + escapeHtml(item.kpi + " " + item.kpiLabel) + "</span></span>" +
    "<span>" + resultHtml(deriveResult(item.checks)) + "</span>"
  );
}

/** Builds the claim list once; later calls only refresh each summary, so an open claim stays open. */
function renderModules(): void {
  const list = document.querySelector<HTMLDivElement>("#claim-list");
  if (!list) return;
  if (!list.children.length) {
    list.innerHTML = modules
      .map((item) => '<details class="claim" data-module="' + escapeHtml(item.id) + '"><summary></summary></details>')
      .join("");
    list.querySelectorAll<HTMLDetailsElement>("details.claim").forEach((row) => {
      row.addEventListener("toggle", () => {
        if (!row.open) return;
        list.querySelectorAll<HTMLDetailsElement>("details.claim[open]").forEach((other) => {
          if (other !== row) other.open = false;
        });
        activeId = row.dataset.module ?? "building";
        const body = document.querySelector("#detail-body");
        if (body) row.append(body);
        renderDetail();
        renderTamper(activeId, false);
      });
    });
  }
  for (const item of modules) {
    const summary = list.querySelector('details[data-module="' + item.id + '"] > summary');
    if (summary) summary.innerHTML = claimSummary(item);
  }
}

function openClaim(id: string): void {
  const row = document.querySelector<HTMLDetailsElement>('details.claim[data-module="' + id + '"]');
  if (!row) return;
  row.open = true;
  row.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderDetail(): void {
  const item = moduleById.get(activeId);
  if (!item) return;
  const set = (selector: string, html: string) => {
    const node = document.querySelector(selector);
    if (node) node.innerHTML = html;
  };
  set("#detail-source", escapeHtml(item.source));
  set("#decision-title", escapeHtml(item.decisionTitle));
  set("#decision-copy", escapeHtml(item.decisionCopy));
  set("#limitations", escapeHtml(item.limitation));
  set("#metric-list", dlHtml(item.metrics));
  set("#decision-list", dlHtml(item.decisions ?? []));
  set("#provenance-list", dlHtml(item.provenance));
  set(
    "#check-list",
    "<li><span>Overall, all checks below</span>" + resultHtml(deriveResult(item.checks)) + "</li>" +
      item.checks
        .map(
          (check) =>
            "<li><span>" + escapeHtml(check.name) + "</span>" +
            stateHtml(check.outcome === "pass" ? "good" : check.outcome === "fail" ? "bad" : "warn", check.outcome) +
            (check.detail ? "<small>" + escapeHtml(check.detail) + "</small>" : "") + "</li>",
        )
        .join(""),
  );
}

/** The building case, told as five steps, plus the claim stub at the top of the page. */
function renderStory(live: LiveCheck): void {
  const { decided, attestation } = live;
  const emissions = decided.analysis.emissions;
  const flags = decided.statuses;
  const decidedCount = flags.filter((flag) => flag.state === "decided").length;
  const stale = flags.filter((flag) => flag.state === "stale").length;
  const result = decided.climateCase.verifications[0]!.result;
  const signature = (algorithm: string) => {
    const found = attestation.signature.signatures.find((item) => item.signature.algorithm === algorithm);
    return found?.signatureValid && attestation.validForCurrentEvidence
      ? stateHtml("good", "matches")
      : stateHtml("bad", "no longer matches");
  };
  const set = (selector: string, html: string) => {
    const node = document.querySelector(selector);
    if (node) node.innerHTML = html;
  };
  const tonnes = emissions.emissionsTCo2e.toFixed(2);
  set("#stub-value", tonnes);
  set("#stub-rebuilt", resultHtml(result));
  set("#stub-flags", stale ? stateHtml("bad", stale + " of " + flags.length + " stale") : stateHtml(decidedCount === flags.length ? "good" : "warn", decidedCount + " of " + flags.length));
  set("#stub-ed", signature("Ed25519"));
  set("#stub-ml", signature("ML-DSA-65"));

  set(
    "#step-measure",
    '<span class="figure-big">' + emissions.acceptedEnergyMWh.toFixed(2) + " MWh</span>" +
      '<span class="figure-cap">accepted electricity, from ' + decided.analysis.anomalies.points.length.toLocaleString("en-US") +
      " readings rebuilt in your browser</span>",
  );
  set(
    "#step-flag",
    '<ul class="flag-list">' +
      flags
        .map((flag) => {
          const run = adviceRuns.find((item) => item.inferenceParameters.interval === flag.timestamp);
          const advice = run && run.output.kind === "qualitative"
            ? "Model advice: " + run.output.statement.replace("advice: ", "").replaceAll("_", " ") + " (" + run.confidence?.toFixed(2) + "), " + (run.extensions?.handOff ?? "needs a person")
            : "No advice recorded";
          return "<li><time>" + escapeHtml(flag.timestamp.slice(0, 16)) + "</time><span>" + escapeHtml(advice) + "</span></li>";
        })
        .join("") +
      "</ul>",
  );
  const choices = [...new Set(flags.filter((flag) => flag.decision).map((flag) => flag.decision!.decision + " by " + flag.decision!.decidedBy))];
  set(
    "#step-decide",
    '<span class="figure-big">' + decidedCount + " of " + flags.length + " decided</span>" +
      '<span class="figure-cap">' +
      (stale
        ? escapeHtml(stale + " decisions are stale: they were made on different meter data.")
        : escapeHtml(choices.join("; ") + ". Nothing flagged counts until a person keeps it.")) +
      "</span>",
  );
  set(
    "#step-sign",
    '<span class="figure-big">' + tonnes + " tCO₂e</span>" +
      '<ul class="flag-list"><li><span>Ed25519</span>' + signature("Ed25519") + "</li>" +
      "<li><span>ML-DSA-65</span>" + signature("ML-DSA-65") + "</li></ul>" +
      '<span class="figure-cap">Signed ' + escapeHtml(caseRun.runAt.slice(0, 10)) + "; checked just now in your browser.</span>",
  );
  set("#case-boundary", dlHtml(boundaryRows(decided.climateCase.claims[0]!)));
}

const tamperOutput = () => document.querySelector<HTMLDivElement>("#tamper-output");

function tamperLines(rows: Array<[string, string]>): string {
  return rows
    .map(([label, value]) => `<div class="tamper-line"><span class="label">${label}</span><span>${value}</span></div>`)
    .join("");
}

/** A tamper result: the verdict in words first, then the evidence for it. */
function showTamper(output: HTMLElement | null, valid: boolean, rows: Array<[string, string]>): void {
  if (!output) return;
  output.classList.toggle("is-good", valid);
  output.classList.toggle("is-bad", !valid);
  output.innerHTML =
    '<p class="verdict ' + (valid ? "good" : "bad") + '">' +
    (valid ? "Both signatures match the evidence." : "The signatures no longer match the evidence.") +
    "</p>" + tamperLines(rows);
}

async function refreshBuilding(): Promise<LiveCheck> {
  const live = await checkBuilding();
  const item = buildingModule(live);
  modules[modules.findIndex((entry) => entry.id === "building")] = item;
  moduleById.set("building", item);
  renderModules();
  renderDetail();
  renderStory(live);
  return live;
}

/** Building tamper is real: the reading changes in this browser and everything downstream is recomputed. */
async function renderBuildingTamper(injected: boolean, output = tamperOutput()): Promise<void> {
  if (!output) return;
  setTampered(injected);
  const live = await refreshBuilding();
  const result = live.decided.climateCase.verifications[0]!.result;
  const stale = live.decided.statuses.filter((flag) => flag.state === "stale").length;
  const undecided = live.decided.statuses.filter((flag) => flag.state === "undecided").length;
  const valid = live.attestation.validForCurrentEvidence;
  const point = buildingService.analysis().anomalies.points[caseRun.tamper.index];
  const tag = (good: boolean, text: string) => '<span class="' + (good ? "good" : "bad") + '">' + escapeHtml(text) + "</span>";
  showTamper(output, valid, [
    ...(injected ? [["mutation", escapeHtml("×" + caseRun.tamper.multiplier + " at " + caseRun.tamper.timestamp + ": now " + point?.value + " kWh, applied in this browser")] as [string, string]] : []),
    ["meter series", escapeHtml(live.decided.digest.value)],
    ["flags", escapeHtml(live.decided.statuses.length + " flagged · " + stale + " decisions stale (made on other data) · " + undecided + " undecided")],
    ["case verification", tag(result === "reconciled", result)],
    ["overall (with signature check)", tag(deriveResult(moduleById.get("building")!.checks) === "reconciled", deriveResult(moduleById.get("building")!.checks))],
    ["signed attestation", tag(valid, valid ? "matches the current evidence (Ed25519 and ML-DSA-65 checked here)" : "no longer matches the current evidence")],
    ...(valid ? [] : [["changed since signing", escapeHtml(live.attestation.changedRefs.map((ref) => ref.id).join(", "))] as [string, string]]),
    ["action", injected ? "Reset restores the committed reading; the signed attestation then matches again." : "Press “Change one reading” to multiply one reading by 20 in this browser."],
  ]);
}

/** Battery tamper is real: the last cycle's capacity changes in this browser and the passport is recomputed. */
async function renderBatteryTamper(injected: boolean, output = tamperOutput()): Promise<void> {
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
  showTamper(output, valid, [
    ...(injected ? [["mutation", escapeHtml(item.tamper.change)] as [string, string]] : []),
    ["cycle history", escapeHtml(built.passport.inputDigest!.value)],
    ["state of health", escapeHtml((built.passport.currentSoh * 100).toFixed(2) + "% · disposition " + built.passport.disposition)],
    ["sign-off", escapeHtml(built.review[0]?.state + (built.review[0]?.state === "stale" ? " (made on a different cycle history)" : ""))],
    ["case verification", tag(result === "reconciled", result)],
    ["overall (with signature check)", tag(deriveResult(item.checks) === "reconciled", deriveResult(item.checks))],
    ["signed attestation", tag(valid, valid ? "matches the current evidence (Ed25519 and ML-DSA-65 checked here)" : "no longer matches the current evidence")],
    ...(valid ? [] : [["changed since signing", escapeHtml(attestation.changedRefs.map((ref) => ref.id).join(", "))] as [string, string]]),
    ["action", injected ? "Reset restores the committed history; the signed attestation then matches again." : "Press “Change one input” to change one cycle in this browser."],
  ]);
}

/** Energy tamper is real: one load value changes in this browser and the case is recomputed. */
async function renderEnergyTamper(injected: boolean, output = tamperOutput()): Promise<void> {
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
  showTamper(output, valid, [
    ...(injected ? [["mutation", escapeHtml(item.tamper.change)] as [string, string]] : []),
    ["series", escapeHtml(built.caseBundle.evidence[0]!.integrity!.value)],
    ["forecast", escapeHtml("mean LOAD_ACC " + built.confidence.toFixed(6) + " · published results reproduced " + reproduced + " of " + built.comparisons.length)],
    ["approval", escapeHtml((built.review[0]?.state ?? "not needed") + (built.review[0]?.state === "stale" ? " (made on a different series)" : ""))],
    ["case verification", tag(result === "reconciled", result)],
    ["overall (with signature check)", tag(deriveResult(item.checks) === "reconciled", deriveResult(item.checks))],
    ["signed attestation", tag(valid, valid ? "matches the current evidence (Ed25519 and ML-DSA-65 checked here)" : "no longer matches the current evidence")],
    ...(valid ? [] : [["changed since signing", escapeHtml(attestation.changedRefs.map((ref) => ref.id).join(", "))] as [string, string]]),
    ["action", injected ? "Reset restores the committed series; the signed attestation then matches again." : "Press “Change one input” to change one load value in this browser."],
  ]);
}

/** Carbon tamper is real: one retirement is duplicated in this browser and the case is rebuilt. */
async function renderCarbonTamper(injected: boolean, output = tamperOutput()): Promise<void> {
  if (!output) return;
  setCarbonTampered(injected);
  await rerenderCarbon();
  const live = await checkCarbon();
  const item = moduleById.get("carbon")!;
  const result = live.built.caseBundle.verifications[0]!.result;
  const valid = live.attestation.validForCurrentEvidence;
  const tag = (good: boolean, text: string) => '<span class="' + (good ? "good" : "bad") + '">' + escapeHtml(text) + "</span>";
  showTamper(output, valid, [
    ...(injected ? [["mutation", escapeHtml(item.tamper.change)] as [string, string]] : []),
    ["duplicates", escapeHtml(String(live.built.report.duplicateExcessCount))],
    ["coverage decisions", escapeHtml(live.built.review.map((status) => status.state).join(" / "))],
    ["case verification", tag(result === "reconciled", result)],
    ["signed attestation", tag(valid, valid ? "matches the current evidence (Ed25519 and ML-DSA-65 checked here)" : "no longer matches the current evidence")],
    ...(valid ? [] : [["changed since signing", escapeHtml(live.attestation.changedRefs.map((ref) => ref.id).join(", "))] as [string, string]]),
    ["action", injected ? "Reset restores the committed records; the signed attestation then matches again." : "Press “Change one input” to duplicate one retirement in this browser."],
  ]);
}

/** Rebuilds the carbon card from the current records and any reports the reviewer brought. */
async function rerenderCarbon(): Promise<void> {
  const item = carbonModule(await checkCarbon());
  modules[modules.findIndex((entry) => entry.id === "carbon")] = item;
  moduleById.set("carbon", item);
  renderModules();
  renderDetail();
}

/** A report the reviewer downloaded from CAR or Gold Standard: read locally, kept as a digest only. */
document.querySelector<HTMLFormElement>("#carbon-import")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget as HTMLFormElement);
  const file = form.get("file");
  const status = document.querySelector<HTMLOutputElement>("#carbon-import-status");
  if (!(file instanceof File) || file.size === 0 || !status) return;
  void (async () => {
    try {
      const result = await carbonService.importReport({
        registry: String(form.get("registry")) as "climate-action-reserve" | "gold-standard",
        kind: String(form.get("kind")) as "issuance" | "retirement",
        csv: await file.text(),
        sourceUri: String(form.get("sourceUri")),
        downloadedAt: new Date().toISOString(),
      });
      status.textContent = result.records + " records brought; digest " + result.digest.value.slice(0, 16) + "…. The records stay in this browser.";
      activeId = "carbon";
      await rerenderCarbon();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  })();
});
document.querySelector("#carbon-import-clear")?.addEventListener("click", () => {
  carbonService.clearImports();
  void rerenderCarbon();
});

/** Disclosure tamper is real: the extracted figure changes in this browser and the case is rebuilt. */
async function renderDisclosureTamper(injected: boolean, output = tamperOutput()): Promise<void> {
  if (!output) return;
  setDisclosureTampered(injected);
  const live = await checkDisclosure();
  const item = disclosureModule(live);
  modules[modules.findIndex((entry) => entry.id === "disclosure")] = item;
  moduleById.set("disclosure", item);
  renderModules();
  renderDetail();
  const { built, attestation } = live;
  const result = built.caseBundle.verifications[0]!.result;
  const valid = attestation.validForCurrentEvidence;
  const tag = (good: boolean, text: string) => '<span class="' + (good ? "good" : "bad") + '">' + escapeHtml(text) + "</span>";
  showTamper(output, valid, [
    ...(injected ? [["mutation", escapeHtml(item.tamper.change)] as [string, string]] : []),
    ["claim", escapeHtml(item.kpi + " " + item.kpiLabel)],
    ["decision", escapeHtml(built.review[0]!.state + (built.review[0]!.state === "stale" ? " (made on a different figure)" : ""))],
    ["case verification", tag(result === "reconciled", result)],
    ["overall (with signature check)", tag(deriveResult(item.checks) === "reconciled", deriveResult(item.checks))],
    ["signed attestation", tag(valid, valid ? "matches the current evidence (Ed25519 and ML-DSA-65 checked here)" : "no longer matches the current evidence")],
    ...(valid ? [] : [["changed since signing", escapeHtml(attestation.changedRefs.map((ref) => ref.id).join(", "))] as [string, string]]),
    ["action", injected ? "Reset restores the committed figure; the signed attestation then matches again." : "Press “Change one input” to change the extracted figure in this browser."],
  ]);
}

/** Earth tamper is real: one NIR value changes in this browser and the case is recomputed. */
async function renderEarthTamper(injected: boolean, output = tamperOutput()): Promise<void> {
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
  showTamper(output, valid, [
    ...(injected ? [["mutation", escapeHtml(item.tamper.change)] as [string, string]] : []),
    ["NIR", escapeHtml(built.caseBundle.evidence[0]!.integrity!.value)],
    ["detector", escapeHtml("detected " + built.result.metrics.predictedHectares.toFixed(2) + " ha · pinned run reproduced: " + (built.reproduced ? "yes" : "no"))],
    ["area decision", escapeHtml((built.review[0]?.state ?? "not needed") + (built.review[0]?.state === "stale" ? " (made on different arrays)" : ""))],
    ["case verification", tag(result === "reconciled", result)],
    ["overall (with signature check)", tag(deriveResult(item.checks) === "reconciled", deriveResult(item.checks))],
    ["signed attestation", tag(valid, valid ? "matches the current evidence (Ed25519 and ML-DSA-65 checked here)" : "no longer matches the current evidence")],
    ...(valid ? [] : [["changed since signing", escapeHtml(attestation.changedRefs.map((ref) => ref.id).join(", "))] as [string, string]]),
    ["action", injected ? "Reset restores the committed arrays; the signed attestation then matches again." : "Press “Change one input” to change one NIR value in this browser."],
  ]);
}

const tamperRenderers: Record<string, (injected: boolean, output?: HTMLElement | null) => Promise<void>> = {
  building: renderBuildingTamper,
  battery: renderBatteryTamper,
  energy: renderEnergyTamper,
  earth: renderEarthTamper,
  carbon: renderCarbonTamper,
  disclosure: renderDisclosureTamper,
};

function renderTamper(id: string, injected: boolean, output: HTMLElement | null = tamperOutput()): void {
  void tamperRenderers[id]?.(injected, output);
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
    : '<p class="note">No tool calls yet. Run the guided audit, or connect an agent through WebMCP.</p>';
}

async function guidedAudit(): Promise<void> {
  const calls: Array<[string, Record<string, unknown>]> = [
    ["climate_list_capabilities", { caseId: demoCase.caseId }],
    ["building_run_baseline", { caseId: buildingCaseId }],
    ["building_review_flags", { caseId: buildingCaseId }],
    ["building_reconstruct_emissions", { caseId: buildingCaseId }],
    ["carbon_review_records", { caseId: carbonCaseId }],
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

const caseMap = document.querySelector<HTMLElement>("#case-map");
if (caseMap) renderCaseMap(caseMap, openClaim);

const storyOutput = () => document.querySelector<HTMLElement>("#story-tamper-output");
document.querySelector("#story-tamper")?.addEventListener("click", () => renderTamper("building", true, storyOutput()));
document.querySelector("#story-reset")?.addEventListener("click", () => renderTamper("building", false, storyOutput()));
document.querySelector("#tamper-button")?.addEventListener("click", () => renderTamper(activeId, true));
document.querySelector("#reset-button")?.addEventListener("click", () => renderTamper(activeId, false));
document.querySelector("#run-agent-audit")?.addEventListener("click", () => void guidedAudit());
document.querySelector("#clear-activity")?.addEventListener("click", () => {
  activity.clear();
  renderActivity();
});

renderModules();
renderDetail();
renderTamper("building", false, storyOutput());
renderActivity();
