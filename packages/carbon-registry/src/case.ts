import {
  CLIMATECHAIN_SCHEMA_VERSION,
  canonicalBytes,
  createEvidenceRoot,
} from "@climatechain/core";
import type {
  Claim,
  ClimateCaseBundle,
  ContentDigest,
  CryptoProvider,
  Evidence,
  Verification,
} from "@climatechain/core";

import { reconcileRegistryTransactions } from "./reconcile.js";
import type {
  NormalizedRegistryTransaction,
  RegistryReconciliationReport,
  RegistrySourceRef,
} from "./types.js";

export interface RegistryVerificationBundle {
  caseBundle: ClimateCaseBundle;
  report: RegistryReconciliationReport;
  evidenceRoot: Awaited<ReturnType<typeof createEvidenceRoot>>;
}

function sourceSlug(path: string): string {
  return path
    .replace(/^tests\/data\//, "")
    .replace(/\.csv$/, "")
    .replaceAll("/", ":")
    .replace(/[^a-zA-Z0-9:_-]+/g, "-");
}

async function digest(
  provider: CryptoProvider,
  value: unknown,
): Promise<ContentDigest> {
  return provider.hash(canonicalBytes(value), "SHA-256");
}

export async function buildRegistryVerification(input: {
  records: NormalizedRegistryTransaction[];
  sources: RegistrySourceRef[];
  provider: CryptoProvider;
  observedAt: string;
  caseId?: string;
}): Promise<RegistryVerificationBundle> {
  const report = reconcileRegistryTransactions(input.records);
  const evidence: Evidence[] = [];

  for (const source of input.sources) {
    const sourceRecords = input.records.filter(
      (record) => record.sourcePath === source.path,
    );
    evidence.push({
      nodeType: "evidence",
      id: "evidence:carbon:" + sourceSlug(source.path),
      createdAt: input.observedAt,
      provenance: [],
      kind: "registry-record",
      source: {
        uri: source.uri,
        publisher: "CarbonPlan OffsetsDB / " + source.registry,
        retrievedAt: input.observedAt,
      },
      integrity: await digest(input.provider, sourceRecords),
      rights: {
        sourceManifestId: "carbonplan-offsets-data",
        termsUri:
          "https://github.com/carbonplan/offsets-db-data/blob/main/TERMS_OF_DATA_ACCESS",
        redistribution: "unclear",
        commercialUse: "unclear",
        derivedData: "unclear",
        attribution:
          "CarbonPlan OffsetsDB and the relevant upstream carbon registry.",
      },
    });
  }

  const claim: Claim = {
    nodeType: "claim",
    id: "claim:carbon-registry-reconciliation",
    createdAt: input.observedAt,
    provenance: evidence.map((item) => ({
      nodeType: "evidence",
      id: item.id,
      role: "registry-source",
    })),
    subject: {
      id: "dataset:carbonplan-offsets-subset",
      kind: "dataset",
      name: "Pinned CarbonPlan OffsetsDB multi-registry subset",
    },
    assertion: {
      kind: "qualitative",
      statement:
        "Reconciled " +
        report.recordCount +
        " registry transactions across " +
        report.registries.length +
        " registries; duplicate retirement excess=" +
        report.duplicateExcessCount +
        ", over-retired groups=" +
        report.overRetiredCount +
        ", unresolved missing-issuance groups=" +
        report.unresolvedMissingIssuanceCount +
        ".",
    },
    assessments: [
      { dimension: "source-found", state: "confirmed" },
      { dimension: "calculation-reproduced", state: "confirmed" },
      {
        dimension: "evidence-integrity-confirmed",
        state: "confirmed",
        note:
          "Each normalized source slice is hashed and the source snapshot is pinned by Git commit/blob identity.",
      },
      ...(report.duplicateExcessCount > 0 || report.overRetiredCount > 0
        ? [{ dimension: "disputed" as const, state: "confirmed" as const }]
        : []),
    ],
  };

  const verificationResult =
    report.duplicateExcessCount > 0 || report.overRetiredCount > 0
      ? "mismatch"
      : report.unresolvedMissingIssuanceCount > 0
        ? "insufficient-evidence"
        : "reconciled";

  const verification: Verification = {
    nodeType: "verification",
    id: "verification:carbon-registry-reconciliation",
    createdAt: input.observedAt,
    provenance: [
      {
        nodeType: "claim",
        id: claim.id,
        role: "claim-under-review",
      },
      ...evidence.map((item) => ({
        nodeType: "evidence" as const,
        id: item.id,
        role: "registry-source",
      })),
    ],
    verifier: {
      id: "service:climatechain:carbon-registry",
      kind: "service",
      name: "ClimateChain Carbon Registry",
    },
    profile: "carbon-registry-reconciliation/0.1",
    result: verificationResult,
    checks: [
      {
        id: "multi-registry",
        name: "At least two registries are present",
        outcome: report.registries.length >= 2 ? "pass" : "fail",
        detail: report.registries.join(", "),
      },
      {
        id: "duplicate-retirements",
        name: "No exact duplicate retirement serial claims",
        outcome: report.duplicateExcessCount === 0 ? "pass" : "fail",
        detail:
          report.duplicateExcessCount +
          " duplicate retirement record(s) beyond first occurrence.",
      },
      {
        id: "over-retirement",
        name: "Retirement quantity does not exceed matched issuance quantity",
        outcome: report.overRetiredCount === 0 ? "pass" : "fail",
        detail: report.overRetiredCount + " over-retired project/vintage group(s).",
      },
      {
        id: "source-coverage",
        name: "Retirements have matching issuance evidence in this bounded subset",
        outcome:
          report.unresolvedMissingIssuanceCount === 0 ? "pass" : "warn",
        detail:
          report.unresolvedMissingIssuanceCount +
          " retirement group(s) lack issuance evidence in this subset; this is unresolved, not automatically invalid.",
      },
    ],
    findings: [
      "Exact duplicate checks are registry-namespaced; identical text across different registries is not treated as the same credit.",
      "Missing issuance in a bounded sample is reported as unresolved rather than over-retirement.",
      "The duplicate/tamper demo injects modified records in memory and is not an allegation about the upstream registries.",
    ],
    verifiedAt: input.observedAt,
  };

  const caseBundle: ClimateCaseBundle = {
    schemaVersion: CLIMATECHAIN_SCHEMA_VERSION,
    caseId: input.caseId ?? "case:carbon-registry",
    title: "Carbon registry reconciliation",
    capabilities: ["carbon-registry", "claim-reconciliation"],
    createdAt: input.observedAt,
    claims: [claim],
    evidence,
    calculations: [],
    factors: [],
    modelRuns: [],
    verifications: [verification],
    attestations: [],
    anchors: [],
  };

  const evidenceRoot = await createEvidenceRoot(
    caseBundle,
    [{ nodeType: "verification", id: verification.id }],
    input.provider,
  );

  return { caseBundle, report, evidenceRoot };
}
