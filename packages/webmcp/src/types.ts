import type {
  ClimateCaseBundle,
  ClimateNode,
  NodeRef,
  Verification,
} from "@climatechain/core";

export type ClimateCapability =
  | "public-disclosure"
  | "building-meter-mrv"
  | "carbon-recalculation"
  | "claim-reconciliation"
  | "renewable-forecasting"
  | "earth-observation"
  | "battery-dpp"
  | "carbon-registry"
  | "pq-attestation"
  | "anchoring"
  | (string & {});

export type ToolRisk = "read" | "consequential";

export interface ClimateToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  incomplete?: boolean;
}

export interface ClimateToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  risk: ToolRisk;
  requiredCapabilities?: ClimateCapability[];
  describeIntent?: (input: Record<string, unknown>) => string;
  execute: (
    input: Record<string, unknown>,
    context: ToolExecutionContext,
  ) => Promise<unknown>;
}

export interface ClimateModule {
  id: string;
  title: string;
  capabilities: ClimateCapability[];
  tools: ClimateToolDefinition[];
}

export interface ToolExecutionContext {
  workspace: ClimateWorkspace;
  signal?: AbortSignal;
}

export interface ClimateWorkspace {
  getCase(caseId?: string): Promise<ClimateCaseBundle | undefined>;
  listCases(): Promise<ClimateCaseBundle[]>;
  getNode(caseId: string, ref: NodeRef): Promise<ClimateNode | undefined>;
  listChecks(caseId: string): Promise<Verification[]>;
  compareClaims?(
    caseId: string,
    leftClaimId: string,
    rightClaimId: string,
  ): Promise<unknown>;
  createAttestation?(
    caseId: string,
    input: Record<string, unknown>,
  ): Promise<unknown>;
  verifyAttestation?(
    caseId: string,
    input: Record<string, unknown>,
  ): Promise<unknown>;
  anchorAttestation?(
    caseId: string,
    input: Record<string, unknown>,
  ): Promise<unknown>;
  publishBundle?(
    caseId: string,
    input: Record<string, unknown>,
  ): Promise<unknown>;
}

export interface ApprovalSummary {
  title: string;
  tool: string;
  args: string;
}

export type ApprovalFn = (
  summary: ApprovalSummary,
) => Promise<boolean>;

export type ActivityPhase =
  | "called"
  | "approved"
  | "declined"
  | "ok"
  | "error";

export interface ActivityEvent {
  at: string;
  tool: string;
  phase: ActivityPhase;
  risk: ToolRisk;
  args?: Record<string, unknown>;
  detail?: string;
}

export type ActivitySink = (event: ActivityEvent) => void;

export interface ModelContextLike {
  registerTool(
    tool: {
      name: string;
      title?: string;
      description: string;
      inputSchema?: Record<string, unknown>;
      annotations?: {
        readOnlyHint?: boolean;
        destructiveHint?: boolean;
        consequentialHint?: boolean;
        untrustedContentHint?: boolean;
      };
      execute: (
        input: Record<string, unknown>,
        context?: { signal?: AbortSignal },
      ) => Promise<unknown>;
    },
    options?: { signal?: AbortSignal },
  ): Promise<unknown> | unknown;
}
