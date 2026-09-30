import {
  CLIMATECHAIN_SCHEMA_VERSION,
  createEvidenceRoot,
} from "@climatechain/core";
import type {
  ClimateCaseBundle,
  CryptoProvider,
} from "@climatechain/core";

import type {
  DisclosureAssessment,
  ExtractedDisclosureClaim,
} from "./types.js";

export async function buildDisclosureCase(input: {
  claim: ExtractedDisclosureClaim;
  provider: CryptoProvider;
  confirmationUrl: string;
  underlyingSourceUrl: string;
  observedAt: string;
  assessment?: Partial<DisclosureAssessment>;
}): Promise<{
  caseBundle: ClimateCaseBundle;
  evidenceRoot: Awaited<ReturnType<typeof createEvidenceRoot>>;
}> {
  const assessment: DisclosureAssessment = {
    disclosedOnCadi: "confirmed",
    sourceLocated: "confirmed",
    calculationReproduced: "not-assessed",
    factorsTraced: "not-assessed",
    evidenceIntegrityConfirmed: "not-assessed",
    thirdPartyAssurance: input.claim.assuranceClaim
      ? "attributed"
      : "not-assessed",
    ...input.assessment,
  };

  const confirmationEvidenceId =
    "evidence:disclosure:" + input.claim.organisationId + ":cadi-confirmation";
  const sourceEvidenceId =
    "evidence:disclosure:" + input.claim.organisationId + ":source";

  const caseBundle: ClimateCaseBundle = {
    schemaVersion: CLIMATECHAIN_SCHEMA_VERSION,
    caseId: "case:disclosure:" + input.claim.organisationId,
    title: input.claim.organisationName + " public carbon disclosure",
    capabilities: ["public-disclosure", "claim-reconciliation"],
    createdAt: input.observedAt,
    claims: [
      {
        nodeType: "claim",
        id: input.claim.id,
        createdAt: input.observedAt,
        provenance: [
          {
            nodeType: "evidence",
            id: confirmationEvidenceId,
            role: "cadi-publication-confirmation",
          },
          {
            nodeType: "evidence",
            id: sourceEvidenceId,
            role: "underlying-public-source",
          },
        ],
        subject: {
          id: "org:" + input.claim.organisationId,
          kind: "organisation",
          name: input.claim.organisationName,
        },
        temporalScope: {
          label: input.claim.period,
        },
        assertion: {
          kind: "quantitative",
          metric: input.claim.metric,
          quantity: {
            value: input.claim.value,
            unit: input.claim.unit,
          },
        },
        assessments: [
          {
            dimension: "disclosed",
            state:
              assessment.disclosedOnCadi === "confirmed"
                ? "confirmed"
                : "not-assessed",
            note:
              "Publication on CaDI is confirmed by a first-party source; this is a disclosure-state claim, not a claim of independent physical truth.",
          },
          {
            dimension: "source-found",
            state:
              assessment.sourceLocated === "confirmed"
                ? "confirmed"
                : "not-assessed",
          },
          {
            dimension: "calculation-reproduced",
            state:
              assessment.calculationReproduced === "confirmed"
                ? "confirmed"
                : assessment.calculationReproduced === "failed"
                  ? "failed"
                  : "not-assessed",
          },
          {
            dimension: "factor-traced",
            state:
              assessment.factorsTraced === "confirmed"
                ? "confirmed"
                : assessment.factorsTraced === "failed"
                  ? "failed"
                  : "not-assessed",
          },
          {
            dimension: "evidence-integrity-confirmed",
            state:
              assessment.evidenceIntegrityConfirmed === "confirmed"
                ? "confirmed"
                : assessment.evidenceIntegrityConfirmed === "failed"
                  ? "failed"
                  : "not-assessed",
          },
          {
            dimension: "third-party-assured",
            state:
              assessment.thirdPartyAssurance === "confirmed"
                ? "confirmed"
                : "not-assessed",
            note: input.claim.assuranceClaim
              ? "The source attributes assurance to a third party: " +
                input.claim.assuranceClaim +
                " ClimateChain has not independently audited that assurance engagement."
              : "No assurance evidence assessed.",
          },
        ],
      },
    ],
    evidence: [
      {
        nodeType: "evidence",
        id: confirmationEvidenceId,
        createdAt: input.observedAt,
        provenance: [],
        kind: "public-disclosure",
        source: {
          uri: input.confirmationUrl,
          publisher: input.claim.organisationName,
          retrievedAt: input.observedAt,
        },
        rights: {
          sourceManifestId: "cadi-public-web",
          termsUri: "https://www.carbonfootprint.com/termsandconditions.html",
          redistribution: "prohibited",
          commercialUse: "prohibited",
          derivedData: "unclear",
          attribution:
            "Link to the original first-party publication/CaDI record; do not mirror CaDI content.",
        },
      },
      {
        nodeType: "evidence",
        id: sourceEvidenceId,
        createdAt: input.observedAt,
        provenance: [],
        kind: "report",
        source: {
          uri: input.underlyingSourceUrl,
          publisher: input.claim.organisationName,
          retrievedAt: input.observedAt,
        },
        rights: {
          redistribution: "unclear",
          commercialUse: "unclear",
          derivedData: "unclear",
          attribution:
            "Preserve the original public source URL. ClimateChain stores extracted factual claims, not the source document bytes.",
        },
      },
    ],
    calculations: [],
    factors: [],
    modelRuns: [],
    verifications: [],
    attestations: [],
    anchors: [],
  };

  const evidenceRoot = await createEvidenceRoot(
    caseBundle,
    [{ nodeType: "claim", id: input.claim.id }],
    input.provider,
  );

  return { caseBundle, evidenceRoot };
}
