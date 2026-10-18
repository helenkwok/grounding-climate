// The disclosure case, rebuilt in the browser from the committed CaDI candidates and the person's decision with the
// same disclosure code as the offline run, and the committed signed attestation checked against it.
import {
  HYBRID_SIGNATURE_POLICY,
  publishedKeyResolver,
  verifySignedAttestation,
  type KeyMetadata,
  type ReviewDecision,
  type SignedAttestationBundle,
  type SignedAttestationVerification,
} from "@grounding-climate/core";
import { DisclosureService, type DisclosureCandidate } from "@grounding-climate/disclosure";

import cadi from "../../../sources/cadi-candidates.json";
import reviewInput from "../../../reports/disclosure/review-input.json";
import caseRunReport from "../../../reports/disclosure/case-run.json";
import decisions from "../../../reports/disclosure/claim-decisions.json";
import { WebCryptoProvider } from "./web-crypto.js";

export const disclosureRun = caseRunReport as unknown as {
  runAt: string;
  organisingQuestion: string;
  publishedKeys: KeyMetadata[];
  attestation: SignedAttestationBundle;
  case: { caseId: string };
};
export const disclosureInput = reviewInput;

const web = new WebCryptoProvider();
export const disclosureCaseId = disclosureRun.case.caseId;
export const disclosureService = new DisclosureService(cadi.candidates as unknown as DisclosureCandidate[], {
  ...reviewInput,
  provider: web,
  observedAt: disclosureRun.runAt,
  decisions: decisions as ReviewDecision[],
});

export function setDisclosureTampered(on: boolean): void {
  if (on) disclosureService.setReviewedValue(reviewInput.tamper.to);
  else disclosureService.resetCandidates();
}

export interface DisclosureCheck {
  built: Awaited<ReturnType<DisclosureService["review"]>>;
  attestation: SignedAttestationVerification;
}

/** Rebuilds the disclosure case for the current candidates and checks the committed attestation against it. */
export async function checkDisclosure(): Promise<DisclosureCheck> {
  const built = await disclosureService.review();
  const attestation = await verifySignedAttestation(built.caseBundle, disclosureRun.attestation, {
    hashProvider: web,
    resolveKey: publishedKeyResolver(disclosureRun.publishedKeys, web),
    policy: HYBRID_SIGNATURE_POLICY,
  });
  return { built, attestation };
}
