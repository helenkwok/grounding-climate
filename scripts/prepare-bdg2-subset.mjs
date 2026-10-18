import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const RECORD_ID = "3887306";
const RECORD_URL = "https://zenodo.org/records/" + RECORD_ID;
const DOI = "10.5281/zenodo.3887306";
const ARCHIVE = "buds-lab/building-data-genome-project-2-v1.0.zip";
const ARCHIVE_MD5 = "44393dc4cf61e84dec105e955368c890";
const ARCHIVE_ROOT = "buds-lab-building-data-genome-project-2-3d0cbaf";

const MEMBERS = {
  meter:
    ARCHIVE_ROOT + "/data/meters/cleaned/electricity_cleaned.csv",
  metadata:
    ARCHIVE_ROOT + "/data/metadata/metadata.csv",
  weather:
    ARCHIVE_ROOT + "/data/weather/weather.csv",
};

function parseArgs(argv) {
  const args = {
    out: "data/external/bdg2/demo",
    hours: 24 * 90,
    building: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--out") args.out = argv[++index];
    else if (value === "--hours") args.hours = Number(argv[++index]);
    else if (value === "--building") args.building = argv[++index];
    else if (value === "--help") {
      console.log(
        [
          "Usage: node scripts/prepare-bdg2-subset.mjs [options]",
          "",
          "Options:",
          "  --out <dir>        Output directory (default data/external/bdg2/demo)",
          "  --hours <count>    Valid hourly rows to retain (default 2160 = 90 days)",
          "  --building <id>    Explicit BDG2 building id; otherwise choose deterministically",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error("Unknown argument: " + value);
    }
  }

  if (!args.out) throw new Error("--out requires a directory.");
  if (!Number.isInteger(args.hours) || args.hours < 336) {
    throw new Error("--hours must be an integer >= 336.");
  }

  return args;
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}

function csvEscape(value) {
  const text = String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return '"' + text.replaceAll('"', '""') + '"';
}

function memberUrl(member) {
  const archive = encodeURIComponent(ARCHIVE);
  const encodedMember = member
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  return (
    "https://zenodo.org/records/" +
    RECORD_ID +
    "/files/" +
    archive +
    "/container/" +
    encodedMember
  );
}

async function fetchMember(member) {
  const url = memberUrl(member);
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "Grounding/0.1 BDG2 subset preparation",
      Accept: "text/csv,text/plain,*/*",
    },
  });

  if (!response.ok || !response.body) {
    throw new Error(
      "Could not stream BDG2 archive member " +
        member +
        " (" +
        response.status +
        " " +
        response.statusText +
        "). " +
        "The fallback is to download " +
        RECORD_URL +
        " / " +
        ARCHIVE +
        " and verify MD5 " +
        ARCHIVE_MD5 +
        ".",
    );
  }

  return { response, url };
}

async function readTextMember(member) {
  const { response, url } = await fetchMember(member);
  return {
    text: await response.text(),
    url,
  };
}

async function forEachRemoteLine(response, handler) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), {
        stream: !done,
      });

      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const raw = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
        const decision = await handler(line);
        if (decision === false) {
          await reader.cancel();
          return;
        }
      }

      if (done) {
        if (buffer.length > 0) await handler(buffer);
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function recordsFromCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0] ?? "");
  return lines.slice(1).filter(Boolean).map((line) => {
    const row = parseCsvLine(line);
    return Object.fromEntries(
      headers.map((header, index) => [header, row[index] ?? ""]),
    );
  });
}

function normalizeYes(value) {
  return /^(yes|true|1)$/i.test(String(value).trim());
}

async function readElectricityHeader() {
  const { response, url } = await fetchMember(MEMBERS.meter);
  let header = [];
  await forEachRemoteLine(response, async (line) => {
    header = parseCsvLine(line);
    return false;
  });
  if (header[0] !== "timestamp") {
    throw new Error("Unexpected electricity CSV header.");
  }
  return { header, url };
}

