import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { validateBundle } from "@grounding-climate/core";
import type { ReviewDecision } from "@grounding-climate/core";
import { InMemoryNodeCryptoProvider } from "@grounding-climate/crypto-node";

import { CarbonRegistryService, coverageFlags, normalizeRegistryCsv, registryTime } from "../src/index.js";
import type { CommittedRegistrySource, RegistryTransactionKind } from "../src/index.js";

// dist/test -> repository root
const read = (path: string) => readFileSync(new URL("../../../../" + path, import.meta.url), "utf8");
const sources: CommittedRegistrySource[] = (["issuance", "retirement"] as RegistryTransactionKind[]).map((kind) => ({
  registry: "american-carbon-registry",
  kind,
  path: "data/external/acr-offsetsdb/" + (kind === "issuance" ? "issuances" : "retirements") + ".csv",
  uri: "https://github.com/carbonplan/offsets-db-data",
  rightsManifestId: "acr-offsetsdb",
  citation: "ACR public reports via CarbonPlan OffsetsDB",
}));
const records = sources.flatMap((source) =>
  normalizeRegistryCsv({ registry: source.registry, kind: source.kind, sourcePath: source.path, csv: read(source.path) }),
);
// Synthetic, in CAR's column layout: not real registry data.
const CAR_CSV =
  "Project ID,Vintage,Quantity of Offset Credits,Status Effective,Offset Credit Serial Numbers,Account Holder\n" +
  "CAR9999,2020,10,2024-01-01,CAR-1-US-9999-1-1 to 10,Example\n";

const service = (decisions: ReviewDecision[]) =>
  new CarbonRegistryService({
    caseId: "case:carbon-test",
    records,
    sources: [],
    provider: new InMemoryNodeCryptoProvider(),
    observedAt: "2026-10-06T00:00:00Z",
    review: { committedSources: sources, decisions },
  });

test("carbon review: the coverage gap needs a current decision; an import or a duplicate changes it", async () => {
  const undecided = await service([]).review();
  assert.equal(undecided.report.recordCount, 200);
  assert.equal(undecided.report.unresolvedMissingIssuanceCount, 22);
  assert.equal(undecided.report.duplicateExcessCount, 0);
  assert.deepEqual(undecided.review.map((status) => status.flag.id), ["coverage:before-window", "coverage:inside-window"]);
  assert.deepEqual([undecided.coverage.beforeWindow, undecided.coverage.groups], [12, 22]);
  assert.equal(coverageFlags(undecided.coverage).length, 2);
  assert.deepEqual(undecided.coverage.windowStart, { "american-carbon-registry": "2024-04-26" });
  assert.equal(registryTime("4/13/2026 7:17:56 PM"), Date.UTC(2026, 3, 13, 19, 17, 56));
  assert.equal(registryTime("1/2/2024 12:05:00 AM"), Date.UTC(2024, 0, 2, 0, 5, 0));
  assert.equal(undecided.caseBundle.verifications[0]?.result, "insufficient-evidence");
  assert.ok(undecided.caseBundle.evidence.every((item) => item.access?.mode === "committed"));
  assert.match(undecided.caseBundle.claims[0]!.boundary!.accounting!.notAssessed.join(" "), /Durability/);
  assert.deepEqual(validateBundle(undecided.caseBundle), []);

  // Row order does not change the digest.
  const reversed = new CarbonRegistryService({
    caseId: "case:carbon-test",
    records: [...records].reverse(),
    sources: [],
    provider: new InMemoryNodeCryptoProvider(),
    observedAt: "2026-10-06T00:00:00Z",
    review: { committedSources: sources, decisions: [] },
  });
  assert.deepEqual((await reversed.review()).reviewInputDigest, undecided.reviewInputDigest);

  const decide = (flagId: string, decision: string): ReviewDecision => ({
    flagId,
    decision,
    reason: "Test.",
    decidedBy: "person:test",
    decidedAt: "2026-10-06T01:00:00Z",
    inputDigest: undecided.reviewInputDigest,
  });
  const split = await service([decide("coverage:before-window", "out-of-sample"), decide("coverage:inside-window", "investigate")]).review();
  assert.equal(split.caseBundle.verifications[0]?.result, "insufficient-evidence");
  const live = service([decide("coverage:before-window", "out-of-sample"), decide("coverage:inside-window", "out-of-sample")]);
  assert.equal((await live.review()).caseBundle.verifications[0]?.result, "reconciled");

  // A report the reviewer brings: kept as a digest, and the decision was made without it, so it is stale.
  const imported = await live.importReport({
    registry: "climate-action-reserve",
    kind: "retirement",
    csv: CAR_CSV,
    sourceUri: "https://thereserve2.apx.com/",
    downloadedAt: "2026-10-06T02:00:00Z",
  });
  assert.equal(imported.records, 1);
  const withImport = await live.review();
  const evidence = withImport.caseBundle.evidence.find((item) => item.access?.mode === "reviewer-supplied");
  assert.deepEqual(evidence?.integrity, imported.digest);
  assert.equal(evidence?.rights?.sourceManifestId, "car-registry-reports");
  assert.ok(!JSON.stringify(withImport.caseBundle).includes("CAR-1-US-9999"), "imported records are not stored in the case");
  assert.equal(withImport.review[0]?.state, "stale");
  await assert.rejects(
    live.importReport({ registry: "american-carbon-registry", kind: "issuance", csv: CAR_CSV, sourceUri: "https://x.org/", downloadedAt: "" }),
    /committed/,
  );
  live.clearImports();

  // A serial range retired twice is a mismatch whatever the decision.
  const first = records.find((record) => record.kind === "retirement")!;
  live.setRecords([...records, { ...first, sourceRow: 999 }]);
  const duplicated = await live.review();
  assert.equal(duplicated.report.duplicateExcessCount, 1);
  assert.equal(duplicated.caseBundle.verifications[0]?.result, "mismatch");
});
