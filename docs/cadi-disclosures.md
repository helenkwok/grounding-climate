# Public CaDI disclosure sources

Issue: #5

Grounding treats a public CaDI record as a **disclosure claim**, not automatic physical ground truth.

The working state model is:

```text
published/disclosed
source located
calculation reproduced
emission factors traced
evidence integrity checked
third-party assurance inspected
```

These states are independent. A source can confirm that a company publishes on CaDI while the underlying calculation remains `not-assessed`.

## Rights boundary

The source-rights policy for CaDI remains `link-only`.

Grounding stores:

- organisation/source identifiers
- original URLs
- retrieval time
- small factual claim extractions
- evidence roots

It does not bulk mirror CaDI pages or package CaDI source content.

The machine-readable candidate set is:

`sources/cadi-candidates.json`

## Confirmed candidates

Research date: **30 September 2026**.

### Carbon Footprint Ltd

First-party confirmation:

`https://www.carbonfootprint.com/our_cadi_data.html`

The company explicitly states that it measures its own footprint and publishes it openly on CaDI.

Underlying source:

`https://www.carbonfootprint.com/our_sustainability.html`

This is useful for disclosure/provenance semantics but is not the first numeric reconciliation case.

### Elliott Baxter & Company Ltd (EBB)

First-party confirmation:

`https://www.ebbgroup.com/ebb-strengthens-transparency-with-carbon-disclosure-on-cadi.html`

EBB states that it publishes its environmental data on CaDI and identifies its annual Sustainability Brochure as the primary detailed source.

Underlying source:

`https://www.ebbgroup.com/sustainability-brochure.html`

### LPL Construction

First-party confirmation and source:

`https://lplconstruction.com/2026/09/25/from-ambition-to-action-lpl-construction-and-the-journey-to-net-zero/`

The page states that Scope 1, 2 and 3 emissions are measured annually, externally verified through Carbon Footprint Ltd, and published on CaDI.

It reports:

```text
2025 Scope 1 = 601.26 tCO2e
```

This is the first numeric claim-ready disclosure case.

Important wording:

- `disclosed = confirmed`
- `source-found = confirmed`
- `calculation-reproduced = not-assessed`
- `factor-traced = not-assessed`
- `third-party-assured = not-assessed` in Grounding

The last item remains not-assessed because the first-party page attributes external verification to Carbon Footprint Ltd, but Grounding has not independently inspected that assurance engagement.

### Venn

Underlying public ESG review:

`https://www.venn-partners.com/wp-content/uploads/2026/01/ESG-initiatives-2025.pdf`

The 2025 review states that Venn received Carbon Footprint certification for 2024 and that the details are published on CaDI. It also reports that corporate-level emissions fell by nearly 60% from the prior year.

This is a useful CaDI confirmation and trend source, but not yet a complete numeric Scope 1/2/3 reconciliation input.

### Centreline / Pula Aviation Services

First-party confirmation:

`https://www.centreline.aero/carbon-database-initiative/`

Centreline states that data is being published via CaDI.

Underlying strategic source:

`https://www.centreline.aero/wp-content/uploads/2025/11/Net-Zero-Strategic-Plan-2050-1.pdf`

The plan includes annual independent carbon-footprint assessment as an action and a net-zero 2050 pathway.

### WASHCO Ltd

First-party confirmation:

`https://www.washco.co.uk/2025/09/another-step-towards-sustainability/`

WASHCO states that its emissions report has been published on CaDI and links directly to the CaDI report.

The direct CaDI application URL is currently:

`https://carbon.knack.com/cadi`

Grounding keeps the link rather than scraping/mirroring the application.

## First executable case: LPL 2025 Scope 1

The curated source record is:

```json
{
  "id": "claim:lpl:2025:scope1",
  "period": "2025",
  "metric": "Scope 1 emissions",
  "value": 601.26,
  "unit": "tCO2e",
  "basis": "reported"
}
```

`buildDisclosureCase()` creates:

