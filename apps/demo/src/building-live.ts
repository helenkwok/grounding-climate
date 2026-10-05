// The building case, recomputed in the browser from the committed BDG2 subset with the same
// building-mrv code the offline run used, and the committed signed attestation checked against it.
import {
  verifySignedAttestation,
  type ContentDigest,
  type CryptoProvider,
  type CryptoSignature,
  type KeyMetadata,
  type SignedAttestationBundle,
  type SignedAttestationVerification,
  type VerificationKey,
} from "@climatechain/core";
import {
  adviceModelRun,
  BuildingMrvService,
  loadPreparedBuildingDataset,
  verifyPreparedArtifactDigests,
  type DecidedCase,
  type IntervalDecision,
} from "@climatechain/building-mrv";

import meterCsv from "../../../data/external/bdg2/meter.csv";
import weatherCsv from "../../../data/external/bdg2/weather.csv";
import metadataJson from "../../../data/external/bdg2/metadata.json";
import sourceJson from "../../../data/external/bdg2/source.json";
import factorReference from "../../../packages/building-mrv/references/epa-egrid2016-camx.json";
import caseRunReport from "../../../reports/building-mrv/case-run.json";
import adviceRecords from "../../../reports/building-mrv/triage-advice.json";
import decisions from "../../../reports/building-mrv/interval-decisions.json";

const toBase64Url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

const fromBase64Url = (value: string) =>
  Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));

/** SHA-256 and Ed25519 verification through WebCrypto. Browsers have no ML-DSA, so it verifies nothing else. */
class WebCryptoProvider implements CryptoProvider {
  async hash(data: Uint8Array, algorithm: "SHA-256"): Promise<ContentDigest> {
    return { algorithm, value: toBase64Url(await crypto.subtle.digest("SHA-256", data as BufferSource)) };
  }

  async sign(): Promise<CryptoSignature> {
    throw new Error("The demo page never signs.");
  }

  async verify(payload: Uint8Array, signature: CryptoSignature, key: VerificationKey): Promise<boolean> {
    if (key.algorithm !== "Ed25519" || signature.algorithm !== "Ed25519" || signature.keyId !== key.keyId) {
      return false;
    }
    try {
      const publicKey = await crypto.subtle.importKey(
        "spki", fromBase64Url(key.publicKey) as BufferSource, { name: "Ed25519" }, false, ["verify"],
      );
      return await crypto.subtle.verify(
        "Ed25519", publicKey, fromBase64Url(signature.value) as BufferSource, payload as BufferSource,
      );
    } catch {
      return false;
    }
  }

  async describeKey(): Promise<KeyMetadata | undefined> {
    return undefined;
  }
}

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
  },
});

let tampered = false;
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
    resolveKey: async (signature) => {
      const metadata = caseRun.publishedKeys.find((key) => key.keyId === signature.keyId);
      return metadata && { provider: web, key: metadata.verificationKey, metadata };
    },
    policy: { requiredSuites: ["classical"] },
  });
  return { decided, attestation, sourceIntegrityValid: sourceIntegrity.valid, tampered };
}
