// The building case, recomputed in the browser from the committed BDG2 subset with the same
// building-mrv code the offline run used, and the committed signed attestation checked against it.
import {
  HYBRID_SIGNATURE_POLICY,
  publishedKeyResolver,
  verifySignedAttestation,
  type KeyMetadata,
  type SignedAttestationBundle,
  type SignedAttestationVerification,
  openClimateRiskContext,
} from "@grounding-climate/core";
import {
  adviceModelRun,
  BuildingMrvService,
  loadPreparedBuildingDataset,
  verifyPreparedArtifactDigests,
  type DecidedCase,
  type IntervalDecision,
} from "@grounding-climate/building-mrv";

import { WebCryptoProvider } from "./web-crypto.js";

export { mlDsaVerifier } from "./web-crypto.js";

import meterCsv from "../../../data/external/bdg2/meter.csv";
import weatherCsv from "../../../data/external/bdg2/weather.csv";
import metadataJson from "../../../data/external/bdg2/metadata.json";
import sourceJson from "../../../data/external/bdg2/source.json";
import factorReference from "../../../packages/building-mrv/references/epa-egrid2016-camx.json";
import caseRunReport from "../../../reports/building-mrv/case-run.json";
import ocr from "../../../data/external/open-climate-risk/ocr-context.json";
import adviceRecords from "../../../reports/building-mrv/triage-advice.json";
import decisions from "../../../reports/building-mrv/interval-decisions.json";

export const caseRun = caseRunReport as unknown as {
  runAt: string;
  organisingQuestion: string;
  publishedKeys: KeyMetadata[];
  attestation: SignedAttestationBundle;
  case: { caseId: string };
  tamper: { index: number; multiplier: number; timestamp: string };
  clean: { signatures: Array<{ algorithm: string; signatureValid: boolean }> };
};

export interface LiveCheck {
  decided: DecidedCase;
  attestation: SignedAttestationVerification;
  sourceIntegrityValid: boolean;
  tampered: boolean;
}

const web = new WebCryptoProvider();
const prepared = { meterCsv, weatherCsv, metadataJson, sourceJson };
const sourceIntegrity = await verifyPreparedArtifactDigests(prepared, web);
const dataset = loadPreparedBuildingDataset(prepared);
const advice = await Promise.all(
  (adviceRecords as Array<Parameters<typeof adviceModelRun>[0]>).map((record) =>
    adviceModelRun({ ...record, hashProvider: web }),
  ),
);

export const buildingCaseId = caseRun.case.caseId;
export const adviceRuns = advice;
export const service = new BuildingMrvService({
  caseId: buildingCaseId,
  dataset,
  factor: { ...factorReference, valueKgCo2ePerKwh: factorReference.conversion.valueKgCo2ePerKwh },
  review: {
    createdAt: caseRun.runAt,
    advice,
    decisions: decisions as IntervalDecision[],
    hashProvider: web,
    context: [await openClimateRiskContext(ocr, "buildingSite", caseRun.runAt, web)],
  },
});

let tampered = false;

/** The meter series the case is rebuilt from, with the tamper applied when it is on. */
export function meterSeries(): Array<{ timestamp: string; value: number }> {
  const { index, multiplier } = caseRun.tamper;
  return dataset.meter.map((point, i) => (tampered && i === index ? { ...point, value: point.value * multiplier } : point));
}

/** The model's suggestion for each flagged reading, as recorded. */
export const adviceByTimestamp = new Map(
  (adviceRecords as Array<{ timestamp: string; advice: { choice: string; probabilities?: Record<string, number> } }>).map((record) => [
    record.timestamp,
    { choice: record.advice.choice, probability: record.advice.probabilities?.[record.advice.choice] },
  ]),
);
export function setTampered(on: boolean): void {
  if (on && !tampered) service.tamper(caseRun.tamper.index, caseRun.tamper.multiplier);
  if (!on) service.resetSeries();
  tampered = on;
}

/** Rebuilds the case for the current series and checks the committed attestation against it. */
export async function checkBuilding(): Promise<LiveCheck> {
  const decided = await service.decidedCase();
  const attestation = await verifySignedAttestation(decided.climateCase, caseRun.attestation, {
    hashProvider: web,
    resolveKey: publishedKeyResolver(caseRun.publishedKeys, web),
    policy: HYBRID_SIGNATURE_POLICY,
  });
  return { decided, attestation, sourceIntegrityValid: sourceIntegrity.valid, tampered };
}
