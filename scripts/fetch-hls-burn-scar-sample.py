#!/usr/bin/env python3
import argparse
import hashlib
import tarfile
import urllib.request
from pathlib import Path

DATASET_ID = "ibm-nasa-geospatial/hls_burn_scars"
REVISION = "1864285e25010d346a842e4f068b1a1d4248ed6d"
TAR_NAME = "hls_burn_scars.tar.gz"
TAR_BYTES = 2_645_552_531
TAR_SHA256 = "4e6f99a75cb2c500547b20662a15cbd531dc421376f815e91846ea542798e8e6"

IMAGE_MEMBER = "validation/subsetted_512x512_HLS.S30.T10SEH.2018190.v1.4_merged.tif"
IMAGE_BYTES = 6_295_168
IMAGE_SHA256 = "13bc592a5e569d837bd8bb3524bb0d2f28418830bcc7b0750e74033078f8b17e"

MASK_MEMBER = "validation/subsetted_512x512_HLS.S30.T10SEH.2018190.v1.4.mask.tif"
MASK_BYTES = 525_272
MASK_SHA256 = "67e92de848f4d90730bff525d3aa51fa7c02759e494f264c0d33dcc8c4f6e66a"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify(path: Path, size: int, digest: str) -> None:
    actual_size = path.stat().st_size
    actual_digest = sha256(path)
    if actual_size != size or actual_digest != digest:
        raise RuntimeError(
            f"{path.name}: expected {size}/{digest}, got {actual_size}/{actual_digest}"
        )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    parser.add_argument(
        "--cache",
        type=Path,
        default=Path("/tmp/climatechain-hls-cache"),
    )
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)
    args.cache.mkdir(parents=True, exist_ok=True)
    tar_path = args.cache / TAR_NAME

    url = (
        f"https://huggingface.co/datasets/{DATASET_ID}/resolve/"
        f"{REVISION}/{TAR_NAME}?download=true"
    )

    if not tar_path.exists() or tar_path.stat().st_size != TAR_BYTES:
        print("Downloading pinned HLS Burn Scars archive:", url, flush=True)
        urllib.request.urlretrieve(url, tar_path)

    verify(tar_path, TAR_BYTES, TAR_SHA256)
    print("Archive verified:", TAR_SHA256, flush=True)

    selected = {
        IMAGE_MEMBER: (IMAGE_BYTES, IMAGE_SHA256),
        MASK_MEMBER: (MASK_BYTES, MASK_SHA256),
    }

    with tarfile.open(tar_path, "r:gz") as archive:
        members = {m.name: m for m in archive if m.name in selected}
        if set(members) != set(selected):
            missing = sorted(set(selected) - set(members))
            raise RuntimeError("Missing pinned members: " + ", ".join(missing))

        for name, (size, digest) in selected.items():
            member = members[name]
            source = archive.extractfile(member)
            if source is None:
                raise RuntimeError("Could not read " + name)
            destination = args.output / Path(name).name
            with destination.open("wb") as target:
                while True:
                    chunk = source.read(1024 * 1024)
                    if not chunk:
                        break
                    target.write(chunk)
            verify(destination, size, digest)
            print(
                f"Member verified: {name} size={size} sha256={digest}",
                flush=True,
            )


if __name__ == "__main__":
    main()
