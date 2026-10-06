// The carbon case, rebuilt in the browser from the committed ACR records and the person's decisions with the same
// carbon-registry code as the offline run, and the committed signed attestation checked against it. A reviewer can
// bring a Climate Action Reserve or Gold Standard report; only its digest enters the case.
import {
  HYBRID_SIGNATURE_POLICY,
  publishedKeyResolver,
  verifySignedAttestation,
  type KeyMetadata,
  type ReviewDecision,
  type SignedAttestationBundle,
  type SignedAttestationVerification,
} from "@grounding-climate/core";
import {
  CarbonRegistryService,
  normalizeRegistryCsv,
  type CommittedRegistrySource,
  type NormalizedRegistryTransaction,
} from "@grounding-climate/carbon-registry";

import manifest from "../../../data/external/acr-offsetsdb/manifest.json";
import issuancesCsv from "../../../data/external/acr-offsetsdb/issuances.csv";
import retirementsCsv from "../../../data/external/acr-offsetsdb/retirements.csv";
import caseRunReport from "../../../reports/carbon-registry/case-run.json";
import decisions from "../../../reports/carbon-registry/coverage-decisions.json";
import { WebCryptoProvider } from "./web-crypto.js";

export const carbonRun = caseRunReport as unknown as {
  runAt: string;
  organisingQuestion: string;
  publishedKeys: KeyMetadata[];
  attestation: SignedAttestationBundle;
  case: { caseId: string };
  tamper: { duplicated: string };
};

const csvOf: Record<string, string> = { "issuances.csv": issuancesCsv, "retirements.csv": retirementsCsv };
const committedSources: CommittedRegistrySource[] = manifest.files.filter((file) => file.kind === "issuance" || file.kind === "retirement").map((file) => ({
  registry: file.registry as CommittedRegistrySource["registry"],
  kind: file.kind as CommittedRegistrySource["kind"],
  path: "data/external/acr-offsetsdb/" + file.path,
  uri: file.upstream.uri,
  rightsManifestId: manifest.rightsManifestId,
  citation: manifest.citation,
}));
const records: NormalizedRegistryTransaction[] = committedSources.flatMap((source) =>
  normalizeRegistryCsv({ ...source, sourcePath: source.path, csv: csvOf[source.path.split("/").pop()!]! }),
);

const web = new WebCryptoProvider();
export const carbonCaseId = carbonRun.case.caseId;
export const carbonService = new CarbonRegistryService({
  caseId: carbonCaseId,
  records,
  sources: [],
  provider: web,
  observedAt: carbonRun.runAt,
  review: { committedSources, decisions: decisions as ReviewDecision[] },
});

/** Tamper: the first ACR retirement appears twice, as a double claim would. */
export function setCarbonTampered(on: boolean): void {
  const first = records.find((record) => record.kind === "retirement")!;
  carbonService.setRecords(on ? [...records, { ...first, sourceRow: records.length + 2 }] : records);
}

export interface CarbonCheck {
  built: Awaited<ReturnType<CarbonRegistryService["review"]>>;
  attestation: SignedAttestationVerification;
}

/** Rebuilds the carbon case for the current records and checks the committed attestation against it. */
export async function checkCarbon(): Promise<CarbonCheck> {
  const built = await carbonService.review();
  const attestation = await verifySignedAttestation(built.caseBundle, carbonRun.attestation, {
    hashProvider: web,
    resolveKey: publishedKeyResolver(carbonRun.publishedKeys, web),
    policy: HYBRID_SIGNATURE_POLICY,
  });
  return { built, attestation };
}