function chooseBuilding(metadataRows, electricityHeader, requested) {
  const available = new Set(electricityHeader.slice(1));
  const eligible = metadataRows
    .filter((row) => available.has(row.building_id))
    .filter((row) => normalizeYes(row.electricity))
    .map((row) => row.building_id)
    .filter(Boolean)
    .sort();

  if (requested) {
    if (!available.has(requested)) {
      throw new Error(
        'Requested building "' + requested + '" is not present in electricity_cleaned.csv.',
      );
    }
    const metadata = metadataRows.find(
      (row) => row.building_id === requested,
    );
    if (!metadata) {
      throw new Error(
        'Requested building "' + requested + '" has no BDG2 metadata row.',
      );
    }
    return requested;
  }

  const first = eligible[0];
  if (!first) {
    throw new Error(
      "No electricity building could be selected from the BDG2 metadata/header intersection.",
    );
  }
  return first;
}

async function extractMeterSeries(buildingId, hours) {
  const { response, url } = await fetchMember(MEMBERS.meter);
  let headers;
  let timestampIndex = -1;
  let buildingIndex = -1;
  const rows = [];

  await forEachRemoteLine(response, async (line) => {
    if (!headers) {
      headers = parseCsvLine(line);
      timestampIndex = headers.indexOf("timestamp");
      buildingIndex = headers.indexOf(buildingId);
      if (timestampIndex < 0 || buildingIndex < 0) {
        throw new Error(
          'Could not locate building "' + buildingId + '" in electricity CSV.',
        );
      }
      return true;
    }

    const row = parseCsvLine(line);
    const timestamp = row[timestampIndex];
    const value = Number(row[buildingIndex]);
    if (!timestamp || !Number.isFinite(value) || value < 0) return true;

    rows.push({ timestamp, value });
    return rows.length < hours;
  });

  if (rows.length < hours) {
    throw new Error(
      "Only " +
        rows.length +
        " valid electricity rows were available for " +
        buildingId +
        "; requested " +
        hours +
        ".",
    );
  }

  return { rows, url };
}

async function extractWeather(siteId, timestamps) {
  const { response, url } = await fetchMember(MEMBERS.weather);
  let headers;
  let timestampIndex = -1;
  let siteIndex = -1;
  let temperatureIndex = -1;
  const rows = [];
  const wanted = new Set(timestamps);
  const lastTimestamp = timestamps.at(-1);

  await forEachRemoteLine(response, async (line) => {
    if (!headers) {
      headers = parseCsvLine(line);
      timestampIndex = headers.indexOf("timestamp");
      siteIndex = headers.indexOf("site_id");
      temperatureIndex = headers.indexOf("airTemperature");
      if (
        timestampIndex < 0 ||
        siteIndex < 0 ||
        temperatureIndex < 0
      ) {
        throw new Error(
          "Weather CSV requires timestamp, site_id, and airTemperature.",
        );
      }
      return true;
    }

    const row = parseCsvLine(line);
    const timestamp = row[timestampIndex];
    if (!timestamp) return true;

    if (
      lastTimestamp &&
      timestamp > lastTimestamp &&
      rows.length > 0
    ) {
      return false;
    }

    if (
      row[siteIndex] === siteId &&
      wanted.has(timestamp)
    ) {
      const airTemperature = Number(row[temperatureIndex]);
      if (Number.isFinite(airTemperature)) {
        rows.push({ timestamp, airTemperature });
      }
    }
    return rows.length < timestamps.length;
  });

  return { rows, url };
}

function sha256(content) {
  return createHash("sha256").update(content).digest("base64url");
}

function meterCsv(rows) {
  return (
    "timestamp,meter_reading\n" +
    rows
      .map(
        (row) =>
          csvEscape(row.timestamp) + "," + String(row.value),
      )
      .join("\n") +
    "\n"
  );
}

function weatherCsv(rows) {
  return (
    "timestamp,airTemperature\n" +
    rows
      .map(
        (row) =>
          csvEscape(row.timestamp) +
          "," +
          String(row.airTemperature),
      )
      .join("\n") +
    "\n"
  );
}

const args = parseArgs(process.argv.slice(2));
const preparedAt = new Date().toISOString();

console.log("Reading BDG2 metadata from pinned Zenodo v1.0...");
const metadataSource = await readTextMember(MEMBERS.metadata);
const metadataRows = recordsFromCsv(metadataSource.text);
const electricityHeader = await readElectricityHeader();

