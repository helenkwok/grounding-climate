# Carbon registry reconciliation

Issue: #13

Primary user: **carbon-market auditor / verifier**.

The operational question is:

> Can a bounded set of issuance and retirement records be reconciled deterministically, with duplicate claims, over-retirement, missing source coverage, and source changes represented explicitly?

The first slice deliberately does **not** add AI. Exact registry identifiers and serial ranges already support a measurable deterministic job; entity-resolution AI can be added later only for records that genuinely require fuzzy matching.

## Real source path

Grounding uses the small multi-registry fixture snapshots maintained by CarbonPlan's OffsetsDB pipeline.

Pinned CarbonPlan commit:

```text
c34ec955df0988009ac14e8abd91013f3b03e4f5
```

Selected runtime files:

| Registry | Issuance blob | Retirement blob |
| --- | --- | --- |
| American Carbon Registry | `3209dc5cd5ad40e54d7dc040d4e6caf2014ae69f` | `1388abca2ff4d83bd849010921582eed3fa72737` |
| Gold Standard | `0bb24827b3f4ec6cc40b0ada761bba7f5dc56e8a` | `94281d0dee382a9175852f1a1c74a5134a97bd8d` |
| Climate Action Reserve | `7e480a2f7e390ef03459e19ec4c9626b4d927cb0` | `c53c0823ecf87be5c566a77753a56f6489450679` |

The preparation script downloads each file from the pinned raw GitHub commit and recalculates its Git blob SHA before analysis.

No upstream registry bytes are committed to Grounding.

## Review case: committed ACR records and reports the reviewer brings

`buildCarbonReviewCase()` runs the records through the shared review process.

- **Committed:** ACR's records, because ACR's terms allow data from its public reports to be reproduced if accurately represented and cited (`data/external/acr-offsetsdb`, made by `scripts/prepare-acr-subset.mjs`). Only the columns the checks read are kept, plus each retired block's issue date. Beneficiary and account-holder names are left out: no check uses them, and some name individuals.
- **Reviewer-supplied:** Climate Action Reserve and Gold Standard records are never fetched or committed. CAR's `robots.txt` disallows all automated access, and neither registry's terms grant reuse. A reviewer downloads a report with the registry's CSV button and brings it, in the page or with `--import <registry>:<kind>:<file>:<page URL>`. The case keeps the page URL, the download time and a SHA-256 of the normalised records (independent of row order and layout), never the records. A verifier brings the report again: the same records verify; different ones are reported as `source-changed`.
- **Flags:** duplicate serial ranges and over-retirement are mismatches. A retirement group with no issuance in the records is a coverage gap, raised as two flags: groups whose retired credits were all issued, by the retirement record's own date, before the records' first issuance (`coverage:before-window`), and the rest (`coverage:inside-window`). Each is decided `out-of-sample` or `investigate`, bound to the digest of all the records. The result is `reconciled` only when every flag is decided `out-of-sample`.
- **Decisions** (`reports/carbon-registry/coverage-decisions.json`, `person:carbon-auditor`): 12 groups before the window, `out-of-sample`; 10 groups inside it, `investigate`. So the signed result is `insufficient-evidence`.
- **Accounting boundary:** counts the committed records and any brought; leaves out records outside them and claims made outside the registries; policy choices are the grouping, treating a gap as a decision rather than an over-retirement, and exact serial-range matching (overlapping ranges written differently are not compared); not assessed: durability, additionality and project quality, and whether a retirement backs the claim its beneficiary makes.

`node scripts/run-carbon-case.mjs` signs the case (`reports/carbon-registry/case-run.json`); `scripts/verify-carbon-case.mjs` is part of `npm run check:cases`. The WebMCP tools add `carbon_import_registry_report` and `carbon_review_records`. The multi-registry smoke below still checks all three registries in CI without committing them.

ACR's registry has moved to ICE GreenTrace (`https://greentrace.ice.com/acr`); looking up the 10 groups there would need GreenTrace's own terms reviewed first.

## Scoreboard: each registry's published records, checked against themselves

