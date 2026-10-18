import {
  domainSeparatedBytes,
} from "@grounding-climate/core";
import type {
  ContentDigest,
  CryptoProvider,
} from "@grounding-climate/core";

import type {
  MeterPoint,
} from "./types.js";

export async function digestMeterSeries(
  series: readonly MeterPoint[],
  provider: CryptoProvider,
): Promise<ContentDigest> {
  return provider.hash(
    domainSeparatedBytes(
      "grounding.building-meter-series",
      "0.1",
      series,
    ),
    "SHA-256",
  );
}
