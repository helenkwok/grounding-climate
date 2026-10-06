// What each claim is, in plain words, with no data attached: pages can name and describe a claim before any
// check has run (the site prerenders them), and the module builders take their titles from here.
import type { VerificationCheck, VerificationResult } from "@climatechain/core";

export type ClaimId = "building" | "energy" | "earth" | "battery" | "carbon" | "disclosure";

export interface ClaimMeta {
  id: ClaimId;
  title: string;
  /** What is checked, in one line. */
  what: string;
  /** The question a verifier brings to this claim. */
  question: string;
  /** The open data the claim is rebuilt from. */
  data: string;
  source: string;
}

export const CLAIMS: readonly ClaimMeta[] = [
  {
    id: "building",
    title: "Building emissions",
    what: "Meter readings rebuilt into emissions; flagged readings decided by a person",
    question: "Can this building's Scope 2 figure be trusted, and who decided what about each odd reading?",
    data: "2,160 hourly electricity readings from one office building in the Building Data Genome 2 dataset (CC BY-SA 4.0), January to March 2016, with EPA eGRID 2016's California grid factor.",
    source: "BDG2 v1.0 + EPA eGRID2016",
  },
  {
    id: "energy",
    title: "Energy forecast",
    what: "Published forecast accuracy reproduced; a capped action approved by a person",
    question: "Does the forecast behind an energy action perform as published, and who approved the action?",
    data: "Seven hourly load and generation series from Energy-EVA (CC BY 4.0), and its published baseline results for five benchmark windows.",
    source: "Energy-EVA / IEX load (CC BY 4.0)",
  },
  {
    id: "earth",
    title: "Burn scar from satellite",
    what: "Burned area detected pixel by pixel and compared with the reference map",
    question: "How much of this satellite scene burned, and does the detector reproduce the reference?",
    data: "One NASA HLS scene (T10SEH, 2018) from the IBM/NASA burn-scar dataset (CC BY 4.0): near-infrared, shortwave-infrared and label arrays.",
    source: "IBM/NASA HLS Burn Scars (CC BY 4.0)",
  },
  {
    id: "battery",
    title: "Battery passport",
    what: "Cycle history rebuilt into state of health; reuse signed off by a person",
    question: "Is this battery cell fit for a second life, and who signed that off?",
    data: "100 charge cycles of one CALB cell from BatteryLife (MIT).",
    source: "BatteryLife / CALB (MIT)",
  },
  {
    id: "carbon",
    title: "Carbon registry records",
    what: "Issuances and retirements reconciled; record gaps decided by a person",
    question: "Were these carbon credits retired only once, and never more than were issued?",
    data: "100 issuance and 100 retirement records from the American Carbon Registry, as published in CarbonPlan's OffsetsDB test data, plus any registry report you bring.",
    source: "ACR public reports via CarbonPlan OffsetsDB",
  },
  {
    id: "disclosure",
    title: "Company disclosure",
    what: "A reported figure that cannot be recalculated; a person decides what it may rest on",
    question: "What does a company's own reported figure rest on, when nobody can recalculate it?",
    data: "LPL Construction's 2025 Scope 1 figure on its own web page, found through the CaDI database. Linked, never copied.",
    source: "CaDI-confirmed first-party sources",
  },
];

export const claimMeta = (id: ClaimId): ClaimMeta => CLAIMS.find((claim) => claim.id === id)!;

/** A claim's overall result from its checks: any failure is a mismatch, anything short of a pass needs evidence. */
export function deriveResult(checks: VerificationCheck[]): VerificationResult {
  if (checks.some((check) => check.outcome === "fail")) return "mismatch";
  if (checks.some((check) => check.outcome !== "pass")) return "insufficient-evidence";
  return "reconciled";
}
