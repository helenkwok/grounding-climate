# Evidence-first domain model

Issue: #6

Grounding models a climate statement as a graph of evidence and transformations. The central object is a **claim**, not a token and not a blockchain transaction.

## Graph

```text
raw/public evidence
      ↓
factor / calculation / model run
      ↓
claim
      ↓
verification
      ↓
attestation
      ↓
optional anchor
```

Every node has a globally meaningful `nodeType + id` pair and an ordered list of upstream `provenance` references. This makes provenance traversal independent of any UI, model provider, signing algorithm, or ledger.

Node kinds:

- `claim` — a quantitative or qualitative statement being checked
- `evidence` — source material such as meter data, reports, satellite imagery, registry records, datasets, or disclosures
- `calculation` — deterministic transformation from upstream nodes
- `factor` — a sourced conversion/emission factor
- `model-run` — an AI/ML execution with model, input, benchmark, and reproducibility metadata
- `verification` — checks over a claim/evidence graph with explicit outcomes and findings
- `attestation` — a signed statement about a claim or verification
- `anchor` — an optional external commitment; it is not evidence of physical truth

## Claim status is multi-dimensional

There is intentionally no generic `verified: boolean`.

A claim can independently be:

- disclosed
- source-found
- calculation-reproduced
- factor-traced
- evidence-integrity-confirmed
- third-party-assured
- attested
- anchored
- disputed

Each dimension has its own state. For example, a public disclosure may be `disclosed=confirmed` and `source-found=confirmed` while `calculation-reproduced=not-assessed`.

This prevents a public source, a correct arithmetic check, a signature, and an external assurance opinion from being conflated.

## Serialization

The JSON envelope is `grounding.case/0.1`.

A bundle contains:

```json
{
  "schemaVersion": "grounding.case/0.1",
  "caseId": "...",
  "title": "...",
  "capabilities": [],
  "createdAt": "...",
  "claims": [],
  "evidence": [],
  "calculations": [],
  "factors": [],
  "modelRuns": [],
  "verifications": [],
  "attestations": [],
  "anchors": []
}
```

Optional fields are omitted rather than serialized as `undefined`.

### Canonical bytes

`canonicalize()` recursively sorts object keys while preserving array order, rejects unsupported/undefined values, and emits deterministic JSON.

`domainSeparatedBytes(domain, schemaVersion, value)` prefixes the canonical bytes with a domain and schema version. Issue #8 can use this as the input to an evidence-root algorithm, and issue #18 can sign the same deterministic bytes without coupling the domain model to Ed25519, ML-DSA, a wallet, or a chain.

The current canonicalizer is a deliberately small project format, not a claim of compliance with RFC 8785/JCS. If interoperability later requires JCS or deterministic CBOR, the schema/version and domain separation allow migration without pretending the encodings are identical.

## Provenance traversal

`traceProvenance(bundle, ref)` performs an upstream traversal from any node.

For example:

```text
claim:scope2
→ calculation:scope2
  → evidence:meter
  → factor:grid
    → evidence:factor-source
```

`validateBundle()` detects duplicate node identities, dangling provenance references, and provenance cycles.

## Reproducibility metadata

Calculations and model runs can retain:

- code repository / commit / version
- runtime/container digest
- dependency-lock digest
- SBOM reference
- preprocessing version
- inference parameters
- random seed
- hardware
- quantisation
- model/weights digest
- benchmark metric and baseline

These fields are descriptive provenance. Whether they are sufficient for reproducibility is a property of a verification profile, not the TypeScript interface itself.

## Source rights

Evidence includes rights metadata because public visibility is not equivalent to redistribution permission.

Until #14 is completed, examples use `redistribution: "unclear"` for third-party data when the licence/terms have not been audited. Large external datasets are not copied into this repository merely to make a demo convenient.

## Examples

### CaDI source example

`packages/core/examples/cadi-source.example.json` represents a real public source-discovery claim: Carbon Footprint Ltd states on its own site that it publishes its carbon footprint on CaDI.

The example deliberately returns `insufficient-evidence` for numeric reconciliation. It proves that a source was located; it does **not** claim that underlying emissions values, factors, or activity data have been independently verified.

Sources:

- https://www.carbonfootprint.com/our_cadi_data.html
- https://www.carbondi.com/

### Benchmark source example

`packages/core/examples/bdg2-source.example.json` records Building Data Genome 2 as the source selected for the building-MRV benchmark path.

It intentionally contains no invented ROC-AUC, RMSLE, forecast score, or other benchmark result. Measured results belong in #9 after code is run against an explicit split/baseline.

Source:

- https://github.com/buds-lab/building-data-genome-project-2

## Invariants

1. An anchor proves a commitment/history property, not real-world truth.
2. A signature proves that a key signed bytes, not that the physical evidence is true.
3. A ZK proof proves a predicate over committed inputs, not the physical truth of those inputs.
4. Derived nodes retain links to their upstream provenance.
5. Consequential model results retain model/input/version/uncertainty information.
6. Raw/large evidence remains off-chain by default.
7. Domain objects do not depend on a blockchain wallet or a specific signature algorithm.

## Next issues

- #14 — formal source-rights manifest
- #8 — deterministic evidence root, attestation lifecycle, challenge, signed log, optional ledger adapter
- #18 — crypto provider, dual classical/PQ signatures, ML-DSA, hybrid PQ TLS
- #7 — capability-aware WebMCP over application services
