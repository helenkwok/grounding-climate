import type {
  ActivitySink,
  ApprovalFn,
  ApprovalSummary,
  ClimateToolDefinition,
  ClimateToolResult,
  ToolExecutionContext,
} from "./types.js";

export const DEFAULT_OUTPUT_CAP = 8_000;
const SENTINEL = "[TRUNCATED by climatechain:";

function neutralizeSentinel(value: string): string {
  return value.split(SENTINEL).join("[truncated-by-climatechain:");
}

export function capToolOutput(
  value: string,
  limit = DEFAULT_OUTPUT_CAP,
): string {
  const clean = neutralizeSentinel(value);
  if (clean.length <= limit) return clean;

  const notice = (dropped: number) =>
    "\n\n" +
    SENTINEL +
    " " +
    dropped +
    " of " +
    clean.length +
    " characters were withheld. This result is INCOMPLETE. Narrow the query rather than reasoning from this partial view.]";

  const room = Math.max(0, limit - notice(clean.length).length);
  return clean.slice(0, room) + notice(clean.length - room);
}

function render(value: unknown): string {
  return typeof value === "string"
    ? value
    : JSON.stringify(value, null, 2);
}

export function describeToolIntent(
  tool: ClimateToolDefinition,
  input: Record<string, unknown>,
): ApprovalSummary {
  if (tool.describeIntent) {
    return {
      title: tool.title,
      tool: tool.name,
      args: tool.describeIntent(input),
    };
  }

  const args = Object.entries(input)
    .map(([key, value]) => {
      if (typeof value === "string" && value.length > 300) {
        return (
          key +
          " = " +
          JSON.stringify(value.slice(0, 300)) +
          "… (" +
          value.length +
          " chars)"
        );
      }
      return key + " = " + JSON.stringify(value);
    })
    .join("\n");

  return {
    title: tool.title,
    tool: tool.name,
    args: args || "(no arguments)",
  };
}

export function serialiseApprovals(approve: ApprovalFn): ApprovalFn {
  let chain: Promise<unknown> = Promise.resolve();

  return (summary) => {
    const next = chain.then(() => approve(summary));
    chain = next.catch(() => false);
    return next;
  };
}

export function makeGatedExecute(
  tool: ClimateToolDefinition,
  context: ToolExecutionContext,
  approve: ApprovalFn,
  activity: ActivitySink = () => undefined,
  outputCap = DEFAULT_OUTPUT_CAP,
): (
  input: Record<string, unknown>,
  invocation?: { signal?: AbortSignal },
) => Promise<ClimateToolResult> {
  return async (input, invocation) => {
    const args = input ?? {};
    const at = () => new Date().toISOString();

    activity({
      at: at(),
      tool: tool.name,
      phase: "called",
      risk: tool.risk,
      args,
    });

    try {
      if (tool.risk === "consequential") {
        const approved = await approve(describeToolIntent(tool, args));

        if (!approved) {
          activity({
            at: at(),
            tool: tool.name,
            phase: "declined",
            risk: tool.risk,
          });
          return {
            ok: false,
            error:
              'REFUSED: the human declined "' +
              tool.name +
              '". The operation was not executed. Do not retry without new user instruction.',
          };
        }

        activity({
          at: at(),
          tool: tool.name,
          phase: "approved",
          risk: tool.risk,
        });
      }

      const result = await tool.execute(args, {
        ...context,
        ...(invocation?.signal ? { signal: invocation.signal } : {}),
      });

      const rendered = render(result);
      const capped = capToolOutput(rendered, outputCap);
      const incomplete = capped.includes(SENTINEL);

      activity({
        at: at(),
        tool: tool.name,
        phase: "ok",
        risk: tool.risk,
      });

      return {
        ok: true,
        data: capped,
        ...(incomplete ? { incomplete: true } : {}),
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      activity({
        at: at(),
        tool: tool.name,
        phase: "error",
        risk: tool.risk,
        detail,
      });
      return {
        ok: false,
        error: capToolOutput(
          "ERROR in " + tool.name + ": " + detail,
          Math.min(800, outputCap),
        ),
      };
    }
  };
}
