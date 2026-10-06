# Earth observation — HLS burn-scar verification

Issue: #11

Primary user: **wildfire / land-management analyst** deciding which mapped burn areas deserve analyst review and follow-up.

## Selected dataset

ClimateChain selects the IBM/NASA **HLS Burn Scar Scenes** dataset for the first environmental-monitoring slice.

- dataset: `ibm-nasa-geospatial/hls_burn_scars`
- DOI: `10.57967/hf/0956`
- licence: CC-BY-4.0
- 804 labelled 512×512 scenes in the original dataset description
- six reflectance bands: Blue, Green, Red, Narrow NIR, SWIR1, SWIR2
- ground truth: 1 burn scar, 0 not burned, -1 no data
- imagery source: Harmonized Landsat/Sentinel-2
- burn labels originate from MTBS source data and manual verification/cleaning described by the dataset authors

The Hugging Face viewer currently cannot stream the original TAR-based loader. ClimateChain therefore treats local TIFF pairs as the reproducible execution boundary rather than making the browser/data-viewer API part of the evidence chain.

## CPU baseline

The runnable baseline is intentionally transparent:

```text
NBR = (NIR - SWIR2) / (NIR + SWIR2)
burn = NBR < threshold
```

The default threshold is 0.0.

This is a **baseline**, not a claim to reproduce Prithvi.

For every scene ClimateChain reports:

- burn-class IoU
- precision
- recall
- F1
- overall accuracy
- labelled burn hectares
- predicted burn hectares
- TP / TN / FP / FN pixel counts

No-data pixels (`-1`) are excluded from metric denominators.

At the dataset's nominal 30 m resolution, one valid pixel represents 0.09 ha.

## Published Prithvi reference

The pinned upstream reference is:

`ibm-nasa-geospatial/Prithvi-EO-1.0-100M-burn-scar`

Its model card reports:

- burn-scar class IoU: 0.73
- overall accuracy: 0.96
- 50-epoch fine-tuning experiment

ClimateChain records those as **published reference values** with `locallyReproduced: false`.

A future GPU path can run Prithvi or Prithvi-EO-2.0 through the same scene/service contract. The current CI does not download large model weights.

## Provenance graph

The Earth Observation module builds:

```text
HLS imagery evidence ─┐
                      ├→ NBR model-run → detected-area claim → verification
ground-truth mask ────┘
```

Imagery and labels have independent hashes.

This matters for audit:

- modified satellite pixels change `evidence:hls-image`
- modified labels change `evidence:burn-mask`
- prediction changes are separately hashed
- the shared #8 evidence root ties the verification to all of them

## Live case and area decision

`packages/earth-observation/src/review-case.ts` builds the case the demo and `scripts/run-earth-case.mjs` sign. Its inputs are committed in `data/external/hls-burn-scars/T10SEH.2018190.v1`: the two bands NBR reads (NIR, SWIR2) as float32 and the label mask as int8, copied unchanged from the pinned TIFFs by `scripts/prepare-hls-scene.py` (2.3 MB; `manifest.json` holds each file's SHA-256 and the source TIFFs').

- **Reproduction.** The TypeScript detector reproduces every pixel count of the Python run in `reports/earth-observation/t10seh-2018190-nbr.json` (TP 129,810, TN 51,534, FP 3,237, FN 77,563). The TIFF bands are float32 and TypeScript computes in float64, but at threshold 0 the test reduces to the sign of NIR − SWIR2, which both get exactly. The check compares counts, not a hard-coded result.
- **The flag.** Detected area 11,974.23 ha against labelled 18,663.57 ha, 35.8% short. `reports/earth-observation/area-policy.json` sets the tolerance at 10%, so the area is flagged and a person decides what the claim reports: `labelled`, `detected-with-gap` (the detected area, with the gap stated), or `hold`. Until a current decision exists the claim states no area and the case is `insufficient-evidence`. The recorded decision (`reports/earth-observation/area-decisions.json`, `person:land-analyst`) is `detected-with-gap`: the claim reports 11,974.23 ha as a lower bound, 35.8% below the labelled area, because 97.6% of detected pixels are labelled burned while 37% of the labelled burn is missed. The decision is bound to the digests of the three arrays and the policy; a change to any of them makes it stale.
- **Accounting boundary.** Counts the labelled pixels of the one subset at 0.09 ha each; excludes no-data pixels and the rest of the fire; policy choices are the NBR threshold, the tolerance and the area decision; not assessed are burn severity, fire emissions, carbon lost and accuracy on other scenes.
- **Tamper.** `scripts/run-earth-case.mjs` and the demo raise one NIR value so a burned pixel reads unburned: the counts no longer match the pinned run (`mismatch`) and the attestation no longer matches the evidence.

