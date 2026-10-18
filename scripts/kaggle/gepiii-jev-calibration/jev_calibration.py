"""Measure where the decision model's triage advice can be trusted, with jeval, on the GEPIII rank-1 labels.

Private Kaggle notebook on the ashrae-energy-prediction competition. It repeats gepiii-jev-scoring (same BDG2
screen, seed, sample and question set building-triage@2) and keeps every answer's full probabilities, then runs
jeval 0.2.0 (github.com/rlaope/jeval, Apache-2.0; the wheel is checked against its published SHA-256) inside
Kaggle to turn what a mistake costs into a confidence threshold for showing the advice as a suggested decision.

What is sent to the decision model is unchanged: only states built from BDG2 raw electricity (CC BY-SA 4.0).
The per-flag records, which carry competition-derived labels, are written under /tmp and never to
/kaggle/working, so the notebook output is jev-calibration.json with aggregate numbers only.
"""
import glob
import io
import json
import math
import re
import hashlib
import subprocess
import sys
import pathlib
import time
import urllib.error
import urllib.request
import zipfile

import numpy as np
import pandas as pd
from kaggle_secrets import UserSecretsClient

SEED = 20261005
SAMPLE = {"residual": 120, "constant-run": 120, "zero": 60}  # per primary reason, drawn without labels
WINDOW = ("2016-01-01 00:00:00", "2016-03-30 23:00:00")
THRESHOLD, TRAINING_FRACTION, MIN_RUN_HOURS = 6.0, 0.8, 168
JEV_URL, JEV_MODEL, QUESTION_SET = "https://api.typesafe.ai/v1/systemone", "jev-latest", "building-triage@2"
ZENODO = "https://zenodo.org/records/3887306/files/buds-lab%2Fbuilding-data-genome-project-2-v1.0.zip/container/buds-lab-building-data-genome-project-2-3d0cbaf/data/"
LABELS_URL = (
    "https://raw.githubusercontent.com/buds-lab/ashrae-great-energy-predictor-3-solution-analysis/"
    "master/solutions/rank-1/input/bad_meter_readings.zip"
)
CRITERIA = {
    "meter_fault": "The reading is a metering or data-collection fault (dropout, stuck value, spike) and should be excluded",
    "real_consumption": "The reading plausibly reflects real electricity use by the building and should be kept",
    "unclear": "The numbers do not support either conclusion",
}
INSTRUCTIONS = (
    "An hourly electricity reading was flagged by a data-quality screen. flag_reasons says why: residual means far "
    "from the building's usual use for that hour of the week; zero means the reading is exactly 0; constant-run means "
    "it is part of a week or more of identical readings. Is it a meter fault or real consumption?"
)
STATE_KEYS = {"meter", "building_use", "weekday", "hour", "reading_kwh", "expected_kwh", "robust_z",
              "flag_threshold_z", "previous_3_kwh", "next_3_kwh", "flag_reasons"}
WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "grounding-research/0.1"})
    return urllib.request.urlopen(request, timeout=600).read()


def find(name: str) -> str:
    found = [p for p in glob.glob(f"/kaggle/input/**/{name}", recursive=True) if "ashrae" in p]
    if len(found) != 1:
        raise SystemExit(f"expected one ashrae {name}, found {found}")
    return found[0]


def round1(value: float) -> float:
    return math.floor(value * 10 + 0.5) / 10  # JavaScript Math.round(value * 10) / 10


def check_sent_state(state: dict) -> None:
    for key, value in state.items():
        if key not in STATE_KEYS:
            raise ValueError("state key not allowed: " + key)
        for item in value if isinstance(value, list) else [value]:
            if isinstance(item, str):
                if len(item) > 120 or re.search(r"\d{6,}", item) or "_" in item:
                    raise ValueError("state string not allowed: " + key)
            elif not (isinstance(item, (int, float)) and math.isfinite(item)):
                raise ValueError("state value not allowed: " + key)


