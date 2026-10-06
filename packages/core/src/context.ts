// Context a case carries without being judged on it: committed third-party values (for example modelled hazard)
// recorded as evidence with their digest and rights, plus one finding that says what they are. No check reads them.
import { canonicalBytes } from "./canonical.js";
import type { CryptoProvider } from "./crypto.js";
import type { Evidence, JsonValue, RightsMetadata } from "./types.js";

export interface CaseContext {
  evidence: Evidence;
  finding: string;
}

export async function committedContext(input: {
  id: string;
  /** Path of the committed file, and the part of it this case uses. */
  localRef: string;
  values: JsonValue;
  source: { uri: string; publisher: string };
  rights: RightsMetadata;
  finding: string;
  createdAt: string;
  provider: CryptoProvider;
}): Promise<CaseContext> {
  return {
    evidence: {
      nodeType: "evidence",
      id: input.id,
      createdAt: input.createdAt,
      provenance: [],
      kind: "dataset",
      source: { uri: input.source.uri, localRef: input.localRef, publisher: input.source.publisher, retrievedAt: input.createdAt },
      integrity: await input.provider.hash(canonicalBytes(input.values), "SHA-256"),
      rights: input.rights,
      access: { mode: "committed", instructions: input.localRef },
      extensions: { role: "context", values: input.values as never },
    },
    finding: input.finding,
  };
}

const pct = (value: number) => (value * 100).toFixed(value < 0.001 ? 4 : 2) + "%";

/**
 * Open Climate Risk wildfire values from data/external/open-climate-risk/ocr-context.json, as context for the
 * building case (the site's value) or the earth case (statistics over the scene). Modelled, not observed.
 */
export function openClimateRiskContext(
  ocr: {
    source: { url: string; snapshot: string };
    attribution: string[];
    buildingSite: { values: Record<string, number> };
    earthScene: { statistics: Record<string, { mean?: number; p90?: number }> };
  },
  part: "buildingSite" | "earthScene",
  createdAt: string,
  provider: CryptoProvider,
): Promise<CaseContext> {
  const values = (part === "buildingSite" ? ocr.buildingSite.values : ocr.earthScene.statistics) as unknown as JsonValue;
  const bp = (key: string) =>
    part === "buildingSite" ? ocr.buildingSite.values[key]! : ocr.earthScene.statistics[key]!.mean!;
  const where = part === "buildingSite" ? "at the BDG2 site" : "mean over the scene";
  return committedContext({
    id: "evidence:open-climate-risk",
    localRef: "data/external/open-climate-risk/ocr-context.json#" + part,
    values,
    source: { uri: ocr.source.url, publisher: "CarbonPlan Open Climate Risk v1.1.0 (snapshot " + ocr.source.snapshot + ")" },
    rights: {
      sourceManifestId: "open-climate-risk",
      licence: "CC-BY-4.0",
      redistribution: "allowed",
      derivedData: "allowed",
      attribution: ocr.attribution.join(" "),
    },
    finding:
      "Context, not evidence: modelled annual wildfire burn probability " + where + " is " + pct(bp("bp_2011")) +
      " for ~2011 conditions and " + pct(bp("bp_2047")) + " for ~2047 (Open Climate Risk, derived). No check reads it.",
    createdAt,
    provider,
  });
}
