# Open Climate Risk: sampled wildfire values

`ocr-context.json` holds values sampled from Open Climate Risk (OCR) v1.1.0, CarbonPlan's open wildfire-risk
raster, at a pinned Icechunk snapshot (`CZP0B0ETPG38MW0C1R30`) read anonymously from
`s3://us-west-2.opendata.source.coop/carbonplan/carbonplan-ocr/`. Only these numbers are committed:

- **buildingSite:** the cell nearest the BDG2 coordinates of the building case's site (site-level, not the building).
- **earthScene:** statistics over the OCR cells whose centres fall inside the earth case's HLS scene footprint.

Variables: `bp_2011` and `bp_2047`, annual burn probability (0 to 1) for ~2011 and ~2047 conditions; `rps_2011` and
`rps_2047`, relative risk to potential structures (%). To reproduce:

    uv run --python 3.13 --with icechunk==1.1.21 --with xarray==2025.12.0 --with zarr==3.4.0 --with dask \
      --with pyproj==3.7.2 --with numpy python scripts/sample-open-climate-risk.py

Both cases record these values as context: modelled, not observed, and read by no check.

**Licence:** CC BY 4.0. The values are derived (sampled and summarised) from OCR. ClimateChain is not affiliated with
or endorsed by CarbonPlan.

**Cite:** Open Climate Risk v1.1.0, CarbonPlan, https://source.coop/carbonplan/carbonplan-ocr. Its inputs: Riley et
al. 2025, USDA Forest Service RDS-2025-0006 (burn probability); Scott et al. 2024, RDS-2020-0016-2 (risk to potential
structures; for national or relative comparison, not a locally calibrated assessment); CONUS404, Rasmussen et al.,
https://doi.org/10.5066/P9PHPK4F.
