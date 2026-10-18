// Writes data/external/climate-reference: two small, pinned reference tables that give Grounding's claims their scale.
// No check reads them. Each raw download is pinned by SHA-256 and a different download fails instead of being used
// (Ember republishes the same URL; to move to a new release, update the pin and the retrieval date below).
//   node scripts/prepare-climate-reference.mjs   # downloads into the gitignored data/cache/climate-reference
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { csvObjects } from "@grounding-climate/carbon-registry";

export const RAW = {
  ember: {
    url: "https://files.ember-energy.org/public-downloads/generation/outputs/release_generation_yearly_global.csv",
    file: "release_generation_yearly_global.csv",
    retrievedAt: "2026-10-18",
    sha256: "b2ac49fa9b27035fedda3c6afb85917bf136de9253bfcbaf09c3410904ec7cd1",
    licence: "CC-BY-4.0",
    licenceEvidence: "https://ember-energy.org/data/yearly-electricity-data/",
    citation: "Ember (2026), Yearly Electricity Data, CC BY 4.0",
  },
  gcb: {
    url: "https://zenodo.org/api/records/17417124/files/GCB2025v15_MtCO2_flat.csv/content",
    file: "GCB2025v15_MtCO2_flat.csv",
    retrievedAt: "2026-10-18",
    sha256: "20650c19b394d91b6b31cddff2fbc9508bcdbbed7c3f93660336f2f655f367ff",
    zenodoMd5: "3008e30d913af5926a83d0d0775fb72e",
    doi: "10.5281/zenodo.17417124",
    licence: "CC-BY-4.0",
    licenceEvidence: "https://zenodo.org/records/17417124",
    citation:
      "Global Carbon Budget 2025 (Friedlingstein et al.), fossil CO2 emissions dataset, CC BY 4.0, doi:10.5281/zenodo.17417124",
  },
};

const CACHE = new URL("../data/cache/climate-reference/", import.meta.url);
const OUT = new URL("../data/external/climate-reference/", import.meta.url);
const hash = (algorithm, data) => createHash(algorithm).update(data).digest("hex");

async function raw({ url, file, sha256 }) {
  const path = new URL(file, CACHE);
  if (!existsSync(path)) {
    await mkdir(CACHE, { recursive: true });
    const response = await fetch(url);
    if (!response.ok) throw new Error("Download failed: " + response.status + " " + url);
    await writeFile(path, Buffer.from(await response.arrayBuffer()));
  }
  const bytes = await readFile(path);
  if (hash("sha256", bytes) !== sha256) {
    throw new Error(file + " differs from the pinned download: expected " + sha256 + ", got " + hash("sha256", bytes));
  }
  return bytes;
}

// Latest year with a value, per key.
function latest(rows, key, value) {
  const out = new Map();
  for (const row of rows) {
    if (row[value] === "" || !Number.isFinite(Number(row[value]))) continue;
    const year = Number(row.Year);
    if (!out.has(row[key]) || out.get(row[key]).Year < year) out.set(row[key], { ...row, Year: year });
  }
  return [...out.values()].sort((a, b) => a[key].localeCompare(b[key]));
}

const emberBytes = await raw(RAW.ember);
const intensity = "Emissions intensity (gCO2e/kWh)";
const ember = {
  schemaVersion: "grounding.climate-reference.ember-grid-intensity/0.1",
  citation: RAW.ember.citation,
  source: RAW.ember.url,
  selection:
    'Rows with "Area type" = "Country or economy" and "Electricity source" = "Total generation"; per country, the latest year with a value of "' +
    intensity + '".',
  scope:
    "Ember's generation-weighted intensity: lifecycle emissions (including upstream methane, supply chain and manufacturing), all gases as CO2e over 100 years, per kWh generated in the country (net imports not included).",
  unit: "gCO2e/kWh",
  countries: latest(
    csvObjects(emberBytes.toString("utf8")).filter(
      (row) => row["Area type"] === "Country or economy" && row["Electricity source"] === "Total generation",
    ),
    "ISO 3 code",
    intensity,
  ).map((row) => ({ iso3: row["ISO 3 code"], name: row.Area, year: row.Year, gCO2ePerKWh: Number(row[intensity]) })),
};

const gcbBytes = await raw(RAW.gcb);
if (hash("md5", gcbBytes) !== RAW.gcb.zenodoMd5) throw new Error("GCB CSV does not match Zenodo's published MD5");
const iso = "ISO 3166-1 alpha-3";
const gcbRows = latest(csvObjects(gcbBytes.toString("utf8")).filter((row) => row[iso] !== ""), iso, "Total");
const entry = (row) => ({ iso3: row[iso], name: row.Country, year: row.Year, MtCO2: Number(row.Total) });
const NOT_COUNTRIES = new Set(["WLD", "XIA", "XIS"]);
const gcb = {
  schemaVersion: "grounding.climate-reference.gcb-fossil-co2/0.1",
  citation: RAW.gcb.citation,
  source: RAW.gcb.url,
  doi: RAW.gcb.doi,
  selection:
    'Column "Total" (fossil CO2: coal, oil, gas, cement, flaring, other), per ISO code the latest year with a value. "WLD" is the world total; "XIA" and "XIS" are international aviation and shipping bunkers, which belong to no country. Rows without an ISO code (historical entities) are left out.',
  unit: "MtCO2",
  unitNote: "The file is already in million tonnes of CO2 (GCB2025v15_MtCO2_flat); no carbon-to-CO2 conversion is applied.",
  world: entry(gcbRows.find((row) => row[iso] === "WLD")),
  internationalBunkers: gcbRows.filter((row) => row[iso] === "XIA" || row[iso] === "XIS").map(entry),
  countries: gcbRows.filter((row) => !NOT_COUNTRIES.has(row[iso])).map(entry),
};

await mkdir(OUT, { recursive: true });
const files = [];
for (const [path, data] of [["ember-grid-intensity.json", ember], ["gcb-fossil-co2.json", gcb]]) {
  const text = JSON.stringify(data, null, 2) + "\n";
  await writeFile(new URL(path, OUT), text);
  files.push({ path, entries: data.countries.length, sha256: hash("sha256", text) });
}
const manifest = {
  schemaVersion: "grounding.climate-reference/0.1",
  rightsManifestId: "climate-reference",
  purpose: "Scale and context for Grounding's claims. Not read by any check.",
  sources: Object.values(RAW),
  files,
};
await writeFile(new URL("manifest.json", OUT), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify(manifest, null, 2));
