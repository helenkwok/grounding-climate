import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const outputRoot = process.argv[2];
if (!outputRoot) {
  throw new Error(
    "Usage: node scripts/prepare-carbonplan-registry-fixtures.mjs <output-dir>",
  );
}

const COMMIT = "c34ec955df0988009ac14e8abd91013f3b03e4f5";
const REPOSITORY = "carbonplan/offsets-db-data";

const sources = [
  {
    registry: "american-carbon-registry",
    kind: "issuance",
    path: "tests/data/american-carbon-registry/issuances.csv",
    output: "acr-issuances.csv",
    gitBlobSha: "3209dc5cd5ad40e54d7dc040d4e6caf2014ae69f",
  },
  {
    registry: "american-carbon-registry",
    kind: "retirement",
    path: "tests/data/american-carbon-registry/retirements.csv",
    output: "acr-retirements.csv",
    gitBlobSha: "1388abca2ff4d83bd849010921582eed3fa72737",
  },
  {
    registry: "gold-standard",
    kind: "issuance",
    path: "tests/data/gold-standard/issuances.csv",
    output: "gold-standard-issuances.csv",
    gitBlobSha: "0bb24827b3f4ec6cc40b0ada761bba7f5dc56e8a",
  },
  {
    registry: "gold-standard",
    kind: "retirement",
    path: "tests/data/gold-standard/retirements.csv",
    output: "gold-standard-retirements.csv",
    gitBlobSha: "94281d0dee382a9175852f1a1c74a5134a97bd8d",
  },
  {
    registry: "climate-action-reserve",
    kind: "issuance",
    path: "tests/data/climate-action-reserve/issuances.csv",
    output: "car-issuances.csv",
    gitBlobSha: "7e480a2f7e390ef03459e19ec4c9626b4d927cb0",
  },
  {
    registry: "climate-action-reserve",
    kind: "retirement",
    path: "tests/data/climate-action-reserve/retirements.csv",
    output: "car-retirements.csv",
    gitBlobSha: "c53c0823ecf87be5c566a77753a56f6489450679",
  },
];

function gitBlobSha(bytes) {
  const prefix = Buffer.from("blob " + bytes.length + "\0");
  return createHash("sha1")
    .update(prefix)
    .update(bytes)
    .digest("hex");
}

await mkdir(outputRoot, { recursive: true });

const manifestSources = [];
for (const source of sources) {
  const uri =
    "https://raw.githubusercontent.com/" +
    REPOSITORY +
    "/" +
    COMMIT +
    "/" +
    source.path;
  console.log("Downloading " + uri);

  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error(
      "Download failed (" + response.status + "): " + uri,
    );
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const actualSha = gitBlobSha(bytes);
  if (actualSha !== source.gitBlobSha) {
    throw new Error(
      source.path +
        ": Git blob SHA mismatch, expected " +
        source.gitBlobSha +
        " got " +
        actualSha,
    );
  }

  await writeFile(path.join(outputRoot, source.output), bytes);
  manifestSources.push({
    registry: source.registry,
    kind: source.kind,
    uri,
    path: source.output,
    upstreamPath: source.path,
    gitBlobSha: source.gitBlobSha,
    commit: COMMIT,
    bytes: bytes.length,
  });

  console.log(
    source.output +
      ": git blob SHA OK (" +
      actualSha +
      "), bytes=" +
      bytes.length,
  );
}

const manifest = {
  schemaVersion: "climatechain.carbonplan-fixtures/0.1",
  repository: "https://github.com/" + REPOSITORY,
  commit: COMMIT,
  rightsManifestId: "carbonplan-offsets-data",
  note:
    "Runtime-only bounded CarbonPlan test fixture snapshot. ClimateChain does not commit these upstream registry bytes.",
  sources: manifestSources,
};

await writeFile(
  path.join(outputRoot, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);

console.log(
  "CLIMATECHAIN_CARBONPLAN_PREPARED=" + JSON.stringify(manifest),
);
