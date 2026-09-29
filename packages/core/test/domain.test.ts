import assert from "node:assert/strict";
import test from "node:test";

import {
  CLIMATECHAIN_SCHEMA_VERSION,
  canonicalize,
  traceProvenance,
  validateBundle,
} from "../src/index.js";
import type { ClimateCaseBundle } from "../src/index.js";

function sampleBundle(): ClimateCaseBundle {
  return {
    schemaVersion: CLIMATECHAIN_SCHEMA_VERSION,
    caseId: "case:test-building",
    title: "Building MRV provenance test",
    capabilities: ["building-meter-mrv", "carbon-recalculation"],
    createdAt: "2026-09-29T06:45:00Z",
    claims: [
      {
        nodeType: "claim",
        id: "claim:scope2",
        createdAt: "2026-09-29T06:45:00Z",
        provenance: [
          { nodeType: "calculation", id: "calculation:scope2", role: "derived-by" },
        ],
        subject: {
          id: "site:test",
          kind: "site",
          name: "Test site",
        },
        assertion: {
          kind: "quantitative",
          metric: "Scope 2 location-based emissions",
          quantity: { value: 10, unit: "tCO2e" },
        },
        assessments: [
          { dimension: "disclosed", state: "confirmed" },
          { dimension: "calculation-reproduced", state: "confirmed" },
          { dimension: "factor-traced", state: "confirmed" },
          { dimension: "evidence-integrity-confirmed", state: "not-assessed" },
        ],
      },
    ],
    evidence: [
      {
        nodeType: "evidence",
        id: "evidence:meter",
        createdAt: "2026-09-29T06:45:00Z",
        provenance: [],
        kind: "meter-data",
        source: {
          localRef: "fixtures/meter.csv",
          publisher: "Test fixture",
          retrievedAt: "2026-09-29T06:45:00Z",
        },
        rights: {
          redistribution: "allowed",
          attribution: "ClimateChain test fixture",
        },
      },
      {
        nodeType: "evidence",
        id: "evidence:factor-source",
        createdAt: "2026-09-29T06:45:00Z",
        provenance: [],
        kind: "calculation-input",
        source: {
          uri: "https://example.invalid/factor",
          publisher: "Test fixture",
          retrievedAt: "2026-09-29T06:45:00Z",
        },
        rights: {
          redistribution: "allowed",
          attribution: "ClimateChain test fixture",
        },
      },
    ],
    calculations: [
      {
        nodeType: "calculation",
        id: "calculation:scope2",
        createdAt: "2026-09-29T06:45:00Z",
        provenance: [
          { nodeType: "evidence", id: "evidence:meter", role: "activity-data" },
          { nodeType: "factor", id: "factor:grid", role: "emission-factor" },
        ],
        method: {
          id: "ghg-multiply",
          name: "Activity data multiplied by emission factor",
          version: "1",
        },
        parameters: {},
        output: {
          kind: "quantitative",
          metric: "Scope 2 location-based emissions",
          quantity: { value: 10, unit: "tCO2e" },
        },
        executedAt: "2026-09-29T06:45:00Z",
        reproducibility: {
          codeVersion: "test",
        },
      },
    ],
    factors: [
      {
        nodeType: "factor",
        id: "factor:grid",
        createdAt: "2026-09-29T06:45:00Z",
        provenance: [
          {
            nodeType: "evidence",
            id: "evidence:factor-source",
            role: "published-by",
          },
        ],
        factorType: "grid-electricity",
        value: 0.2,
        unit: "kgCO2e/kWh",
        sourceOrganisation: "Test fixture",
        retrievedAt: "2026-09-29T06:45:00Z",
        accountingBasis: "location-based",
      },
    ],
    modelRuns: [],
    verifications: [],
    attestations: [],
    anchors: [],
  };
}

test("canonicalize is independent of object key insertion order", () => {
  const left = canonicalize({
    z: 1,
    a: { d: 4, b: 2 },
    list: [{ y: 2, x: 1 }],
  });
  const right = canonicalize({
    list: [{ x: 1, y: 2 }],
    a: { b: 2, d: 4 },
    z: 1,
  });

  assert.equal(left, right);
});

test("traceProvenance walks from claim to raw source evidence", () => {
  const bundle = sampleBundle();
  const nodes = traceProvenance(bundle, {
    nodeType: "claim",
    id: "claim:scope2",
  });

  assert.deepEqual(
    nodes.map((node) => node.id),
    [
      "claim:scope2",
      "calculation:scope2",
      "evidence:meter",
      "factor:grid",
      "evidence:factor-source",
    ],
  );
});

test("validateBundle reports no graph issues for a valid bundle", () => {
  assert.deepEqual(validateBundle(sampleBundle()), []);
});

test("validateBundle reports a dangling provenance reference", () => {
  const bundle = sampleBundle();
  bundle.claims[0]?.provenance.push({
    nodeType: "evidence",
    id: "evidence:missing",
    role: "supporting-source",
  });

  const issues = validateBundle(bundle);
  assert.equal(
    issues.some((issue) => issue.code === "dangling-reference"),
    true,
  );
});

test("status vocabulary does not collapse evidence states into verified", () => {
  const claim = sampleBundle().claims[0];
  assert.ok(claim);
  assert.equal("verified" in claim, false);
  assert.equal(
    claim.assessments.some(
      (assessment) =>
        assessment.dimension === "calculation-reproduced" &&
        assessment.state === "confirmed",
    ),
    true,
  );
});
