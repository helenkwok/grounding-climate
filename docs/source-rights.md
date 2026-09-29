# Source rights policy

Issue: #14

ClimateChain uses real public datasets, disclosures, reports, registries, and benchmark code. Public accessibility does not by itself grant permission to copy or redistribute those materials.

The machine-readable audit is:

- `sources/rights-manifest.json`

The generated human-readable attribution list is:

- `docs/source-attribution.md`

## Default rule

```text
rights unclear
→ use/link from the original source only
→ do not commit source bytes
→ do not place them in the submission ZIP
```

Unknown rights therefore fail closed.

## Code and data are separate

A repository licence is not automatically a licence for all data used by that repository.

Examples currently captured in the manifest:

- ALDI++ code is MIT, while the ASHRAE/Kaggle competition data are subject to competition rules.
- Energy-EVA code is Apache-2.0, while its standardized datasets originate from multiple upstream providers and require source-specific review.
- CarbonPlan OffsetsDB code is MIT, while the registry data are covered by separate access terms and may also be subject to registry-specific rights.
- SustainBench code is MIT and its released raw data are separately described as CC-BY-SA-4.0.

This is why the manifest records **components**, not merely project names.

## Repository modes

Each component is assigned one of four modes.

### `redistributable`

Only for material with an explicitly verified open licence and explicit permission to redistribute.

Small fixtures may be stored under:

```text
data/external/<source-id>/
```

The full upstream dataset should still normally be downloaded from its original source.

### `download-from-upstream`

The project may provide code/instructions to retrieve data, but the downloaded bytes are not committed.

Use this when terms are source-specific, competition-controlled, or unresolved.

### `link-only`

Use the public source as evidence/reference without mirroring it.

CaDI is currently handled this way because Carbon Footprint Ltd's website terms restrict distribution and commercial use of website material even though CaDI describes the service as free/open-access to use.

### `code-only`

The repository code is reusable under its code licence, but that decision says nothing about associated datasets.

## CI enforcement

`npm run check:rights` validates the manifest and scans `data/external/`.

CI fails when:

- a source ID is duplicated
- a source is marked redistributable without a verified-open licence
- a verified-open source has no licence identifier
- a non-redistributable source declares a repository data path
- an external data directory has no manifest entry
- external data are present for a source not explicitly approved for redistribution

`npm run sources:attribution:check` also fails if the generated attribution document is stale.

## Current audit decisions

### CaDI / Carbon Footprint Ltd

**Policy:** link-only.

Do not bulk mirror or package CaDI pages/data. Preserve the original source URL. The demo may point to public records but should not imply affiliation, endorsement, or independent verification of CaDI as a whole.

### Building Data Genome 2

**Policy:** redistributable small fixtures.

The repository licence identifies CC-BY-SA-4.0. Preserve attribution and ShareAlike obligations. Prefer download scripts for full data.

### ASHRAE / Kaggle

**Policy:** download-from-upstream.

Kaggle identifies the competition data licence as “Subject to Competition Rules”. Do not commit the competition files or place them in the hackathon ZIP.

### ALDI++

**Policy:** code-only.

MIT applies to repository code. Treat its input data separately.

### Energy-EVA

**Policy:** code-only for repository code; download-from-upstream for datasets.

Apache-2.0 applies to the repository code. Its benchmark data are assembled from multiple sources, so the selected sub-dataset needs its own terms check before packaging.

### IBM/NASA HLS Burn Scars

**Policy:** redistributable small fixtures.

Hugging Face metadata identifies CC-BY-4.0. Preserve the dataset citation and the underlying HLS/MTBS provenance.

### Sen1Floods11

**Policy:** download-from-upstream.

The original Cloud to Street/Floodbase repository documents public download and citation, but no authoritative licence was identified; the repository has an open issue about the missing LICENSE file. Do not infer rights from a later mirror.

### SustainBench

**Policy:** code-only for MIT code; redistributable small fixtures for released raw data under CC-BY-SA-4.0.

Preserve task-specific upstream citations.

### BatteryLife

**Policy:** code-only for benchmark code; redistributable small fixtures for the Hugging Face raw dataset.

Both currently identify MIT, but BatteryLife aggregates original battery datasets, so constituent provenance/citations remain important.

### CarbonPlan OffsetsDB

**Policy:** code-only for MIT code; download-from-upstream for registry data.

CarbonPlan says it does not claim copyright in the factual offset data, while expressly warning that upstream registries may claim rights or require licences. Do not vendor registry snapshots until the selected registry terms are audited.

## Adding a new source

1. Add a component to `sources/rights-manifest.json`.
2. Record the canonical upstream URL and publisher.
3. Record the licence/terms URL actually reviewed.
4. Separate code, dataset, model, and web content where their rights differ.
5. If any material term is unclear, set redistribution to `unclear` and use `download-from-upstream` or `link-only`.
6. Regenerate attribution with `npm run sources:attribution`.
7. Run `npm run check`.

## Submission ZIP rule

Only repository-owned content and third-party material explicitly marked `redistributable` may be included as third-party bytes.

Everything else should be fetched from, or referenced at, its original source during setup/demo.
