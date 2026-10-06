import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryNodeCryptoProvider } from "@grounding-climate/crypto-node";

import {
  CarbonRegistryService,
  buildRegistryVerification,
  checkRetirement,
  createCarbonRegistryModule,
  normalizeRegistryCsv,
  reconcileRegistryTransactions,
} from "../src/index.js";
import type {
  NormalizedRegistryTransaction,
  RegistrySourceRef,
} from "../src/index.js";

const COMMIT = "c34ec955df0988009ac14e8abd91013f3b03e4f5";

const acrIssuance = `Date Issued (GMT),Vintage,Total Credits Issued,Project ID
2026-01-01,2025,100,ACR1
`;

const acrRetirement = `Vintage,Quantity of Credits,Status Effective (GMT),Retired on Behalf of,Project ID,Credit Serial Numbers
2025,40,2026-02-01,Buyer A,ACR1,ACR-US-1-1 to 40
`;

const gsIssuance = `Vintage,Quantity,GSID,Issuance Date
2025,75,123,2026-01-02
`;

const gsRetirement = `Vintage,Quantity,GSID,Retirement Date,Serial Number,Using Entity
2025,25,123,2026-02-02,GS1-1-TEST-1-25,Buyer B
`;

const carRetirementOnly = `Vintage,Quantity of Offset Credits,Status Effective,Project ID,Offset Credit Serial Numbers,Account Holder
2025,10,2026-02-03,CAR9,CAR-TEST-1 to 10,Buyer C
`;

function normalizeAll(): NormalizedRegistryTransaction[] {
  return [
    ...normalizeRegistryCsv({
      registry: "american-carbon-registry",
      kind: "issuance",
      sourcePath: "acr-issuances.csv",
      csv: acrIssuance,
    }),
    ...normalizeRegistryCsv({
      registry: "american-carbon-registry",
      kind: "retirement",
      sourcePath: "acr-retirements.csv",
      csv: acrRetirement,
    }),
    ...normalizeRegistryCsv({
      registry: "gold-standard",
      kind: "issuance",
      sourcePath: "gs-issuances.csv",
      csv: gsIssuance,
    }),
    ...normalizeRegistryCsv({
      registry: "gold-standard",
      kind: "retirement",
      sourcePath: "gs-retirements.csv",
      csv: gsRetirement,
    }),
    ...normalizeRegistryCsv({
      registry: "climate-action-reserve",
      kind: "retirement",
      sourcePath: "car-retirements.csv",
      csv: carRetirementOnly,
    }),
  ];
}

function sources(): RegistrySourceRef[] {
  return [
    {
      registry: "american-carbon-registry",
      kind: "issuance",
      uri: "https://example.invalid/acr-issuances.csv",
      path: "acr-issuances.csv",
      gitBlobSha: "a",
      commit: COMMIT,
    },
    {
      registry: "american-carbon-registry",
      kind: "retirement",
      uri: "https://example.invalid/acr-retirements.csv",
      path: "acr-retirements.csv",
      gitBlobSha: "b",
      commit: COMMIT,
    },
    {
      registry: "gold-standard",
      kind: "issuance",
      uri: "https://example.invalid/gs-issuances.csv",
      path: "gs-issuances.csv",
      gitBlobSha: "c",
      commit: COMMIT,
    },
    {
      registry: "gold-standard",
      kind: "retirement",
      uri: "https://example.invalid/gs-retirements.csv",
      path: "gs-retirements.csv",
      gitBlobSha: "d",
      commit: COMMIT,
    },
    {
      registry: "climate-action-reserve",
      kind: "retirement",
      uri: "https://example.invalid/car-retirements.csv",
      path: "car-retirements.csv",
      gitBlobSha: "e",
      commit: COMMIT,
    },
  ];
}

test("normalizes three registry source schemas", () => {
  const records = normalizeAll();

  assert.equal(records.length, 5);
  assert.deepEqual(
    [...new Set(records.map((record) => record.registry))].sort(),
    [
      "american-carbon-registry",
      "climate-action-reserve",
      "gold-standard",
    ],
  );

  const gs = records.find(
    (record) =>
      record.registry === "gold-standard" &&
      record.kind === "issuance",
  );
  assert.equal(gs?.projectId, "GS123");
  assert.equal(gs?.quantity, 75);

  const acr = records.find(
    (record) =>
      record.registry === "american-carbon-registry" &&
      record.kind === "retirement",
  );
  assert.equal(acr?.serialRange, "ACR-US-1-1 to 40");
  assert.equal(acr?.beneficiary, "Buyer A");
});

test("bounded missing issuance is unresolved rather than over-retired", () => {
  const report = reconcileRegistryTransactions(normalizeAll());

  assert.equal(report.overRetiredCount, 0);
  assert.equal(report.unresolvedMissingIssuanceCount, 1);
  assert.equal(report.supportedCount, 2);

  const car = report.reconciliations.find(
    (item) => item.registry === "climate-action-reserve",
  );
  assert.equal(car?.status, "unresolved-missing-issuance");
});

