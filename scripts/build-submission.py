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

DOCS = [
    "docs/judging-demo.md",
    "docs/domain-model.md",
    "docs/crypto-trust.md",
    "docs/provenance-attestation.md",
    "docs/webmcp.md",
    "docs/source-rights.md",
    "docs/source-attribution.md",
]
REPORTS = [
    "reports/building-mrv/bdg2-v1-smoke.json",
    "reports/energy-forecast/active-power-dummy.json",
    "reports/earth-observation/t10seh-2018190-nbr.json",
    "reports/battery-dpp/batterylife-calb-smoke.json",
    "reports/carbon-registry/carbonplan-smoke.json",
]
SOURCES = [
    "sources/cadi-candidates.json",
    "sources/rights-manifest.json",
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
    subprocess.run(["npm", "run", "demo:build"], cwd=ROOT, check=True)

    if OUT_ROOT.exists():
        shutil.rmtree(OUT_ROOT)
    STAGE.mkdir(parents=True)

    copy_required("README.md")
    for relative in DOCS + REPORTS + SOURCES:
        copy_required(relative)

    demo_src = ROOT / "apps" / "demo" / "dist"
    if not demo_src.is_dir():
        raise RuntimeError("demo build output is missing")
    shutil.copytree(demo_src, STAGE / "demo")

    submission_readme = """# Grounding submission bundle

This ZIP is a presentation/review bundle, not the full source repository.

Contents:
- static browser demo
- measured result summaries
- architecture/reproducibility documentation
- external-source rights manifest and attribution
- public-disclosure candidate metadata

Raw third-party datasets, reports, model weights, registry snapshots, and downloaded benchmark files are intentionally excluded.

Full source code must be provided through the public repository required by the hackathon.
"""
    (STAGE / "SUBMISSION.md").write_text(submission_readme, encoding="utf-8")

    files = sorted(
        p for p in STAGE.rglob("*")
        if p.is_file() and p.name != "MANIFEST.json"
    )
    manifest = {
        "schemaVersion": "grounding.submission-manifest/0.1",
        "thirdPartyRawDataIncluded": False,
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
        "thirdPartyRawDataIncluded": False,
    }, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"submission build failed: {exc}", file=sys.stderr)
        raise
