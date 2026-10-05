import {
  CORE_TOOLS,
  TRUST_TOOLS,
} from "./core-tools.js";
import {
  makeGatedExecute,
  serialiseApprovals,
} from "./gate.js";
import type { ClimateCapabilityRegistry } from "./registry.js";
import type {
  ActivitySink,
  ApprovalFn,
  ClimateCapability,
  ClimateToolDefinition,
  ClimateWorkspace,
  ModelContextLike,
} from "./types.js";

export interface WebMcpRegistrationOutcome {
  registered: string[];
  failed: Array<{ name: string; error: string }>;
}

export interface RegisteredWebMcpSurface {
  /** The browser exposes a WebMCP model context. Says nothing about whether tools registered. */
  available: boolean;
  toolNames: string[];
  /** Settles once every registerTool call has resolved or rejected. */
  registration: Promise<WebMcpRegistrationOutcome>;
  controller: AbortController;
  executeFallback(
    toolName: string,
    input?: Record<string, unknown>,
  ): Promise<unknown>;
}

export interface RegisterClimateWebMcpOptions {
  registry: ClimateCapabilityRegistry;
  workspace: ClimateWorkspace;
  activeCapabilities: readonly ClimateCapability[];
  approve: ApprovalFn;
  activity?: ActivitySink;
  modelContext?: ModelContextLike | null;
  outputCap?: number;
}

function selectedTools(
  registry: ClimateCapabilityRegistry,
  activeCapabilities: readonly ClimateCapability[],
): ClimateToolDefinition[] {
  const capabilities = new Set<ClimateCapability>(activeCapabilities);
  const tools = [
    ...CORE_TOOLS,
    ...TRUST_TOOLS,
    ...registry.tools(activeCapabilities),
  ];

  const names = new Set<string>();
  return tools
    .filter((tool) => {
      const required = tool.requiredCapabilities ?? [];
      return required.every((capability) => capabilities.has(capability));
    })
    .filter((tool) => {
      if (names.has(tool.name)) {
        throw new Error('Duplicate WebMCP tool "' + tool.name + '".');
      }
      names.add(tool.name);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function currentDocumentModelContext(): ModelContextLike | null {
  if (typeof document === "undefined") return null;
  const doc = document as Document & {
    modelContext?: ModelContextLike;
  };
  return doc.modelContext ?? null;
}

export function registerClimateWebMcp(
  options: RegisterClimateWebMcpOptions,
): RegisteredWebMcpSurface {
  const controller = new AbortController();
  const approve = serialiseApprovals(options.approve);
  const tools = selectedTools(
    options.registry,
    options.activeCapabilities,
  );
  const executions = new Map<
    string,
    ReturnType<typeof makeGatedExecute>
  >();

  for (const tool of tools) {
    const execute = makeGatedExecute(
      tool,
      { workspace: options.workspace },
      approve,
      options.activity,
      options.outputCap,
    );
    executions.set(tool.name, execute);
  }

  const modelContext =
    options.modelContext === undefined
      ? currentDocumentModelContext()
      : options.modelContext;

  const attempts: Array<Promise<{ name: string; error?: string }>> = [];

  if (modelContext) {
    for (const tool of tools) {
      const execute = executions.get(tool.name);
      if (!execute) continue;

      let attempt: Promise<unknown>;
      try {
        attempt = Promise.resolve(
          modelContext.registerTool(
            {
              name: tool.name,
              title: tool.title,
              description: tool.description,
              inputSchema: tool.inputSchema,
              annotations: {
                readOnlyHint: tool.risk === "read",
                destructiveHint: false,
                consequentialHint: tool.risk === "consequential",
                untrustedContentHint: true,
              },
              execute,
            },
            { signal: controller.signal },
          ),
        );
      } catch (error) {
        attempt = Promise.reject(error);
      }
      attempts.push(
        attempt.then(
          () => ({ name: tool.name }),
          (error: unknown) => ({
            name: tool.name,
            error: error instanceof Error ? error.message : String(error),
          }),
        ),
      );
    }
  }

  const registration = Promise.all(attempts).then((results) => ({
    registered: results.filter((r) => r.error === undefined).map((r) => r.name),
    failed: results
      .filter((r) => r.error !== undefined)
      .map((r) => ({ name: r.name, error: r.error as string })),
  }));

  return {
    available: modelContext !== null,
    toolNames: tools.map((tool) => tool.name),
    registration,
    controller,
    async executeFallback(toolName, input = {}) {
      const execute = executions.get(toolName);
      if (!execute) {
        return {
          ok: false,
          error: 'Unknown or inactive tool "' + toolName + '".',
        };
      }
      return execute(input);
    },
  };
}

export class DynamicClimateWebMcp {
  private current: RegisteredWebMcpSurface | undefined;

  constructor(
    private readonly base: Omit<
      RegisterClimateWebMcpOptions,
      "activeCapabilities"
    >,
  ) {}

  activate(
    activeCapabilities: readonly ClimateCapability[],
  ): RegisteredWebMcpSurface {
    this.current?.controller.abort();
    this.current = registerClimateWebMcp({
      ...this.base,
      activeCapabilities,
    });
    return this.current;
  }

  stop(): void {
    this.current?.controller.abort();
    this.current = undefined;
  }
}
