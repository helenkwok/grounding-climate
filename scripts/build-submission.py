#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_ROOT = ROOT / "dist" / "submission"
STAGE = OUT_ROOT / "grounding-climate"
ZIP_PATH = OUT_ROOT / "grounding-climate-submission.zip"

SITE = "https://helenkwok.github.io/grounding-climate/"
VIDEO = "https://youtu.be/UvnaIW0SFvY"
REPO = "https://github.com/helenkwok/grounding-climate"
TOP = ["README.md", "LICENSE", "NOTICE"]
SOURCES = [
    "sources/cadi-candidates.json",
    "sources/rights-manifest.json",
]
# Open data the built site carries so its claims rebuild in the browser. The public repository redistributes the
# same files; each id is an entry in sources/rights-manifest.json, which holds the licence and attribution.
SITE_DATA = [
    {"id": "bdg2", "what": "BDG2 hourly meter readings for one building", "licence": "CC BY-SA 4.0"},
    {"id": "energy-eva-active-power-load", "what": "Energy-EVA hourly load series", "licence": "CC BY 4.0"},
    {"id": "hls-burn-scars", "what": "HLS burn-scar scene T10SEH arrays (site/data/hls-burn-scars)", "licence": "CC BY 4.0"},
    {"id": "nasa-battery", "what": "NASA Ames cell B0005 capacity and impedance history", "licence": "US federal government work (17 U.S.C. 105)"},
    {"id": "acr-offsetsdb", "what": "100 issuance and 100 retirement ACR records via CarbonPlan OffsetsDB", "licence": "ACR Website Terms of Use, public reports clause"},
    {"id": "open-climate-risk", "what": "Open Climate Risk state summary for the map", "licence": "CC BY 4.0"},
]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def copy_required(relative: str) -> None:
    src = ROOT / relative
    if not src.is_file():
        raise FileNotFoundError(relative)
    dst = STAGE / relative
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)


def main() -> int:
    # Builds every package and the site at the root path, so the bundled site serves from any local folder.
    subprocess.run(["npm", "run", "build"], cwd=ROOT, check=True)

    if OUT_ROOT.exists():
        shutil.rmtree(OUT_ROOT)
    STAGE.mkdir(parents=True)

    docs = sorted(p.relative_to(ROOT).as_posix() for p in (ROOT / "docs").glob("*.md"))
    reports = sorted(p.relative_to(ROOT).as_posix() for p in (ROOT / "reports").rglob("*") if p.is_file())
    for relative in TOP + docs + reports + SOURCES:
        copy_required(relative)

    site_src = ROOT / "apps" / "site" / "dist" / "client"
    if not (site_src / "index.html").is_file():
        raise RuntimeError("site build output is missing")
    shutil.copytree(site_src, STAGE / "site")

    data_lines = "\n".join(f"- {d['what']}: {d['licence']} (`{d['id']}` in `sources/rights-manifest.json`)" for d in SITE_DATA)
    submission_readme = f"""# Grounding submission bundle

Climate claims that show their work. IEEE ClimateChain Global Hackathon 2026, track Climate Data & Environmental Monitoring.

- Live site: {SITE} (for judges, about 30 seconds: {SITE}judge/)
- Demo video: {VIDEO}
- Source code: {REPO}

## Contents

- `site/`: the built site. Every claim rebuilds in your browser from the data it carries.
- `reports/`: each claim's signed record, W3C Verifiable Credential, Bitcoin timestamp and anchors, plus the measured reports.
- `docs/`: how each module works, the standards crosswalk, the credentials and the anchors.
- `sources/`: the rights manifest for every external source, and the disclosure candidates.
- `README.md`, `LICENSE` (Apache-2.0), `NOTICE`, and `MANIFEST.json` with a SHA-256 for every file.

## Run the site from this folder

The site needs a local web server (opening `index.html` as a file does not work):

```bash
python3 -m http.server 8000 --directory site
```

Then open http://127.0.0.1:8000/. Drop any `reports/<claim>/credential.json` on the Verify page to check it.

## Third-party data in this bundle

The site carries this open data so its claims can be recomputed. The public repository redistributes the same files.
Attribution for each is in `docs/source-attribution.md`.

{data_lines}

The map's base tiles and wildfire-risk shading are fetched from OpenFreeMap and CarbonPlan when the site runs; they are not in the bundle.
"""
    (STAGE / "SUBMISSION.md").write_text(submission_readme, encoding="utf-8")

    files = sorted(
        p for p in STAGE.rglob("*")
        if p.is_file() and p.name != "MANIFEST.json"
    )
    manifest = {
        "schemaVersion": "grounding.submission-manifest/0.1",
        "thirdPartyRawDataIncluded": True,
        "thirdPartyData": SITE_DATA,
        "fileCount": len(files),
        "files": [
            {
                "path": p.relative_to(STAGE).as_posix(),
                "bytes": p.stat().st_size,
                "sha256": sha256(p),
            }
            for p in files
        ],
    }
    manifest_path = STAGE / "MANIFEST.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2) + "\n",
        encoding="utf-8",
    )

    ZIP_PATH.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(ZIP_PATH, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(p for p in STAGE.rglob("*") if p.is_file()):
            archive.write(path, path.relative_to(OUT_ROOT))

    print(json.dumps({
        "zip": str(ZIP_PATH.relative_to(ROOT)),
        "bytes": ZIP_PATH.stat().st_size,
        "sha256": sha256(ZIP_PATH),
        "manifestFiles": manifest["fileCount"],
        "thirdPartyRawDataIncluded": True,
    }, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"submission build failed: {exc}", file=sys.stderr)
        raise
