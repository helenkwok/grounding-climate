#!/usr/bin/env python3
import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image, ImageDraw


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def scale_rgb(bands: np.ndarray) -> np.ndarray:
    # HLS files in this dataset are reflectance. Percentile scaling is for
    # visualization only; detector metrics always use the original values.
    rgb = np.moveaxis(bands[[2, 1, 0]], 0, -1)
    output = np.zeros_like(rgb, dtype=np.uint8)
    for channel in range(3):
        values = rgb[..., channel]
        finite = values[np.isfinite(values)]
        if finite.size == 0:
            continue
        low, high = np.percentile(finite, [2, 98])
        if high <= low:
            continue
        output[..., channel] = np.clip(
            (values - low) / (high - low) * 255,
            0,
            255,
        ).astype(np.uint8)
    return output


def metrics(pred: np.ndarray, truth: np.ndarray, pixel_size: float):
    valid = truth != -1
    p = pred[valid]
    t = truth[valid]
    if not np.all(np.isin(t, [0, 1])):
        raise RuntimeError("ground-truth mask contains values other than -1, 0, 1")

    tp = int(np.sum((p == 1) & (t == 1)))
    tn = int(np.sum((p == 0) & (t == 0)))
    fp = int(np.sum((p == 1) & (t == 0)))
    fn = int(np.sum((p == 0) & (t == 1)))
    union = tp + fp + fn
    predicted_positive = tp + fp
    actual_positive = tp + fn
    valid_count = tp + tn + fp + fn
    pixel_hectares = pixel_size * pixel_size / 10000

    return {
        "validPixels": valid_count,
        "burnPixelsGroundTruth": actual_positive,
        "burnPixelsPredicted": predicted_positive,
        "truePositive": tp,
        "trueNegative": tn,
        "falsePositive": fp,
        "falseNegative": fn,
        "iou": tp / union if union else 1.0,
        "precision": (
            tp / predicted_positive
            if predicted_positive
            else (1.0 if actual_positive == 0 else 0.0)
        ),
        "recall": tp / actual_positive if actual_positive else 1.0,
        "f1": (2 * tp / (2 * tp + fp + fn)) if (2 * tp + fp + fn) else 1.0,
        "accuracy": (tp + tn) / valid_count if valid_count else 0.0,
        "groundTruthHectares": actual_positive * pixel_hectares,
        "predictedHectares": predicted_positive * pixel_hectares,
    }


