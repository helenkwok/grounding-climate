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

RELEASES = {
    "v1": {
        "record": "14890219",
        "doi": "10.5281/zenodo.14890219",
        "version": "v1",
        "files": {
            "CALB_labels.json": "6a9eff3b988d0faf03a08b5b2aca42ed",
        },
        "labels_only": True,
    },
    "v4": {
        "record": "14969822",
        "doi": "10.5281/zenodo.14969822",
        "version": "v4",
        "files": {
            "Life labels.zip": "75915ef17f86bf295ab272409a1317ea",
            "CALB.zip": "b16c5fefced9dd46c320dcb66cb1d08b",
        },
    },
    "v11": {
        "record": "19688272",
        "doi": "10.5281/zenodo.19688272",
        "version": "v11",
        "files": {
            "Life labels.zip": "cd0cc01a7211972be45e8e38d86cdeca",
            "CALB.zip": "2b1006e96e0ca42765a732060f964687",
        },
    },
}
DEFAULT_BATTERY = "CALB_0_B182.pkl"

def md5(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def download(record: str, name: str, destination: Path) -> None:
    url = (
        "https://zenodo.org/records/"
        + record
        + "/files/"
        + urllib.parse.quote(name)
        + "?download=1"
    )
    print("Downloading", url)
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "Grounding/0.1 BatteryLife reproducibility smoke"},
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

def export_history(pickle_path: Path, output_path: Path, release: dict) -> dict:
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
            "uri": "https://zenodo.org/records/" + release["record"],
            "sourceManifestId": "batterylife-processed",
            "dataset": "BatteryLife CALB",
            "datasetVersion": release["version"],
        },
    }
    output_path.write_text(json.dumps(history, indent=2) + "\n", encoding="utf-8")
    return history

def main():
    if len(sys.argv) < 2:
        raise SystemExit(
            "Usage: prepare-batterylife-calb.py <output-dir> [release=v11] [battery-file]"
        )

    root = Path(sys.argv[1]).resolve()
    release_name = sys.argv[2] if len(sys.argv) > 2 else "v11"
    if release_name not in RELEASES:
        raise RuntimeError("Unknown BatteryLife release: " + release_name)
    release = RELEASES[release_name]
    battery_file = sys.argv[3] if len(sys.argv) > 3 else DEFAULT_BATTERY
    root.mkdir(parents=True, exist_ok=True)
    downloads = root / "downloads"
    extracted = root / "extracted"
    downloads.mkdir(exist_ok=True)
    extracted.mkdir(exist_ok=True)

    for name, expected_md5 in release["files"].items():
        path = downloads / name
        if not path.exists():
            download(release["record"], name, path)
        actual = md5(path)
        if actual != expected_md5:
            raise RuntimeError(
                f"Checksum mismatch for {name}: expected {expected_md5}, got {actual}"
            )
        print(f"{name}: md5 OK ({actual})")
        if name.endswith(".zip"):
            with zipfile.ZipFile(path) as zf:
                zf.extractall(extracted / name.removesuffix(".zip"))

    if release.get("labels_only"):
        labels_path = downloads / "CALB_labels.json"
    else:
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

    history = None
    if not release.get("labels_only"):
        battery_path = find_file(extracted / "CALB", battery_file)
        history = export_history(
            battery_path,
            root / "battery-history.json",
            release,
        )

    manifest = {
        "schemaVersion": "grounding.batterylife-prepared/0.1",
        "source": {
            "zenodoRecord": "https://zenodo.org/records/" + release["record"],
            "doi": release["doi"],
            "version": release["version"],
            "files": [
                {"name": name, "md5": checksum}
                for name, checksum in release["files"].items()
            ],
        },
        "labelCount": len(labels),
        "selectedBattery": battery_file if history else None,
        "selectedBatteryCycleCount": len(history["cycles"]) if history else None,
        "selectedBatteryNominalCapacityAh": history["nominalCapacityAh"] if history else None,
    }
    (root / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n",
        encoding="utf-8",
    )
    print("GROUNDING_BATTERYLIFE_PREPARED=" + json.dumps(manifest))

if __name__ == "__main__":
    main()
