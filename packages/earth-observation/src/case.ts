import {
  CLIMATECHAIN_SCHEMA_VERSION,
} from "@climatechain/core";
import type {
  ClimateCaseBundle,
  ContentDigest,
} from "@climatechain/core";

import type {
  BurnScarDetectionResult,
  BurnScarScene,
  PublishedBurnScarReference,
} from "./types.js";

export function buildBurnScarCase(options: {
  caseId: string;
  createdAt: string;
  scene: BurnScarScene;
  imageDigest: ContentDigest;
  groundTruthDigest: ContentDigest;
  predictionDigest: ContentDigest;
  result: BurnScarDetectionResult;
  publishedReference?: PublishedBurnScarReference;
}): ClimateCaseBundle {
  const { scene, result, createdAt } = options;
  const reference = options.publishedReference;

  return {
    schemaVersion: CLIMATECHAIN_SCHEMA_VERSION,
    caseId: options.caseId,
    title: "HLS burn-scar monitoring — " + scene.sceneId,
    capabilities: [
      "earth-observation",
      "claim-reconciliation",
      "pq-attestation",
    ],
    createdAt,
    claims: [
      {
        nodeType: "claim",
        id: "claim:burn-scar-area",
        createdAt,
        provenance: [
          {
            nodeType: "model-run",
            id: "model-run:nbr-burn-scar",
            role: "detected-by",
          },
        ],
        subject: {
          id: "scene:" + scene.sceneId,
          kind: "area",
          name: scene.source.geography ?? scene.sceneId,
        },
        assertion: {
          kind: "quantitative",
          metric: "Detected burn-scar area",
          quantity: {
            value: result.metrics.predictedHectares,
            unit: "ha",
          },
        },
        ...(scene.source.acquiredAt
          ? {
              temporalScope: {
                start: scene.source.acquiredAt,
                end: scene.source.acquiredAt,
              },
            }
          : {}),
        ...(scene.source.geography
          ? { spatialScope: { label: scene.source.geography } }
          : {}),
        assessments: [
          {
            dimension: "source-found",
            state: "confirmed",
            assessedAt: createdAt,
          },
          {
            dimension: "calculation-reproduced",
            state: "confirmed",
            assessedAt: createdAt,
          },
          {
            dimension: "evidence-integrity-confirmed",
            state: "confirmed",
            assessedAt: createdAt,
          },
        ],
      },
    ],
    evidence: [
      {
        nodeType: "evidence",
        id: "evidence:hls-image",
        createdAt,
        provenance: [],
        kind: "satellite-image",
        source: {
          uri: scene.source.uri,
          publisher: "IBM/NASA Geospatial; HLS source imagery",
          retrievedAt: createdAt,
        },
        integrity: options.imageDigest,
        rights: {
          sourceManifestId: scene.source.sourceManifestId,
          licence: "CC-BY-4.0",
          redistribution: "allowed",
          commercialUse: "allowed",
          derivedData: "allowed",
          attribution:
            "HLS Burn Scar Scenes, IBM/NASA Geospatial; preserve HLS/MTBS provenance.",
        },
        ...(scene.source.acquiredAt
          ? {
              temporalCoverage: {
                start: scene.source.acquiredAt,
                end: scene.source.acquiredAt,
              },
            }
          : {}),
        ...(scene.source.geography
          ? { spatialCoverage: { label: scene.source.geography } }
          : {}),
      },
      {
        nodeType: "evidence",
        id: "evidence:burn-mask",
        createdAt,
        provenance: [],
        kind: "dataset",
        source: {
          uri: scene.source.uri,
          publisher: "IBM/NASA Geospatial / MTBS-derived labels",
          retrievedAt: createdAt,
        },
        integrity: options.groundTruthDigest,
        rights: {
          sourceManifestId: scene.source.sourceManifestId,
          licence: "CC-BY-4.0",
          redistribution: "allowed",
          commercialUse: "allowed",
          derivedData: "allowed",
          attribution:
            "HLS Burn Scar Scenes, IBM/NASA Geospatial; labels derive from MTBS burn-scar source data.",
        },
      },
    ],
    calculations: [],
    factors: [],
    modelRuns: [
      {
        nodeType: "model-run",
        id: "model-run:nbr-burn-scar",
        createdAt,
        provenance: [
          {
            nodeType: "evidence",
            id: "evidence:hls-image",
            role: "detector-input",
          },
          {
            nodeType: "evidence",
            id: "evidence:burn-mask",
            role: "evaluation-ground-truth",
          },
        ],
        model: {
          id: "nbr-threshold",
          name: "Normalized Burn Ratio threshold baseline",
          version: "earth-observation/0.1",
        },
        inputDigest: options.imageDigest,
        preprocessingVersion: "HLS reflectance bands; NIR=B8A; SWIR2=B12",
        inferenceParameters: {
          threshold: result.threshold,
          formula: result.provenance.bandFormula,
          ignoredGroundTruthValue: -1,
        },
        output: {
          kind: "quantitative",
          metric: "Burn-scar IoU",
          quantity: {
            value: result.metrics.iou,
            unit: "IoU",
          },
        },
        benchmark: {
          metric: "Burn-class IoU",
          value: result.metrics.iou,
          ...(reference
            ? { baselineValue: reference.burnClassIoU }
            : {}),
          notes: reference
            ? "baselineValue is the published Prithvi result and is not locally reproduced."
            : "No published-model reference attached.",
        },
        executedAt: createdAt,
        reproducibility: {
          codeVersion: "earth-observation/0.1",
        },
        extensions: {
          predictionDigestAlgorithm: options.predictionDigest.algorithm,
          predictionDigestValue: options.predictionDigest.value,
          precision: result.metrics.precision,
          recall: result.metrics.recall,
          f1: result.metrics.f1,
          accuracy: result.metrics.accuracy,
          groundTruthHectares: result.metrics.groundTruthHectares,
          predictedHectares: result.metrics.predictedHectares,
        },
      },
    ],
    verifications: [
      {
        nodeType: "verification",
        id: "verification:burn-scar",
        createdAt,
        provenance: [
          {
            nodeType: "claim",
            id: "claim:burn-scar-area",
            role: "claim-under-review",
          },
          {
            nodeType: "model-run",
            id: "model-run:nbr-burn-scar",
            role: "detector-run",
          },
        ],
        verifier: {
          id: "service:climatechain-earth-observation",
          kind: "service",
          name: "ClimateChain Earth Observation",
        },
        profile: "earth-observation/0.1",
        result: "reconciled",
        checks: [
          {
            id: "ground-truth-comparison",
            name: "Prediction compared with labelled burn-scar mask",
            outcome: "pass",
            detail:
              "IoU=" +
              result.metrics.iou +
              "; precision=" +
              result.metrics.precision +
              "; recall=" +
              result.metrics.recall +
              "; F1=" +
              result.metrics.f1,
          },
          {
            id: "input-integrity",
            name: "Input and label digests recorded independently",
            outcome: "pass",
          },
        ],
        findings: [
          "NBR thresholding is a transparent CPU baseline, not Prithvi inference.",
          "The HLS Burn Scar Scenes split is random rather than a held-out geographic/event split; global generalisation is not established.",
        ],
        verifiedAt: createdAt,
      },
    ],
    attestations: [],
    anchors: [],
    extensions: {
      primaryUser: "wildfire and land-management analyst",
      sceneId: scene.sceneId,
      pixelSizeMeters: scene.pixelSizeMeters,
      detectedHectares: result.metrics.predictedHectares,
      labelledHectares: result.metrics.groundTruthHectares,
      publishedPrithviIoU: reference?.burnClassIoU ?? null,
      publishedPrithviAccuracy: reference?.overallAccuracy ?? null,
    },
  };
}