`node scripts/run-carbon-scoreboard.mjs` runs four checks over CarbonPlan OffsetsDB's whole export (532,799 credit rows,
seven registries) and writes `reports/carbon-registry/scoreboard.json`. The export was generated on 2026-06-01; OffsetsDB
updates are paused upstream, so the zip is pinned by SHA-256 (`scripts/prepare-offsetsdb-snapshot.mjs`). Every count is
registry data via CarbonPlan OffsetsDB, snapshot 2026-06-01
([terms of data access](https://github.com/carbonplan/offsets-db-data/blob/main/TERMS_OF_DATA_ACCESS)).

Each registry's counts stand on their own. Registries are listed alphabetically and are never ranked or compared:
ACR's and ART's terms forbid competitive benchmarking. A flagged item is an inconsistency in the published data (may
come from OffsetsDB processing or the registry), never a finding of error by the registry.

| Check | ICVCM basis |
| --- | --- |
| Retired plus cancelled credits above issued credits, per project-vintage. Split into coverage gaps (no issuance rows for that vintage) and excess over recorded issuance; also per project | Criterion 6.2: once retired or cancelled, a credit cannot be used again; one credit per tonne |
| Retirements dated before the first issuance of their project-vintage, with the number of distinct dates | Tracking principle (A2) and the definitions of a carbon credit and a retirement: a credit is issued, then tracked, then retired |
| Issuances dated before their vintage year starts | Criterion 5.3: only ex-post issuance is eligible; the vintage is the year the reduction happened |
| Project-table issued and retired totals against the sums of the credit rows | Tracking (A2) and Transparency (A3) |

Measured counts (`scoreboard.json`, `packages/carbon-registry/src/scoreboard.ts`):

| Registry | Issuance / retirement / cancellation rows | Project-vintages | Retired + cancelled above issued (gaps / excess / projects) | Retired before first issuance (rows, distinct dates) | Issued before vintage year | Project totals differing |
| --- | --- | --- | --- | --- | --- | --- |
| American Carbon Registry | 2,247 / 11,177 / 57 | 1,993 | 0 / 0 / 0 | 80 (3,488,231 credits, 60 projects), 1 date | 0 | 0 |
| ART TREES | 13 / 14 / 4 | 11 | 0 / 0 / 0 | 0 | 0 | 0 |
| Cercarbono | checked; counts not published | | | | | |
| Climate Action Reserve | checked; counts not published | | | | | |
| Gold Standard | 16,075 / 162,180 / 0 | 11,247 | 0 / 3 / 1 | 0 | 674 | 0 |
| Isometric | checked; counts not published | | | | | |
| Verra | checked; counts not published | | | | | |

Only ACR's rows are committed (`data/external/acr-offsetsdb-full`, under ACR's reproduction-with-citation terms), and
only ACR's flagged items are listed in the report. All 80 ACR retirements dated before their first issuance carry the
same date, 2022-11-01.

ART TREES and Gold Standard are published as counts. Climate Action Reserve, Cercarbono, Isometric and Verra are checked
by the same code, but their counts are not published: their terms claim rights over analyses of, or data derived from,
their records, and whether that reaches counts computed from OffsetsDB is unclear. Anyone can compute all seven with
`node scripts/prepare-offsetsdb-snapshot.mjs` and `node scripts/run-carbon-scoreboard.mjs`, which writes them to the
gitignored `data/cache/offsetsdb/scoreboard-all-registries.json`.

`scripts/verify-carbon-scoreboard.mjs` (part of `npm run check:cases`) runs without the network: it recomputes ACR's
counts and flagged items from the committed files, checks the ART TREES and Gold Standard counts against the digest the
run recorded with the pinned snapshot, and fails if the four unpublished registries carry any counts. The digest check
catches a hand edit, not a deliberate forgery; with the snapshot cached it recomputes the published registries.

Limits:

- The export has no serial numbers, so a credit retired twice cannot be checked at this scale; only quantities are
  compared.
- Verra issuance figures in OffsetsDB are inferred by CarbonPlan, not issuance records Verra publishes.
- ACR's 80 retirements sharing the date 2022-11-01 suggest a migration or pipeline artefact. That is an inference, not
  checked against the registry.
- These are checks of published data. They do not show that a program meets, or fails, any ICVCM criterion, and nothing
  here is an ICVCM assessment.
- Registries other than ACR are shown as counts only, and four of them not at all.

## Rights

The source-rights manifest already separates:

- CarbonPlan processing code — MIT
- OffsetsDB registry data — source-specific / upstream registry terms

For registry data, Grounding therefore uses:

```text
download-from-upstream
```

and preserves the original CarbonPlan/registry source reference rather than treating CarbonPlan's code licence as a data licence.

## Normalized transaction model

Three source schemas are normalized to:

```text
registry
transaction kind
project ID
vintage
quantity
transaction date
serial range (retirements)
beneficiary (where supplied)
source path + source row
```

Identifiers remain registry-namespaced. A serial string from ACR is not automatically considered the same credit as identical text appearing under another registry.

## Deterministic checks

### Issuance / retirement reconciliation

Transactions are grouped by:

```text
registry + project ID + vintage
```

Possible states:

- `supported` — known retirement is within known issuance
- `issued-not-retired` — issuance is present with no retirement in the bounded subset
- `unresolved-missing-issuance` — retirement is present but matching issuance is absent from this bounded subset
- `over-retired` — known retirement quantity exceeds known issuance quantity

The unresolved state is important. A sample missing an issuance row is **not** sufficient evidence of invalid retirement.

### Duplicate retirement claims

Exact duplicate detection uses:

```text
registry + serial range
```

A second occurrence is reported as a duplicate excess record.

The demo injects an exact duplicate of a real upstream retirement row **in memory**. This is a test fixture mutation, not an allegation that the source registry or CarbonPlan contains a fraudulent duplicate.

### Tamper / source-change check

The demo also changes one normalized retirement quantity in memory.

Each source slice becomes a normal Grounding `Evidence` node with a canonical digest. The shared #8 evidence root therefore changes after the quantity modification.

Cryptographic integrity proves that bytes/state changed; it does not prove the original registry statement was physically or legally correct.

## Verification semantics

The shared verification result is:

```text
duplicate or over-retired
→ mismatch

no mismatch, but missing issuance coverage
→ insufficient-evidence

otherwise
→ reconciled
```

The verification graph includes:

- source evidence nodes
- reconciliation claim
- deterministic checks
- shared evidence root

This keeps "not enough data in this bounded sample" separate from "known conflicting data."

## WebMCP

The same `CarbonRegistryService` backs:

- `carbon_reconcile_registry_records`
- `carbon_check_retirement`
- `carbon_check_duplicate_claim`

The module is exposed only when the active case advertises `carbon-registry`.

## AI decision

AI is **not included** in this first slice.

Reason: the selected records have explicit registry/project/serial identifiers, so exact deterministic reconciliation is the appropriate baseline.

A future labelled entity-resolution sample could justify AI for inconsistent names or documents, but it should be compared with an exact/fuzzy baseline and should not replace the final deterministic retirement/double-counting rules.

## Ledger decision

The current prototype returns:

```text
defer-ledger
```

Three of the shared four criteria are plausible:

- multiple independent parties may inspect the state
- historical verification can be useful
- a compact evidence/attestation commitment is possible

But this prototype still consumes a trusted registry/CarbonPlan snapshot and does not model a multi-party transfer workflow with **no single trusted record keeper**.

Therefore signed append-only provenance is sufficient for this slice.

A chain can be reconsidered for a concrete deployment where independent registries/buyers/verifiers co-maintain shared issuance/transfer/retirement state.

## Measured real-data smoke

The pinned six-file CarbonPlan snapshot contains:

- 600 normalized transactions
- 300 issuance records
- 300 retirement records
- 3 registries
- 12 project/vintage groups where retirement is supported by issuance in this bounded snapshot
- 269 issuance-only groups
- 101 retirement groups with no matching issuance in this bounded snapshot
- 0 over-retired groups
- 0 exact duplicate retirement serial claims

Because 101 retirement groups lack matching issuance rows in this intentionally bounded snapshot, the clean verification result is `insufficient-evidence`, not `mismatch`.

The clean evidence root is:

```text
SHA-256 snPmdsybCzwqESJsqvkYUQZ46Tu5hJAoRiHfH9cmSY4
```

### Injected duplicate

The smoke duplicates the first ACR retirement row in memory:

```text
ACR-FR-1129-2025-2917-30932 to 35143
```

This produces:

- duplicate excess count: 1
- verification result: `mismatch`
- evidence root: `u92hWxFQXVmWN-dsEqLtEDACG5grxbVO2LmZagnnkF0`

This is a synthetic test mutation and not an allegation about ACR or CarbonPlan.

### Injected quantity change

The same source retirement quantity is changed in memory:

```text
4212 → 4213
```

The evidence root changes to:

```text
mQifKVD7u1y_5YrLj-d_TfJwjMl1tsvj5gh7AxyQwZU
```

The measured summary is committed at:

`reports/carbon-registry/carbonplan-smoke.json`

## Reproduce

```bash
node scripts/prepare-carbonplan-registry-fixtures.mjs /tmp/carbonplan-registry
npm install
npm run build
node scripts/smoke-carbon-registry.mjs /tmp/carbonplan-registry
```

The GitHub Actions workflow `Carbon registry data smoke` runs the same pinned source path.
