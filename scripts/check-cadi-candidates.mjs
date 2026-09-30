import { readFile } from "node:fs/promises";

const manifest = JSON.parse(
  await readFile("sources/cadi-candidates.json", "utf8"),
);

const errors = [];
if (manifest.schemaVersion !== "climatechain.cadi-candidates/0.1") {
  errors.push("Unsupported CaDI candidate manifest version.");
}
if ((manifest.candidates?.length ?? 0) < 5) {
  errors.push("At least five confirmed CaDI candidates are required.");
}

const ids = new Set();
for (const candidate of manifest.candidates ?? []) {
  if (ids.has(candidate.id)) {
    errors.push("Duplicate candidate id: " + candidate.id);
  }
  ids.add(candidate.id);

  if (candidate.confirmationStatus !== "confirmed-on-cadi") {
    errors.push(candidate.id + ": candidate is not confirmed on CaDI.");
  }
  if (!candidate.confirmationUrl || !candidate.underlyingSourceUrl) {
    errors.push(candidate.id + ": source URLs are incomplete.");
  }

  for (const claim of candidate.extractedClaims ?? []) {
    if (!Number.isFinite(claim.value) || claim.value < 0) {
      errors.push(candidate.id + ": invalid numeric claim.");
    }
    if (!claim.sourceUrl || !claim.sourceRetrievedAt) {
      errors.push(candidate.id + ": extracted claim lacks source metadata.");
    }
  }
}

if (!manifest.candidates.some((candidate) => candidate.numericClaimReady)) {
  errors.push("At least one candidate must have a usable numeric claim.");
}

if (errors.length) {
  console.error("CaDI candidate check failed:");
  for (const error of errors) console.error(" - " + error);
  process.exit(1);
}

console.log(
  "CaDI candidate manifest OK: " +
    manifest.candidates.length +
    " confirmed organisations; " +
    manifest.candidates.filter((item) => item.numericClaimReady).length +
    " numeric claim-ready.",
);