def screen(values: np.ndarray, stamps: pd.Series):
    """Residual robust z, predicted values and reasons per reading, as runBuildingMrv with minRunHours 168."""
    n = len(values)
    end = max(168, min(n - 1, int(np.floor(n * TRAINING_FRACTION))))
    slot = (stamps.dt.dayofweek.to_numpy() + 1) % 7 * 24 + stamps.dt.hour.to_numpy()
    means = pd.Series(values[:end]).groupby(slot[:end]).mean()
    predicted = pd.Series(slot).map(means).fillna(values[:end].mean()).to_numpy()
    residual = values - predicted
    center = np.median(residual[:end])
    scale = max(1e-9, 1.4826 * np.median(np.abs(residual[:end] - center)))
    z = (residual - center) / scale
    new_run = (pd.Series(values) != pd.Series(values).shift()) | (stamps.diff().reset_index(drop=True) != pd.Timedelta(hours=1))
    run = pd.Series(values).groupby(new_run.cumsum()).transform("size").to_numpy()
    reasons = [
        [r for r, hit in (("residual", abs(z[i]) >= THRESHOLD), ("zero", values[i] == 0), ("constant-run", run[i] >= MIN_RUN_HOURS)) if hit]
        for i in range(n)
    ]
    return z, predicted, reasons


# 1. BDG2 (CC BY-SA): the only source of anything sent to the decision model.
meta = pd.read_csv(io.BytesIO(fetch(ZENODO + "metadata/metadata.csv")))
meta = meta[meta.building_id_kaggle.notna()].set_index("building_id")
raw = pd.read_csv(io.BytesIO(fetch(ZENODO + "meters/raw/electricity.csv")))
raw = raw[(raw.timestamp >= WINDOW[0]) & (raw.timestamp <= WINDOW[1])]

flags = []
for building in [c for c in raw.columns if c in meta.index]:
    rows = raw[["timestamp", building]].dropna()
    if len(rows) < 336:
        continue
    values = rows[building].to_numpy(dtype=float)
    stamps = pd.to_datetime(rows.timestamp).reset_index(drop=True)
    z, predicted, reasons = screen(values, stamps)
    use = meta.loc[building, "primaryspaceusage"]
    for i, why in enumerate(reasons):
        if not why:
            continue
        flags.append({
            "kaggle_id": int(meta.loc[building, "building_id_kaggle"]),
            "timestamp": rows.timestamp.iloc[i],
            "bdg2_value": values[i],
            "primary": "residual" if why == ["residual"] else ("zero" if "zero" in why else ("constant-run" if "constant-run" in why else "residual")),
            "state": {
                "meter": "hourly electricity, kWh",
                "building_use": use if isinstance(use, str) and use else "unknown",
                "weekday": WEEKDAYS[(stamps[i].dayofweek + 1) % 7],
                "hour": int(stamps[i].hour),
                "reading_kwh": round1(values[i]),
                "expected_kwh": round1(predicted[i]),
                "robust_z": round1(z[i]),
                "flag_threshold_z": THRESHOLD,
                "previous_3_kwh": [round1(v) for v in values[max(0, i - 3):i]],
                "next_3_kwh": [round1(v) for v in values[i + 1:i + 4]],
                "flag_reasons": why,
            },
        })
flags = pd.DataFrame(flags)
population = flags.primary.value_counts().to_dict()
rng = np.random.default_rng(SEED)
sample = pd.concat([
    flags[flags.primary == reason].iloc[rng.permutation(int((flags.primary == reason).sum()))[:size]]
    for reason, size in SAMPLE.items()
]).reset_index(drop=True)

