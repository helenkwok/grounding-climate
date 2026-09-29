export const SOURCE_RIGHTS_SCHEMA_VERSION =
  "climatechain.source-rights/0.1" as const;

export type RightsDecision = "allowed" | "prohibited" | "unclear";
export type LicenceStatus =
  | "verified-open"
  | "terms-restricted"
  | "source-specific"
  | "unclear";

export type RepositoryUseMode =
  | "redistributable"
  | "download-from-upstream"
  | "link-only"
  | "code-only";

export interface SourceRightsLicence {
  status: LicenceStatus;
  identifier?: string;
  name: string;
  url: string;
}

export interface SourceRightsPermissions {
  use: "allowed" | "reference-only" | "unclear";
  redistribution: RightsDecision;
  commercialUse: RightsDecision;
  derivedData: RightsDecision;
  attributionRequired: boolean;
}

export interface SourceRightsEvidence {
  url: string;
  finding: string;
}

export interface SourceRightsRecord {
  id: string;
  name: string;
  component:
    | "website"
    | "code"
    | "dataset"
    | "registry-data"
    | "benchmark-data";
  canonicalUrl: string;
  upstreamPublisher: string;
  retrievedAt: string;
  licence: SourceRightsLicence;
  permissions: SourceRightsPermissions;
  repository: {
    mode: RepositoryUseMode;
    path?: string;
    note: string;
  };
  attribution: string;
  notes: string[];
  evidence: SourceRightsEvidence[];
}

export interface SourceRightsManifest {
  schemaVersion: typeof SOURCE_RIGHTS_SCHEMA_VERSION;
  auditedAt: string;
  policy: {
    unknownRightsDefault: "do-not-redistribute";
    externalDataRoot: string;
    requireOriginalSourceUrl: boolean;
    requireAttribution: boolean;
  };
  sources: SourceRightsRecord[];
}

export interface SourceRightsValidationIssue {
  code:
    | "duplicate-source"
    | "unsafe-redistribution"
    | "missing-open-licence-id"
    | "repository-mode-conflict"
    | "missing-attribution"
    | "missing-evidence";
  sourceId: string;
  message: string;
}

export function validateSourceRightsManifest(
  manifest: SourceRightsManifest,
): SourceRightsValidationIssue[] {
  const issues: SourceRightsValidationIssue[] = [];
  const seen = new Set<string>();

  for (const source of manifest.sources) {
    if (seen.has(source.id)) {
      issues.push({
        code: "duplicate-source",
        sourceId: source.id,
        message: "Duplicate source id: " + source.id,
      });
    }
    seen.add(source.id);

    if (
      source.permissions.redistribution === "allowed" &&
      source.licence.status !== "verified-open"
    ) {
      issues.push({
        code: "unsafe-redistribution",
        sourceId: source.id,
        message:
          "Redistribution is allowed only when the source licence is verified-open.",
      });
    }

    if (
      source.licence.status === "verified-open" &&
      !source.licence.identifier
    ) {
      issues.push({
        code: "missing-open-licence-id",
        sourceId: source.id,
        message: "Verified-open sources require a licence identifier.",
      });
    }

    if (
      source.repository.mode === "redistributable" &&
      source.permissions.redistribution !== "allowed"
    ) {
      issues.push({
        code: "repository-mode-conflict",
        sourceId: source.id,
        message:
          "Repository mode redistributable requires redistribution=allowed.",
      });
    }

    if (
      source.repository.mode !== "redistributable" &&
      source.repository.path
    ) {
      issues.push({
        code: "repository-mode-conflict",
        sourceId: source.id,
        message:
          "Only redistributable sources may declare an external-data path.",
      });
    }

    if (
      source.permissions.attributionRequired &&
      source.attribution.trim().length === 0
    ) {
      issues.push({
        code: "missing-attribution",
        sourceId: source.id,
        message: "Attribution-required source has no attribution text.",
      });
    }

    if (source.evidence.length === 0) {
      issues.push({
        code: "missing-evidence",
        sourceId: source.id,
        message: "Rights decisions require at least one evidence URL.",
      });
    }
  }

  return issues;
}

export function canRedistributeSource(
  source: SourceRightsRecord,
): boolean {
  return (
    source.licence.status === "verified-open" &&
    source.permissions.redistribution === "allowed" &&
    source.repository.mode === "redistributable"
  );
}
