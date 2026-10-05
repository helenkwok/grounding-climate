// Advice from a decision model on each flagged meter interval, ported from the TOP project's Jev lane.
// Advice only: nothing here sets a status, excludes a reading or changes a check. A person decides
// (see decisions.ts); the advice is recorded as a model-run so the decision can show what it was shown.
import { domainSeparatedBytes } from "@climatechain/core";
import type { CryptoProvider, JsonObject, ModelRun } from "@climatechain/core";

import type { AnomalyResult, BuildingMetadata, MeterPoint } from "./types.js";

export const JEV_URL = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODEL = "jev-latest";
export const QUESTION_SET = "building-triage@1";
export const JEV_TIMEOUT_MS = 20_000;
const RETRY_AFTER_CAP_S = 10;
const MAX_STRING = 120;

export const TRIAGE_CRITERIA = {
  meter_fault:
    "The reading is a metering or data-collection fault (dropout, stuck value, spike) and should be excluded",
  real_consumption:
    "The reading plausibly reflects real electricity use by the building and should be kept",
  unclear: "The numbers do not support either conclusion",
} as const;
export type TriageChoice = keyof typeof TRIAGE_CRITERIA;

const TRIAGE_INSTRUCTIONS =
  "An hourly electricity reading was flagged because it is far from the building's usual use for that hour of the week. Is it a meter fault or real consumption?";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The only shape that leaves this machine. Numbers and short public descriptors; no ids, names or dates. */
export interface FlagState {
  meter: "hourly electricity, kWh";
  building_use: string;
  weekday: string;
  hour: number;
  reading_kwh: number;
  expected_kwh: number;
  robust_z: number;
  flag_threshold_z: number;
  previous_3_kwh: number[];
  next_3_kwh: number[];
}

const STATE_KEYS = [
  "meter", "building_use", "weekday", "hour", "reading_kwh", "expected_kwh",
  "robust_z", "flag_threshold_z", "previous_3_kwh", "next_3_kwh",
];

const round1 = (value: number) => Math.round(value * 10) / 10;

/** Builds the state for one flagged interval. Throws if the point is not flagged. */
export function buildFlagState(
  series: readonly MeterPoint[],
  anomalies: AnomalyResult,
  index: number,
  metadata: BuildingMetadata,
): FlagState {
  const point = anomalies.points[index];
  if (!point?.flagged) throw new Error("Interval " + index + " is not flagged.");
  // BDG2 timestamps are local wall-clock "YYYY-MM-DD HH:mm:ss"; read them as UTC to keep the wall-clock fields.
  const at = new Date(
    point.timestamp.includes("T") ? point.timestamp : point.timestamp.replace(" ", "T") + "Z",
  );
  const state: FlagState = {
    meter: "hourly electricity, kWh",
    building_use: metadata.primarySpaceUsage ?? "unknown",
    weekday: WEEKDAYS[at.getUTCDay()] ?? "unknown",
    hour: at.getUTCHours(),
    reading_kwh: round1(point.value),
    expected_kwh: round1(point.predicted),
    robust_z: round1(point.robustZ),
    flag_threshold_z: anomalies.threshold,
    previous_3_kwh: series.slice(Math.max(0, index - 3), index).map((p) => round1(p.value)),
    next_3_kwh: series.slice(index + 1, index + 4).map((p) => round1(p.value)),
  };
  checkSentState(state);
  return state;
}

/** The leak guard: throws instead of sending anything outside the allow-list. */
export function checkSentState(state: unknown): void {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("Advisory state must be an object.");
  }
  for (const [key, value] of Object.entries(state)) {
    if (!STATE_KEYS.includes(key)) throw new Error("Advisory state key not allowed: " + key);
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (typeof item === "number") {
        if (!Number.isFinite(item)) throw new Error("Advisory state number is not finite: " + key);
      } else if (typeof item === "string") {
        if (item.length > MAX_STRING) throw new Error("Advisory state string too long: " + key);
        if (/\d{6,}/.test(item)) throw new Error("Advisory state string looks like an id: " + key);
        if (/_/.test(item)) throw new Error("Advisory state string looks like an identifier: " + key);
      } else {
        throw new Error("Advisory state value not allowed: " + key);
      }
    }
  }
}

export interface JevAdvice {
  model: string;
  choice: TriageChoice;
  probabilities: Record<string, number>;
  confidence: number;
  inputTokens: number;
  latencyMs: number;
}

export type JevErrorCode =
  | "unauthorized" | "unprocessable" | "rate_limited" | "overloaded"
  | "http_error" | "timeout" | "network" | "bad_response";

/** Carries a code and, when there is one, the HTTP status. Never a body, a header or the key. */
export class JevError extends Error {
  constructor(readonly code: JevErrorCode, readonly status?: number, detail?: string) {
    super("jev " + code + (status ? " (" + status + ")" : "") + (detail ? ": " + detail : ""));
    this.name = "JevError";
  }
}

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; headers?: { get(name: string): string | null }; json(): Promise<unknown> }>;

