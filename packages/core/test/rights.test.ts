import assert from "node:assert/strict";
import test from "node:test";

import {
  SOURCE_RIGHTS_SCHEMA_VERSION,
  canRedistributeSource,
  validateSourceRightsManifest,
} from "../src/index.js";
import type {
  SourceRightsManifest,
  SourceRightsRecord,
} from "../src/index.js";

function source(
  overrides: Partial<SourceRightsRecord> = {},
): SourceRightsRecord {
  return {
    id: "source:test",
    name: "Test dataset",
    component: "dataset",
    canonicalUrl: "https://example.invalid/data",
    upstreamPublisher: "Example",
    retrievedAt: "2026-09-29",
    licence: {
      status: "verified-open",
      identifier: "CC-BY-4.0",
      name: "Creative Commons Attribution 4.0",
      url: "https://example.invalid/license",
    },
    permissions: {
      use: "allowed",
      redistribution: "allowed",
      commercialUse: "allowed",
      derivedData: "allowed",
      attributionRequired: true,
    },
    repository: {
      mode: "redistributable",
      path: "data/external/source:test",
      note: "Small fixture only.",
    },
    attribution: "Example dataset, CC-BY-4.0.",
    notes: [],
    evidence: [
      {
        url: "https://example.invalid/license",
        finding: "Licence metadata checked.",
      },
    ],
    ...overrides,
  };
}

function manifest(sources: SourceRightsRecord[]): SourceRightsManifest {
  return {
    schemaVersion: SOURCE_RIGHTS_SCHEMA_VERSION,
    auditedAt: "2026-09-29",
    policy: {
      unknownRightsDefault: "do-not-redistribute",
      externalDataRoot: "data/external",
      requireOriginalSourceUrl: true,
      requireAttribution: true,
    },
    sources,
  };
}

test("verified open sources can be marked redistributable", () => {
  const item = source();
  assert.equal(canRedistributeSource(item), true);
  assert.deepEqual(validateSourceRightsManifest(manifest([item])), []);
});

test("unknown rights cannot be marked redistributable", () => {
  const item = source({
    licence: {
      status: "unclear",
      name: "No licence found",
      url: "https://example.invalid/no-license",
    },
  });

  const issues = validateSourceRightsManifest(manifest([item]));
  assert.equal(canRedistributeSource(item), false);
  assert.equal(
    issues.some((issue) => issue.code === "unsafe-redistribution"),
    true,
  );
});

test("non-redistributable sources cannot declare an external data path", () => {
  const item = source({
    permissions: {
      use: "reference-only",
      redistribution: "prohibited",
      commercialUse: "prohibited",
      derivedData: "unclear",
      attributionRequired: true,
    },
    repository: {
      mode: "link-only",
      path: "data/external/unsafe",
      note: "Should not be allowed.",
    },
  });

  const issues = validateSourceRightsManifest(manifest([item]));
  assert.equal(
    issues.some((issue) => issue.code === "repository-mode-conflict"),
    true,
  );
});
