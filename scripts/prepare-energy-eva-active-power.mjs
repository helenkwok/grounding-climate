import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const RECORD_ID = "17099628";
const ARCHIVE = "EnergyEVA_Timeseries_Dataset.zip";
const MEMBER = "load/active_power_load.parquet";
const SOURCE_URL = "https://zenodo.org/records/" + RECORD_ID;
const ARCHIVE_MD5 = "662cbf850ecd592d6ff534471460f3f1";

const outDir = process.argv[2] ?? "data/external/energy-eva-active-power-load/demo";
const memberUrl =
  SOURCE_URL +
  "/files/" +
  encodeURIComponent(ARCHIVE) +
  "/container/" +
  MEMBER.split("/").map(encodeURIComponent).join("/");

const response = await fetch(memberUrl, {
  redirect: "follow",
  headers: {
    accept: "application/octet-stream",
    "user-agent": "Grounding/0.1 Energy-EVA active-power preparation",
  },
});

if (!response.ok) {
  throw new Error(
    "Could not fetch Energy-EVA archive member " +
      MEMBER +
      " (" +
      response.status +
      " " +
      response.statusText +
      ").",
  );
}

const bytes = new Uint8Array(await response.arrayBuffer());
if (bytes.length === 0) {
  throw new Error("Energy-EVA parquet member was empty.");
}

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, "active_power_load.parquet"), bytes);
await writeFile(
  path.join(outDir, "source.json"),
  JSON.stringify(
    {
      sourceManifestId: "energy-eva-active-power-load",
      energyEvaSourceManifestId: "energy-eva-datasets",
      zenodoRecord: SOURCE_URL,
      doi: "10.5281/zenodo.17099628",
      archiveName: ARCHIVE,
      archiveMd5: ARCHIVE_MD5,
      member: MEMBER,
      memberUrl,
      byteLength: bytes.length,
      preparedAt: new Date().toISOString(),
    },
    null,
    2,
  ) + "\n",
);

console.log(
  "GROUNDING_ENERGY_EVA_MEMBER=" +
    JSON.stringify({
      member: MEMBER,
      byteLength: bytes.length,
      outDir,
    }),
);
