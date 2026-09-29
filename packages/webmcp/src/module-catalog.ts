import type {
  ClimateCapability,
  ClimateModule,
  ClimateToolDefinition,
} from "./types.js";

export interface ModuleToolSpec {
  name: string;
  title: string;
  description: string;
  capability: ClimateCapability;
  risk?: "read" | "consequential";
}

export const CLIMATE_MODULE_TOOL_SPECS: ModuleToolSpec[] = [
  { name: "building_get_meter_series", title: "Get building meter series", description: "Get building meter measurements for the active case.", capability: "building-meter-mrv" },
  { name: "building_detect_anomalies", title: "Detect building anomalies", description: "Run the configured building-meter anomaly check.", capability: "building-meter-mrv" },
  { name: "building_run_baseline", title: "Run building baseline", description: "Run the configured building energy baseline.", capability: "building-meter-mrv" },
  { name: "building_reconstruct_emissions", title: "Reconstruct building emissions", description: "Reconstruct emissions using traced activity data and factors.", capability: "carbon-recalculation" },

  { name: "energy_run_forecast", title: "Run renewable forecast", description: "Run a renewable/load/price forecast.", capability: "renewable-forecasting" },
  { name: "energy_compare_baseline", title: "Compare forecast baseline", description: "Compare a renewable forecast against its baseline.", capability: "renewable-forecasting" },
  { name: "energy_prepare_bounded_action", title: "Prepare bounded energy action", description: "Prepare, but do not automatically publish, a bounded energy action.", capability: "renewable-forecasting", risk: "consequential" },

  { name: "earth_run_detector", title: "Run Earth observation detector", description: "Run the configured Earth-observation detector.", capability: "earth-observation" },
  { name: "earth_compare_ground_truth", title: "Compare Earth ground truth", description: "Compare detector output with held-out/reference ground truth.", capability: "earth-observation" },
  { name: "earth_get_scene_provenance", title: "Get scene provenance", description: "Get source and transformation provenance for an Earth-observation scene.", capability: "earth-observation" },

  { name: "battery_predict_health", title: "Predict battery health", description: "Run the configured battery health/RUL model.", capability: "battery-dpp" },
  { name: "battery_compare_baseline", title: "Compare battery baseline", description: "Compare battery model output against its benchmark baseline.", capability: "battery-dpp" },
  { name: "battery_build_passport_claim", title: "Build battery passport claim", description: "Build a passport claim from the measured/modelled battery result.", capability: "battery-dpp" },

  { name: "carbon_reconcile_registry_records", title: "Reconcile carbon registry records", description: "Reconcile carbon-credit records across configured registry sources.", capability: "carbon-registry" },
  { name: "carbon_check_retirement", title: "Check carbon retirement", description: "Check retirement state for a carbon-credit record.", capability: "carbon-registry" },
  { name: "carbon_check_duplicate_claim", title: "Check duplicate carbon claim", description: "Check whether the same registry/credit state appears to be claimed more than once.", capability: "carbon-registry" },

  { name: "disclosure_get_public_claim", title: "Get public disclosure claim", description: "Get a public disclosure claim and its original source reference.", capability: "public-disclosure" },
  { name: "disclosure_extract_report_claims", title: "Extract report claims", description: "Extract scoped claims from a report through the configured application service.", capability: "public-disclosure" },
  { name: "disclosure_reconcile_claim", title: "Reconcile disclosure claim", description: "Reconcile a public disclosure against available calculation/evidence.", capability: "claim-reconciliation" },
];

export interface ModuleCommandRouter {
  execute(
    moduleId: string,
    toolName: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown>;
}

export function createRoutedModule(options: {
  id: string;
  title: string;
  capabilities: ClimateCapability[];
  toolNames: string[];
  router: ModuleCommandRouter;
}): ClimateModule {
  const allowedCapabilities = new Set(options.capabilities);
  const specs = options.toolNames.map((name) => {
    const spec = CLIMATE_MODULE_TOOL_SPECS.find((item) => item.name === name);
    if (!spec) throw new Error('Unknown ClimateChain module tool spec "' + name + '".');
    if (!allowedCapabilities.has(spec.capability)) {
      throw new Error(
        'Tool "' +
          name +
          '" requires capability "' +
          spec.capability +
          '" which module "' +
          options.id +
          '" does not advertise.',
      );
    }
    return spec;
  });

  const tools: ClimateToolDefinition[] = specs.map((spec) => ({
    name: spec.name,
    title: spec.title,
    description: spec.description,
    inputSchema: {
      type: "object",
      properties: {
        caseId: { type: "string" },
      },
      required: ["caseId"],
      additionalProperties: true,
    },
    risk: spec.risk ?? "read",
    requiredCapabilities: [spec.capability],
    execute: (input, context) =>
      options.router.execute(
        options.id,
        spec.name,
        input,
        context.signal,
      ),
  }));

  return {
    id: options.id,
    title: options.title,
    capabilities: [...options.capabilities],
    tools,
  };
}
