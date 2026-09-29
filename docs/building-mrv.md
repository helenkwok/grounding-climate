# Building MRV prototype

Issue: #9

Primary user: **building/facility energy manager**.

Secondary consumers are sustainability managers and carbon auditors/verifiers who need the same evidence bundle.

## Purpose

The first Building MRV slice connects a real public building-energy dataset to ClimateChain's shared evidence, calculation, verification, attestation, and WebMCP layers.

It does **not** claim that better data quality reduces emissions. The measured outputs are:

- accepted electricity in kWh / MWh
- electricity excluded by the configured anomaly screen
- reconstructed location-based tCO₂e
- temporal-holdout baseline RMSLE / MAE
- evidence-root changes when the meter series changes

## Data source

ClimateChain pins Building Data Genome Project 2 v1.0:

- Zenodo record: https://zenodo.org/records/3887306
- DOI: `10.5281/zenodo.3887306`
- archive: `buds-lab/building-data-genome-project-2-v1.0.zip`
- published archive MD5: `44393dc4cf61e84dec105e955368c890`
- licence tracked by source-rights ID: `bdg2`

The GitHub repository's large data paths are Git LFS pointers. The preparation script therefore retrieves data from the pinned release rather than interpreting the pointer files as CSV data.

### Small deterministic subset

Run:

```bash
npm run building:prepare -- \
  --out data/external/bdg2/demo \
  --hours 2160
```

The default keeps 90 days of valid hourly electricity readings.

The preparation script:

1. reads the pinned BDG2 metadata
2. reads the electricity header
3. chooses the first sorted building that is present in the electricity file and is marked as having electricity in metadata, unless `--building` is supplied
4. streams only enough electricity rows to satisfy `--hours`
5. extracts matching site weather rows
6. writes:
   - `meter.csv`
   - `weather.csv`
   - `metadata.json`
   - `source.json`
7. records SHA-256 digests of every prepared artifact

The full upstream archive is not committed.

The member-streaming route follows the InvenioRDM container-file route used by Zenodo. If that route is unavailable in a deployment, the script fails with the pinned record/archive/checksum so a full-archive downloader can be substituted without silently changing the source.

## Integrity and deliberate tamper are different

Before analysis, the CLI re-hashes the prepared files.

```text
prepared meter.csv changed unexpectedly
→ SHA-256 mismatch
→ analysis stops
```

The demo tamper is explicitly different:

```text
prepared source integrity passes
→ --tamper-index modifies one in-memory reading
→ canonical meter-series digest changes
→ anomaly screen runs
→ accepted energy / tCO₂e changes
→ verification becomes mismatch
→ evidence root changes
```

This prevents an accidental file edit from being presented as if it were the intentional demonstration.

## Baseline

The first ClimateChain baseline is intentionally transparent:

```text
training period
→ mean reading for each of 168 hour-of-week slots
→ predict later temporal holdout
→ RMSLE + MAE
```

Default split:

- first 80%: training
- final 20%: test
- no random shuffling

This is a local ClimateChain benchmark. It is not labelled ALDI++ and does not reuse ALDI++'s published score as if ClimateChain had reproduced it.

## Measured real-data smoke

The repository's path-filtered GitHub Actions smoke has now executed the pinned BDG2 preparation path successfully.

Measured result:

- selected building: `Bear_assembly_Angel`
- site: `Bear`
- primary use: Entertainment/public assembly
- floor area: 22,117 m²
- electricity rows: 2,160
- matching weather rows: 2,159
- prepared meter/metadata/weather integrity: pass
- training rows: 1,728
- test rows: 432
- temporal holdout: 2016-03-13 through 2016-03-30
- local baseline RMSLE: **0.3419815733**
- local baseline MAE: **70.8869356334**
- clean residual flags: 3
- clean flagged energy: 0 kWh

The real-data tamper smoke changed holdout row 1,728 from 295.3 to 5,906 (×20). That interval was flagged, total flags increased from 3 to 4, and the canonical meter digest changed from:

```text
5WkUmBIgwiXOiGPe4hOtcIGLCpjFF6Fawum99aEUQ28
```

to:

```text
VCPYrmOehcTmKYZhZ8E_n3WXyDmc07K0aoPYqDV_-_k
```

Machine-readable measured record:

- `reports/building-mrv/bdg2-v1-smoke.json`

This is now a ClimateChain-measured result. It remains separate from the ALDI++ publication numbers below.

## ALDI++ reference

The upstream ALDI++ project reports the following GEPIII forecasting RMSLE values:

