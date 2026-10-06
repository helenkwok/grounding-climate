const RECORD_ID = "17099628";
const url = "https://zenodo.org/api/records/" + RECORD_ID;

const response = await fetch(url, {
  headers: {
    accept: "application/json",
    "user-agent": "Grounding/0.1 (+https://github.com/helenkwok/grounding-climate)",
  },
});
if (!response.ok) {
  throw new Error(
    "Zenodo metadata request failed: " +
      response.status +
      " " +
      response.statusText,
  );
}

const record = await response.json();
const files = (record.files ?? []).map((file) => ({
  key: file.key,
  size: file.size,
  checksum: file.checksum,
  content:
    file.links?.content ??
    file.links?.self ??
    null,
}));

const candidates = files.filter((file) =>
  String(file.key).toLowerCase().includes("active_power") ||
  String(file.key).toLowerCase().includes("load") ||
  /\.(zip|tar|tgz|gz)$/i.test(String(file.key)),
);

const output = {
  recordId: RECORD_ID,
  doi: record.pids?.doi?.identifier ?? record.metadata?.doi ?? null,
  title: record.metadata?.title ?? null,
  publicationDate: record.metadata?.publication_date ?? null,
  rights: record.metadata?.rights ?? [],
  fileCount: files.length,
  files,
  candidates,
};

console.log(
  "GROUNDING_ENERGY_EVA_ZENODO=" + JSON.stringify(output),
);

if (files.length === 0) {
  throw new Error("Zenodo record contains no downloadable files.");
}
