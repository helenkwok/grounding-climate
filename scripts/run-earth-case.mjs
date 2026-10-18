// The earth case end to end: committed HLS scene arrays -> NBR baseline checked against the pinned Python run ->
// detected area compared with the labelled area -> a person's decision on which area the claim reports ->
// attestation signed with Ed25519 and ML-DSA-65 -> verification with only the public keys -> the same check after
// a tamper.
//
//   node scripts/run-earth-case.mjs
//
// Decisions are written by a person in reports/earth-observation/area-decisions.json; the script prints a
// template when the area flag has no current decision.
import { readFile, writeFile } from "node:fs/promises";

import { openClimateRiskContext } from "@grounding-climate/core";
import { InMemoryNodeCryptoProvider } from "@grounding-climate/crypto-node";
import { buildEarthReviewCase } from "@grounding-climate/earth-observation";

import { loadHlsScene } from "./lib/hls-scene.mjs";
import { signCase, verificationSummary } from "./lib/attest.mjs";

const json = async (path, fallback) => {
  try {
    return JSON.parse(await readFile(new URL("../" + path, import.meta.url), "utf8"));
  } catch (error) {
    if (fallback !== undefined && error?.code === "ENOENT") return fallback;
    throw error;
  }
};
const DECISIONS = "reports/earth-observation/area-decisions.json";
const OUT = new URL("../reports/earth-observation/case-run.json", import.meta.url);
const SCENE = "T10SEH.2018190.v1";
const CASE_ID = "case:earth-observation:" + SCENE;

const { scene, manifest } = await loadHlsScene(SCENE);
const pinnedReport = await json("reports/earth-observation/t10seh-2018190-nbr.json");
const { policy } = await json("reports/earth-observation/area-policy.json");
const decisions = await json(DECISIONS, []);
const crypto = new InMemoryNodeCryptoProvider();
const createdAt = new Date().toISOString();
const ocr = await json("data/external/open-climate-risk/ocr-context.json");
const build = async (someScene) =>
  buildEarthReviewCase({
    caseId: CASE_ID,
    createdAt,
    scene: someScene,
    pinned: pinnedReport.baseline.metrics,
    policy,
    provider: crypto,
    decisions,
    publishedPrithviIoU: pinnedReport.publishedPrithviReference.burnClassIoU,
    context: [await openClimateRiskContext(ocr, "earthScene", createdAt, crypto)],
  });

const clean = await build(scene);
const open = clean.review.filter((status) => status.state !== "decided");
if (open.length > 0) {
  console.log("The area flag has no current decision. Template for " + DECISIONS + ":");
  console.log(JSON.stringify(open.map((status) => ({
    flagId: status.flag.id,
    decision: "labelled | detected-with-gap | hold",
    reason: "",
    decidedBy: "person:<your id>",
    decidedAt: "<ISO time>",
    inputDigest: clean.reviewInputDigest,
  })), null, 2));
}

const verification = clean.caseBundle.verifications[0];
const claim = clean.caseBundle.claims[0];
const { attestation, publishedKeys, verify } = await signCase({
  climateCase: clean.caseBundle,
  module: "earth-observation",
  statement:
    "Burn-scar baseline recomputed from the committed HLS scene arrays and checked against the pinned run. " +
    "Verification result at signing: " + verification.result + ".",
  claimRef: { nodeType: "claim", id: claim.id },
  verificationRef: { nodeType: "verification", id: verification.id },
  createdAt,
});

// Tamper: the first pixel both labelled and detected as burned gets NIR raised above SWIR2, so it reads unburned.
const index = clean.result.prediction.findIndex((value, i) => value === 1 && scene.mask[i] === 1);
const tamperedScene = { ...scene, nir: Float32Array.from(scene.nir) };
const from = tamperedScene.nir[index];
tamperedScene.nir[index] = scene.swir2[index] * 2;
const tampered = await build(tamperedScene);

const summary = (built, someVerification) => ({
  reproduced: built.reproduced,
  detectedHectares: built.result.metrics.predictedHectares,
  labelledHectares: built.result.metrics.groundTruthHectares,
  areaGap: built.areaGap,
  result: built.caseBundle.verifications[0].result,
  areaDecision: built.review.map(({ flag, state, decision }) => ({ flag: flag.id, state, decision: decision?.decision ?? null })),
  ...verificationSummary(someVerification),
});

const report = {
  schemaVersion: "grounding.earth-case-run/0.1",
  runAt: createdAt,
  organisingQuestion: "How much of this scene burned, and who decided which area the claim may report?",
  scene: { id: SCENE, files: manifest.files, sourceFiles: manifest.sourceFiles },
  policy,
  clean: summary(clean, await verify(clean.caseBundle)),
  tamper: { pixel: index, row: Math.floor(index / scene.width), column: index % scene.width, band: "nir", from, to: tamperedScene.nir[index], ...summary(tampered, await verify(tampered.caseBundle)) },
  publishedKeys,
  attestation,
  case: clean.caseBundle,
  limitations: [
    "Signing keys are generated for each run; they identify the run, not a person or an organisation.",
    "One scene; the dataset's split is random, so accuracy elsewhere is not established.",
    "NBR is a CPU baseline, not Prithvi; the labels are MTBS-derived, not checked on site.",
  ],
};
await writeFile(OUT, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ clean: report.clean, tamper: report.tamper }, null, 2));
