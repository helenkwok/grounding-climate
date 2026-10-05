# Energy-EVA active power load: the 7 standardised series

All 7 hourly series of Energy-EVA's standardised `load/active_power_load.parquet` (5,160 rows), exported unchanged
to JSON. They come from the EnergyTS time-series dataset (doi:10.5281/zenodo.17099628,
`EnergyEVA_Timeseries_Dataset.zip`, archive MD5 662cbf850ecd592d6ff534471460f3f1). Steps to reproduce:

    node scripts/prepare-energy-eva-active-power.mjs <dir>
    python scripts/export-energy-eva-active-power.py <dir>/active_power_load.parquet series.json

`manifest.json` records the archive and the member's checksums.

**Licence:** CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/), both the Zenodo record and the original data.
The only change is the format: parquet to JSON, with ISO timestamps. The parquet does not record a unit; ClimateChain
labels the values MW.

**Cite:**
- Tao Luo, Lingfeng Zhang, Feng Qian, "EnergyTS TimeSeries Dataset", Zenodo,
  https://doi.org/10.5281/zenodo.17099628 (standardised by Energy-EVA, https://github.com/antgroup/Energy-EVA).
- Venkataramana Veeramsetty, Surender Reddy Salkuti, Baddam Nikitha and Thallapalli Siddartha, "Active power load
  dataset - IEX data", Mendeley Data v1, https://doi.org/10.17632/jxm8d4w4cv.1 (the original data).

The demo page and `scripts/run-energy-case.mjs` read `series.json`.