`scripts/verify-earth-case.mjs` (part of `npm run check`) rebuilds the case and checks the signed attestation.

## WebMCP

The module supplies the #7 tools:

- `earth_run_detector`
- `earth_compare_ground_truth`
- `earth_get_scene_provenance`

The comparison tool returns an explicit overlay code:

- -1 missing/no-data
- 0 correctly not-burned
- 1 true-positive burn
- 2 false-positive burn
- 3 false-negative/missed burn

A UI can render this without recomputing the detector. In the live demo, `earth_compare_ground_truth` returns the overlay's totals rather than 262,144 codes, with the area gap, the decision and the accounting boundary.

## Real TIFF smoke

Run against any genuine paired HLS Burn Scar TIFF files:

```bash
python -m pip install rasterio numpy pillow

python scripts/smoke-hls-burn-scars.py \
  validation/<scene>_merged.tif \
  validation/<scene>.mask.tif \
  --threshold 0 \
  --output-json reports/earth-observation/<scene>.json \
  --output-png reports/earth-observation/<scene>.png
```

The smoke records SHA-256 for both input files and produces a visual comparison with:

1. RGB composite
2. ground-truth mask
3. prediction/error overlay

The full ~2.65 GB upstream archive is **not** committed.

A known public validation scene used in NASA/Prithvi examples is:

`subsetted_512x512_HLS.S30.T10SEH.2018190.v1.4`

The repository does not copy that scene until the real-data smoke is intentionally run and its attribution is retained.

## Generalisation limitation

The original HLS Burn Scar dataset documentation describes a random training/validation split.

Therefore a good validation IoU on this dataset does **not** by itself establish:

- performance on an unseen wildfire event
- performance outside the continental United States
- performance on different sensors/resolutions
- calibrated uncertainty for operational response

ClimateChain records this limitation in each verification bundle rather than converting a local metric into a global claim.

## Climate-impact boundary

The defensible units for this module are:

- hectares labelled / detected
- false-positive and missed-burn hectares
- scenes/area prioritised for analyst review
- provenance/citation integrity

Detection accuracy is **not** converted directly into avoided tCO2e.


## Measured real-scene result

The isolated real-data smoke was executed in GitHub Actions run `36580275620` against the pinned test scene:

`T10SEH.2018190.v1`

The full upstream TAR, image member, and mask member all matched their pinned byte sizes and SHA-256 digests before analysis.

With NBR threshold `0.0`:

| Metric | Measured |
| --- | ---: |
| Burn-class IoU | 0.6163525 |
| Precision | 0.9756703 |
| Recall | 0.6259735 |
| F1 | 0.7626461 |
| Overall accuracy | 0.6917725 |
| Labelled burn area | 18,663.57 ha |
| Predicted burn area | 11,974.23 ha |
| Missed burn area | 6,980.67 ha |
| False-positive burn area | 291.33 ha |

This result is operationally informative: the zero-threshold NBR baseline is very conservative/high-precision on this scene, but recall is only about 0.626. It misses far more labelled burn area than it falsely adds, with a net under-estimate of 6,689.34 ha.

For a wildfire/land-management analyst, this makes the baseline suitable as a cheap **triage** signal, not as final burn-boundary delineation.

The corresponding JSON record is:

`reports/earth-observation/t10seh-2018190-nbr.json`

The workflow also produced a visual artifact containing the RGB scene, ground-truth mask, and TP/FP/FN overlay. The derived artifact ZIP was 664,415 bytes with SHA-256 `2bf7724361acca57d7112c5720f526f516a82babf3d804bf812af5bded944edb`.

The published Prithvi IoU of 0.73 remains a separately attributed reference and is not represented as locally reproduced.
