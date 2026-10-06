// The earth case: the NBR burn-scar baseline recomputed from the committed HLS scene arrays and checked against
// the pinned Python run, then the detected area compared with the labelled area. When they disagree by more than
// the policy's tolerance, a person decides which area the claim may rest on.
import {
  canonicalBytes,
  CLIMATECHAIN_SCHEMA_VERSION,
  reviewStatuses,
  reviewVerification,
} from "@climatechain/core";
import type {
  ClimateCaseBundle,
  ContentDigest,
  CryptoProvider,
  ReviewDecision,
  ReviewFlag,
  ReviewStatus,
} from "@climatechain/core";

import { runNbrBurnScarDetector } from "./detector.js";
import type { BurnScarDetectionResult, BurnScarMetrics } from "./types.js";

/** The detector's inputs as committed: two HLS bands and the label mask, row-major. */
export interface HlsSceneArrays {
  sceneId: string;
  width: number;
  height: number;
  pixelSizeMeters: number;
  nir: Float32Array;
  swir2: Float32Array;
  mask: Int8Array;
  acquiredAt?: string;
  geography?: string;
}

export interface AreaPolicy {
  /** NBR below this is burned. */
  threshold: number;
  /** Largest relative difference between detected and labelled area accepted without a person. */
  areaTolerance: number;
}

/** "labelled": the claim reports the labelled area. "detected-with-gap": the detected area, with the gap stated. */
export type AreaDecision = "labelled" | "detected-with-gap" | "hold";

const COUNTS = ["validPixels", "truePositive", "trueNegative", "falsePositive", "falseNegative"] as const;

export function areaFlag(): ReviewFlag {
  return { id: "area:detected-vs-labelled", label: "Detected burn area differs from the labelled area" };
}

const bytesOf = (array: Float32Array | Int8Array) =>
  new Uint8Array(array.buffer, array.byteOffset, array.byteLength);

/** SHA-256 of each committed array's bytes, the same bytes as the files in data/external/hls-burn-scars. */
export async function digestSceneArrays(scene: HlsSceneArrays, provider: CryptoProvider) {
  const [nir, swir2, mask] = await Promise.all([
    provider.hash(bytesOf(scene.nir), "SHA-256"),
    provider.hash(bytesOf(scene.swir2), "SHA-256"),
    provider.hash(bytesOf(scene.mask), "SHA-256"),
  ]);
  return { nir, swir2, mask };
}

