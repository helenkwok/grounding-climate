// The six claims as plain data for the pages: each builder turns a live in-browser check into what a page shows.
// Nothing here touches the DOM, so the demo page and the site share it.
import {
  GROUNDING_SCHEMA_VERSION,
  type ClimateCaseBundle,
  type ClimateNode,
  type ContentDigest,
  type NodeRef,
  type Claim,
  type Verification,
  type VerificationCheck,
  type VerificationResult,
  type SignedAttestationVerification,
} from "@grounding-climate/core";
import {
  ActivityLog,
  ClimateCapabilityRegistry,
  DynamicClimateWebMcp,
  createRoutedModule,
  type ClimateWorkspace,
  type ModuleCommandRouter,
} from "@grounding-climate/webmcp";

import {
  adviceByTimestamp,
  adviceRuns,
  buildingCaseId,
  caseRun,
  checkBuilding,
  meterSeries,
  mlDsaVerifier,
  service as buildingService,
  setTampered,
  type LiveCheck,
} from "./building-live.js";
import {
  batteryCaseId,
  batteryRun,
  batteryHistory,
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
import energyAction from "../../../reports/energy-forecast/action-request.json";
import cadi from "../../../sources/cadi-candidates.json";

import { claimMeta, deriveResult } from "./claims-meta.js";

export { deriveResult };

type JsonObject = Record<string, any>;

/** One flagged item and what happened to it: the model's or policy's suggestion, then a person's decision. */
export type DecisionFlag = { when: string; what: string; who: string; state: "decided" | "stale" | "undecided" | "none" };

/** A drawing of the claim's own evidence, from the live data, so a change shows on the page. */
export type EvidenceChart =
  | {
      kind: "series";
      caption: string;
      unit: string;
      values: number[];
      /** Index and label of each x-axis tick. */
      ticks: Array<[number, string]>;
      /** The y scale's top, fixed to the recorded data so a changed value shows as a clipped spike. */
      max: number;
      /** The y scale's bottom; 0 when absent. */
      min?: number;
      marks?: Array<{ index: number; state: DecisionFlag["state"] }>;
      changed?: { index: number; note: string };
      line?: { value: number; label: string };
    }
  | {
      kind: "bars";
      caption: string;
      unit: string;
      /** `value: null` is a figure nobody can recompute; tone says what the bar is. */
      bars: Array<{ label: string; value: number | null; tone: "claim" | "measured" | "limit" | "flag"; note?: string }>;
      link?: { href: string; text: string };
    };

export type DemoModule = {
  id: string;
  /** The live case, rebuilt in this browser: what a reviewer signs. */
  climateCase: ClimateCaseBundle;
  title: string;
  icon: string;
  kicker: string;
  kpi: string;
  kpiLabel: string;
  /** How the headline figure is known, when it is not rechecked (a company's own reported figure). */
  kpiLead?: string;
  source: string;
  decisionTitle: string;
  decisionCopy: string;
  limitation: string;
  metrics: Array<[string, string]>;
  /** The claim's evidence, drawn. */
  evidence: EvidenceChart[];
  /** Each flagged item and who decided it. */
  flags: DecisionFlag[];
  /** Each signature on the committed record, checked against the current evidence. */
  seals: Array<{ algorithm: string; valid: boolean }>;
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

const cadiData = cadi as JsonObject;

const sealsOf = (attestation: SignedAttestationVerification): DemoModule["seals"] =>
  attestation.signature.signatures.map((item) => ({ algorithm: item.signature.algorithm, valid: item.signatureValid && attestation.validForCurrentEvidence }));
const role = (decidedBy?: string) => (decidedBy ?? "a person").replace(/^person:/, "").replace(/-/g, " ");
/** A review status as a flag row: who decided what, or that nobody has yet. */
const flagOf = (
  when: string,
  what: string,
  status?: { state: "decided" | "stale" | "undecided"; decision?: { decision: string; decidedBy: string } },
): DecisionFlag => ({
  when,
  what,
  state: status?.state ?? "none",
  who: !status
    ? "No decision needed under the policy"
    : status.state === "undecided" || !status.decision
      ? "No one has decided"
      : (status.state === "stale" ? "Stale (data changed): " : "") + status.decision.decision + ", by the " + role(status.decision.decidedBy),
});
const n = (value: number) => value.toLocaleString("en-US");

export const short = (digest: ContentDigest) => digest.value.slice(0, 16) + "…";

/** The case's own result as a check, so the overall status never reads better than the case does. */
export function caseCheck(verification: Verification): VerificationCheck {
  const { result } = verification;
  return {
    id: "case-result",
    name: "Case result: " + result,
    outcome: result === "reconciled" ? "pass" : result === "insufficient-evidence" ? "warn" : "fail",
    detail: verification.findings[0],
  };
}

/** The hourly readings with every flagged reading marked; the scale ignores the reading the tamper changes. */
function buildingChart(flags: LiveCheck["decided"]["statuses"]): EvidenceChart {
  const series = meterSeries();
  const { index: changedIndex, multiplier } = caseRun.tamper;
  const values = series.map((point) => point.value);
  const max = Math.max(...values.filter((_, i) => i !== changedIndex));
  const at = new Map(series.map((point, i) => [point.timestamp, i]));
  const changed = values[changedIndex]!;
  return {
    kind: "series",
    caption: n(values.length) + " hourly electricity readings, January to March 2016. Each flagged reading is numbered.",
    unit: "kWh / hour",
    values,
    ticks: [[0, "Jan 2016"], [744, "Feb"], [1440, "Mar"]],
    max,
    marks: flags.flatMap((flag) => (at.has(flag.timestamp) ? [{ index: at.get(flag.timestamp)!, state: flag.state }] : [])),
    ...(changed > max ? { changed: { index: changedIndex, note: "changed: " + n(Math.round(changed)) + " kWh, ×" + multiplier } } : {}),
  };
}

/** Capacity over the cycles, against the policy's second-life line, and the ohmic resistance over the sweeps. */
function batteryCharts(tampered: boolean): EvidenceChart[] {
  const history = batteryHistory();
  const rated = history.nominalCapacityAh ?? 2;
  const capacity = history.cycles.map((cycle) => cycle.dischargeCapacityAh);
  const sweeps = history.impedance ?? [];
  // Single sweeps are noisy, so the line is the running median of 5, the window the resistance rise is measured with.
  const re = sweeps.map((_, i) => {
    const window = sweeps.slice(Math.max(0, i - 2), i + 3).map((sweep) => sweep.reOhm).sort((a, b) => a - b);
    return window[Math.floor(window.length / 2)]!;
  });
  const tick = (cycle: number) => sweeps.findIndex((sweep) => sweep.afterCycle >= cycle);
  return [
    {
      kind: "series",
      caption: "Discharge capacity in each of " + capacity.length + " cycles. A second life needs 75% of the " + rated + " Ah rating under the policy.",
      unit: "Ah",
      values: capacity,
      ticks: [[0, "cycle 1"], [49, "50"], [99, "100"], [149, "150"]],
      min: 1.2,
      max: rated,
      line: { value: 0.75 * rated, label: "75% of rating" },
      ...(tampered ? { changed: { index: capacity.length - 1, note: "changed: cycle " + batteryRun.tamper.cycle + ", " + batteryRun.tamper.to.toFixed(3) + " Ah" } } : {}),
    },
    {
      kind: "series",
      caption: "Ohmic resistance Re over " + re.length + " impedance sweeps (NASA's fitted values), as a running median of 5 sweeps.",
      unit: "Ω",
      values: re,
      ticks: [[0, "after cycle " + sweeps[0]?.afterCycle], ...[50, 100, 150].map((cycle): [number, string] => [tick(cycle), String(cycle)]).filter(([i]) => i > 0)],
      min: Math.min(...re) * 0.98,
      max: Math.max(...re) * 1.02,
    },
  ];
}

export function buildingModule(live: LiveCheck): DemoModule {
  const { decided, attestation } = live;
  const verification = decided.climateCase.verifications[0]!;
  const emissions = decided.analysis.emissions;
  const flags = decided.statuses;
  const decidedCount = flags.filter((flag) => flag.state === "decided").length;
  const ed25519 = attestation.signature.signatures.find((item) => item.signature.algorithm === "Ed25519");
  const mlDsa = attestation.signature.signatures.find((item) => item.signature.algorithm === "ML-DSA-65");
  return {
    id: "building",
    climateCase: decided.climateCase,
    evidence: [buildingChart(flags)],
    flags: flags.map((flag) => {
      const advice = adviceByTimestamp.get(flag.timestamp);
      const what =
        flag.state === "undecided" ? "New flag" : flag.decision?.reason.startsWith("no such hour") ? "An hour that never existed" : "Read zero: meter dropout?";
      return flagOf(
        flag.timestamp.slice(5, 16).replace("-", "/"),
        what + (advice?.probability === undefined ? "" : " · model: " + advice.choice + ", " + Math.round(advice.probability * 100) + "%"),
        flag,
      );
    }),
    seals: sealsOf(attestation),
    title: claimMeta("building").title,
    icon: "▦",
    kicker: claimMeta("building").what,
    kpi: emissions.emissionsTCo2e.toFixed(2),
    kpiLabel: "tCO₂e, recomputed in this browser",
    source: claimMeta("building").source,
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

export function batteryModule(live: BatteryCheck): DemoModule {
  const { built, attestation } = live;
  const verification = built.caseBundle.verifications[0]!;
  const passport = built.passport;
  const signOff = built.review[0];
  const boundary = built.caseBundle.claims[0]?.boundary?.accounting;
  const ed25519 = attestation.signature.signatures.find((item) => item.signature.algorithm === "Ed25519");
  const mlDsa = attestation.signature.signatures.find((item) => item.signature.algorithm === "ML-DSA-65");
  return {
    id: "battery",
    climateCase: built.caseBundle,
    evidence: batteryCharts(live.tampered),
    flags: [flagOf("Disposition", "Policy proposed " + passport.disposition + (passport.decisionReasons.length ? ": " + passport.decisionReasons.join(" ") : ""), signOff)],
    seals: sealsOf(attestation),
    title: claimMeta("battery").title,
    icon: "▣",
    kicker: claimMeta("battery").what,
    kpi: (passport.currentSoh * 100).toFixed(1) + "%",
    kpiLabel: "state of health, recomputed in this browser",
    source: claimMeta("battery").source,
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
      "Decision support only, not a safety certification. One lab cell. The first impedance sweep came after cycle 19, so the " +
      "resistance base is not beginning of life, and Re is NASA's fitted value. Signing keys are per-run demo keys.",
    metrics: [
      ["Battery", passport.batteryId],
      ["Observed cycles", String(passport.observedCycle)],
      ["State of health", (passport.currentSoh * 100).toFixed(2) + "%"],
      ["Remaining cycles to SoH 0.8", String(passport.estimatedRulCycles ?? "n/a")],
      ["Fit R²", (passport.model.fitRSquared ?? 0).toFixed(4)],
      ["Disposition", passport.disposition],
    ],
    provenance: [
      ["Dataset", "NASA PCoE Battery Data Set, cell B0005 (Saha and Goebel, 2007; a US government work)"],
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

export function energyModule(live: EnergyCheck): DemoModule {
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
    climateCase: built.caseBundle,
    evidence: [
      {
        kind: "bars",
        caption:
          "The load shift asked for, the policy's cap, and what it allows. The forecast behind it scores " + built.confidence.toFixed(3) +
          " on Energy-EVA's benchmark (the policy needs " + energyAction.policy.minimumConfidence + ").",
        unit: "MWh",
        bars: [
          { label: "Asked for", value: energyAction.request.requestedMWh, tone: "claim" },
          { label: "Policy cap", value: energyAction.policy.maxActionMWh, tone: "limit" },
          { label: "Allowed", value: built.action.approvedMWh, tone: "measured", note: "a person approves above " + energyAction.policy.humanApprovalAboveMWh + " MWh" },
        ],
      },
    ],
    flags: [flagOf("Load shift", "Policy allows " + built.action.approvedMWh + " of " + energyAction.request.requestedMWh + " MWh", approval)],
    seals: sealsOf(attestation),
    title: claimMeta("energy").title,
    icon: "↯",
    kicker: claimMeta("energy").what,
    kpi: built.confidence.toFixed(3),
    kpiLabel: "mean LOAD_ACC, recomputed in this browser",
    source: claimMeta("energy").source,
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
export function boundaryRows(claim: Claim): Array<[string, string]> {
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

export function contextRows(verification: Verification): Array<[string, string]> {
  return verification.findings
    .filter((finding) => finding.startsWith("Context, not evidence"))
    .map((finding) => ["Wildfire context", finding.replace("Context, not evidence: ", "")]);
}

export function earthModule(live: EarthCheck): DemoModule {
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
    climateCase: built.caseBundle,
    evidence: [
      {
        kind: "bars",
        caption: "Burned area in scene T10SEH: found by the detector pixel by pixel, against the dataset's reference labels.",
        unit: "ha",
        bars: [
          { label: "Detected", value: Math.round(m.predictedHectares), tone: "measured", note: "what the claim reports, as a lower bound" },
          { label: "Reference labels", value: Math.round(m.groundTruthHectares), tone: "limit", note: "the detector finds " + Math.abs(built.areaGap * 100).toFixed(1) + "% less" },
        ],
      },
    ],
    flags: [flagOf("Area gap", "Detected area " + Math.abs(built.areaGap * 100).toFixed(1) + "% below the labelled area, past the tolerance", status)],
    seals: sealsOf(attestation),
    title: claimMeta("earth").title,
    icon: "◉",
    kicker: claimMeta("earth").what,
    kpi: m.iou.toFixed(3),
    kpiLabel: "burn-class IoU, recomputed in this browser",
    source: claimMeta("earth").source,
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

export function disclosureModule(live: DisclosureCheck): DemoModule {
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
    climateCase: built.caseBundle,
    evidence: [
      {
        kind: "bars",
        caption: "Scope 1 for 2025: the company's own figure, from its own page (linked, never copied). Nothing public recalculates it.",
        unit: "tCO₂e",
        bars: [
          { label: "Reported", value: value?.value ?? null, tone: "claim" },
          { label: "Recalculated", value: null, tone: "limit", note: "not possible from public data" },
        ],
        link: { href: source, text: "The company's page" },
      },
    ],
    flags: [flagOf("Reported figure", (claim.subject.name ?? "") + (value ? " " + value.value + " " + value.unit : ""), status)],
    seals: sealsOf(attestation),
    title: claimMeta("disclosure").title,
    icon: "◫",
    kicker: claimMeta("disclosure").what,
    kpi: value ? String(value.value) : "—",
    kpiLabel: value ? value.unit + " Scope 1, as the company reports it" : "source-only",
    kpiLead: "Reported, not recalculated:",
    source: claimMeta("disclosure").source,
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

export function carbonModule(live: CarbonCheck): DemoModule {
  const { built, attestation } = live;
  const report = built.report;
  const verification = built.caseBundle.verifications[0]!;
  const claim = built.caseBundle.claims[0]!;
  const ed25519 = attestation.signature.signatures.find((item) => item.signature.algorithm === "Ed25519");
  const mlDsa = attestation.signature.signatures.find((item) => item.signature.algorithm === "ML-DSA-65");
  const imported = built.caseBundle.evidence.filter((item) => item.access?.mode === "reviewer-supplied");
  return {
    id: "carbon",
    climateCase: built.caseBundle,
    evidence: [
      {
        kind: "bars",
        caption: n(report.recordCount) + " ACR issuance and retirement records, reconciled in this browser. Red is a count that should be zero.",
        unit: "",
        bars: [
          { label: "Retirements within issuance", value: report.supportedCount, tone: "measured" },
          { label: "Issued, not retired", value: report.issuedNotRetiredCount, tone: "measured" },
          { label: "Retirements with no issuance in the records", value: report.unresolvedMissingIssuanceCount, tone: "limit", note: "a gap a person decides" },
          { label: "Duplicate serial ranges", value: report.duplicateExcessCount, tone: report.duplicateExcessCount ? "flag" : "measured" },
        ],
      },
    ],
    flags: built.review.map((status) => flagOf("Record gap", status.flag.label, status)),
    seals: sealsOf(attestation),
    title: claimMeta("carbon").title,
    icon: "◎",
    kicker: claimMeta("carbon").what,
    kpi: String(report.recordCount),
    kpiLabel: "registry records reconciled in this browser",
    source: claimMeta("carbon").source,
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

