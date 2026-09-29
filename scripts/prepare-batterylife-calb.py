#!/usr/bin/env python3
import hashlib
import json
import os
import pickle
import sys
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

RECORD = "19688272"
DOI = "10.5281/zenodo.19688272"
FILES = {
    "Life labels.zip": "cd0cc01a7211972be45e8e38d86cdeca",
    "CALB.zip": "2b1006e96e0ca42765a732060f964687",
}
DEFAULT_BATTERY = "CALB_0_B182.pkl"

def md5(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def download(name: str, destination: Path) -> None:
    url = (
        "https://zenodo.org/records/"
        + RECORD
        + "/files/"
        + urllib.parse.quote(name)
        + "?download=1"
    )
    print("Downloading", url)
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "ClimateChain/0.1 BatteryLife reproducibility smoke"},
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        with destination.open("wb") as out:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                out.write(chunk)

def find_file(root: Path, filename: str) -> Path:
    matches = list(root.rglob(filename))
    if len(matches) != 1:
        raise RuntimeError(
            f"Expected one {filename}, found {len(matches)}: {matches}"
        )
    return matches[0]

def get_attr(value, name):
    if isinstance(value, dict):
        return value.get(name)
    return getattr(value, name, None)

def max_finite(values):
    finite = [float(v) for v in values if v is not None and float(v) == float(v)]
    return max(finite) if finite else None

def export_history(pickle_path: Path, output_path: Path) -> dict:
    with pickle_path.open("rb") as f:
        data = pickle.load(f)

    cell_id = get_attr(data, "cell_id") or pickle_path.stem
    nominal = get_attr(data, "nominal_capacity_in_Ah")
    cycles = get_attr(data, "cycle_data")
    if nominal is None or cycles is None:
        raise RuntimeError("Processed CALB pickle lacks nominal_capacity_in_Ah/cycle_data")

    exported = []
    for item in cycles:
        cycle = get_attr(item, "cycle_number")
        discharge = get_attr(item, "discharge_capacity_in_Ah")
        if cycle is None or discharge is None:
            continue
        capacity = max_finite(discharge)
        if capacity is None or capacity <= 0:
            continue
        exported.append(
            {
                "cycle": int(cycle),
                "dischargeCapacityAh": capacity,
            }
        )

    exported.sort(key=lambda row: row["cycle"])
    if len(exported) < 2:
        raise RuntimeError("Selected CALB battery has fewer than two usable cycles")

    history = {
        "batteryId": str(cell_id),
        "chemistry": "NMC",
        "formFactor": "Prismatic",
        "nominalCapacityAh": float(nominal),
        "cycles": exported,
        "source": {
            "uri": "https://zenodo.org/records/" + RECORD,
            "sourceManifestId": "batterylife-processed",
            "dataset": "BatteryLife CALB",
            "datasetVersion": "v11",
        },
    }
    output_path.write_text(json.dumps(history, indent=2) + "\n", encoding="utf-8")
    return history

def main():
    if len(sys.argv) < 2:
        raise SystemExit("Usage: prepare-batterylife-calb.py <output-dir> [battery-file]")

    root = Path(sys.argv[1]).resolve()
    battery_file = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_BATTERY
    root.mkdir(parents=True, exist_ok=True)
    downloads = root / "downloads"
    extracted = root / "extracted"
    downloads.mkdir(exist_ok=True)
    extracted.mkdir(exist_ok=True)

    for name, expected_md5 in FILES.items():
        path = downloads / name
        if not path.exists():
            download(name, path)
        actual = md5(path)
        if actual != expected_md5:
            raise RuntimeError(
                f"Checksum mismatch for {name}: expected {expected_md5}, got {actual}"
            )
        print(f"{name}: md5 OK ({actual})")
        with zipfile.ZipFile(path) as zf:
            zf.extractall(extracted / name.removesuffix(".zip"))

    labels_path = find_file(extracted / "Life labels", "CALB_labels.json")
    labels_raw = json.loads(labels_path.read_text(encoding="utf-8"))
    labels = [
        {"batteryFile": str(name), "lifeCycles": float(value)}
        for name, value in labels_raw.items()
        if value is not None
    ]
    labels.sort(key=lambda row: row["batteryFile"])
    (root / "calb-labels.json").write_text(
        json.dumps(labels, indent=2) + "\n",
        encoding="utf-8",
    )

    battery_path = find_file(extracted / "CALB", battery_file)
    history = export_history(battery_path, root / "battery-history.json")

    manifest = {
        "schemaVersion": "climatechain.batterylife-prepared/0.1",
        "source": {
            "zenodoRecord": "https://zenodo.org/records/" + RECORD,
            "doi": DOI,
            "version": "v11",
            "files": [
                {"name": name, "md5": checksum}
                for name, checksum in FILES.items()
            ],
        },
        "labelCount": len(labels),
        "selectedBattery": battery_file,
        "selectedBatteryCycleCount": len(history["cycles"]),
        "selectedBatteryNominalCapacityAh": history["nominalCapacityAh"],
    }
    (root / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n",
        encoding="utf-8",
    )
    print("CLIMATECHAIN_BATTERYLIFE_PREPARED=" + json.dumps(manifest))

if __name__ == "__main__":
    main()
