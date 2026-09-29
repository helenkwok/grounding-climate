import { domainSeparatedBytes } from "./canonical.js";
import { buildGraphIndex, traceProvenance } from "./graph.js";
import type { CryptoProvider } from "./crypto.js";
import type {
  ClimateCaseBundle,
  ClimateNode,
  ContentDigest,
  NodeRef,
} from "./types.js";

export const EVIDENCE_MANIFEST_VERSION =
  "climatechain.evidence-manifest/0.1" as const;

export interface EvidenceManifestNode {
  ref: NodeRef;
  digest: ContentDigest;
}

export interface EvidenceManifest {
  version: typeof EVIDENCE_MANIFEST_VERSION;
  caseId: string;
  caseSchemaVersion: string;
  rootRefs: NodeRef[];
  nodes: EvidenceManifestNode[];
}

export interface EvidenceRootBundle {
  manifest: EvidenceManifest;
  root: ContentDigest;
}

export interface EvidenceManifestVerification {
  manifestRootMatches: boolean;
  currentEvidenceMatches: boolean;
  currentRoot: ContentDigest;
  changedRefs: NodeRef[];
  missingRefs: NodeRef[];
  unexpectedRefs: NodeRef[];
}

function refKey(ref: NodeRef): string {
  return ref.nodeType + ":" + ref.id;
}

function normalizedRef(ref: NodeRef): NodeRef {
  return {
    nodeType: ref.nodeType,
    id: ref.id,
  };
}

function compareRefs(left: NodeRef, right: NodeRef): number {
  return refKey(left).localeCompare(refKey(right));
}

function sameDigest(left: ContentDigest, right: ContentDigest): boolean {
  return left.algorithm === right.algorithm && left.value === right.value;
}

async function digestNode(
  node: ClimateNode,
  caseSchemaVersion: string,
  hashProvider: CryptoProvider,
): Promise<ContentDigest> {
  const bytes = domainSeparatedBytes(
    "climatechain.evidence-node",
    caseSchemaVersion,
    node,
  );
  return hashProvider.hash(bytes, "SHA-256");
}

async function digestManifest(
  manifest: EvidenceManifest,
  hashProvider: CryptoProvider,
): Promise<ContentDigest> {
  const bytes = domainSeparatedBytes(
    "climatechain.evidence-manifest",
    manifest.version,
    manifest,
  );
  return hashProvider.hash(bytes, "SHA-256");
}

export async function createEvidenceRoot(
  bundle: ClimateCaseBundle,
  rootRefs: readonly NodeRef[],
  hashProvider: CryptoProvider,
): Promise<EvidenceRootBundle> {
  if (rootRefs.length === 0) {
    throw new Error("Evidence manifest requires at least one root reference.");
  }

  const index = buildGraphIndex(bundle);
  const normalizedRoots = [...new Map(
    rootRefs.map((ref) => [refKey(ref), normalizedRef(ref)]),
  ).values()].sort(compareRefs);

  const included = new Map<string, ClimateNode>();

  for (const root of normalizedRoots) {
    if (!index.has(refKey(root))) {
      throw new Error("Evidence root reference does not exist: " + refKey(root));
    }

    for (const node of traceProvenance(bundle, root)) {
      included.set(refKey(node), node);
    }
  }

  const nodes: EvidenceManifestNode[] = [];
  for (const node of [...included.values()].sort((left, right) =>
    refKey(left).localeCompare(refKey(right)),
  )) {
    nodes.push({
      ref: normalizedRef(node),
      digest: await digestNode(node, bundle.schemaVersion, hashProvider),
    });
  }

  const manifest: EvidenceManifest = {
    version: EVIDENCE_MANIFEST_VERSION,
    caseId: bundle.caseId,
    caseSchemaVersion: bundle.schemaVersion,
    rootRefs: normalizedRoots,
    nodes,
  };

  return {
    manifest,
    root: await digestManifest(manifest, hashProvider),
  };
}

export async function verifyEvidenceRoot(
  bundle: ClimateCaseBundle,
  expected: EvidenceRootBundle,
  hashProvider: CryptoProvider,
): Promise<EvidenceManifestVerification> {
  const storedManifestRoot = await digestManifest(
    expected.manifest,
    hashProvider,
  );
  const manifestRootMatches = sameDigest(storedManifestRoot, expected.root);

  const current = await createEvidenceRoot(
    bundle,
    expected.manifest.rootRefs,
    hashProvider,
  );

  const expectedByRef = new Map(
    expected.manifest.nodes.map((node) => [refKey(node.ref), node]),
  );
  const currentByRef = new Map(
    current.manifest.nodes.map((node) => [refKey(node.ref), node]),
  );

  const changedRefs: NodeRef[] = [];
  const missingRefs: NodeRef[] = [];
  const unexpectedRefs: NodeRef[] = [];

  for (const [key, node] of expectedByRef) {
    const currentNode = currentByRef.get(key);
    if (!currentNode) {
      missingRefs.push(node.ref);
      continue;
    }

    if (!sameDigest(node.digest, currentNode.digest)) {
      changedRefs.push(node.ref);
    }
  }

  for (const [key, node] of currentByRef) {
    if (!expectedByRef.has(key)) {
      unexpectedRefs.push(node.ref);
    }
  }

  changedRefs.sort(compareRefs);
  missingRefs.sort(compareRefs);
  unexpectedRefs.sort(compareRefs);

  const currentEvidenceMatches =
    manifestRootMatches &&
    sameDigest(current.root, expected.root) &&
    changedRefs.length === 0 &&
    missingRefs.length === 0 &&
    unexpectedRefs.length === 0;

  return {
    manifestRootMatches,
    currentEvidenceMatches,
    currentRoot: current.root,
    changedRefs,
    missingRefs,
    unexpectedRefs,
  };
}
