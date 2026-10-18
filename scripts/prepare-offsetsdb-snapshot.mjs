// Writes the full American Carbon Registry part of the pinned CarbonPlan OffsetsDB export to
// data/external/acr-offsetsdb-full: every ACR credit row, reduced to the columns the scoreboard reads (no beneficiary,
// account or note), and every ACR project's issued and retired totals. The other registries stay in the gitignored
// cache (data/cache/offsetsdb) and are reported as counts only.
//   node scripts/prepare-offsetsdb-snapshot.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";

import { csvObjects } from "@grounding-climate/carbon-registry";

import { SNAPSHOT, openSnapshot, sha256 } from "./lib/offsetsdb.mjs";

const OUT = new URL("../data/external/acr-offsetsdb-full/", import.meta.url);
const COLUMNS = {
  "credits.csv": ["project_id", "vintage", "transaction_type", "quantity", "transaction_date"],
  "projects.csv": ["project_id", "issued", "retired"],
};
const cell = (value) => (/[",\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value);

const dir = await openSnapshot();
await mkdir(OUT, { recursive: true });
const files = [];
for (const [name, columns] of Object.entries(COLUMNS)) {
  const rows = csvObjects(await readFile(new URL(name, dir), "utf8")).filter((row) => row.project_id.startsWith("ACR"));
  const text = [columns.join(","), ...rows.map((row) => columns.map((column) => cell(row[column] ?? "")).join(","))].join("\n") + "\n";
  await writeFile(new URL(name, OUT), text);
  files.push({ path: name, rows: rows.length, columns, sha256: sha256(text) });
}

const manifest = {
  schemaVersion: "grounding.acr-offsetsdb-full/0.1",
  rightsManifestId: "acr-offsetsdb-full",
  citation:
    "American Carbon Registry public reports, via CarbonPlan OffsetsDB (export generated " + SNAPSHOT.generatedAt +
    "). Rows filtered to ACR and columns reduced by Grounding; values unchanged.",
  source: SNAPSHOT,
  files,
};
await writeFile(new URL("manifest.json", OUT), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify(manifest, null, 2));
