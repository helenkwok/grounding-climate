// Snapshots the World Bank WDI indicators Grounding cites for scale (latest non-empty value per economy) into
// data/cache/world-bank-wdi: real countries only (aggregates such as WLD and HIC are dropped by joining to the
// country list), the world total kept on its own, and the URL, lastupdated date and SHA-256 of every raw response.
//   node scripts/prepare-world-bank-indicators.mjs
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

// Kept in the gitignored cache: the GHG series come from EDGAR, whose fossil CO2 is IEA-derived (CC BY-NC-ND 4.0), and
// the renewables share from the IEA, so the data is not committed; the docs cite single figures with their source.
const OUT = new URL("../data/cache/world-bank-wdi/", import.meta.url);
const API = "https://api.worldbank.org/v2";
const INDICATORS = ["EN.GHG.ALL.MT.CE.AR5", "EN.GHG.CO2.PC.CE.AR5", "EG.FEC.RNEW.ZS"];
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const raw = [];

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url + " answered " + res.status);
  const text = await res.text();
  raw.push({ url, sha256: sha256(text), bytes: Buffer.byteLength(text) });
  const [meta, rows] = JSON.parse(text);
  if (!rows) throw new Error(url + " returned no rows: " + JSON.stringify(meta));
  if (meta.pages !== 1) throw new Error(url + " has " + meta.pages + " pages; raise per_page");
  return { meta, rows };
}

// Economies whose region is "NA" are aggregates (World, income groups, regions), not countries.
const { rows: economies } = await get(API + "/country?format=json&per_page=400");
const countries = new Set(economies.filter((item) => item.region.id !== "NA").map((item) => item.id));

const indicators = [];
for (const code of INDICATORS) {
  const { meta, rows } = await get(API + "/country/all/indicator/" + code + "?format=json&mrnev=1&per_page=400");
  const world = rows.find((row) => row.countryiso3code === "WLD");
  indicators.push({
    code,
    name: rows[0].indicator.value,
    unit: rows[0].unit || null,
    lastUpdated: meta.lastupdated,
    world: world ? { year: world.date, value: world.value } : null,
    countries: rows
      .filter((row) => countries.has(row.countryiso3code) && row.value !== null)
      .map((row) => ({ iso3: row.countryiso3code, name: row.country.value, year: row.date, value: row.value }))
      .sort((a, b) => a.iso3.localeCompare(b.iso3)),
  });
}

await mkdir(OUT, { recursive: true });
const data = JSON.stringify({ source: "World Bank, World Development Indicators (CC BY 4.0)", indicators }, null, 1) + "\n";
await writeFile(new URL("indicators.json", OUT), data);
await writeFile(
  new URL("manifest.json", OUT),
  JSON.stringify(
    {
      schemaVersion: "grounding.world-bank-wdi/0.1",
      rightsManifestId: "world-bank-wdi",
      citation: "World Bank, World Development Indicators, retrieved " + new Date().toISOString().slice(0, 10) + ". CC BY 4.0. Latest non-empty value per economy; aggregates removed by Grounding; values unchanged.",
      retrievedAt: new Date().toISOString(),
      responses: raw,
      files: [{ path: "indicators.json", sha256: sha256(data) }],
    },
    null,
    2,
  ) + "\n",
);
for (const item of indicators) {
  console.log(item.code, item.lastUpdated, "world", item.world, "countries", item.countries.length);
}
