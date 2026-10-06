#!/usr/bin/env python3
# Samples Open Climate Risk (OCR) v1.1.0 wildfire values from its public Icechunk store, anonymously, at a pinned
# snapshot: the value at the BDG2 site of the building case, and statistics over the footprint of the earth case's
# HLS scene. Writes only those numbers to data/external/open-climate-risk/ocr-context.json.
#   uv run --python 3.13 --with icechunk==1.1.21 --with xarray==2025.12.0 --with zarr==3.4.0 --with dask \
#     --with pyproj==3.7.2 --with numpy python scripts/sample-open-climate-risk.py
import json
from pathlib import Path

import icechunk
import numpy as np
import xarray as xr
from pyproj import Transformer

ROOT = Path(__file__).resolve().parent.parent
PREFIX = "carbonplan/carbonplan-ocr/output/fire-risk/tensor/production/v1.1.0/ocr.icechunk"
SNAPSHOT = "CZP0B0ETPG38MW0C1R30"
VARIABLES = ["bp_2011", "bp_2047", "rps_2011", "rps_2047"]

storage = icechunk.s3_storage(bucket="us-west-2.opendata.source.coop", prefix=PREFIX, region="us-west-2", anonymous=True)
session = icechunk.Repository.open(storage).readonly_session(snapshot_id=SNAPSHOT)
ds = xr.open_dataset(session.store, engine="zarr", chunks={})
if ds.attrs.get("version") != "1.1.0" or ds.attrs.get("license_name") != "CC-BY-4.0":
    raise SystemExit("unexpected store attributes " + json.dumps(ds.attrs))

site = json.loads((ROOT / "data/external/bdg2/metadata.json").read_text())
point = ds[VARIABLES].sel(latitude=site["latitude"], longitude=site["longitude"], method="nearest").compute()
point_values = {name: float(point[name]) for name in VARIABLES}

scene = json.loads((ROOT / "data/external/hls-burn-scars/T10SEH.2018190.v1/manifest.json").read_text())
x0, y0 = scene["origin"]
size = scene["width"] * scene["pixelSizeMeters"]
to_lonlat = Transformer.from_crs("EPSG:32610", "EPSG:4326", always_xy=True)
to_utm = Transformer.from_crs("EPSG:4326", "EPSG:32610", always_xy=True)
corners = [to_lonlat.transform(x, y) for x in (x0, x0 + size) for y in (y0, y0 - size)]
lons, lats = [c[0] for c in corners], [c[1] for c in corners]
lat_slice = slice(max(lats), min(lats)) if ds.latitude[0] > ds.latitude[-1] else slice(min(lats), max(lats))
window = ds[VARIABLES].sel(latitude=lat_slice, longitude=slice(min(lons), max(lons))).compute()
grid_lon, grid_lat = np.meshgrid(window.longitude.values, window.latitude.values)
ux, uy = to_utm.transform(grid_lon, grid_lat)
inside = (ux >= x0) & (ux < x0 + size) & (uy <= y0) & (uy > y0 - size)


def stats(values):
    burnable = values[np.isfinite(values)]
    if burnable.size == 0:
        return {"cells": int(values.size), "burnableCells": 0}
    return {
        "cells": int(values.size),
        "burnableCells": int(burnable.size),
        "mean": float(burnable.mean()),
        "median": float(np.median(burnable)),
        "p90": float(np.percentile(burnable, 90)),
        "max": float(burnable.max()),
    }


report = {
    "schemaVersion": "climatechain.ocr-context/0.1",
    "source": {
        "name": "Open Climate Risk v1.1.0 (CarbonPlan), fire-risk tensor",
        "store": "s3://us-west-2.opendata.source.coop/" + PREFIX,
        "snapshot": SNAPSHOT,
        "licence": "CC-BY-4.0",
        "url": "https://source.coop/carbonplan/carbonplan-ocr",
        "grid": "EPSG:4326, about 30 m",
        "units": {"bp": "annual burn probability (0-1)", "rps": "relative risk to potential structures (%)"},
        "years": "bp_2011 and rps_2011 are ~2011 conditions; bp_2047 and rps_2047 are ~2047 conditions",
    },
    "derived": "Values sampled from OCR by ClimateChain; NaN cells (unburnable) are left out of the statistics.",
    "buildingSite": {
        "case": "building-mrv",
        "location": "BDG2 site coordinates of site " + site["siteId"] + " (site-level, not the building)",
        "latitude": site["latitude"],
        "longitude": site["longitude"],
        "nearestCell": {"latitude": float(point.latitude), "longitude": float(point.longitude)},
        "values": point_values,
    },
    "earthScene": {
        "case": "earth-observation",
        "sceneId": scene["sceneId"],
        "footprint": "UTM 10N x " + str(x0) + "-" + str(x0 + size) + ", y " + str(y0 - size) + "-" + str(y0),
        "selection": "OCR cells whose centres fall inside the scene footprint",
        "statistics": {name: stats(window[name].values[inside]) for name in VARIABLES},
    },
    "attribution": [
        "Open Climate Risk v1.1.0, CarbonPlan, CC BY 4.0, https://source.coop/carbonplan/carbonplan-ocr; values sampled by ClimateChain.",
        "Burn probability: Riley et al. 2025, USDA Forest Service Research Data Archive RDS-2025-0006, https://www.fs.usda.gov/rds/archive/catalog/RDS-2025-0006",
        "Risk to potential structures: Scott et al. 2024, RDS-2020-0016-2, https://www.fs.usda.gov/rds/archive/catalog/RDS-2020-0016-2",
        "Wind adjustment: CONUS404, Rasmussen et al., https://doi.org/10.5066/P9PHPK4F",
    ],
    "limitations": [
        "Modelled values for national or relative comparison, not a locally calibrated assessment (Scott et al.).",
        "Context, not evidence: one location per case; the values do not test or change either case's result.",
    ],
}
out = ROOT / "data/external/open-climate-risk/ocr-context.json"
out.write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
