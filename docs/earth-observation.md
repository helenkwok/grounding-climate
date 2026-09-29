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

A UI can render this without recomputing the detector.

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
