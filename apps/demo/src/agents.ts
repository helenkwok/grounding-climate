// The agent surface: every module's tools registered through WebMCP when the browser offers document.modelContext,
// gated by the open case's capabilities, with a fallback executor for browsers without it. Importing this module
// rebuilds the six claims and activates the surface once.
import {
  GROUNDING_SCHEMA_VERSION,
  type ClimateCaseBundle,
  type ClimateNode,
  type ContentDigest,
  type NodeRef,
  type Claim,
  type Verification,
  type VerificationCheck,
  type VerificationResult,
} from "@grounding-climate/core";
import {
  ActivityLog,
  ClimateCapabilityRegistry,
  DynamicClimateWebMcp,
  createRoutedModule,
  type ClimateWorkspace,
  type ModuleCommandRouter,
} from "@grounding-climate/webmcp";

import {
  adviceRuns,
  buildingCaseId,
  caseRun,
  checkBuilding,
  mlDsaVerifier,
  service as buildingService,
  setTampered,
  type LiveCheck,
} from "./building-live.js";
import {
  batteryCaseId,
  batteryRun,
  batteryService,
  checkBattery,
  setBatteryTampered,
  type BatteryCheck,
} from "./battery-live.js";
import {
  checkEnergy,
  energyCaseId,
  energyRun,
  energyService,
  setEnergyTampered,
  type EnergyCheck,
} from "./energy-live.js";
import { renderCaseMap } from "./map-view.js";
import {
  carbonCaseId,
  carbonRun,
  carbonService,
  checkCarbon,
  setCarbonTampered,
  type CarbonCheck,
} from "./carbon-live.js";
import {
  checkDisclosure,
  disclosureCaseId,
  disclosureInput,
  disclosureRun,
  disclosureService,
  setDisclosureTampered,
  type DisclosureCheck,
} from "./disclosure-live.js";
import { checkEarth, earthCaseId, earthRun, earthService, setEarthTampered, type EarthCheck } from "./earth-live.js";
import batteryReport from "../../../reports/battery-dpp/batterylife-calb-smoke.json";
import cadi from "../../../sources/cadi-candidates.json";

import {
  batteryModule,
  boundaryRows,
  buildingModule,
  carbonModule,
  deriveResult,
  disclosureModule,
  earthModule,
  energyModule,
  short,
  type DemoModule,
} from "./modules.js";

const modules: DemoModule[] = [
  buildingModule(await checkBuilding()),
  energyModule(await checkEnergy()),
  earthModule(await checkEarth()),
  batteryModule(await checkBattery()),
  carbonModule(await checkCarbon()),
  disclosureModule(await checkDisclosure()),
];

const moduleById = new Map(modules.map((item) => [item.id, item]));

function reportEvidence(id: string, source: string, digest?: ContentDigest) {
  return {
    nodeType: "evidence" as const,
    id: "evidence:demo:" + id,
    createdAt: "2026-09-30T00:00:00Z",
    provenance: [],
    kind: "dataset" as const,
    source: {
      localRef: "committed measured report",
      publisher: source,
      retrievedAt: "2026-09-30T00:00:00Z",
    },
    ...(digest ? { integrity: digest } : {}),
    rights: {
      redistribution: "allowed" as const,
      attribution: source,
    },
  };
}

const demoEvidence = modules.map((item) =>
  reportEvidence(item.id, item.source, item.digest),
);

const demoClaims = modules.map((item) => ({
  nodeType: "claim" as const,
  id: "claim:demo:" + item.id,
  createdAt: "2026-09-30T00:00:00Z",
  provenance: [
    {
      nodeType: "evidence" as const,
      id: "evidence:demo:" + item.id,
      role: "measured-report",
    },
  ],
  subject: {
    id: "demo:" + item.id,
    kind: "other" as const,
    name: item.title,
  },
  assertion: {
    kind: "qualitative" as const,
    statement: item.kicker + "; key measured result: " + item.kpi + " " + item.kpiLabel,
  },
  assessments: [
    { dimension: "source-found" as const, state: "confirmed" as const },
    item.digest
      ? {
          dimension: "evidence-integrity-confirmed" as const,
          state: "confirmed" as const,
          note: item.digest.algorithm + " digest recorded by the module's smoke run",
        }
      : { dimension: "evidence-integrity-confirmed" as const, state: "not-assessed" as const },
  ],
}));


