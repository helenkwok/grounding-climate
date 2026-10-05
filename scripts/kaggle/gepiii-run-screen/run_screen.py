"""Choose and score a screen for zero readings and constant runs against the GEPIII rank-1 bad-reading labels.

Private Kaggle notebook on the ashrae-energy-prediction competition. Competition data stays on Kaggle; the only
output is run-screen.json with aggregate counts and rates. Nothing is sent to a third party.

Rules, per electricity reading (rows sorted by time within a building):
  residual  the existing ClimateChain screen (hour-of-week mean baseline, robust z >= 6), as in label_scoring.py
  zero      the reading is exactly 0
  run>=L    the reading belongs to a run of at least L consecutive hourly readings with the same value

The run length L is chosen on even-numbered buildings and reported on odd-numbered ones, so the reported
numbers are not tuned on the buildings they describe. Site 0 is also reported separately, because its
electricity before May 2016 is known to be wrong in bulk, which no per-building screen can see.
"""
import glob
import io
import json
import urllib.request
import zipfile

import numpy as np
import pandas as pd

LABELS_URL = (
    "https://raw.githubusercontent.com/buds-lab/ashrae-great-energy-predictor-3-solution-analysis/"
    "master/solutions/rank-1/input/bad_meter_readings.zip"
)
WINDOWS = {
    "case-2160h": ("2016-01-01 00:00:00", "2016-03-30 23:00:00"),
    "full-2016": ("2016-01-01 00:00:00", "2016-12-31 23:00:00"),
}
RUN_LENGTHS = [2, 3, 4, 6, 8, 12, 24, 48, 72, 96, 168, 336]
THRESHOLD = 6.0
TRAINING_FRACTION = 0.8


def find(name: str) -> str:
    found = [p for p in glob.glob(f"/kaggle/input/**/{name}", recursive=True) if "ashrae" in p]
    if len(found) != 1:
        raise SystemExit(f"expected one ashrae {name} under /kaggle/input, found {found}")
    return found[0]


train = pd.read_csv(find("train.csv"), dtype={"building_id": "int16", "meter": "int8", "meter_reading": "float64"})
site = pd.read_csv(find("building_metadata.csv")).set_index("building_id").site_id
with zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(LABELS_URL, timeout=120).read())) as archive:
    labels = pd.read_csv(archive.open("bad_meter_readings.csv"))["is_bad_meter_reading"].astype(bool)
if len(labels) != len(train):
    raise SystemExit(f"label rows {len(labels)} != train rows {len(train)}; alignment unknown, refusing to score")
train["bad"] = labels.values
elec = train[train.meter == 0].drop(columns="meter")
elec["timestamp"] = pd.to_datetime(elec.timestamp)
del train


def residual_screen(values: np.ndarray, stamps: pd.Series) -> np.ndarray:
    n = len(values)
    if n < 336:
        return np.zeros(n, dtype=bool)
    end = max(168, min(n - 1, int(np.floor(n * TRAINING_FRACTION))))
    slot = (stamps.dt.dayofweek.to_numpy() + 1) % 7 * 24 + stamps.dt.hour.to_numpy()
    means = pd.Series(values[:end]).groupby(slot[:end]).mean()
    predicted = pd.Series(slot).map(means).fillna(values[:end].mean()).to_numpy()
    residual = values - predicted
    center = np.median(residual[:end])
    scale = max(1e-9, 1.4826 * np.median(np.abs(residual[:end] - center)))
    return np.abs((residual - center) / scale) >= THRESHOLD


def rates(flags: np.ndarray, bad: np.ndarray) -> dict:
    tp = int((flags & bad).sum()); fp = int((flags & ~bad).sum()); fn = int((~flags & bad).sum())
    precision = tp / (tp + fp) if tp + fp else None
    recall = tp / (tp + fn) if tp + fn else None
    f1 = 2 * precision * recall / (precision + recall) if precision and recall else None
    return {"flagged": tp + fp, "tp": tp, "precision": precision, "recall": recall, "f1": f1}


result = {
    "schemaVersion": "climatechain.gepiii-run-screen/0.2",
    "labels": {"source": LABELS_URL, "licence": "MIT", "rows": int(len(labels))},
    "meter": "electricity (meter 0)",
    "selection": "run length chosen by F1 of residual|zero|run>=L on even building ids; reported on odd ids",
    "windows": {},
}

for name, (start, end) in WINDOWS.items():
    w = elec[(elec.timestamp >= start) & (elec.timestamp <= end)].sort_values(["building_id", "timestamp"]).reset_index(drop=True)
    w["residual"] = False
    for _, idx in w.groupby("building_id").indices.items():
        w.loc[idx, "residual"] = residual_screen(w.meter_reading.to_numpy()[idx], w.timestamp.iloc[idx])
    new_run = (
        (w.building_id != w.building_id.shift())
        | (w.meter_reading != w.meter_reading.shift())
        | (w.timestamp - w.timestamp.shift() != pd.Timedelta(hours=1))
    )
    w["run_length"] = w.groupby(new_run.cumsum()).meter_reading.transform("size")
    w["zero"] = w.meter_reading == 0
    w["site0"] = w.building_id.map(site).to_numpy() == 0

    def score(mask: np.ndarray) -> dict:
        part = w[mask]
        bad = part.bad.to_numpy()
        res, zero, runlen = part.residual.to_numpy(), part.zero.to_numpy(), part.run_length.to_numpy()
        out = {"rows": int(len(part)), "badRate": float(bad.mean()), "residual": rates(res, bad), "zero": rates(zero, bad)}
        for length in RUN_LENGTHS:
            out[f"run>={length}"] = rates(runlen >= length, bad)
            out[f"residual|zero|run>={length}"] = rates(res | zero | (runlen >= length), bad)
            out[f"zero|run>={length}"] = rates(zero | (runlen >= length), bad)
        return out

    even = (w.building_id % 2 == 0).to_numpy()
    tuning = score(even)
    best = max(RUN_LENGTHS, key=lambda length: tuning[f"residual|zero|run>={length}"]["f1"] or 0)
    held_out = score(~even)
    held_out_no_site0 = score(~even & ~w.site0.to_numpy())
    result["windows"][name] = {
        "range": [start, end],
        "chosenRunLength": best,
        "tuningEvenBuildings": tuning,
        "heldOutOddBuildings": held_out,
        "heldOutOddBuildingsExcludingSite0": held_out_no_site0,
    }

with open("run-screen.json", "w") as out:
    json.dump(result, out, indent=2)
print(json.dumps({n: {"L": v["chosenRunLength"], "heldOut": {k: v["heldOutOddBuildings"][k] for k in ("residual", f"residual|zero|run>={v['chosenRunLength']}")}} for n, v in result["windows"].items()}, indent=2))
