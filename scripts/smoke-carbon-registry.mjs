import { readFile } from "node:fs/promises";

import { InMemoryNodeCryptoProvider } from "../packages/crypto-node/dist/src/index.js";
import {
  CarbonRegistryService,
  buildRegistryVerification,
  normalizeRegistryCsv,
} from "../packages/carbon-registry/dist/src/index.js";

const root = process.argv[2];
if (!root) {
  throw new Error(
    "Usage: node scripts/smoke-carbon-registry.mjs <prepared-dir>",
  );
}

const manifest = JSON.parse(
  await readFile(root + "/manifest.json", "utf8"),
);

const records = [];
for (const source of manifest.sources) {
  const csv = await readFile(root + "/" + source.path, "utf8");
  records.push(
    ...normalizeRegistryCsv({
      registry: source.registry,
      kind: source.kind,
      sourcePath: source.path,
      csv,
    }),
  );
}

const provider = new InMemoryNodeCryptoProvider();
provider.generateEd25519Key({
  keyId: "key:carbon-registry-smoke",
  controller: "service:climatechain:carbon-registry",
  createdAt: "2026-09-30T00:00:00Z",
});

const sourceRefs = manifest.sources.map((source) => ({
  registry: source.registry,
  kind: source.kind,
  uri: source.uri,
  path: source.path,
  gitBlobSha: source.gitBlobSha,
  commit: source.commit,
}));

const service = new CarbonRegistryService({
  caseId: "case:carbon-registry-smoke",
  records,
  sources: sourceRefs,
  provider,
  observedAt: "2026-09-30T00:00:00Z",
});

const clean = await service.verification();
const ledgerDecision = service.ledgerDecision();

const firstRetirement = records.find(
  (record) => record.kind === "retirement" && record.serialRange,
);
if (!firstRetirement) {
  throw new Error("No retirement record with a serial range was found.");
}

const duplicateRecords = structuredClone(records);
duplicateRecords.push({
  ...structuredClone(firstRetirement),
  sourceRow: firstRetirement.sourceRow + 1_000_000,
});

const duplicate = await buildRegistryVerification({
  records: duplicateRecords,
  sources: sourceRefs,
  provider,
  observedAt: "2026-09-30T00:00:00Z",
  caseId: "case:carbon-registry-duplicate-demo",
});

if (duplicate.report.duplicateExcessCount < 1) {
  throw new Error("Injected duplicate retirement was not detected.");
}
if (
  duplicate.caseBundle.verifications[0]?.result !== "mismatch"
) {
  throw new Error("Injected duplicate did not cause verification mismatch.");
}

const tamperedRecords = structuredClone(records);
const tamperedRecord = tamperedRecords.find(
  (record) =>
    record.sourcePath === firstRetirement.sourcePath &&
    record.sourceRow === firstRetirement.sourceRow,
);
if (!tamperedRecord) {
  throw new Error("Could not find retirement selected for tamper demo.");
}

const originalQuantity = tamperedRecord.quantity;
tamperedRecord.quantity = originalQuantity + 1;

const tampered = await buildRegistryVerification({
  records: tamperedRecords,
  sources: sourceRefs,
  provider,
  observedAt: "2026-09-30T00:00:00Z",
  caseId: "case:carbon-registry-tamper-demo",
});

if (
  clean.evidenceRoot.root.value === tampered.evidenceRoot.root.value
) {
  throw new Error("Registry evidence tamper did not change evidence root.");
}

if (ledgerDecision.decision !== "defer-ledger") {
  throw new Error(
    "Prototype unexpectedly passed ledger decision gate: " +
      JSON.stringify(ledgerDecision),
  );
}

const cleanVerification =
  clean.caseBundle.verifications[0]?.result ?? null;

const result = {
  schemaVersion: "climatechain.carbon-registry-smoke/0.1",
  source: {
    repository: manifest.repository,
    commit: manifest.commit,
    rightsManifestId: manifest.rightsManifestId,
    fileCount: manifest.sources.length,
    totalBytes: manifest.sources.reduce(
      (sum, source) => sum + source.bytes,
      0,
    ),
  },
  clean: {
    report: clean.report,
    verificationResult: cleanVerification,
    evidenceRoot: clean.evidenceRoot.root,
  },
  duplicateDemo: {
    injected: true,
    registry: firstRetirement.registry,
    serialRange: firstRetirement.serialRange,
    originalSourcePath: firstRetirement.sourcePath,
    originalSourceRow: firstRetirement.sourceRow,
    duplicateExcessCount: duplicate.report.duplicateExcessCount,
    verificationResult:
      duplicate.caseBundle.verifications[0]?.result ?? null,
    evidenceRoot: duplicate.evidenceRoot.root,
    caveat:
      "The duplicate row is injected in memory for testing and is not an allegation about the upstream registry or CarbonPlan dataset.",
  },
  tamperDemo: {
    registry: firstRetirement.registry,
    serialRange: firstRetirement.serialRange,
    originalQuantity,
    changedQuantity: tamperedRecord.quantity,
    originalEvidenceRoot: clean.evidenceRoot.root,
    changedEvidenceRoot: tampered.evidenceRoot.root,
    rootChanged:
      clean.evidenceRoot.root.value !==
      tampered.evidenceRoot.root.value,
    caveat:
      "The quantity modification is injected in memory solely to test evidence integrity.",
  },
  ledgerDecision,
  scope: {
    primaryUser: "carbon-market auditor / verifier",
    aiUsed: false,
    aiRationale:
      "The first slice uses exact identifiers and deterministic reconciliation; no measurable AI task is needed.",
  },
};

console.log(
  "CLIMATECHAIN_CARBON_REGISTRY_SMOKE=" +
    JSON.stringify(result),
);