const demoVerifications: Verification[] = modules.map((item) => ({
  nodeType: "verification",
  id: "verification:demo:" + item.id,
  createdAt: "2026-09-30T00:00:00Z",
  provenance: [
    {
      nodeType: "claim",
      id: "claim:demo:" + item.id,
      role: "claim-under-review",
    },
  ],
  verifier: {
    id: "service:grounding-demo",
    kind: "service",
    name: "Grounding measured-report workspace",
  },
  profile: "demo-report/0.1",
  result: deriveResult(item.checks),
  checks: item.checks,
  findings: [item.limitation],
  verifiedAt: "2026-09-30T00:00:00Z",
}));

const demoCase: ClimateCaseBundle = {
  schemaVersion: GROUNDING_SCHEMA_VERSION,
  caseId: "case:grounding-demo",
  title: "Grounding multi-capability evidence workspace",
  capabilities: [
    "building-meter-mrv",
    "carbon-recalculation",
    "renewable-forecasting",
    "earth-observation",
    "battery-dpp",
    "carbon-registry",
    "public-disclosure",
    "claim-reconciliation",
  ],
  createdAt: "2026-09-30T00:00:00Z",
  claims: demoClaims,
  evidence: demoEvidence,
  calculations: [],
  factors: [],
  modelRuns: [],
  verifications: demoVerifications,
  attestations: [],
  anchors: [],
};

class DemoWorkspace implements ClimateWorkspace {
  async getCase(caseId?: string): Promise<ClimateCaseBundle | undefined> {
    if (caseId === buildingCaseId) return (await buildingService.decidedCase()).climateCase;
    if (caseId === batteryCaseId) return (await batteryService.passport()).caseBundle;
    if (caseId === energyCaseId) return (await energyService.build()).caseBundle;
    if (caseId === earthCaseId) return (await earthService.build()).caseBundle;
    if (caseId === carbonCaseId) return (await carbonService.review()).caseBundle;
    if (caseId === disclosureCaseId) return (await disclosureService.review()).caseBundle;
    return !caseId || caseId === demoCase.caseId ? demoCase : undefined;
  }

  async listCases(): Promise<ClimateCaseBundle[]> {
    return [
      demoCase,
      (await buildingService.decidedCase()).climateCase,
      (await batteryService.passport()).caseBundle,
      (await energyService.build()).caseBundle,
      (await earthService.build()).caseBundle,
      (await disclosureService.review()).caseBundle,
      (await carbonService.review()).caseBundle,
    ];
  }

  async getNode(
    caseId: string,
    ref: NodeRef,
  ): Promise<ClimateNode | undefined> {
    const bundle = await this.getCase(caseId);
    if (!bundle) return undefined;
    const groups: ClimateNode[][] = [
      bundle.claims,
      bundle.evidence,
      bundle.calculations,
      bundle.factors,
      bundle.modelRuns,
      bundle.verifications,
      bundle.attestations,
      bundle.anchors,
    ];
    return groups.flat().find(
      (node) => node.nodeType === ref.nodeType && node.id === ref.id,
    );
  }

  async listChecks(caseId: string): Promise<Verification[]> {
    return (await this.getCase(caseId))?.verifications ?? [];
  }

  async compareClaims(
    caseId: string,
    leftClaimId: string,
    rightClaimId: string,
  ) {
    if (caseId !== demoCase.caseId) throw new Error("Unknown demo case.");
    return {
      left: demoCase.claims.find((claim) => claim.id === leftClaimId) ?? null,
      right: demoCase.claims.find((claim) => claim.id === rightClaimId) ?? null,
      note: "Comparison preserves module-specific limitations; unlike metrics are not collapsed into one score.",
    };
  }
}


