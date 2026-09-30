# Carbon registry reconciliation

Issue: #13

Primary user: **carbon-market auditor / verifier**.

The operational question is:

> Can a bounded set of issuance and retirement records be reconciled deterministically, with duplicate claims, over-retirement, missing source coverage, and source changes represented explicitly?

The first slice deliberately does **not** add AI. Exact registry identifiers and serial ranges already support a measurable deterministic job; entity-resolution AI can be added later only for records that genuinely require fuzzy matching.

## Real source path

ClimateChain uses the small multi-registry fixture snapshots maintained by CarbonPlan's OffsetsDB pipeline.

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

No upstream registry bytes are committed to ClimateChain.

## Rights

The source-rights manifest already separates:

- CarbonPlan processing code — MIT
- OffsetsDB registry data — source-specific / upstream registry terms

For registry data, ClimateChain therefore uses:

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

Each source slice becomes a normal ClimateChain `Evidence` node with a canonical digest. The shared #8 evidence root therefore changes after the quantity modification.

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