const buildingId = chooseBuilding(
  metadataRows,
  electricityHeader.header,
  args.building,
);
const metadataRow = metadataRows.find(
  (row) => row.building_id === buildingId,
);
if (!metadataRow) throw new Error("Selected building metadata disappeared.");

const siteId = metadataRow.site_id;
if (!siteId) {
  throw new Error(
    'Selected building "' + buildingId + '" has no site_id.',
  );
}

console.log(
  "Streaming " +
    args.hours +
    " valid electricity rows for " +
    buildingId +
    " (" +
    siteId +
    ")...",
);
const meterSource = await extractMeterSeries(buildingId, args.hours);

console.log("Streaming matching weather rows...");
const weatherSource = await extractWeather(
  siteId,
  meterSource.rows.map((row) => row.timestamp),
);

function firstNonEmpty(row, keys) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && String(value).trim() !== "") return value;
  }
  return undefined;
}

function optionalNumber(row, keys) {
  const value = firstNonEmpty(row, keys);
  if (value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

const timezone = firstNonEmpty(metadataRow, [
  "timezone",
  "time_zone",
]);
const latitude = optionalNumber(metadataRow, [
  "lat",
  "latitude",
]);
const longitude = optionalNumber(metadataRow, [
  "lng",
  "lon",
  "longitude",
]);
const climateZone = firstNonEmpty(metadataRow, [
  "climatezone",
  "climate_zone",
  "ashraeclimatezone",
]);

const metadata = {
  buildingId,
  siteId,
  ...(metadataRow.primaryspaceusage
    ? { primarySpaceUsage: metadataRow.primaryspaceusage }
    : {}),
  ...(Number.isFinite(Number(metadataRow.sqm))
    ? { floorAreaM2: Number(metadataRow.sqm) }
    : {}),
  ...(timezone ? { timezone } : {}),
  ...(latitude !== undefined ? { latitude } : {}),
  ...(longitude !== undefined ? { longitude } : {}),
  ...(climateZone ? { climateZone } : {}),
};

const meterText = meterCsv(meterSource.rows);
const weatherText = weatherCsv(weatherSource.rows);
const metadataText = JSON.stringify(metadata, null, 2) + "\n";

const source = {
  sourceManifestId: "bdg2",
  zenodoRecord: RECORD_URL,
  doi: DOI,
  archiveName: ARCHIVE,
  publishedArchiveMd5: ARCHIVE_MD5,
  preparedAt,
  buildingId,
  siteId,
  requestedHours: args.hours,
  returnedWeatherRows: weatherSource.rows.length,
  members: {
    meter: MEMBERS.meter,
    metadata: MEMBERS.metadata,
    weather: MEMBERS.weather,
  },
  memberUrls: {
    meter: meterSource.url,
    metadata: metadataSource.url,
    weather: weatherSource.url,
  },
  digests: {
    meter: {
      algorithm: "SHA-256",
      value: sha256(meterText),
    },
    metadata: {
      algorithm: "SHA-256",
      value: sha256(metadataText),
    },
    weather: {
      algorithm: "SHA-256",
      value: sha256(weatherText),
    },
  },
};

await mkdir(args.out, { recursive: true });
await Promise.all([
  writeFile(path.join(args.out, "meter.csv"), meterText),
  writeFile(path.join(args.out, "weather.csv"), weatherText),
  writeFile(path.join(args.out, "metadata.json"), metadataText),
  writeFile(
    path.join(args.out, "source.json"),
    JSON.stringify(source, null, 2) + "\n",
  ),
]);

const check = JSON.parse(
  await readFile(path.join(args.out, "source.json"), "utf8"),
);
if (check.digests.meter.value !== sha256(meterText)) {
  throw new Error("Prepared meter digest self-check failed.");
}

console.log(
  JSON.stringify(
    {
      out: args.out,
      buildingId,
      siteId,
      meterRows: meterSource.rows.length,
      weatherRows: weatherSource.rows.length,
      metadata,
      meterSha256: source.digests.meter.value,
    },
    null,
    2,
  ),
);
