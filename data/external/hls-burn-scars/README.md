# HLS Burn Scar Scenes: scene T10SEH.2018190.v1

The two bands the NBR detector reads, and the label mask, for one 512×512 validation scene of the HLS Burn Scar
Scenes dataset (`ibm-nasa-geospatial/hls_burn_scars`, revision `1864285e25010d346a842e4f068b1a1d4248ed6d`). The scene
is HLS Sentinel-2 tile T10SEH (northern California), day 190 of 2018 (9 July 2018).

| File | Contents |
|---|---|
| `nir.f32` | channel 4 of the merged TIFF (HLS B8A, narrow NIR), float32 reflectance |
| `swir2.f32` | channel 6 (HLS B12, SWIR2), float32 reflectance |
| `mask.i8` | the label mask: 1 burn scar, 0 not burned, -1 no data (int16 in the TIFF, stored as int8) |

Each file is raw little-endian, row-major, 512×512. The float32 values are copied unchanged from the TIFF.
`manifest.json` records the SHA-256 of each file and of the two source TIFFs, the CRS, origin and pixel size. To
reproduce:

    python scripts/fetch-hls-burn-scar-sample.py <dir>
    uv run --with rasterio==1.4.3 --with numpy python scripts/prepare-hls-scene.py <dir>

The other four bands are not committed: the detector does not read them.

**Licence:** CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). The change is the format: two bands and the
mask taken out of the GeoTIFFs as raw arrays.

**Cite:** Christopher Phillips, Sujit Roy, Kumar Ankur and Rahul Ramachandran, "HLS Foundation Burnscars Dataset",
2023, https://doi.org/10.57967/hf/0956. The imagery is NASA Harmonized Landsat Sentinel-2 (HLS); the burn labels derive
from Monitoring Trends in Burn Severity (MTBS) data.