def color_mask(code: np.ndarray) -> np.ndarray:
    # visualization palette:
    # correct non-burn dark, TP green, FP amber, FN magenta, missing gray
    out = np.zeros((*code.shape, 3), dtype=np.uint8)
    out[code == -1] = (110, 110, 110)
    out[code == 0] = (20, 20, 20)
    out[code == 1] = (40, 200, 80)
    out[code == 2] = (240, 170, 40)
    out[code == 3] = (220, 60, 180)
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("image", type=Path)
    parser.add_argument("mask", type=Path)
    parser.add_argument("--threshold", type=float, default=0.0)
    parser.add_argument("--output-json", type=Path)
    parser.add_argument("--output-png", type=Path)
    parser.add_argument("--scene-id")
    args = parser.parse_args()

    if not -1 <= args.threshold <= 1:
        raise SystemExit("--threshold must be between -1 and 1")

    with rasterio.open(args.image) as src:
        bands = src.read().astype(np.float32)
        transform = src.transform
        crs = str(src.crs) if src.crs else None

    with rasterio.open(args.mask) as src:
        truth = src.read(1).astype(np.int16)

    if bands.shape[0] != 6:
        raise RuntimeError(f"expected six HLS bands, got {bands.shape}")
    if bands.shape[1:] != truth.shape:
        raise RuntimeError("image and mask dimensions do not align")

    nir = bands[3]
    swir2 = bands[5]
    denominator = nir + swir2
    nbr = np.divide(
        nir - swir2,
        denominator,
        out=np.full_like(nir, np.nan),
        where=(denominator != 0) & np.isfinite(denominator),
    )
    pred = (np.isfinite(nbr) & (nbr < args.threshold)).astype(np.int16)

    pixel_size_x = abs(float(transform.a))
    pixel_size_y = abs(float(transform.e))
    pixel_size = math.sqrt(pixel_size_x * pixel_size_y)

    measured = metrics(pred, truth, pixel_size)

    scene_id = args.scene_id or args.image.name.replace("_merged.tif", "")
    report = {
        "schemaVersion": "climatechain.hls-burn-scar-smoke/0.1",
        "sceneId": scene_id,
        "source": {
            "dataset": "ibm-nasa-geospatial/hls_burn_scars",
            "doi": "10.57967/hf/0956",
            "license": "CC-BY-4.0",
            "imageSha256": sha256(args.image),
            "maskSha256": sha256(args.mask),
            "crs": crs,
            "width": int(truth.shape[1]),
            "height": int(truth.shape[0]),
            "pixelSizeMetersApprox": pixel_size,
        },
        "baseline": {
            "method": "NBR threshold",
            "formula": "(NIR - SWIR2) / (NIR + SWIR2)",
            "bands": {"nir": "B8A/channel-4", "swir2": "B12/channel-6"},
            "threshold": args.threshold,
            "metrics": measured,
        },
        "publishedPrithviReference": {
            "model": "ibm-nasa-geospatial/Prithvi-EO-1.0-100M-burn-scar",
            "burnClassIoU": 0.73,
            "overallAccuracy": 0.96,
            "locallyReproduced": False,
        },
        "limitation": (
            "This scene-level NBR result is a transparent baseline. "
            "The source dataset uses a random train/validation split and "
            "does not by itself demonstrate held-out geographic generalisation."
        ),
    }

    if args.output_png:
        valid = truth != -1
        overlay_code = np.zeros_like(truth, dtype=np.int8)
        overlay_code[~valid] = -1
        overlay_code[valid & (truth == 1) & (pred == 1)] = 1
        overlay_code[valid & (truth == 0) & (pred == 1)] = 2
        overlay_code[valid & (truth == 1) & (pred == 0)] = 3

        rgb = Image.fromarray(scale_rgb(bands), mode="RGB")
        overlay = Image.fromarray(color_mask(overlay_code), mode="RGB")
        mask_rgb = np.zeros((*truth.shape, 3), dtype=np.uint8)
        mask_rgb[truth == 1] = (255, 255, 255)
        mask_rgb[truth == -1] = (110, 110, 110)
        gt = Image.fromarray(mask_rgb, mode="RGB")

        gap = 8
        label_height = 32
        canvas = Image.new(
            "RGB",
            (
                rgb.width * 3 + gap * 2,
                rgb.height + label_height,
            ),
            "white",
        )
        canvas.paste(rgb, (0, label_height))
        canvas.paste(gt, (rgb.width + gap, label_height))
        canvas.paste(overlay, (rgb.width * 2 + gap * 2, label_height))
        draw = ImageDraw.Draw(canvas)
        draw.text((4, 8), "HLS RGB", fill="black")
        draw.text((rgb.width + gap + 4, 8), "Ground truth", fill="black")
        draw.text(
            (rgb.width * 2 + gap * 2 + 4, 8),
            "NBR: green TP / amber FP / magenta FN",
            fill="black",
        )
        args.output_png.parent.mkdir(parents=True, exist_ok=True)
        canvas.save(args.output_png)
        report["visualComparison"] = str(args.output_png)

    rendered = json.dumps(report, indent=2)
    if args.output_json:
        args.output_json.parent.mkdir(parents=True, exist_ok=True)
        args.output_json.write_text(rendered + "\n")
    print("CLIMATECHAIN_HLS_BURN_SCAR=" + json.dumps(report))


if __name__ == "__main__":
    main()
