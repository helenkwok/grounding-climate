#!/usr/bin/env python3
"""Cycle-capacity history of one NASA Ames battery (default B0005) from the NASA PCoE "Battery Data Set".

    python3 scripts/prepare-nasa-battery.py <battery-data-set.zip> <out.json> [B0005]

The zip is the repository's own download, https://phm-datasets.s3.amazonaws.com/NASA/5.+Battery+Data+Set.zip; its
SHA-256 is checked before anything is read. Kept: the discharge capacity of each discharge cycle, and from each
impedance sweep the electrolyte (ohmic) resistance Re and charge-transfer resistance Rct that NASA fitted, with the
number of discharge cycles completed before the sweep.
Cite: B. Saha and K. Goebel (2007), "Battery Data Set", NASA Prognostics Data Repository, NASA Ames Research Center,
Moffett Field, CA.
"""
import hashlib
import io
import json
import sys
import zipfile

from scipy.io import loadmat

ARCHIVE_SHA256 = "82302a7db4fc1b34e0b6676326610438d43b816bdf11a69d1d012a464ef2f92e"
INNER = "5. Battery Data Set/1. BatteryAgingARC-FY08Q4.zip"
URL = "https://phm-datasets.s3.amazonaws.com/NASA/5.+Battery+Data+Set.zip"


def main(archive: str, out: str, cell: str = "B0005") -> None:
    digest = hashlib.sha256(open(archive, "rb").read()).hexdigest()
    if digest != ARCHIVE_SHA256:
        sys.exit(f"Unexpected archive SHA-256 {digest}; expected {ARCHIVE_SHA256}")
    with zipfile.ZipFile(archive) as outer, zipfile.ZipFile(io.BytesIO(outer.read(INNER))) as inner:
        raw = inner.read(f"{cell}.mat")
        readme = inner.read("README.txt").decode()
    cycles = loadmat(io.BytesIO(raw), simplify_cells=True)[cell]["cycle"]
    discharges = [op for op in cycles if op["type"] == "discharge"]
    impedance, done = [], 0
    for op in cycles:
        if op["type"] == "discharge":
            done += 1
        elif op["type"] == "impedance":
            re, rct = complex(op["data"]["Re"]), complex(op["data"]["Rct"])
            if re.imag or rct.imag or not re.real > 0:
                continue  # NASA's fit failed for this sweep
            impedance.append({"sweep": len(impedance) + 1, "afterCycle": done, "reOhm": round(re.real, 6), "rctOhm": round(rct.real, 6)})
    history = {
        "batteryId": "NASA_" + cell,
        "chemistry": "Li-ion",
        "nominalCapacityAh": 2.0,
        "cycles": [
            {"cycle": i + 1, "dischargeCapacityAh": round(float(op["data"]["Capacity"]), 6)}
            for i, op in enumerate(discharges)
        ],
        "impedance": impedance,
        "source": {
            "uri": URL,
            "sourceManifestId": "nasa-battery",
            "dataset": "NASA PCoE Battery Data Set (BatteryAgingARC-FY08Q4)",
            "datasetVersion": "sha256:" + ARCHIVE_SHA256,
            "publisher": "NASA Ames Research Center, Prognostics Center of Excellence",
            "committedPath": "data/external/nasa-battery",
            "licence": "US federal government work (17 U.S.C. 105); no licence stated by the repository",
            "attribution": "B. Saha and K. Goebel (2007), Battery Data Set, NASA Prognostics Data Repository, NASA Ames Research Center, Moffett Field, CA",
        },
    }
    # The README states the rated capacity and the end-of-life rule the tests stopped at.
    assert "from 2Ahr to 1.4Ahr" in readme, "README no longer states the 2 Ah rating"
    with open(out, "w") as f:
        json.dump(history, f, indent=1)
        f.write("\n")
    caps = [c["dischargeCapacityAh"] for c in history["cycles"]]
    print(f"{cell}: {len(caps)} discharge cycles, {caps[0]} -> {caps[-1]} Ah; {len(impedance)} impedance sweeps, Re "
          f"{impedance[0]['reOhm']} -> {impedance[-1]['reOhm']} ohm; wrote {out}")


if __name__ == "__main__":
    main(*sys.argv[1:4])
