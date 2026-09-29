import type {
  ClimateCapability,
  ClimateModule,
  ClimateToolDefinition,
} from "./types.js";

export class ClimateCapabilityRegistry {
  private readonly modules = new Map<string, ClimateModule>();

  register(module: ClimateModule): this {
    if (this.modules.has(module.id)) {
      throw new Error('Climate module "' + module.id + '" is already registered.');
    }

    const toolNames = new Set<string>();
    for (const existing of this.modules.values()) {
      for (const tool of existing.tools) toolNames.add(tool.name);
    }
    for (const tool of module.tools) {
      if (toolNames.has(tool.name)) {
        throw new Error('Climate tool "' + tool.name + '" is already registered.');
      }
      toolNames.add(tool.name);
    }

    this.modules.set(module.id, module);
    return this;
  }

  unregister(moduleId: string): boolean {
    return this.modules.delete(moduleId);
  }

  manifests(): Array<Pick<ClimateModule, "id" | "title" | "capabilities">> {
    return [...this.modules.values()]
      .map((module) => ({
        id: module.id,
        title: module.title,
        capabilities: [...module.capabilities],
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  capabilities(): ClimateCapability[] {
    return [
      ...new Set(
        [...this.modules.values()].flatMap((module) => module.capabilities),
      ),
    ].sort();
  }

  tools(
    activeCapabilities?: readonly ClimateCapability[],
  ): ClimateToolDefinition[] {
    const active = activeCapabilities
      ? new Set<ClimateCapability>(activeCapabilities)
      : undefined;

    return [...this.modules.values()]
      .flatMap((module) => module.tools)
      .filter((tool) => {
        const required = tool.requiredCapabilities ?? [];
        return !active || required.every((capability) => active.has(capability));
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  moduleForTool(toolName: string): ClimateModule | undefined {
    return [...this.modules.values()].find((module) =>
      module.tools.some((tool) => tool.name === toolName),
    );
  }
}
