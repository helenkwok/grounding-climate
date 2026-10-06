export const GROUNDING_SCHEMA_VERSION = "grounding.case/0.1" as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type NodeType =
  | "claim"
  | "evidence"
  | "calculation"
  | "factor"
  | "model-run"
  | "verification"
  | "attestation"
  | "anchor";

export interface NodeRef {
  nodeType: NodeType;
  id: string;
  role?: string;
}

export interface BaseNode {
  nodeType: NodeType;
  id: string;
  createdAt: string;
  updatedAt?: string;
  provenance: NodeRef[];
  extensions?: JsonObject;
}

export interface SubjectRef {
  id: string;
  kind: "organisation" | "asset" | "site" | "product" | "project" | "dataset" | "area" | "other";
  name?: string;
}

export interface TemporalScope {
  start?: string;
  end?: string;
  label?: string;
}

export interface SpatialScope {
  label: string;
  geometryRef?: string;
}

export interface Uncertainty {
  kind: "standard-deviation" | "confidence-interval" | "range" | "other";
  value?: number;
  lower?: number;
  upper?: number;
  confidenceLevel?: number;
  unit?: string;
  note?: string;
}

export interface Quantity {
  value: number;
  unit: string;
  uncertainty?: Uncertainty;
}

export interface QuantitativeAssertion {
  kind: "quantitative";
  metric: string;
  quantity: Quantity;
}

export interface QualitativeAssertion {
  kind: "qualitative";
  statement: string;
}

export type ClaimAssertion = QuantitativeAssertion | QualitativeAssertion;

export type ClaimAssessmentDimension =
  | "disclosed"
  | "source-found"
  | "calculation-reproduced"
  | "factor-traced"
  | "evidence-integrity-confirmed"
  | "third-party-assured"
  | "attested"
  | "anchored"
  | "disputed";

export type AssessmentState =
  | "not-assessed"
  | "confirmed"
  | "failed"
  | "not-applicable"
  | "challenged";

export interface ClaimAssessment {
  dimension: ClaimAssessmentDimension;
  state: AssessmentState;
  assessedAt?: string;
  note?: string;
}

export interface AccountingBoundary {
  /** What the claim counts. */
  included: string[];
  /** What it deliberately leaves out. */
  excluded: string[];
  /** Choices a person or a policy made, which another reviewer could make differently. */
  policyChoices: string[];
  /** Properties the claim says nothing about. */
  notAssessed: string[];
}

/**
 * How a reviewer obtains the data behind a piece of evidence. "committed": in the repository, where the
 * licence allows it. "reviewer-supplied": the reviewer gets it from the source and brings it; only its
 * digest is kept. "link-only": the source can be read where it is published, but not copied.
 */
export interface EvidenceAccess {
  mode: "committed" | "reviewer-supplied" | "link-only";
  instructions?: string;
}

export interface Claim extends BaseNode {
  nodeType: "claim";
  subject: SubjectRef;
  assertion: ClaimAssertion;
  temporalScope?: TemporalScope;
  spatialScope?: SpatialScope;
  boundary?: {
    scopes?: string[];
    methodology?: string;
    organisationalBoundary?: string;
    notes?: string;
    /**
     * The accounting boundary: policy judgements about what the claim counts, kept apart from how it was
     * measured (calculations, factors and model runs). After CarbonPlan and CRSI, "Recentering goals" (2026).
     */
    accounting?: AccountingBoundary;
  };
  assessments: ClaimAssessment[];
}

export type EvidenceKind =
  | "public-disclosure"
  | "report"
  | "meter-data"
  | "satellite-image"
  | "supplier-declaration"
  | "registry-record"
  | "dataset"
  | "model-input"
  | "calculation-input"
  | "other";

export interface ContentDigest {
  algorithm: string;
  value: string;
}

export interface RightsMetadata {
  sourceManifestId?: string;
  licence?: string;
  termsUri?: string;
  redistribution: "allowed" | "prohibited" | "unclear";
  attribution?: string;
  commercialUse?: "allowed" | "prohibited" | "unclear";
  derivedData?: "allowed" | "prohibited" | "unclear";
}

