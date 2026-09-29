import type {
  ClimateCaseBundle,
  ClimateNode,
  NodeRef,
  NodeType,
} from "./types.js";

export interface ValidationIssue {
  code: "duplicate-node" | "dangling-reference" | "provenance-cycle";
  message: string;
  node?: NodeRef;
  reference?: NodeRef;
}

function keyOf(ref: NodeRef): string {
  return ref.nodeType + ":" + ref.id;
}

function refOf(node: ClimateNode): NodeRef {
  return { nodeType: node.nodeType, id: node.id };
}

export function listNodes(bundle: ClimateCaseBundle): ClimateNode[] {
  return [
    ...bundle.claims,
    ...bundle.evidence,
    ...bundle.calculations,
    ...bundle.factors,
    ...bundle.modelRuns,
    ...bundle.verifications,
    ...bundle.attestations,
    ...bundle.anchors,
  ];
}

export function buildGraphIndex(
  bundle: ClimateCaseBundle,
): ReadonlyMap<string, ClimateNode> {
  const index = new Map<string, ClimateNode>();

  for (const node of listNodes(bundle)) {
    const key = keyOf(refOf(node));
    if (index.has(key)) {
      throw new Error("Duplicate climate node: " + key);
    }
    index.set(key, node);
  }

  return index;
}

export function getNode(
  bundle: ClimateCaseBundle,
  ref: NodeRef,
): ClimateNode | undefined {
  return buildGraphIndex(bundle).get(keyOf(ref));
}

export function traceProvenance(
  bundle: ClimateCaseBundle,
  start: NodeRef,
): ClimateNode[] {
  const index = buildGraphIndex(bundle);
  const result: ClimateNode[] = [];
  const visited = new Set<string>();

  function visit(ref: NodeRef): void {
    const key = keyOf(ref);
    if (visited.has(key)) {
      return;
    }

    const node = index.get(key);
    if (!node) {
      throw new Error("Dangling provenance reference: " + key);
    }

    visited.add(key);
    result.push(node);

    for (const upstream of node.provenance) {
      visit(upstream);
    }
  }

  visit(start);
  return result;
}

export function validateBundle(bundle: ClimateCaseBundle): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const nodes = listNodes(bundle);
  const index = new Map<string, ClimateNode>();

  for (const node of nodes) {
    const ref = refOf(node);
    const key = keyOf(ref);
    if (index.has(key)) {
      issues.push({
        code: "duplicate-node",
        message: "Duplicate climate node: " + key,
        node: ref,
      });
      continue;
    }
    index.set(key, node);
  }

  for (const node of nodes) {
    for (const upstream of node.provenance) {
      if (!index.has(keyOf(upstream))) {
        issues.push({
          code: "dangling-reference",
          message:
            "Node " +
            keyOf(refOf(node)) +
            " references missing " +
            keyOf(upstream),
          node: refOf(node),
          reference: upstream,
        });
      }
    }
  }

  const permanent = new Set<string>();
  const active = new Set<string>();
  const cycleKeys = new Set<string>();

  function detect(node: ClimateNode): void {
    const key = keyOf(refOf(node));
    if (permanent.has(key)) {
      return;
    }
    if (active.has(key)) {
      cycleKeys.add(key);
      return;
    }

    active.add(key);
    for (const upstream of node.provenance) {
      const target = index.get(keyOf(upstream));
      if (target) {
        if (active.has(keyOf(upstream))) {
          cycleKeys.add(keyOf(upstream));
          cycleKeys.add(key);
        } else {
          detect(target);
        }
      }
    }
    active.delete(key);
    permanent.add(key);
  }

  for (const node of nodes) {
    detect(node);
  }

  for (const key of [...cycleKeys].sort()) {
    const node = index.get(key);
    if (node) {
      issues.push({
        code: "provenance-cycle",
        message: "Provenance cycle includes " + key,
        node: refOf(node),
      });
    }
  }

  return issues;
}

export function refsByType(
  nodes: readonly ClimateNode[],
  nodeType: NodeType,
): NodeRef[] {
  return nodes
    .filter((node) => node.nodeType === nodeType)
    .map((node) => ({ nodeType: node.nodeType, id: node.id }));
}
