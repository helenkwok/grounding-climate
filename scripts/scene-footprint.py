#!/usr/bin/env python3
# Writes the earth scene's footprint as a WGS 84 polygon for the demo map, from the committed manifest's UTM origin,
# pixel size and dimensions. Run: uv run --with pyproj==3.7.2 python scripts/scene-footprint.py
import json
from pathlib import Path

from pyproj import Transformer

ROOT = Path(__file__).resolve().parent.parent
SCENE = ROOT / "data/external/hls-burn-scars/T10SEH.2018190.v1"
manifest = json.loads((SCENE / "manifest.json").read_text())
x0, y0 = manifest["origin"]
size = manifest["pixelSizeMeters"]
x1, y1 = x0 + manifest["width"] * size, y0 - manifest["height"] * size
to_wgs84 = Transformer.from_crs("EPSG:32610", "EPSG:4326", always_xy=True)  # UTM zone 10N
ring = [[round(v, 6) for v in to_wgs84.transform(x, y)] for x, y in [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]]
out = {
    "sceneId": manifest["sceneId"],
    "method": "Corners of the UTM 10N footprint (manifest origin, pixel size, width, height) transformed to EPSG:4326 with pyproj 3.7.2.",
    "polygon": ring,
}
(ROOT / "reports/earth-observation/scene-footprint.json").write_text(json.dumps(out, indent=2) + "\n")
print(json.dumps(out))