export interface JevDeps {
  fetch: FetchLike;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  timeoutMs?: number;
}

const isUnit = (value: unknown): value is number =>
  typeof value === "number" && value >= 0 && value <= 1;

export function parseJevResponse(body: unknown): Omit<JevAdvice, "latencyMs"> {
  const b = body as { model?: unknown; answers?: Record<string, unknown>; usage?: { input_tokens?: unknown } };
  if (typeof b?.model !== "string" || !b.model || !b.answers) {
    throw new JevError("bad_response", undefined, "no model or answers");
  }
  const a = b.answers.triage as { type?: unknown; choice?: unknown; probabilities?: unknown; confidence?: unknown };
  const options = Object.keys(TRIAGE_CRITERIA);
  if (a?.type !== "choice" || typeof a.choice !== "string" || !options.includes(a.choice)) {
    throw new JevError("bad_response", undefined, "triage is not a choice in its criteria");
  }
  if (!isUnit(a.confidence) || !a.probabilities || typeof a.probabilities !== "object") {
    throw new JevError("bad_response", undefined, "triage has no confidence or probabilities");
  }
  const probabilities: Record<string, number> = {};
  for (const [key, value] of Object.entries(a.probabilities)) {
    if (!options.includes(key) || !isUnit(value)) {
      throw new JevError("bad_response", undefined, "triage probability is invalid");
    }
    probabilities[key] = value;
  }
  return {
    model: b.model,
    choice: a.choice as TriageChoice,
    probabilities,
    confidence: a.confidence,
    inputTokens: Number(b.usage?.input_tokens ?? 0) || 0,
  };
}

/** One POST per flagged interval. One retry after 429 or 529; fails fast otherwise. */
export async function callJev(deps: JevDeps, key: string, state: FlagState): Promise<JevAdvice> {
  checkSentState(state);
  const body = JSON.stringify({
    model: JEV_MODEL,
    state,
    questions: {
      triage: { type: "choice", instructions: TRIAGE_INSTRUCTIONS, criteria: TRIAGE_CRITERIA },
    },
  });
  for (let attempt = 1; ; attempt += 1) {
    const started = deps.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? JEV_TIMEOUT_MS);
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await deps.fetch(JEV_URL, {
        method: "POST",
        headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      });
    } catch {
      // The underlying message is never kept: it could echo a header.
      throw new JevError(controller.signal.aborted ? "timeout" : "network");
    } finally {
      clearTimeout(timer);
    }
    if (res.ok) {
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        throw new JevError("bad_response", res.status, "body is not JSON");
      }
      return { ...parseJevResponse(json), latencyMs: Math.max(0, deps.now() - started) };
    }
    if ((res.status === 429 || res.status === 529) && attempt === 1) {
      const retryAfter = Number(res.headers?.get("retry-after"));
      const seconds = retryAfter > 0 ? Math.min(retryAfter, RETRY_AFTER_CAP_S) : 1;
      await deps.sleep(seconds * 1000);
      continue;
    }
    const codes: Record<number, JevErrorCode> = {
      401: "unauthorized", 422: "unprocessable", 429: "rate_limited", 529: "overloaded",
    };
    throw new JevError(codes[res.status] ?? "http_error", res.status);
  }
}

export function adviceRunId(timestamp: string): string {
  return "model-run:triage-advice:" + timestamp.replace(" ", "T");
}

/** Records one answer as a model-run node. The state sent and its digest go with it. */
export async function adviceModelRun(input: {
  timestamp: string;
  state: FlagState;
  advice: JevAdvice;
  executedAt: string;
  hashProvider: CryptoProvider;
}): Promise<ModelRun> {
  const { advice, state } = input;
  return {
    nodeType: "model-run",
    id: adviceRunId(input.timestamp),
    createdAt: input.executedAt,
    provenance: [
      { nodeType: "model-run", id: "model-run:hour-of-week-baseline", role: "flag-source" },
    ],
    model: { id: "typesafe-jev", name: "Typesafe AI System One (Jev)", version: advice.model },
    inputDigest: await input.hashProvider.hash(
      domainSeparatedBytes("climatechain.triage-advice-state", QUESTION_SET, state),
      "SHA-256",
    ),
    inferenceParameters: {
      endpoint: JEV_URL,
      requestedModel: JEV_MODEL,
      questionSet: QUESTION_SET,
      interval: input.timestamp,
      state: state as unknown as JsonObject,
      probabilities: advice.probabilities,
      inputTokens: advice.inputTokens,
      latencyMs: advice.latencyMs,
    },
    output: { kind: "qualitative", statement: "advice: " + advice.choice },
    confidence: advice.confidence,
    executedAt: input.executedAt,
    reproducibility: { codeVersion: "building-mrv/0.1 " + QUESTION_SET },
    extensions: { authority: "advice-only" },
  };
}