# 2. Ask the decision model. Only the BDG2-built state leaves Kaggle.
key = UserSecretsClient().get_secret("TYPESAFE_API_KEY")
body_questions = {"triage": {"type": "choice", "instructions": INSTRUCTIONS, "criteria": CRITERIA}}
answers, errors, models, input_tokens = [], {}, {}, 0
for state in sample.state:
    check_sent_state(state)
    payload = json.dumps({"model": JEV_MODEL, "state": state, "questions": body_questions}).encode()
    answer = None
    for attempt in (1, 2):
        request = urllib.request.Request(JEV_URL, data=payload, method="POST", headers={
            "Authorization": "Bearer " + key, "Content-Type": "application/json"})
        try:
            body = json.loads(urllib.request.urlopen(request, timeout=20).read())
            triage = body["answers"]["triage"]
            if triage.get("choice") not in CRITERIA:
                raise ValueError("choice outside criteria")
            probabilities = {k: float(v) for k, v in triage.get("probabilities", {}).items()}
            answer = {"choice": triage["choice"], "confidence": float(triage["confidence"]),
                      "p_fault": probabilities.get("meter_fault", 0.0), "probabilities": probabilities,
                      "model": body["model"]}
            models[body["model"]] = models.get(body["model"], 0) + 1
            input_tokens += int(body.get("usage", {}).get("input_tokens", 0) or 0)
            break
        except urllib.error.HTTPError as error:  # status only; never the body or headers
            if error.code in (429, 529) and attempt == 1:
                time.sleep(min(10, float(error.headers.get("retry-after") or 1)))
                continue
            errors[str(error.code)] = errors.get(str(error.code), 0) + 1
            break
        except Exception as error:  # noqa: BLE001 - only the class name is kept
            errors[type(error).__name__] = errors.get(type(error).__name__, 0) + 1
            break
    answers.append(answer)
del key
sample["answer"] = answers

# 3. Score inside Kaggle against the labels.
train = pd.read_csv(find("train.csv"), dtype={"building_id": "int16", "meter": "int8", "meter_reading": "float64"})
with zipfile.ZipFile(io.BytesIO(fetch(LABELS_URL))) as archive:
    labels = pd.read_csv(archive.open("bad_meter_readings.csv"))["is_bad_meter_reading"].astype(bool)
if len(labels) != len(train):
    raise SystemExit("labels are not aligned with train.csv")
train["bad"] = labels.values
elec = train[train.meter == 0].set_index(["building_id", "timestamp"])
del train
joined = sample.join(elec[["meter_reading", "bad"]], on=["kaggle_id", "timestamp"])
answered = joined[joined.answer.notna() & joined.bad.notna()].copy()
answered["bad"] = answered.bad.astype(bool)
answered["p_fault"] = [a["p_fault"] for a in answered.answer]
answered["choice"] = [a["choice"] for a in answered.answer]


def summary(part: pd.DataFrame) -> dict:
    if part.empty:
        return {"n": 0}
    bad, p = part.bad.to_numpy(), part.p_fault.to_numpy()
    said_fault = (part.choice == "meter_fault").to_numpy()
    positives, negatives = p[bad], p[~bad]
    auc = None
    if len(positives) and len(negatives):
        auc = float((positives[:, None] > negatives[None, :]).mean() + 0.5 * (positives[:, None] == negatives[None, :]).mean())
    bins = []
    for low, high in ((0, 0.5), (0.5, 0.8), (0.8, 0.9), (0.9, 0.95), (0.95, 1.0001)):
        inside = (p >= low) & (p < high)
        if inside.any():
            bins.append({"pFault": [low, min(high, 1.0)], "n": int(inside.sum()), "meanP": float(p[inside].mean()), "badRate": float(bad[inside].mean())})
    return {
        "n": int(len(part)),
        "badRate": float(bad.mean()),
        "choices": part.choice.value_counts().to_dict(),
        "accuracyFaultVsNot": float((said_fault == bad).mean()),
        "alwaysFaultAccuracy": float(bad.mean()),
        "precisionOfFault": float(bad[said_fault].mean()) if said_fault.any() else None,
        "recallOfFault": float(said_fault[bad].mean()) if bad.any() else None,
        "brier": float(((p - bad) ** 2).mean()),
        "aucPFault": auc,
        "reliability": bins,
    }



# 4. jeval inside Kaggle. Records under /tmp only; nothing per flag reaches /kaggle/working.
WHEEL = "https://github.com/rlaope/jeval/releases/download/v0.2.0/jeval_cli-0.2.0-py3-none-any.whl"
WHEEL_SHA256 = "027aa1953e8e91056ac697e79e1d1f6b90041ce3fc99b3a98158ffc094758222"
wheel = pathlib.Path("/tmp/jeval_cli-0.2.0-py3-none-any.whl")
wheel.write_bytes(fetch(WHEEL))
if hashlib.sha256(wheel.read_bytes()).hexdigest() != WHEEL_SHA256:
    raise SystemExit("jeval wheel does not match its published SHA-256")
