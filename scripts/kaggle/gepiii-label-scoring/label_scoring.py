"""Score ClimateChain's building anomaly screen against the GEPIII rank-1 team's bad-reading labels.

Runs as a private Kaggle notebook attached to the ashrae-energy-prediction competition. The competition
data never leaves Kaggle: the only output is label-scoring.json, which holds aggregate counts and rates,
plus the labels of the three readings ClimateChain's building case flagged (timestamps we already
publish from BDG2, CC BY-SA). Nothing here is sent to a third party.

Labels: bad_meter_readings.csv from the rank-1 solution (MIT licence), one 0/1 value per train.csv row,
in train.csv row order. https://github.com/buds-lab/ashrae-great-energy-predictor-3-solution-analysis

The screen is a line-by-line port of packages/building-mrv (baseline.ts, anomaly.ts): an hour-of-week
mean fitted on the first 80% of a building's rows, robust z of the residual against the training
residuals' median and MAD, flagged when |z| >= 6.
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
# The mount point has moved between Kaggle versions; find the competition's train.csv wherever it is.
_found = [p for p in glob.glob("/kaggle/input/**/train.csv", recursive=True) if "ashrae" in p]
if len(_found) != 1:
    raise SystemExit("expected one ashrae train.csv under /kaggle/input, found " + str(_found))
TRAIN = _found[0]
CASE_BUILDING = 602  # BDG2 Bear_assembly_Angel
CASE_FLAGS = ["2016-02-03 07:00:00", "2016-03-01 17:00:00", "2016-03-03 14:00:00"]
CASE_ACCEPTED_KWH = 1160425.4405  # sum of the 2,160 BDG2 readings in our committed subset
WINDOWS = {"case-2160h": ("2016-01-01 00:00:00", "2016-03-30 23:00:00"), "full-2016": ("2016-01-01", "2016-12-31 23:00:00")}
THRESHOLD = 6.0
TRAINING_FRACTION = 0.8

train = pd.read_csv(TRAIN, dtype={"building_id": "int16", "meter": "int8", "meter_reading": "float64"})
with zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(LABELS_URL, timeout=120).read())) as archive:
    labels = pd.read_csv(archive.open("bad_meter_readings.csv"))["is_bad_meter_reading"].astype(bool)
if len(labels) != len(train):
    raise SystemExit(f"label rows {len(labels)} != train rows {len(train)}; alignment unknown, refusing to score")
train["bad"] = labels.values
elec = train[train.meter == 0].drop(columns="meter")
elec["timestamp"] = pd.to_datetime(elec.timestamp)
del train


def screen(values: np.ndarray, stamps: pd.Series) -> np.ndarray | None:
    """Flags per row, or None when the building has too few rows for the baseline (as in baseline.ts)."""
    n = len(values)
    if n < 336:
        return None
    end = max(168, min(n - 1, int(np.floor(n * TRAINING_FRACTION))))
    slot = (stamps.dt.dayofweek.to_numpy() + 1) % 7 * 24 + stamps.dt.hour.to_numpy()  # Sunday = 0, as getUTCDay
    means = pd.Series(values[:end]).groupby(slot[:end]).mean()
    predicted = pd.Series(slot).map(means).fillna(values[:end].mean()).to_numpy()
    residual = values - predicted
    center = np.median(residual[:end])
    scale = max(1e-9, 1.4826 * np.median(np.abs(residual[:end] - center)))
    return np.abs((residual - center) / scale) >= THRESHOLD


def rates(tp: int, fp: int, fn: int, tn: int) -> dict:
    precision = tp / (tp + fp) if tp + fp else None
    recall = tp / (tp + fn) if tp + fn else None
    f1 = 2 * precision * recall / (precision + recall) if precision and recall else None
    return {"tp": tp, "fp": fp, "fn": fn, "tn": tn, "precision": precision, "recall": recall, "f1": f1}


def quantiles(values: list) -> dict | None:
    values = [v for v in values if v is not None]
    if not values:
        return None
    q = np.quantile(values, [0.1, 0.5, 0.9])
    return {"buildings": len(values), "p10": float(q[0]), "median": float(q[1]), "p90": float(q[2])}


result = {
    "schemaVersion": "climatechain.gepiii-label-scoring/0.1",
    "labels": {"source": LABELS_URL, "licence": "MIT", "rows": int(len(labels)), "alignedToTrainRows": True},
    "screen": {"method": "hour-of-week-mean baseline, robust z of residual", "threshold": THRESHOLD, "trainingFraction": TRAINING_FRACTION},
    "meter": "electricity (meter 0)",
    "windows": {},
}

for name, (start, end) in WINDOWS.items():
    window = elec[(elec.timestamp >= start) & (elec.timestamp <= end)].sort_values(["building_id", "timestamp"])
    tp = fp = fn = tn = 0
    skipped = 0
    per_building = []
    for _, rows in window.groupby("building_id", sort=False):
        flags = screen(rows.meter_reading.to_numpy(), rows.timestamp)
        if flags is None:
            skipped += 1
            continue
        bad = rows.bad.to_numpy()
        b = (int((flags & bad).sum()), int((flags & ~bad).sum()), int((~flags & bad).sum()), int((~flags & ~bad).sum()))
        tp, fp, fn, tn = tp + b[0], fp + b[1], fn + b[2], tn + b[3]
        per_building.append(rates(*b))
    labelled = [r for r in per_building if r["tp"] + r["fn"] > 0]
    result["windows"][name] = {
        "range": [start, end],
        "buildingsScored": len(per_building),
        "buildingsSkippedTooFewRows": skipped,
        "buildingsWithAnyBadLabel": len(labelled),
        "rows": tp + fp + fn + tn,
        "badRate": (tp + fn) / (tp + fp + fn + tn),
        "pooled": rates(tp, fp, fn, tn),
        "perBuildingPrecision": quantiles([r["precision"] for r in per_building]),
        "perBuildingRecall": quantiles([r["recall"] for r in labelled]),
    }

case = elec[(elec.building_id == CASE_BUILDING) & (elec.timestamp <= WINDOWS["case-2160h"][1])].sort_values("timestamp")
by_time = case.set_index(case.timestamp.dt.strftime("%Y-%m-%d %H:%M:%S"))
result["caseBuilding"] = {
    "gepiiiBuildingId": CASE_BUILDING,
    "bdg2BuildingId": "Bear_assembly_Angel",
    "windowRows": int(len(case)),
    "windowSumKWh": float(case.meter_reading.sum()),
    "matchesCommittedBdg2Subset": bool(len(case) == 2160 and abs(case.meter_reading.sum() - CASE_ACCEPTED_KWH) < 1e-3),
    "badReadingsInWindow": int(case.bad.sum()),
    "ourFlags": [
        {"timestamp": t, "inLabels": t in by_time.index, "labelledBad": bool(by_time.bad.get(t, False))}
        for t in CASE_FLAGS
    ],
}

with open("label-scoring.json", "w") as out:
    json.dump(result, out, indent=2)
print(json.dumps(result, indent=2))