export async function buildEarthReviewCase(options: {
  caseId: string;
  createdAt: string;
  scene: HlsSceneArrays;
  /** Metrics of the pinned Python run on the original TIFFs. */
  pinned: BurnScarMetrics;
  policy: AreaPolicy;
  provider: CryptoProvider;
  decisions?: readonly ReviewDecision[];
  publishedPrithviIoU?: number;
}): Promise<{
  caseBundle: ClimateCaseBundle;
  result: BurnScarDetectionResult;
  reproduced: boolean;
  areaGap: number;
  review: ReviewStatus[];
  reviewInputDigest: ContentDigest;
}> {
  const { scene, createdAt, provider, policy } = options;
  const count = scene.width * scene.height;
  const empty = new Array<number>(count).fill(0);
  // The detector reads NIR and SWIR2 only; the other bands are not committed.
  const result = runNbrBurnScarDetector({
    scene: {
      sceneId: scene.sceneId,
      width: scene.width,
      height: scene.height,
      pixelSizeMeters: scene.pixelSizeMeters,
      bands: { blue: empty, green: empty, red: empty, nir: Array.from(scene.nir), swir1: empty, swir2: Array.from(scene.swir2) },
      groundTruth: Array.from(scene.mask),
      source: { dataset: "hls_burn_scars", uri: "https://huggingface.co/datasets/ibm-nasa-geospatial/hls_burn_scars", sourceManifestId: "hls-burn-scars" },
    },
    threshold: policy.threshold,
  });
  const m = result.metrics;
  // Pixel counts must match the pinned run exactly; ratios follow from them.
  const reproduced = COUNTS.every((key) => m[key] === options.pinned[key]);
  const digests = await digestSceneArrays(scene, provider);
  const predictionDigest = await provider.hash(Uint8Array.from(result.prediction), "SHA-256");
  const areaGap = m.groundTruthHectares === 0 ? 0 : (m.predictedHectares - m.groundTruthHectares) / m.groundTruthHectares;
  const reviewInputDigest = await provider.hash(canonicalBytes({ ...digests, policy }), "SHA-256");
  const flags = Math.abs(areaGap) > policy.areaTolerance ? [areaFlag()] : [];
  const review = reviewStatuses(flags, options.decisions ?? [], reviewInputDigest);
  const decision = review[0]?.state === "decided" ? (review[0].decision?.decision as AreaDecision) : undefined;
  const decided = review.every((status) => status.state === "decided");
  const pixelHa = scene.pixelSizeMeters ** 2 / 10_000;
  const missed = m.falseNegative * pixelHa;
  const reported =
    flags.length === 0 || decision === "detected-with-gap"
      ? m.predictedHectares
      : decision === "labelled"
        ? m.groundTruthHectares
        : undefined;
  const result_ = !reproduced ? "mismatch" : decided && decision !== "hold" ? "reconciled" : "insufficient-evidence";
  const pct = (value: number) => (value * 100).toFixed(1) + "%";
  const ha = (value: number) => Math.round(value).toLocaleString("en-US") + " ha";
  const ids = {
    nir: "evidence:hls-nir",
    swir2: "evidence:hls-swir2",
    mask: "evidence:burn-mask",
    pinned: "evidence:python-run",
    run: "model-run:nbr-burn-scar",
    claim: "claim:burn-scar-area",
    verification: "verification:burn-scar",
    review: "verification:area-decision",
  };
  const band = (id: string, label: string, integrity: ContentDigest, file: string) => ({
    nodeType: "evidence" as const,
    id,
    createdAt,
    provenance: [],
    kind: id === ids.mask ? ("dataset" as const) : ("satellite-image" as const),
    source: {
      uri: "https://huggingface.co/datasets/ibm-nasa-geospatial/hls_burn_scars",
      localRef: "data/external/hls-burn-scars/" + scene.sceneId + "/" + file,
      publisher: id === ids.mask ? "IBM/NASA Geospatial; labels derived from MTBS" : "IBM/NASA Geospatial; HLS imagery",
      retrievedAt: createdAt,
    },
    integrity,
    access: { mode: "committed" as const, instructions: label },
    rights: {
      sourceManifestId: "hls-burn-scars",
      licence: "CC-BY-4.0",
      redistribution: "allowed" as const,
      commercialUse: "allowed" as const,
      derivedData: "allowed" as const,
      attribution: "HLS Burn Scar Scenes, IBM/NASA Geospatial (doi:10.57967/hf/0956), CC BY 4.0; HLS and MTBS provenance retained.",
    },
  });

  const caseBundle: ClimateCaseBundle = {
    schemaVersion: CLIMATECHAIN_SCHEMA_VERSION,
    caseId: options.caseId,
    title: "HLS burn-scar area — " + scene.sceneId,
    capabilities: ["earth-observation", "claim-reconciliation", "pq-attestation"],
    createdAt,
    claims: [
      {
        nodeType: "claim",
        id: ids.claim,
        createdAt,
        provenance: [
          { nodeType: "model-run", id: ids.run, role: "detected-by" },
          { nodeType: "verification", id: ids.review, role: "area-decision" },
        ],
        subject: { id: "scene:" + scene.sceneId, kind: "area", name: scene.geography ?? scene.sceneId },
        assertion:
          reported === undefined
            ? { kind: "qualitative", statement: "Burn-scar area not stated: detected and labelled areas disagree and no current decision says which to use." }
            : {
                kind: "quantitative",
                metric: "Burn-scar area",
                quantity: {
                  value: reported,
                  unit: "ha",
                  ...(decision === "detected-with-gap"
                    ? { uncertainty: { kind: "other" as const, note: "Lower bound: " + pct(-areaGap) + " below the labelled " + ha(m.groundTruthHectares) + "." } }
                    : {}),
                },
              },
        ...(scene.acquiredAt ? { temporalScope: { start: scene.acquiredAt, end: scene.acquiredAt } } : {}),
        ...(scene.geography ? { spatialScope: { label: scene.geography } } : {}),
        boundary: {
          methodology: "NBR = (NIR - SWIR2) / (NIR + SWIR2) on HLS reflectance; a pixel is burned when NBR < " + policy.threshold + ".",
          accounting: {
            included: [
              "The " + m.validPixels.toLocaleString("en-US") + " labelled pixels of one " + scene.width + "×" + scene.height + " HLS subset",
              "One pixel = " + pixelHa + " ha",
            ],
            excluded: ["No-data pixels (mask -1)", "Land outside the subset, and the rest of the fire"],
            policyChoices: [
              "NBR threshold " + policy.threshold,
              "Area tolerance " + pct(policy.areaTolerance) + " between detected and labelled area before a person decides",
              ...(decision ? ["Area reported: " + decision] : []),
            ],
            notAssessed: [
              "Burn severity, emissions from the fire and carbon lost",
              "Accuracy on other scenes: the dataset's split is random, not held out by place or fire",
            ],
          },
        },
        assessments: [
          { dimension: "source-found", state: "confirmed", assessedAt: createdAt },
          { dimension: "calculation-reproduced", state: reproduced ? "confirmed" : "failed", assessedAt: createdAt },
          { dimension: "evidence-integrity-confirmed", state: "confirmed", assessedAt: createdAt },
        ],
      },
    ],
    evidence: [
      band(ids.nir, "data/external/hls-burn-scars/" + scene.sceneId + "/nir.f32", digests.nir, "nir.f32"),
      band(ids.swir2, "data/external/hls-burn-scars/" + scene.sceneId + "/swir2.f32", digests.swir2, "swir2.f32"),
      band(ids.mask, "data/external/hls-burn-scars/" + scene.sceneId + "/mask.i8", digests.mask, "mask.i8"),
      {
        nodeType: "evidence",
        id: ids.pinned,
        createdAt,
        provenance: [],
        kind: "report",
        source: { localRef: "reports/earth-observation/t10seh-2018190-nbr.json", publisher: "ClimateChain CI (Python, rasterio)", retrievedAt: createdAt },
        integrity: await provider.hash(canonicalBytes(options.pinned as unknown as Record<string, number>), "SHA-256"),
        access: { mode: "committed", instructions: "reports/earth-observation/t10seh-2018190-nbr.json" },
      },
    ],
    calculations: [],
    factors: [],
    modelRuns: [
      {
        nodeType: "model-run",
        id: ids.run,
        createdAt,
        provenance: [
          { nodeType: "evidence", id: ids.nir, role: "detector-input" },
          { nodeType: "evidence", id: ids.swir2, role: "detector-input" },
          { nodeType: "evidence", id: ids.mask, role: "evaluation-ground-truth" },
        ],
        model: { id: "nbr-threshold", name: "Normalized Burn Ratio threshold baseline", version: "earth-observation/0.2" },
        inputDigest: await provider.hash(canonicalBytes({ nir: digests.nir, swir2: digests.swir2 }), "SHA-256"),
        preprocessingVersion: "HLS reflectance; NIR = B8A (channel 4), SWIR2 = B12 (channel 6)",
        inferenceParameters: { threshold: policy.threshold, formula: result.provenance.bandFormula, ignoredGroundTruthValue: -1 },
        output: { kind: "quantitative", metric: "Detected burn area", quantity: { value: m.predictedHectares, unit: "ha" } },
        benchmark: {
          metric: "Burn-class IoU",
          value: m.iou,
          ...(options.publishedPrithviIoU !== undefined ? { baselineValue: options.publishedPrithviIoU } : {}),
          notes: "baselineValue is Prithvi's published IoU over the validation set, not reproduced here and not for this scene.",
        },
        executedAt: createdAt,
        reproducibility: { codeVersion: "earth-observation/0.2" },
        extensions: {
          predictionDigestAlgorithm: predictionDigest.algorithm,
          predictionDigestValue: predictionDigest.value,
          ...Object.fromEntries(COUNTS.map((key) => [key, m[key]])),
          precision: m.precision,
          recall: m.recall,
          labelledHectares: m.groundTruthHectares,
        },
      },
    ],
    verifications: [
      {
        nodeType: "verification",
        id: ids.verification,
        createdAt,
        provenance: [
          { nodeType: "claim", id: ids.claim, role: "claim-under-review" },
          { nodeType: "evidence", id: ids.pinned, role: "pinned-run" },
          { nodeType: "verification", id: ids.review, role: "human-decisions" },
        ],
        verifier: { id: "service:climatechain-earth-observation", kind: "service", name: "ClimateChain Earth Observation" },
        profile: "earth-observation/0.2",
        result: result_,
        checks: [
          {
            id: "baseline-reproduced",
            name: "Pixel counts match the pinned Python run on the original TIFFs",
            outcome: reproduced ? "pass" : "fail",
            detail: COUNTS.map((key) => key + " " + m[key] + (m[key] === options.pinned[key] ? "" : " (pinned " + options.pinned[key] + ")")).join("; "),
          },
          {
            id: "area-agreement",
            name: "Detected area within " + pct(policy.areaTolerance) + " of the labelled area",
            outcome: flags.length === 0 ? "pass" : "warn",
            detail:
              "detected " + ha(m.predictedHectares) + ", labelled " + ha(m.groundTruthHectares) + " (" +
              (areaGap >= 0 ? "+" : "") + pct(areaGap) + "); missed " + ha(missed) + ", false burn " +
              ha(m.falsePositive * pixelHa),
          },
          {
            id: "area-decision",
            name: "A person decided which area the claim reports",
            outcome: flags.length === 0 || (decided && decision !== "hold") ? "pass" : "warn",
            detail:
              flags.length === 0
                ? "Within tolerance; no decision needed."
                : review[0]?.state === "decided"
                  ? decision + " by " + review[0].decision?.decidedBy + ": " + review[0].decision?.reason
                  : review[0]?.state === "stale"
                    ? "The decision was made on different arrays or policy."
                    : "No decision yet.",
          },
        ],
        findings: [
          "NBR thresholding is a transparent CPU baseline, not Prithvi inference.",
          "The labels are MTBS-derived and are treated as the reference, not as ground truth checked on site.",
        ],
        verifiedAt: createdAt,
      },
      reviewVerification({
        id: ids.review,
        profile: "earth-observation/area-decision/0.1",
        statuses: review,
        flagSource: { nodeType: "model-run", id: ids.run, role: "flag-source" },
        adviceRefs: [],
        createdAt,
        staleNote: "Stale: made on different scene arrays or policy. ",
        findings: ["A decision records which area the claim reports, not why the detector missed burned pixels."],
      }),
    ],
    attestations: [],
    anchors: [],
  };
  return { caseBundle, result, reproduced, areaGap, review, reviewInputDigest };
}
