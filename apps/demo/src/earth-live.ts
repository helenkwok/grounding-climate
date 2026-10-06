// The earth case, recomputed in the browser from the committed HLS scene arrays with the same earth-observation
// code as the offline run, and the committed signed attestation checked against it. The arrays (2.3 MB) are
// fetched next to the page rather than bundled.
import {
  HYBRID_SIGNATURE_POLICY,
  openClimateRiskContext,
  publishedKeyResolver,
  verifySignedAttestation,
  type KeyMetadata,
  type ReviewDecision,
  type SignedAttestationBundle,
  type SignedAttestationVerification,
} from "@climatechain/core";
import { EarthCaseService, type BurnScarMetrics } from "@climatechain/earth-observation";

import manifest from "../../../data/external/hls-burn-scars/T10SEH.2018190.v1/manifest.json";
import ocr from "../../../data/external/open-climate-risk/ocr-context.json";
import pinnedReport from "../../../reports/earth-observation/t10seh-2018190-nbr.json";
import areaPolicy from "../../../reports/earth-observation/area-policy.json";
import caseRunReport from "../../../reports/earth-observation/case-run.json";
import decisions from "../../../reports/earth-observation/area-decisions.json";
import { WebCryptoProvider } from "./web-crypto.js";

export const earthRun = caseRunReport as unknown as {
  runAt: string;
  organisingQuestion: string;
  publishedKeys: KeyMetadata[];
  attestation: SignedAttestationBundle;
  case: { caseId: string };
  scene: { id: string };
  tamper: { pixel: number; row: number; column: number; from: number; to: number };
};

const bytes = async (name: string) => {
  const response = await fetch("data/hls-burn-scars/" + manifest.sceneId + "/" + name);
  if (!response.ok) throw new Error("Could not load " + name + ": HTTP " + response.status);
  return response.arrayBuffer();
};
const [nir, swir2, mask] = await Promise.all([bytes("nir.f32"), bytes("swir2.f32"), bytes("mask.i8")]);

const web = new WebCryptoProvider();
export const earthCaseId = earthRun.case.caseId;
export const earthService = new EarthCaseService({
  caseId: earthCaseId,
  scene: {
    sceneId: manifest.sceneId,
    width: manifest.width,
    height: manifest.height,
    pixelSizeMeters: manifest.pixelSizeMeters,
    nir: new Float32Array(nir),
    swir2: new Float32Array(swir2),
    mask: new Int8Array(mask),
    acquiredAt: "2018-07-09",
    geography: "HLS tile T10SEH, northern California",
  },
  pinned: pinnedReport.baseline.metrics as BurnScarMetrics,
  policy: areaPolicy.policy,
  provider: web,
  observedAt: earthRun.runAt,
  decisions: decisions as ReviewDecision[],
  publishedPrithviIoU: pinnedReport.publishedPrithviReference.burnClassIoU,
  context: [await openClimateRiskContext(ocr, "earthScene", earthRun.runAt, web)],
});

export function setEarthTampered(on: boolean): void {
  if (on) earthService.setNir(earthRun.tamper.pixel, earthRun.tamper.to);
  else earthService.resetScene();
}

export interface EarthCheck {
  built: Awaited<ReturnType<EarthCaseService["build"]>>;
  attestation: SignedAttestationVerification;
}

/** Rebuilds the earth case for the current arrays and checks the committed attestation against it. */
export async function checkEarth(): Promise<EarthCheck> {
  const built = await earthService.build();
  const attestation = await verifySignedAttestation(built.caseBundle, earthRun.attestation, {
    hashProvider: web,
    resolveKey: publishedKeyResolver(earthRun.publishedKeys, web),
    policy: HYBRID_SIGNATURE_POLICY,
  });
  return { built, attestation };
}
