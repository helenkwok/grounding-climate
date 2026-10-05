// The energy case, recomputed in the browser from the committed Energy-EVA series with the same
// energy-forecast code as the offline run, and the committed signed attestation checked against it.
import {
  HYBRID_SIGNATURE_POLICY,
  publishedKeyResolver,
  verifySignedAttestation,
  type KeyMetadata,
  type ReviewDecision,
  type SignedAttestationBundle,
  type SignedAttestationVerification,
} from "@climatechain/core";
import { EnergyCaseService, type EnergySeries, type PublishedCutoff } from "@climatechain/energy-forecast";

import data from "../../../data/external/energy-eva-active-power-load/series.json";
import reference from "../../../packages/energy-forecast/references/energy-eva-active-power-load.json";
import action from "../../../reports/energy-forecast/action-request.json";
import caseRunReport from "../../../reports/energy-forecast/case-run.json";
import decisions from "../../../reports/energy-forecast/action-decisions.json";
import { WebCryptoProvider } from "./web-crypto.js";

export const energyRun = caseRunReport as unknown as {
  runAt: string;
  organisingQuestion: string;
  publishedKeys: KeyMetadata[];
  attestation: SignedAttestationBundle;
  case: { caseId: string };
  tamper: { item: string; itemIndex: number; pointIndex: number; timestamp: string; from: number; to: number };
};

const web = new WebCryptoProvider();
export const energyCaseId = energyRun.case.caseId;
export const energyService = new EnergyCaseService({
  caseId: energyCaseId,
  series: data.series as EnergySeries[],
  published: reference.energyEva.publishedResults as PublishedCutoff[],
  action: action as unknown as ConstructorParameters<typeof EnergyCaseService>[0]["action"],
  provider: web,
  observedAt: energyRun.runAt,
  decisions: decisions as ReviewDecision[],
});

let tampered = false;
export function setEnergyTampered(on: boolean): void {
  const { itemIndex, pointIndex, from, to } = energyRun.tamper;
  if (on && !tampered) energyService.tamperValue(itemIndex, pointIndex, to / from);
  if (!on) energyService.resetSeries();
  tampered = on;
}

export interface EnergyCheck {
  built: Awaited<ReturnType<EnergyCaseService["build"]>>;
  attestation: SignedAttestationVerification;
  tampered: boolean;
}

/** Rebuilds the energy case for the current series and checks the committed attestation against it. */
export async function checkEnergy(): Promise<EnergyCheck> {
  const built = await energyService.build();
  const attestation = await verifySignedAttestation(built.caseBundle, energyRun.attestation, {
    hashProvider: web,
    resolveKey: publishedKeyResolver(energyRun.publishedKeys, web),
    policy: HYBRID_SIGNATURE_POLICY,
  });
  return { built, attestation, tampered };
}
