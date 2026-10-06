// Loads what the carbon case is built from: the committed ACR records, the person's decisions, and any reports the
// reviewer brings with --import <registry>:<kind>:<file>:<page URL>. Grounding never fetches from a registry.
import { readFile } from "node:fs/promises";

import { CarbonRegistryService, normalizeRegistryCsv } from "@grounding-climate/carbon-registry";

export const DECISIONS = "reports/carbon-registry/coverage-decisions.json";
const root = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

export async function loadCarbonCase({ provider, observedAt, caseId = "case:carbon-registry:acr" }) {
  const manifest = JSON.parse(await read("data/external/acr-offsetsdb/manifest.json"));
  const committedSources = manifest.files.filter((file) => file.kind === "issuance" || file.kind === "retirement").map((file) => ({
    registry: file.registry,
    kind: file.kind,
    path: "data/external/acr-offsetsdb/" + file.path,
    uri: file.upstream.uri,
    rightsManifestId: manifest.rightsManifestId,
    citation: manifest.citation,
  }));
  const records = [];
  for (const source of committedSources) {
    records.push(...normalizeRegistryCsv({ ...source, sourcePath: source.path, csv: await read(source.path) }));
  }
  let decisions = [];
  try {
    decisions = JSON.parse(await read(DECISIONS));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const service = new CarbonRegistryService({
    caseId,
    records,
    sources: [],
    provider,
    observedAt,
    review: { committedSources, decisions },
  });
  return { service, records };
}

/** Applies each --import <registry>:<kind>:<file>:<page URL> argument. */
export async function applyImports(service, argv, downloadedAt) {
  const timeOf = typeof downloadedAt === "function" ? downloadedAt : () => downloadedAt;
  const imports = argv.flatMap((arg, index) => (arg === "--import" ? [argv[index + 1]] : []));
  for (const [index, spec] of imports.entries()) {
    const [registry, kind, file, ...uri] = spec.split(":");
    await service.importReport({ registry, kind, csv: await readFile(file, "utf8"), sourceUri: uri.join(":"), downloadedAt: timeOf(index) });
  }
  return imports.length;
}