subprocess.run([sys.executable, "-m", "pip", "install", "-q", str(wheel)], check=True)
import yaml  # noqa: E402 - installed with jeval

root = pathlib.Path("/tmp/jeval-root")
subprocess.run([sys.executable, "-m", "jeval", "init", "--root", str(root)], check=True, capture_output=True)
with open(root / ".jeval" / "records.jsonl", "w") as out:
    for i, row in enumerate(answered.itertuples()):
        probabilities = row.answer["probabilities"]
        out.write(json.dumps({
            "id": f"flag-{i}", "ts": "2026-10-06T00:00:00Z", "model": row.answer["model"],
            "question_key": "triage", "question_type": "choice", "prediction": row.choice,
            "confidence": probabilities.get(row.choice, row.answer["confidence"]), "probabilities": probabilities,
            "label": "meter_fault" if row.bad else "real_consumption", "label_source": "human_review",
            "segment": {"flag_reason": row.primary},
        }) + "\n")

# Costs in review units: a person deciding unaided costs 1. Showing "exclude" as the suggested decision when the
# reading was real costs RATIO (real use excluded, emissions under-reported if nobody catches it).
RATIOS = (2, 5, 10)
(root / "costs.yaml").write_text(yaml.safe_dump({"actions": [
    {"name": f"suggest_exclude_x{r}", "question": "triage", "when": "meter_fault",
     "cost_false_accept": r, "cost_escalate": 1, "cost_false_reject": 0} for r in RATIOS]}))
thresholds = {}
for name, by in (("overall", None), ("byFlagReason", "flag_reason")):
    out_path = root / f"thresholds-{name}.yaml"
    command = [sys.executable, "-m", "jeval", "threshold", "--root", str(root), "--costs", str(root / "costs.yaml"), "-o", str(out_path)]
    run = subprocess.run(command + (["--by", by] if by else []), capture_output=True, text=True)
    thresholds[name] = {"exit": run.returncode, "summary": [line for line in run.stdout.splitlines() if "threshold" in line or "flag_reason =" in line]}
    if out_path.exists():
        thresholds[name]["file"] = yaml.safe_load(out_path.read_text())

result = {
    "schemaVersion": "grounding.gepiii-jev-calibration/0.1",
    "sentToModel": "states built from BDG2 v1.0 raw electricity (CC BY-SA 4.0) only; no competition data",
    "questionSet": QUESTION_SET,
    "window": list(WINDOW),
    "screen": {"threshold": THRESHOLD, "minRunHours": MIN_RUN_HOURS},
    "flagPopulationByPrimaryReason": population,
    "sampleByPrimaryReason": sample.primary.value_counts().to_dict(),
    "seed": SEED,
    "models": models,
    "inputTokens": input_tokens,
    "errors": errors,
    "unlabelledInSample": int(joined.bad.isna().sum()),
    "bdg2MatchesCompetitionValue": float((abs(joined.meter_reading - joined.bdg2_value) < 1e-3)[joined.bad.notna()].mean()),
    "overall": summary(answered),
    "byPrimaryReason": {reason: summary(answered[answered.primary == reason]) for reason in SAMPLE},
    "labels": "GEPIII rank-1 team's bad_meter_readings, passed to jeval as gold (label_source human_review)",
    "jeval": {"version": "0.2.0", "wheelSha256": WHEEL_SHA256, "costUnits": "review units; escalate = 1",
              "suggestExcludeCostRatios": list(RATIOS), "thresholds": thresholds},
}
with open("jev-calibration.json", "w") as out:
    json.dump(result, out, indent=2)
print(json.dumps({k: result[k] for k in ("models", "errors", "unlabelledInSample", "bdg2MatchesCompetitionValue")}, indent=2))
print(json.dumps(thresholds, indent=2, default=str))
