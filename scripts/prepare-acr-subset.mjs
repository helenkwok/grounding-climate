// Writes the ACR records ClimateChain commits: the American Carbon Registry issuance and retirement fixtures from
// CarbonPlan's OffsetsDB pipeline at a pinned commit, reduced to the columns the reconciliation reads. Beneficiary
// and account-holder names are left out: no check uses them, and some name individuals.
// It also writes projects.csv: the same fixture set's project list, fetched here at the pinned commit and checked
// against its Git blob SHA, reduced to the projects in the sample and to where each one is (state, country).
// Input: the directory written by prepare-carbonplan-registry-fixtures.mjs, which checks each file's Git blob SHA.
//   node scripts/prepare-acr-subset.mjs <prepared-dir>
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { csvObjects } from "../packages/carbon-registry/dist/src/csv.js";

const root = process.argv[2];
if (!root) throw new Error("Usage: node scripts/prepare-acr-subset.mjs <prepared-dir>");
const OUT = new URL("../data/external/acr-offsetsdb/", import.meta.url);
const COLUMNS = {
  issuance: ["Project ID", "Vintage", "Total Credits Issued", "Date Issued (GMT)"],
  retirement: ["Project ID", "Vintage", "Quantity of Credits", "Status Effective (GMT)", "Credit Serial Numbers", "Date Issued (GMT)"],
};
const PROJECTS = {
  path: "tests/data/american-carbon-registry/projects.csv",
  gitBlobSha: "1e1346bc8b2a4ce92bf18bf70f589cbc4379c405",
  columns: ["Project ID", "Project Name", "Project Type", "Project Site State", "Project Site Country"],
};
const cell = (value) => (/[",\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value);

const prepared = JSON.parse(await readFile(root + "/manifest.json", "utf8"));
await mkdir(OUT, { recursive: true });
const files = [];
for (const source of prepared.sources.filter((item) => item.registry === "american-carbon-registry")) {
  const rows = csvObjects(await readFile(root + "/" + source.path, "utf8"));
  const columns = COLUMNS[source.kind];
  const text = [columns.join(","), ...rows.map((row) => columns.map((name) => cell(row[name] ?? "")).join(","))].join("\n") + "\n";
  const name = source.kind === "issuance" ? "issuances.csv" : "retirements.csv";
  await writeFile(new URL(name, OUT), text);
  files.push({
    path: name,
    registry: source.registry,
    kind: source.kind,
    rows: rows.length,
    columns,
    sha256: createHash("sha256").update(text).digest("hex"),
    upstream: { uri: source.uri, path: source.upstreamPath, gitBlobSha: source.gitBlobSha, commit: source.commit },
  });
}
const inSample = new Set();
for (const file of files) {
  for (const row of csvObjects(await readFile(new URL(file.path, OUT), "utf8"))) inSample.add(row["Project ID"]);
}
const projectsUri = "https://raw.githubusercontent.com/carbonplan/offsets-db-data/" + prepared.commit + "/" + PROJECTS.path;
const projectsBytes = Buffer.from(await (await fetch(projectsUri)).arrayBuffer());
const blobSha = createHash("sha1").update("blob " + projectsBytes.length + "\0").update(projectsBytes).digest("hex");
if (blobSha !== PROJECTS.gitBlobSha) throw new Error("projects.csv: Git blob SHA mismatch, expected " + PROJECTS.gitBlobSha + " got " + blobSha);
const projects = csvObjects(projectsBytes.toString("utf8")).filter((row) => inSample.has(row["Project ID"]));
const projectsText =
  [PROJECTS.columns.join(","), ...projects.map((row) => PROJECTS.columns.map((name) => cell((row[name] ?? "").trim())).join(","))].join("\n") + "\n";
await writeFile(new URL("projects.csv", OUT), projectsText);
files.push({
  path: "projects.csv",
  registry: "american-carbon-registry",
  kind: "projects",
  rows: projects.length,
  columns: PROJECTS.columns,
  sha256: createHash("sha256").update(projectsText).digest("hex"),
  upstream: { uri: projectsUri, path: PROJECTS.path, gitBlobSha: PROJECTS.gitBlobSha, commit: prepared.commit },
});

const manifest = {
  schemaVersion: "climatechain.acr-subset/0.1",
  rightsManifestId: "acr-offsetsdb-subset",
  citation:
    "American Carbon Registry public reports, as collected in CarbonPlan OffsetsDB (github.com/carbonplan/offsets-db-data, commit " +
    prepared.commit + ", tests/data/american-carbon-registry). Columns reduced by ClimateChain; values unchanged.",
  files,
};
await writeFile(new URL("manifest.json", OUT), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify(manifest, null, 2));
