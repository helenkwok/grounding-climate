import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const manifestPath = path.join(root, "sources", "rights-manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const errors = [];

if (manifest.schemaVersion !== "climatechain.source-rights/0.1") {
  errors.push("Unsupported source-rights schemaVersion: " + manifest.schemaVersion);
}

if (manifest.policy?.unknownRightsDefault !== "do-not-redistribute") {
  errors.push("Manifest must default unknown rights to do-not-redistribute.");
}

const byId = new Map();

for (const source of manifest.sources ?? []) {
  if (byId.has(source.id)) {
    errors.push("Duplicate source id: " + source.id);
    continue;
  }
  byId.set(source.id, source);

  if ((source.evidence?.length ?? 0) === 0) {
    errors.push(source.id + ": rights decision has no evidence URL.");
  }

  if (
    source.permissions?.redistribution === "allowed" &&
    source.licence?.status !== "verified-open"
  ) {
    errors.push(
      source.id +
        ": redistribution=allowed requires licence.status=verified-open.",
    );
  }

  if (
    source.licence?.status === "verified-open" &&
    !source.licence?.identifier
  ) {
    errors.push(source.id + ": verified-open source is missing licence identifier.");
  }

  if (
    source.repository?.mode === "redistributable" &&
    source.permissions?.redistribution !== "allowed"
  ) {
    errors.push(
      source.id + ": redistributable repository mode requires allowed redistribution.",
    );
  }

  if (
    source.repository?.mode !== "redistributable" &&
    source.repository?.path
  ) {
    errors.push(
      source.id + ": only redistributable sources may declare a repository path.",
    );
  }
}

const externalRoot = path.join(
  root,
  manifest.policy?.externalDataRoot ?? "data/external",
);

async function walkDirectories(dir) {
  const result = [];
  if (!existsSync(dir)) return result;

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(full);
  }
  return result;
}

for (const sourceDir of await walkDirectories(externalRoot)) {
  const sourceId = path.basename(sourceDir);
  const source = byId.get(sourceId);

  if (!source) {
    errors.push(
      "External data directory has no rights-manifest entry: " + sourceId,
    );
    continue;
  }

  if (
    source.permissions?.redistribution !== "allowed" ||
    source.licence?.status !== "verified-open" ||
    source.repository?.mode !== "redistributable"
  ) {
    errors.push(
      sourceId +
        ": external data is present but manifest does not explicitly allow redistribution.",
    );
  }

  const configuredPath = source.repository?.path;
  if (configuredPath) {
    const actual = path.relative(root, sourceDir).split(path.sep).join("/");
    if (actual !== configuredPath) {
      errors.push(
        sourceId +
          ": external data path " +
          actual +
          " does not match manifest path " +
          configuredPath,
      );
    }
  }

  const info = await stat(sourceDir);
  if (!info.isDirectory()) {
    errors.push(sourceId + ": configured external data path is not a directory.");
  }
}

if (errors.length > 0) {
  console.error("Source-rights policy failed:");
  for (const error of errors) console.error(" - " + error);
  process.exit(1);
}

console.log(
  "Source-rights policy OK: " +
    byId.size +
    " source components audited; unknown rights default to no redistribution.",
);
