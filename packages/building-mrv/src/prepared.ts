import type {
  ContentDigest,
  CryptoProvider,
} from "@climatechain/core";

import {
  parseMeterCsv,
  parseWeatherCsv,
} from "./csv.js";
import type {
  BuildingMetadata,
  PreparedBuildingDataset,
} from "./types.js";

interface PreparedSourceFile {
  sourceManifestId: "bdg2";
  zenodoRecord: string;
  doi: string;
  archiveName: string;
  publishedArchiveMd5: string;
  preparedAt: string;
  members: {
    meter: string;
    metadata: string;
    weather: string;
  };
  digests: {
    meter: ContentDigest;
    metadata: ContentDigest;
    weather?: ContentDigest;
  };
}

export function loadPreparedBuildingDataset(input: {
  meterCsv: string;
  weatherCsv?: string;
  metadataJson: string;
  sourceJson: string;
}): PreparedBuildingDataset {
  const metadata = JSON.parse(input.metadataJson) as BuildingMetadata;
  const source = JSON.parse(input.sourceJson) as PreparedSourceFile;
  const meter = parseMeterCsv(input.meterCsv);
  const weather = input.weatherCsv
    ? parseWeatherCsv(input.weatherCsv)
    : undefined;

  if (!metadata.buildingId || !metadata.siteId) {
    throw new Error(
      "Prepared BDG2 metadata requires buildingId and siteId.",
    );
  }
  if (source.sourceManifestId !== "bdg2") {
    throw new Error(
      "Prepared Building MRV input must reference sourceManifestId=bdg2.",
    );
  }
  if (meter.length < 336) {
    throw new Error(
      "Prepared Building MRV input requires at least 336 valid meter rows.",
    );
  }

  return {
    metadata,
    meter,
    ...(weather ? { weather } : {}),
    source: {
      sourceManifestId: "bdg2",
      zenodoRecord: source.zenodoRecord,
      doi: source.doi,
      archiveName: source.archiveName,
      publishedArchiveMd5: source.publishedArchiveMd5,
      meterMember: source.members.meter,
      metadataMember: source.members.metadata,
      weatherMember: source.members.weather,
      preparedAt: source.preparedAt,
      meterDigest: source.digests.meter,
      metadataDigest: source.digests.metadata,
      ...(source.digests.weather
        ? { weatherDigest: source.digests.weather }
        : {}),
    },
  };
}


function sameDigest(
  left: ContentDigest,
  right: ContentDigest,
): boolean {
  return left.algorithm === right.algorithm && left.value === right.value;
}

export interface PreparedArtifactIntegrityResult {
  valid: boolean;
  meter: boolean;
  metadata: boolean;
  weather: boolean | null;
}

export async function verifyPreparedArtifactDigests(
  input: {
    meterCsv: string;
    weatherCsv?: string;
    metadataJson: string;
    sourceJson: string;
  },
  provider: CryptoProvider,
): Promise<PreparedArtifactIntegrityResult> {
  const source = JSON.parse(input.sourceJson) as PreparedSourceFile;
  const encoder = new TextEncoder();

  const meter = await provider.hash(
    encoder.encode(input.meterCsv),
    "SHA-256",
  );
  const metadata = await provider.hash(
    encoder.encode(input.metadataJson),
    "SHA-256",
  );
  const meterValid = sameDigest(meter, source.digests.meter);
  const metadataValid = sameDigest(
    metadata,
    source.digests.metadata,
  );

  let weatherValid: boolean | null = null;
  if (input.weatherCsv && source.digests.weather) {
    const weather = await provider.hash(
      encoder.encode(input.weatherCsv),
      "SHA-256",
    );
    weatherValid = sameDigest(
      weather,
      source.digests.weather,
    );
  } else if (input.weatherCsv || source.digests.weather) {
    weatherValid = false;
  }

  return {
    valid:
      meterValid &&
      metadataValid &&
      weatherValid !== false,
    meter: meterValid,
    metadata: metadataValid,
    weather: weatherValid,
  };
}
