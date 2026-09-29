import { canonicalBytes } from "@climatechain/core";
import type { ContentDigest, CryptoProvider } from "@climatechain/core";

import type { EnergySeries } from "./types.js";

export async function digestEnergySeries(
  series: EnergySeries,
  provider: CryptoProvider,
): Promise<ContentDigest> {
  return provider.hash(
    canonicalBytes({
      itemId: series.itemId,
      unit: series.unit,
      stepMinutes: series.stepMinutes,
      points: series.points,
      source: {
        dataset: series.source.dataset,
        sourceUri: series.source.sourceUri,
        sourceManifestId: series.source.sourceManifestId,
      },
    }),
    "SHA-256",
  );
}
