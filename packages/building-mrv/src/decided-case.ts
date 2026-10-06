import { validateBundle } from "@grounding-climate/core";
import type { CaseContext, ContentDigest, CryptoProvider, ModelRun } from "@grounding-climate/core";

import { runBuildingMrv } from "./analysis.js";
import { buildBuildingMrvCase } from "./case.js";
import { applyDecisions, flagStatuses } from "./decisions.js";
import type { FlagStatus, IntervalDecision } from "./decisions.js";
import { digestMeterSeries } from "./integrity.js";
import type {
  BuildingMrvAnalysis,
  GridEmissionFactor,
  MeterPoint,
  PreparedBuildingDataset,
} from "./types.js";

export interface DecidedCaseInput {
  caseId: string;
  createdAt: string;
  dataset: PreparedBuildingDataset;
  meter: readonly MeterPoint[];
  factor: GridEmissionFactor;
  advice: ModelRun[];
  decisions: readonly IntervalDecision[];
  context?: readonly CaseContext[];
  hashProvider: CryptoProvider;
}

export interface DecidedCase {
  climateCase: ReturnType<typeof buildBuildingMrvCase>;
  digest: ContentDigest;
  analysis: BuildingMrvAnalysis;
  statuses: FlagStatus[];
}

/** The building case for a meter series with its advice and decisions; decisions on another series come out stale. */
export async function buildDecidedBuildingCase(input: DecidedCaseInput): Promise<DecidedCase> {
  const meter = input.meter.map((point) => ({ ...point }));
  const digest = await digestMeterSeries(meter, input.hashProvider);
  const raw = runBuildingMrv(meter, input.factor);
  const statuses = flagStatuses(raw, input.decisions, digest);
  const analysis = applyDecisions(meter, input.factor, raw, statuses);
  const climateCase = buildBuildingMrvCase({
    caseId: input.caseId,
    createdAt: input.createdAt,
    dataset: { ...input.dataset, meter, source: { ...input.dataset.source, meterSeriesDigest: digest } },
    factor: input.factor,
    analysis,
    flagStatuses: statuses,
    advice: input.advice,
    ...(input.context ? { context: input.context } : {}),
  });
  const issues = validateBundle(climateCase);
  if (issues.length > 0) throw new Error("Invalid building case: " + JSON.stringify(issues));
  return { climateCase, digest, analysis, statuses };
}
