import { domainSeparatedBytes } from "@grounding-climate/core";
import type {
  ContentDigest,
  CryptoProvider,
} from "@grounding-climate/core";

import type { BatteryHistory } from "./types.js";

export async function digestBatteryHistory(
  history: BatteryHistory,
  provider: CryptoProvider,
): Promise<ContentDigest> {
  return provider.hash(
    domainSeparatedBytes(
      "grounding.battery-history",
      "battery-dpp/0.1",
      history,
    ),
    "SHA-256",
  );
}
