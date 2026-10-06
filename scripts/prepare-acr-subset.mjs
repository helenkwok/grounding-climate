// Writes the ACR records ClimateChain commits: the American Carbon Registry issuance and retirement fixtures from
// CarbonPlan's OffsetsDB pipeline at a pinned commit, reduced to the columns the reconciliation reads. Beneficiary
// and account-holder names are left out: no check uses them, and some name individuals.
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
