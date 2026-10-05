import assert from "node:assert/strict";
import test from "node:test";

import {
  createEvidenceRoot,
  verifyEvidenceRoot,
} from "@climatechain/core";
import {
  InMemoryNodeCryptoProvider,
} from "@climatechain/crypto-node";

import {
  EarthObservationService,
  buildBurnScarCase,
  buildBurnScarOverlay,
  calculateBurnScarMetrics,
  createEarthObservationModule,
  digestBurnScarGroundTruth,
  digestBurnScarImage,
  digestBurnScarPrediction,
  normalizedBurnRatio,
  runNbrBurnScarDetector,
} from "../src/index.js";
import type {
  BurnScarScene,
  PublishedBurnScarReference,
} from "../src/index.js";

function scene(): BurnScarScene {
  // 4x3 toy scene:
  // low/negative NBR = burn, high NBR = not burned.
  return {
    sceneId: "HLS.S30.T10SEH.2018190.v1.4",
    width: 4,
    height: 3,
    pixelSizeMeters: 30,
    bands: {
      blue:  Array(12).fill(0.05),
      green: Array(12).fill(0.08),
      red:   Array(12).fill(0.10),
      nir:   [0.1,0.7,0.1,0.7, 0.1,0.7,0.7,0.1, 0.7,0.1,0.7,0.2],
      swir1: Array(12).fill(0.3),
      swir2: [0.5,0.2,0.5,0.2, 0.5,0.2,0.2,0.5, 0.2,0.5,0.2,0.4],
    },
    groundTruth: [1,0,1,0, 1,0,-1,1, 0,1,0,1],
    source: {
      dataset: "hls_burn_scars",
      uri: "https://huggingface.co/datasets/ibm-nasa-geospatial/hls_burn_scars",
      sourceManifestId: "hls-burn-scars",
      acquiredAt: "2018-07-09T00:00:00Z",
      geography: "HLS tile T10SEH, continental United States",
    },
  };
}

const reference: PublishedBurnScarReference = {
  model: "ibm-nasa-geospatial/Prithvi-EO-1.0-100M-burn-scar",
  dataset: "ibm-nasa-geospatial/hls_burn_scars",
  burnClassIoU: 0.73,
  overallAccuracy: 0.96,
  source: "https://huggingface.co/ibm-nasa-geospatial/Prithvi-EO-1.0-100M-burn-scar",
  locallyReproduced: false,
};

test("NBR uses NIR and SWIR2 in the documented order", () => {
  // (NIR - SWIR2) / (NIR + SWIR2); compared with a tolerance, since floating point cannot hit 0.5 or -2/3 exactly.
  assert.ok(Math.abs(normalizedBurnRatio(0.6, 0.2) - 0.5) < 1e-12);
  assert.ok(Math.abs(normalizedBurnRatio(0.1, 0.5) - -2 / 3) < 1e-12);
  assert.ok(normalizedBurnRatio(0.2, 0.6) < 0, "SWIR2 above NIR (burnt) must be negative");
});

test("CPU NBR baseline ignores no-data labels and reports hectares", () => {
  const result = runNbrBurnScarDetector({ scene: scene(), threshold: 0 });

  assert.equal(result.metrics.validPixels, 11);
  assert.equal(result.metrics.truePositive, 6);
  assert.equal(result.metrics.falsePositive, 0);
  assert.equal(result.metrics.falseNegative, 0);
  assert.equal(result.metrics.iou, 1);
  assert.equal(result.metrics.precision, 1);
  assert.equal(result.metrics.recall, 1);
  assert.equal(result.metrics.f1, 1);
  assert.equal(result.metrics.groundTruthHectares, 0.54);
  assert.equal(result.metrics.predictedHectares, 0.54);
});

test("metric implementation distinguishes false burn and missed burn", () => {
  const metrics = calculateBurnScarMetrics(
    [1, 1, 0, 0],
    [1, 0, 1, -1],
    30,
  );

  assert.equal(metrics.validPixels, 3);
  assert.equal(metrics.truePositive, 1);
  assert.equal(metrics.falsePositive, 1);
  assert.equal(metrics.falseNegative, 1);
  assert.equal(metrics.iou, 1 / 3);
  assert.equal(metrics.precision, 0.5);
  assert.equal(metrics.recall, 0.5);
  assert.equal(metrics.f1, 0.5);
});