const router: ModuleCommandRouter = {
  async execute(moduleId, toolName, input) {
    const item = moduleById.get(moduleId);
    if (!item) throw new Error("Unknown demo module: " + moduleId);
    // Building runs the real service on the committed data, the same one the page renders from.
    if (moduleId === "building") return buildingService.execute("building-mrv", toolName, input);
    if (moduleId === "battery") return batteryService.execute("battery-dpp", toolName, input);
    if (moduleId === "energy") return energyService.execute("energy-forecast", toolName, input);
    if (moduleId === "earth") return earthService.execute("earth-observation", toolName, input);
    if (moduleId === "disclosure") {
      return disclosureService.execute("disclosure", toolName, {
        candidateId: disclosureInput.candidateId,
        claimId: disclosureInput.claimId,
        ...input,
      });
    }
    if (moduleId === "carbon") return carbonService.execute("carbon-registry", toolName, { ...input, caseId: carbonCaseId });
    throw new Error("Unknown demo module: " + moduleId);
  },
};

const registry = new ClimateCapabilityRegistry()
  .register(
    createRoutedModule({
      id: "building",
      title: "Building MRV",
      capabilities: ["building-meter-mrv", "carbon-recalculation"],
      toolNames: [
        "building_get_meter_series",
        "building_detect_anomalies",
        "building_run_baseline",
        "building_reconstruct_emissions",
        "building_review_flags",
      ],
      router,
    }),
  )
  .register(
    createRoutedModule({
      id: "energy",
      title: "Renewable / load forecasting",
      capabilities: ["renewable-forecasting"],
      toolNames: [
        "energy_run_forecast",
        "energy_compare_baseline",
        "energy_prepare_bounded_action",
      ],
      router,
    }),
  )
  .register(
    createRoutedModule({
      id: "earth",
      title: "Earth observation",
      capabilities: ["earth-observation"],
      toolNames: [
        "earth_run_detector",
        "earth_compare_ground_truth",
        "earth_get_scene_provenance",
      ],
      router,
    }),
  )
  .register(
    createRoutedModule({
      id: "battery",
      title: "Battery DPP",
      capabilities: ["battery-dpp"],
      toolNames: [
        "battery_predict_health",
        "battery_compare_baseline",
        "battery_build_passport_claim",
      ],
      router,
    }),
  )
  .register(
    createRoutedModule({
      id: "carbon",
      title: "Carbon registry",
      capabilities: ["carbon-registry"],
      toolNames: [
        "carbon_reconcile_registry_records",
        "carbon_check_retirement",
        "carbon_check_duplicate_claim",
        "carbon_import_registry_report",
        "carbon_review_records",
      ],
      router,
    }),
  )
  .register(
    createRoutedModule({
      id: "disclosure",
      title: "Public disclosure",
      capabilities: ["public-disclosure", "claim-reconciliation"],
      toolNames: [
        "disclosure_get_public_claim",
        "disclosure_extract_report_claims",
        "disclosure_reconcile_claim",
        "disclosure_review_claim",
      ],
      router,
    }),
  );

const activity = new ActivityLog();
const workspace = new DemoWorkspace();

const webmcp = new DynamicClimateWebMcp({
  registry,
  workspace,
  approve: async (summary) =>
    window.confirm(
      "Grounding requires your approval before this consequential operation.\n\n" +
        summary.title +
        "\n" +
        summary.tool +
        "\n\n" +
        summary.args,
    ),
  activity: activity.sink,
});

const surface = webmcp.activate(demoCase.capabilities);


export { activity, demoCase, surface };

/** The guided audit: the same tool calls an agent would make, run through the fallback executor. */
export async function guidedAudit(onCall?: () => void): Promise<void> {
  const calls: Array<[string, Record<string, unknown>]> = [
    ["climate_list_capabilities", { caseId: demoCase.caseId }],
    ["building_run_baseline", { caseId: buildingCaseId }],
    ["building_review_flags", { caseId: buildingCaseId }],
    ["building_reconstruct_emissions", { caseId: buildingCaseId }],
    ["carbon_review_records", { caseId: carbonCaseId }],
    ["disclosure_get_public_claim", { caseId: demoCase.caseId }],
  ];
  for (const [tool, input] of calls) {
    await surface.executeFallback(tool, input);
    onCall?.();
  }
}
