#!/usr/bin/env python3
# Extracts the two bands the NBR detector reads (NIR, SWIR2) and the label mask from the pinned HLS Burn Scar
# scene, as raw little-endian arrays the browser can load without a TIFF reader. Input: the TIFF pair written
# by fetch-hls-burn-scar-sample.py. Run: uv run --with rasterio --with numpy python scripts/prepare-hls-scene.py <dir>
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import rasterio

SCENE = "T10SEH.2018190.v1"
IMAGE = ("subsetted_512x512_HLS.S30.T10SEH.2018190.v1.4_merged.tif",
         "13bc592a5e569d837bd8bb3524bb0d2f28418830bcc7b0750e74033078f8b17e")
MASK = ("subsetted_512x512_HLS.S30.T10SEH.2018190.v1.4.mask.tif",
        "67e92de848f4d90730bff525d3aa51fa7c02759e494f264c0d33dcc8c4f6e66a")
OUT = Path(__file__).resolve().parent.parent / "data/external/hls-burn-scars" / SCENE


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    args = parser.parse_args()
    for name, digest in (IMAGE, MASK):
        if sha256((args.source / name).read_bytes()) != digest:
            raise SystemExit(name + " does not match its pinned SHA-256")

    with rasterio.open(args.source / IMAGE[0]) as src:
        bands = src.read()
        dtypes = src.dtypes
        transform = src.transform
        crs = str(src.crs)
    with rasterio.open(args.source / MASK[0]) as src:
        mask = src.read(1)
        mask_dtype = src.dtypes[0]
    if bands.shape != (6, 512, 512) or mask.shape != (512, 512):
        raise SystemExit("unexpected shapes " + str(bands.shape) + " " + str(mask.shape))
    if not np.isin(mask, [-1, 0, 1]).all():
        raise SystemExit("mask holds values other than -1, 0, 1")

    # The detector's inputs as stored in the TIFF: float32 values are written unchanged.
    arrays = {
        "nir.f32": bands[3].astype("<f4"),
        "swir2.f32": bands[5].astype("<f4"),
        "mask.i8": mask.astype("<i1"),
    }
    OUT.mkdir(parents=True, exist_ok=True)
    files = {}
    for name, array in arrays.items():
        data = array.tobytes(order="C")
        (OUT / name).write_bytes(data)
        files[name] = {"bytes": len(data), "sha256": sha256(data)}

    manifest = {
        "schemaVersion": "grounding.hls-scene-arrays/0.1",
        "sceneId": SCENE,
        "dataset": "ibm-nasa-geospatial/hls_burn_scars",
        "datasetRevision": "1864285e25010d346a842e4f068b1a1d4248ed6d",
        "licence": "CC-BY-4.0",
        "sourceFiles": {"image": {"member": "validation/" + IMAGE[0], "sha256": IMAGE[1]},
                        "mask": {"member": "validation/" + MASK[0], "sha256": MASK[1]}},
        "width": 512,
        "height": 512,
        "pixelSizeMeters": abs(transform.a),
        "crs": crs,
        "origin": [transform.c, transform.f],
        "layout": "row-major, little-endian",
        "sourceDtypes": {"bands": list(dtypes), "mask": mask_dtype},
        "bands": {"nir.f32": "channel 4 (HLS B8A, narrow NIR)", "swir2.f32": "channel 6 (HLS B12, SWIR2)",
                  "mask.i8": "1 burn scar, 0 not burned, -1 no data"},
        "files": files,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
