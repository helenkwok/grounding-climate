import { domainSeparatedBytes } from "@climatechain/core";
import type {
  ContentDigest,
  CryptoProvider,
} from "@climatechain/core";

import type { BatteryHistory } from "./types.js";

export async function digestBatteryHistory(
  history: BatteryHistory,
  provider: CryptoProvider,
): Promise<ContentDigest> {
  return provider.hash(
    domainSeparatedBytes(
      "climatechain.battery-history",
      "battery-dpp/0.1",
      history,
    ),
    "SHA-256",
  );
}
