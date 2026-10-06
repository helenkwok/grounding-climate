// The battery passport case, recomputed in the browser from the committed BatteryLife cycle history with
// the same battery-dpp code as the offline run, and the committed signed attestation checked against it.
import {
  HYBRID_SIGNATURE_POLICY,
  publishedKeyResolver,
  verifySignedAttestation,
  type KeyMetadata,
  type ReviewDecision,
  type SignedAttestationBundle,
  type SignedAttestationVerification,
} from "@grounding-climate/core";
import { BatteryDppService, type BatteryHistory } from "@grounding-climate/battery-dpp";

import history from "../../../data/external/batterylife-processed/battery-history.json";
import caseRunReport from "../../../reports/battery-dpp/case-run.json";
import decisions from "../../../reports/battery-dpp/disposition-decisions.json";
import { WebCryptoProvider } from "./web-crypto.js";

export const batteryRun = caseRunReport as unknown as {
  runAt: string;
  organisingQuestion: string;
  publishedKeys: KeyMetadata[];
  attestation: SignedAttestationBundle;
  case: { caseId: string };
  tamper: { cycle: number; from: number; to: number };
};

const web = new WebCryptoProvider();
export const batteryCaseId = batteryRun.case.caseId;
export const batteryService = new BatteryDppService({
  caseId: batteryCaseId,
  history: history as BatteryHistory,
  provider: web,
  observedAt: batteryRun.runAt,
  decisions: decisions as ReviewDecision[],
});

let tampered = false;
export function setBatteryTampered(on: boolean): void {
  if (on && !tampered) batteryService.tamperLastCycle(batteryRun.tamper.to / batteryRun.tamper.from);
  if (!on) batteryService.resetHistory();
  tampered = on;
}

export interface BatteryCheck {
  built: Awaited<ReturnType<BatteryDppService["passport"]>>;
  attestation: SignedAttestationVerification;
  tampered: boolean;
}

/** Rebuilds the passport case for the current history and checks the committed attestation against it. */
export async function checkBattery(): Promise<BatteryCheck> {
  const built = await batteryService.passport();
  const attestation = await verifySignedAttestation(built.caseBundle, batteryRun.attestation, {
    hashProvider: web,
    resolveKey: publishedKeyResolver(batteryRun.publishedKeys, web),
    policy: HYBRID_SIGNATURE_POLICY,
  });
  return { built, attestation, tampered };
}
