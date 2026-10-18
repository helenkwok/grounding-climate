// Checks data/external/climate-reference without the network: every committed file matches its SHA-256 in the
// manifest. Then prints the figures for the write-up. These are context only; no Grounding check uses them.
//   node scripts/verify-climate-reference.mjs
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL("../" + path, import.meta.url), "utf8");
const DIR = "data/external/climate-reference/";
const manifest = JSON.parse(await read(DIR + "manifest.json"));
for (const file of manifest.files) {
  const actual = createHash("sha256").update(await read(DIR + file.path)).digest("hex");
  if (actual !== file.sha256) {
    console.error("Climate reference check failed: " + file.path + " has SHA-256 " + actual + ", manifest says " + file.sha256);
    process.exit(1);
  }
}
console.log("Climate reference data OK: " + manifest.files.length + " files match manifest.json.");

const ember = JSON.parse(await read(DIR + "ember-grid-intensity.json"));
const gcb = JSON.parse(await read(DIR + "gcb-fossil-co2.json"));
const egrid = JSON.parse(await read("packages/building-mrv/references/epa-egrid2016-camx.json"));
const run = JSON.parse(await read("reports/building-mrv/case-run.json"));
const tonnes = run.clean.emissionsTCo2e;
const factor = egrid.conversion.valueKgCo2ePerKwh;
const kwh = run.case.calculations[0].parameters.acceptedEnergyKWh;
const grid = (iso3) => ember.countries.find((c) => c.iso3 === iso3);
const fossil = (iso3) => gcb.countries.find((c) => c.iso3 === iso3);
const usa = grid("USA");

console.log("\nFigures for the write-up (context only):");
console.log(
  "- US grid, Ember " + usa.year + ": " + usa.gCO2ePerKWh + " gCO2e/kWh (lifecycle, all gases) vs eGRID2016 CAMX " +
    (factor * 1000).toFixed(1) + " gCO2e/kWh (plant output, 2016) used by the building claim.",
);
console.log(
  "- Building claim " + tonnes.toFixed(2) + " tCO2e = " + Math.round(kwh).toLocaleString("en-US") +
    " kWh x CAMX factor. Same kWh at each country's Ember intensity (illustration only, different year and method):",
);
for (const iso3 of ["USA", "DEU", "IND", "CHN", "FRA"]) {
  const c = grid(iso3);
  console.log("    " + c.name + " (" + c.year + "): " + ((kwh * c.gCO2ePerKWh) / 1e6).toFixed(1) + " tCO2e");
}
const us = fossil("USA");
console.log(
  "- Fossil CO2, GCB 2025: world " + (gcb.world.MtCO2 / 1000).toFixed(1) + " GtCO2 (" + gcb.world.year + "), USA " +
    (us.MtCO2 / 1000).toFixed(2) + " GtCO2 (" + us.year + ", territorial).",
);