test("overlay encodes TP FP FN and missing separately", () => {
  const input = scene();
  const result = runNbrBurnScarDetector({ scene: input, threshold: 0 });
  const overlay = buildBurnScarOverlay(input, result);

  assert.equal(overlay.width, 4);
  assert.equal(overlay.height, 3);
  assert.equal(overlay.pixels[6], -1);
  assert.equal(overlay.pixels[0], 1);
  assert.equal(overlay.pixels[1], 0);
});

test("imagery and ground-truth labels have independent digests", async () => {
  const provider = new InMemoryNodeCryptoProvider();
  const original = scene();
  const originalImage = await digestBurnScarImage(original, provider);
  const originalLabels = await digestBurnScarGroundTruth(original, provider);

  const changedLabels = structuredClone(original);
  changedLabels.groundTruth[0] = 0;

  assert.deepEqual(
    await digestBurnScarImage(changedLabels, provider),
    originalImage,
  );
  assert.notDeepEqual(
    await digestBurnScarGroundTruth(changedLabels, provider),
    originalLabels,
  );

  const changedImage = structuredClone(original);
  changedImage.bands.nir[0] = 0.9;

  assert.notDeepEqual(
    await digestBurnScarImage(changedImage, provider),
    originalImage,
  );
  assert.deepEqual(
    await digestBurnScarGroundTruth(changedImage, provider),
    originalLabels,
  );
});

test("source tamper changes current Earth-observation evidence root", async () => {
  const provider = new InMemoryNodeCryptoProvider();
  const cleanScene = scene();
  const cleanResult = runNbrBurnScarDetector({
    scene: cleanScene,
    threshold: 0,
  });
  const cleanCase = buildBurnScarCase({
    caseId: "case:earth:test",
    createdAt: "2026-09-29T00:00:00Z",
    scene: cleanScene,
    imageDigest: await digestBurnScarImage(cleanScene, provider),
    groundTruthDigest: await digestBurnScarGroundTruth(cleanScene, provider),
    predictionDigest: await digestBurnScarPrediction(cleanResult, provider),
    result: cleanResult,
    publishedReference: reference,
  });
  const root = await createEvidenceRoot(
    cleanCase,
    [{ nodeType: "verification", id: "verification:burn-scar" }],
    provider,
  );

  const changed = scene();
  changed.bands.nir[0] = 0.95;
  const changedResult = runNbrBurnScarDetector({
    scene: changed,
    threshold: 0,
  });
  const changedCase = buildBurnScarCase({
    caseId: "case:earth:test",
    createdAt: "2026-09-29T00:00:00Z",
    scene: changed,
    imageDigest: await digestBurnScarImage(changed, provider),
    groundTruthDigest: await digestBurnScarGroundTruth(changed, provider),
    predictionDigest: await digestBurnScarPrediction(changedResult, provider),
    result: changedResult,
    publishedReference: reference,
  });

  const verification = await verifyEvidenceRoot(
    changedCase,
    root,
    provider,
  );

  assert.equal(verification.currentEvidenceMatches, false);
  assert.ok(
    verification.changedRefs.some(
      (ref) => ref.id === "evidence:hls-image",
    ),
  );
});

test("Earth WebMCP module routes all three tools through one service", async () => {
  const provider = new InMemoryNodeCryptoProvider();
  const service = new EarthObservationService({
    caseId: "case:earth:test",
    scene: scene(),
    provider,
    threshold: 0,
    publishedReference: reference,
  });
  const module = createEarthObservationModule(service);

  assert.deepEqual(
    module.tools.map((tool) => tool.name).sort(),
    [
      "earth_compare_ground_truth",
      "earth_get_scene_provenance",
      "earth_run_detector",
    ],
  );

  const detector = await service.execute(
    "earth-observation",
    "earth_run_detector",
    { caseId: "case:earth:test" },
  ) as { metrics: { iou: number }; outputDigest: { value: string } };

  assert.equal(detector.metrics.iou, 1);
  assert.ok(detector.outputDigest.value.length > 0);

  const comparison = await service.execute(
    "earth-observation",
    "earth_compare_ground_truth",
    { caseId: "case:earth:test" },
  ) as {
    publishedReference: PublishedBurnScarReference;
    limitations: string[];
  };

  assert.equal(comparison.publishedReference.burnClassIoU, 0.73);
  assert.equal(comparison.publishedReference.locallyReproduced, false);
  assert.ok(
    comparison.limitations.some((item) =>
      item.includes("geographic"),
    ),
  );
});
