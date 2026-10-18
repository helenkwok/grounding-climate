// The pinned CarbonPlan OffsetsDB export used by the registry scoreboard, and how its rows become ScoreboardRows.
// Upstream updates are paused, but "latest" could still change: the zip is pinned by SHA-256 and a different download
// fails instead of being used.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { csvObjects, registryOfProjectId } from "@grounding-climate/carbon-registry";

export const SNAPSHOT = {
  url: "https://carbonplan-offsets-db.s3.us-west-2.amazonaws.com/production/latest/offsets-db.csv.zip",
  generatedAt: "2026-06-01T20:33:13.820968+00:00",
  zipSha256: "c037be30f54fac47b625b8fdebc02ca459e49d627d3214a90eb90ce0a45bb61e",
  termsUrl: "https://github.com/carbonplan/offsets-db-data/blob/main/TERMS_OF_DATA_ACCESS",
  attribution: "Registry data via CarbonPlan OffsetsDB, snapshot 2026-06-01",
};
export const CACHE = new URL("../../data/cache/offsetsdb/", import.meta.url);
export const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/** Downloads the zip once into the gitignored cache, checks its SHA-256 and unzips it. Returns the unzipped folder. */
export async function openSnapshot({ download = true } = {}) {
  const zip = new URL("offsets-db.csv.zip", CACHE);
  if (!existsSync(zip)) {
    if (!download) throw new Error("No cached OffsetsDB snapshot; run node scripts/prepare-offsetsdb-snapshot.mjs");
    await mkdir(CACHE, { recursive: true });
    const response = await fetch(SNAPSHOT.url);
    if (!response.ok) throw new Error("Download failed: " + response.status + " " + SNAPSHOT.url);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (sha256(bytes) !== SNAPSHOT.zipSha256) {
      throw new Error("OffsetsDB zip differs from the pinned snapshot: expected " + SNAPSHOT.zipSha256 + ", got " + sha256(bytes));
    }
    await writeFile(zip, bytes);
  }
  const actual = sha256(await readFile(zip));
  if (actual !== SNAPSHOT.zipSha256) throw new Error("Cached OffsetsDB zip differs from the pinned snapshot: " + actual);
  const dir = new URL("x/", CACHE);
  execFileSync("unzip", ["-oq", zip.pathname, "credits.csv", "projects.csv", "metadata.json", "-d", dir.pathname]);
  const meta = JSON.parse(await readFile(new URL("metadata.json", dir), "utf8"));
  if (meta.generated_at !== SNAPSHOT.generatedAt) throw new Error("Unexpected snapshot time: " + meta.generated_at);
  return dir;
}

// OffsetsDB dates look like "2009-03-26 00:00:00+00:00"; some rows have none.
const isoDate = (value) => (value ? new Date(value.replace(" ", "T")).toISOString() : undefined);

/** OffsetsDB credit rows (or the committed ACR subset, same column names) as ScoreboardRows. */
export function creditRows(csv) {
  return csvObjects(csv).map((row) => {
    const date = isoDate(row.transaction_date);
    const quantity = Number(row.quantity);
    const vintage = Number(row.vintage);
    if (!Number.isFinite(quantity) || !Number.isInteger(vintage)) throw new Error("Bad credit row: " + JSON.stringify(row));
    return {
      registry: registryOfProjectId(row.project_id),
      projectId: row.project_id,
      vintage,
      kind: row.transaction_type,
      quantity,
      ...(date ? { date } : {}),
    };
  });
}

export function projectRows(csv) {
  return csvObjects(csv).map((row) => ({
    registry: registryOfProjectId(row.project_id),
    projectId: row.project_id,
    issued: Number(row.issued),
    retired: Number(row.retired),
  }));
}

/** The counts for one registry, as the scoreboard's table records them. */
export const countsDigest = (zipSha256, registries) => sha256(JSON.stringify({ zipSha256, registries }));

// Registries whose counts are published; the rest are computed locally only (docs/carbon-registry.md, Scoreboard).
export const PUBLISHED = ["american-carbon-registry", "art-trees", "gold-standard"];
