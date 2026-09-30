import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryNodeCryptoProvider } from "@climatechain/crypto-node";

import {
  DisclosureService,
  buildDisclosureCase,
  createDisclosureModule,
  reconcileDisclosureClaim,
} from "../src/index.js";
import type {
  DisclosureCandidate,
  ExtractedDisclosureClaim,
} from "../src/index.js";

const LPL_CLAIM: ExtractedDisclosureClaim = {
  id: "claim:lpl:2025:scope1",
  organisationId: "lpl-construction",
  organisationName: "LPL Construction",
  period: "2025",
  metric: "Scope 1 emissions",
  value: 601.26,
  unit: "tCO2e",
  basis: "reported",
  sourceUrl:
    "https://lplconstruction.com/2026/09/25/from-ambition-to-action-lpl-construction-and-the-journey-to-net-zero/",
  sourceRetrievedAt: "2026-09-30T00:00:00Z",
  assuranceClaim:
    "First-party page states external verification through Carbon Footprint Ltd.",
};

const LPL: DisclosureCandidate = {
  id: "lpl-construction",
  name: "LPL Construction",
  confirmationStatus: "confirmed-on-cadi",
  confirmationUrl: LPL_CLAIM.sourceUrl,
  underlyingSourceUrl: LPL_CLAIM.sourceUrl,
  usableClaim:
    "2025 Scope 1 = 601.26 tCO2e; first-party page states publication on CaDI.",
  numericClaimReady: true,
  extractedClaims: [LPL_CLAIM],
};

test("numeric reconciliation is explicit and tolerance-bounded", () => {
  const exact = reconcileDisclosureClaim(LPL_CLAIM, 601.26, 0.001);
  assert.equal(exact.reconciled, true);
  assert.equal(exact.relativeDifference, 0);

  const changed = reconcileDisclosureClaim(LPL_CLAIM, 575, 0.01);
  assert.equal(changed.reconciled, false);
  assert.ok(changed.relativeDifference > 0.04);
});

test("public disclosure case does not collapse assurance into generic verification", async () => {
  const provider = new InMemoryNodeCryptoProvider();
  provider.generateEd25519Key({
    keyId: "key:disclosure-test",
    controller: "service:disclosure",
    createdAt: "2026-09-30T00:00:00Z",
  });

  const built = await buildDisclosureCase({
    claim: LPL_CLAIM,
    provider,
    confirmationUrl: LPL.confirmationUrl,
    underlyingSourceUrl: LPL.underlyingSourceUrl,
    observedAt: "2026-09-30T00:00:00Z",
  });

  const claim = built.caseBundle.claims[0];
  assert.ok(claim);
  assert.equal(
    claim.assessments.find((item) => item.dimension === "disclosed")?.state,
    "confirmed",
  );
  assert.equal(
    claim.assessments.find(
      (item) => item.dimension === "calculation-reproduced",
    )?.state,
    "not-assessed",
  );
  assert.equal(
    claim.assessments.find(
      (item) => item.dimension === "third-party-assured",
    )?.state,
    "not-assessed",
  );
  assert.match(
    claim.assessments.find(
      (item) => item.dimension === "third-party-assured",
    )?.note ?? "",
    /has not independently audited/,
  );
});

test("changing a public claim changes the shared evidence root", async () => {
  const provider = new InMemoryNodeCryptoProvider();
  provider.generateEd25519Key({
    keyId: "key:disclosure-root",
    controller: "service:disclosure",
    createdAt: "2026-09-30T00:00:00Z",
  });

  const original = await buildDisclosureCase({
    claim: LPL_CLAIM,
    provider,
    confirmationUrl: LPL.confirmationUrl,
    underlyingSourceUrl: LPL.underlyingSourceUrl,
    observedAt: "2026-09-30T00:00:00Z",
  });

  const changed = await buildDisclosureCase({
    claim: { ...LPL_CLAIM, value: 601.27 },
    provider,
    confirmationUrl: LPL.confirmationUrl,
    underlyingSourceUrl: LPL.underlyingSourceUrl,
    observedAt: "2026-09-30T00:00:00Z",
  });

  assert.notEqual(
    original.evidenceRoot.root.value,
    changed.evidenceRoot.root.value,
  );
});

test("WebMCP disclosure tools reuse curated source records and reconciliation", async () => {
  const service = new DisclosureService([LPL]);
  const module = createDisclosureModule(service);

  assert.ok(module.capabilities.includes("public-disclosure"));
  assert.ok(module.capabilities.includes("claim-reconciliation"));

  const extracted = (await service.execute(
    "disclosure",
    "disclosure_extract_report_claims",
    { candidateId: "lpl-construction" },
  )) as { extractionMode: string; claims: ExtractedDisclosureClaim[] };

  assert.equal(extracted.extractionMode, "curated-source-record");
  assert.equal(extracted.claims[0]?.value, 601.26);

  const reconciled = (await service.execute(
    "disclosure",
    "disclosure_reconcile_claim",
    {
      claimId: "claim:lpl:2025:scope1",
      reconstructedValue: 601.26,
      tolerance: 0.001,
    },
  )) as { reconciled: boolean };

  assert.equal(reconciled.reconciled, true);
});