- public-disclosure confirmation evidence
- underlying-source evidence
- quantitative Claim
- independent assessment dimensions
- shared #8 evidence root

No source document bytes are committed.

## Decision and accounting boundary

Nothing public lets anyone recalculate 601.26 tCO2e: the fuel quantities and factors behind it are LPL's. So the claim cannot reach `reconciled` by a calculation. `buildDisclosureReviewCase()` raises one flag, `disclosure:not-recalculable`, and a person decides what the claim rests on:

- `accept-as-attributed`: the claim rests on LPL's own statement, and says so. Result `reconciled`.
- `needs-source`: the claim waits for the activity data or the verification statement. Result `insufficient-evidence`.
- `reject`: result `insufficient-evidence`, marked rejected.

The decision (`reports/disclosure/claim-decisions.json`) is `accept-as-attributed` by `person:sustainability-reviewer`. It is bound to a SHA-256 of the extracted figure and both source links (`reviewInputDigest`), so a changed figure or link makes it stale. Decided is not verified: calculation reproduced and third-party assured stay `not-run`.

The claim's accounting boundary (`claim.boundary.accounting`) states:

- **Counts:** LPL's 2025 Scope 1, 601.26 tCO2e, as LPL reports it.
- **Leaves out:** Scope 2 (8.31 tCO2e) and Scope 3 (3,891.22 tCO2e) for 2025, reported on the same page; anything not on LPL's own page, including the CaDI record itself.
- **Policy choices:** a figure that cannot be recalculated needs a person's decision; the organisational boundary and method are LPL's (the page cites the GHG Protocol).
- **Not assessed:** the activity data and factors; the verification attributed to Carbon Footprint Ltd; whether the CaDI record matches the page.

Both evidence nodes are `link-only`: the reviewer opens the page and compares the figure. `node scripts/run-disclosure-case.mjs` builds, signs and verifies the case (`reports/disclosure/case-run.json`); `scripts/verify-disclosure-case.mjs` is part of `npm run check:cases`. The demo rebuilds the case in the browser, and `disclosure_review_claim` returns the claim, the boundary and the current decision.

## Reconciliation

`reconcileDisclosureClaim()` compares a later reconstructed value with the disclosed value using an explicit relative tolerance.

For example:

```text
disclosed = 601.26 tCO2e
reconstructed = 601.26 tCO2e
tolerance = 0.1%
→ numeric reconciliation passes
```

Changing the reconstructed value can fail numeric reconciliation.

This still does **not** prove that boundaries/methodology match. The result therefore carries a caveat that organisational boundary, activity data, factor basis, and assurance scope require separate checks.

## WebMCP

The shared disclosure module implements:

- `disclosure_get_public_claim`
- `disclosure_extract_report_claims`
- `disclosure_reconcile_claim`
- `disclosure_review_claim`

The current extraction mode is explicitly named:

```text
curated-source-record
```

It is not presented as an independently benchmarked AI extraction system.

If a report-extraction model is added later, it needs its own labelled evaluation set/metric before the UI or agent surface calls its output reliable.

## Tamper behavior

A change to the stored public claim changes the shared evidence root. In the signed case run, changing the extracted figure from 601.26 to 6012.6 (a decimal slip) makes the decision stale, the result `insufficient-evidence`, and the attestation stop matching (`reports/disclosure/case-run.json`, `tamper`).

This demonstrates integrity:

```text
old disclosure bytes/state
→ old root

changed claim/source state
→ new root
```

It does not turn the old public disclosure into false data automatically; it shows that the current state no longer matches the old commitment.

## Next cross-module demo

The strongest integration path is:

```text
LPL/other real CaDI disclosure
→ source claim
→ Building MRV or another real activity-data module
→ traced factor/calculation
→ numeric reconciliation
→ signed attestation
→ tamper one input
→ current evidence root changes
```

The public disclosure and reconstructed calculation must remain separate evidence branches until the underlying activity data and boundaries genuinely support the comparison.
