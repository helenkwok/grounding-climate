import {
  domainSeparatedBytes,
} from "@climatechain/core";
import type {
  ContentDigest,
  CryptoProvider,
} from "@climatechain/core";

import type {
  MeterPoint,
} from "./types.js";

export async function digestMeterSeries(
  series: readonly MeterPoint[],
  provider: CryptoProvider,
): Promise<ContentDigest> {
  return provider.hash(
    domainSeparatedBytes(
      "climatechain.building-meter-series",
      "0.1",
      series,
    ),
    "SHA-256",
  );
}