| Upstream method | RMSLE |
| --- | ---: |
| Kaggle winning team labels | 2.841 |
| 2-standard-deviation labels | 2.835 |
| ALDI labels | 2.834 |
| VAE labels | 2.829 |
| ALDI++ labels | 2.665 |

Machine-readable reference:

- `packages/building-mrv/references/aldiplusplus.json`

It explicitly records `reproducedByClimateChain: false`.

A later #9 slice can run the ALDI++ labelled-outlier benchmark itself. Until then, these numbers remain an upstream comparison target.

## Anomaly check

The current deterministic check uses residuals from the hour-of-week model.

Training residuals produce:

- median residual
- median absolute deviation (MAD)
- robust scale `1.4826 × MAD`

An interval is flagged when:

```text
abs(robust_z) >= threshold
```

Default threshold: `6`.

This is deliberately described as an **anomaly/data-quality check**, not a proof of fraud or malicious tampering.

The package also exposes precision, recall, specificity, and F1 helpers for the later ALDI++ labelled-outlier evaluation.

## Emissions reconstruction

For accepted electricity readings:

```text
accepted kWh × location-based kgCO₂e/kWh
→ kgCO₂e
→ tCO₂e
```

The grid factor is intentionally required at runtime.

ClimateChain does **not** infer a factor from an anonymised BDG2 site label.

Run analysis with an explicitly sourced factor:

```bash
npm run building:analyze -- \
  --dir data/external/bdg2/demo \
  --factor <kgCO2e-per-kWh> \
  --factor-geography "<matching geography>" \
  --factor-source "<original factor URL>" \
  --factor-organisation "<publisher>"
```

Optional:

```text
--factor-document
--factor-retrieved-at
--training-fraction
--anomaly-threshold
```

Outputs:

- `case.json`
- `report.json`
- `evidence-root.json`

The factor becomes its own `Factor` node with a separate source-evidence node.

## Tamper demo

After a clean run, repeat with:

```bash
npm run building:analyze -- \
  --dir data/external/bdg2/demo \
  --factor <kgCO2e-per-kWh> \
  --factor-geography "<matching geography>" \
  --factor-source "<original factor URL>" \
  --tamper-index 1800 \
  --tamper-multiplier 20
```

Expected behavior:

1. prepared-file integrity passes
2. one already-verified in-memory reading changes
3. the canonical meter-series digest changes
4. anomaly screening identifies the interval when it is outside the configured residual threshold
5. flagged electricity is excluded from the accepted measurement set
6. reconstructed tCO₂e changes
7. `verification:building-mrv` becomes `mismatch`
8. the evidence root differs from the clean run
9. an attestation created for the clean root remains attributable only to the clean root through #8

## Shared ClimateChain graph

The Building MRV result maps to:

```text
evidence:bdg2-electricity
        │
        ├────→ model-run:hour-of-week-baseline
        │
        └────→ calculation:electricity-emissions
                         ↑
               factor:grid-electricity
                         ↑
              evidence:grid-factor-source

calculation:electricity-emissions
        ↓
claim:building-electricity-emissions
        ↓
verification:building-mrv
        ↓
#8 attestation / evidence root
```

There is no parallel Building-specific trust model.

## WebMCP

The module provides the #7 tools:

- `building_get_meter_series`
- `building_detect_anomalies`
- `building_run_baseline`
- `building_reconstruct_emissions`

All four call the same `BuildingMrvService` used by the application.

## Real public disclosure

The disclosure path uses the already selected real CaDI example for **Carbon Footprint Ltd**:

- https://www.carbonfootprint.com/our_cadi_data.html
- https://www.carbondi.com/

ClimateChain deliberately does **not** pretend the anonymised BDG2 building belongs to Carbon Footprint Ltd.

Therefore the current Building MRV claim and the Carbon Footprint Ltd disclosure are different subjects and must not be numerically labelled “reconciled”.

The disclosure example remains useful to prove the public-source/provenance path. A true numeric disclosure reconciliation requires activity data and a public disclosure for the **same organisational/asset boundary and reporting period**.

This is a correctness constraint, not a missing UI feature.

## What remains for #9

The first runnable analysis path is implemented, but #9 should remain open until:

- the pinned real BDG2 preparation path is executed end-to-end and its measured baseline result is recorded
- the ALDI++ labelled-outlier benchmark is reproduced on an allowed local copy of the GEPIII/labels data, or the scope is explicitly reduced
- a same-subject public disclosure dataset is found if numeric CaDI reconciliation is required

The foundation does not manufacture those results.