export interface Evidence extends BaseNode {
  nodeType: "evidence";
  kind: EvidenceKind;
  source: {
    uri?: string;
    localRef?: string;
    publisher?: string;
    owner?: string;
    retrievedAt: string;
  };
  integrity?: ContentDigest;
  rights?: RightsMetadata;
  access?: EvidenceAccess;
  temporalCoverage?: TemporalScope;
  spatialCoverage?: SpatialScope;
  signer?: {
    subjectId: string;
    keyId?: string;
    signatureRef?: string;
  };
}

export interface ReproducibilityMetadata {
  codeRepository?: string;
  codeCommit?: string;
  codeVersion?: string;
  runtimeDigest?: string;
  dependencyLockDigest?: string;
  sbomRef?: string;
  hardware?: string;
  quantisation?: string;
}

export interface Calculation extends BaseNode {
  nodeType: "calculation";
  method: {
    id: string;
    name: string;
    version?: string;
  };
  parameters: JsonObject;
  output: ClaimAssertion;
  executedAt: string;
  reproducibility: ReproducibilityMetadata;
}

export interface Factor extends BaseNode {
  nodeType: "factor";
  factorType: string;
  value: number;
  unit: string;
  geography?: string;
  effectivePeriod?: TemporalScope;
  sourceOrganisation: string;
  sourceDocument?: string;
  method?: string;
  accountingBasis?: "location-based" | "market-based" | "other";
  retrievedAt: string;
  integrity?: ContentDigest;
}

export interface BenchmarkResult {
  metric: string;
  value: number;
  baselineValue?: number;
  splitRef?: string;
  notes?: string;
}

export interface ModelRun extends BaseNode {
  nodeType: "model-run";
  model: {
    id: string;
    name: string;
    version?: string;
    weightsDigest?: ContentDigest;
  };
  inputDigest?: ContentDigest;
  preprocessingVersion?: string;
  inferenceParameters: JsonObject;
  randomSeed?: number;
  output: ClaimAssertion;
  confidence?: number;
  benchmark?: BenchmarkResult;
  executedAt: string;
  reproducibility: ReproducibilityMetadata;
}

export type VerificationResult =
  | "reconciled"
  | "mismatch"
  | "insufficient-evidence"
  | "source-changed"
  | "methodology-mismatch"
  | "factor-mismatch"
  | "model-outside-acceptance-range";

export interface VerificationCheck {
  id: string;
  name: string;
  outcome: "pass" | "fail" | "warn" | "not-run";
  detail?: string;
}

export interface Verification extends BaseNode {
  nodeType: "verification";
  verifier: {
    id: string;
    kind: "person" | "organisation" | "service" | "agent";
    name?: string;
  };
  profile: string;
  result: VerificationResult;
  checks: VerificationCheck[];
  findings: string[];
  verifiedAt: string;
}

export type AttestationStatus =
  | "pending"
  | "attested"
  | "challenged"
  | "superseded"
  | "revoked"
  | "final";

export interface SignatureReference {
  suite: string;
  algorithm: string;
  keyId: string;
  value: string;
}

export interface Attestation extends BaseNode {
  nodeType: "attestation";
  attester: {
    subjectId: string;
    name?: string;
  };
  statement: string;
  evidenceRoot: ContentDigest;
  signatures: SignatureReference[];
  status: AttestationStatus;
  validFrom: string;
  validUntil?: string;
  revokedAt?: string;
  supersededBy?: NodeRef;
}

export interface Anchor extends BaseNode {
  nodeType: "anchor";
  mechanism: string;
  network?: string;
  recordId: string;
  committedDigest: ContentDigest;
  timestamp: string;
  status: "pending" | "confirmed" | "failed";
  finality?: string;
  cost?: {
    amount: number;
    unit: string;
  };
  footprint?: {
    value: number;
    unit: string;
    methodology?: string;
  };
}

export type ClimateNode =
  | Claim
  | Evidence
  | Calculation
  | Factor
  | ModelRun
  | Verification
  | Attestation
  | Anchor;

export interface ClimateCaseBundle {
  schemaVersion: typeof GROUNDING_SCHEMA_VERSION;
  caseId: string;
  title: string;
  capabilities: string[];
  createdAt: string;
  updatedAt?: string;
  claims: Claim[];
  evidence: Evidence[];
  calculations: Calculation[];
  factors: Factor[];
  modelRuns: ModelRun[];
  verifications: Verification[];
  attestations: Attestation[];
  anchors: Anchor[];
  extensions?: JsonObject;
}