test("retirement above known issuance is an explicit mismatch", () => {
  const records = normalizeAll();
  const acrRetirementRecord = records.find(
    (record) =>
      record.registry === "american-carbon-registry" &&
      record.kind === "retirement",
  );
  assert.ok(acrRetirementRecord);
  acrRetirementRecord.quantity = 140;

  const report = reconcileRegistryTransactions(records);

  assert.equal(report.overRetiredCount, 1);
  const acr = report.reconciliations.find(
    (item) => item.registry === "american-carbon-registry",
  );
  assert.equal(acr?.status, "over-retired");
  assert.equal(acr?.remaining, -40);
});

test("exact duplicate retirement serial is registry-namespaced", () => {
  const records = normalizeAll();
  const acr = records.find(
    (record) =>
      record.registry === "american-carbon-registry" &&
      record.kind === "retirement",
  );
  assert.ok(acr);

  records.push({
    ...structuredClone(acr),
    sourceRow: 999,
  });

  records.push({
    ...structuredClone(acr),
    registry: "climate-action-reserve",
    projectId: "CAR-CROSS-REGISTRY",
    sourceRow: 1000,
  });

  const report = reconcileRegistryTransactions(records);

  assert.equal(report.duplicateRetirements.length, 1);
  assert.equal(report.duplicateExcessCount, 1);
  assert.equal(
    report.duplicateRetirements[0]?.registry,
    "american-carbon-registry",
  );
});

test("retirement lookup reports exact duplicate count", () => {
  const records = normalizeAll();
  const acr = records.find(
    (record) =>
      record.registry === "american-carbon-registry" &&
      record.kind === "retirement",
  );
  assert.ok(acr?.serialRange);

  records.push({ ...structuredClone(acr), sourceRow: 999 });

  const result = checkRetirement(
    records,
    "american-carbon-registry",
    acr.serialRange,
  );

  assert.equal(result.found, true);
  assert.equal(result.duplicate, true);
  assert.equal(result.occurrences, 2);
});

test("shared evidence root changes when normalized registry evidence changes", async () => {
  const provider = new InMemoryNodeCryptoProvider();
  provider.generateEd25519Key({
    keyId: "key:carbon-test",
    controller: "service:carbon-test",
    createdAt: "2026-09-30T00:00:00Z",
  });

  const clean = await buildRegistryVerification({
    records: normalizeAll(),
    sources: sources(),
    provider,
    observedAt: "2026-09-30T00:00:00Z",
  });

  const tamperedRecords = normalizeAll();
  const retirement = tamperedRecords.find(
    (record) =>
      record.registry === "american-carbon-registry" &&
      record.kind === "retirement",
  );
  assert.ok(retirement);
  retirement.quantity += 1;

  const tampered = await buildRegistryVerification({
    records: tamperedRecords,
    sources: sources(),
    provider,
    observedAt: "2026-09-30T00:00:00Z",
  });

  assert.notEqual(
    clean.evidenceRoot.root.value,
    tampered.evidenceRoot.root.value,
  );
});

test("verification reports insufficient evidence until bounded source coverage is complete", async () => {
  const provider = new InMemoryNodeCryptoProvider();
  provider.generateEd25519Key({
    keyId: "key:carbon-verification",
    controller: "service:carbon-test",
    createdAt: "2026-09-30T00:00:00Z",
  });

  const built = await buildRegistryVerification({
    records: normalizeAll(),
    sources: sources(),
    provider,
    observedAt: "2026-09-30T00:00:00Z",
  });

  assert.equal(
    built.caseBundle.verifications[0]?.result,
    "insufficient-evidence",
  );
  assert.equal(built.report.duplicateExcessCount, 0);
});

test("WebMCP tools reuse the service and ledger decision defers", async () => {
  const provider = new InMemoryNodeCryptoProvider();
  provider.generateEd25519Key({
    keyId: "key:carbon-service",
    controller: "service:carbon-test",
    createdAt: "2026-09-30T00:00:00Z",
  });

  const service = new CarbonRegistryService({
    caseId: "case:carbon-registry",
    records: normalizeAll(),
    sources: sources(),
    provider,
    observedAt: "2026-09-30T00:00:00Z",
  });
  const module = createCarbonRegistryModule(service);

  assert.deepEqual(module.capabilities, ["carbon-registry"]);

  const report = (await service.execute(
    "carbon-registry",
    "carbon_reconcile_registry_records",
    { caseId: "case:carbon-registry" },
  )) as ReturnType<CarbonRegistryService["report"]>;

  assert.equal(report.registries.length, 3);
  assert.equal(service.ledgerDecision().decision, "defer-ledger");
});
