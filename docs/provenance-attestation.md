# Provenance, attestation, challenge, and anchoring

Issue: #8

ClimateChain treats blockchain as downstream of evidence and verification.

```text
source evidence
→ calculation / model output
→ provenance graph
→ verification
→ signed attestation
→ signed append-only log
→ optional external/ledger commitment
```

## Evidence manifest and root

`createEvidenceRoot()` starts from one or more root nodes, walks all upstream provenance, then records a deterministic manifest containing:

- case ID and schema version
- normalized root references
- every included node reference
- a SHA-256 digest of each domain-separated canonical node

The manifest itself is then domain-separated and hashed to form the **evidence root**.

For the first hackathon implementation this is a canonical-manifest commitment rather than a Merkle tree. It is intentionally simple to inspect and reproduce. A Merkle structure can be introduced later if selective proofs or very large graphs justify the extra complexity.

The manifest stays off-chain.

## Tamper semantics

An old attestation does not magically validate changed evidence.

```text
evidence A
→ root R1
→ signed attestation A1

change evidence A → A'

current root R2 != R1

A1 remains cryptographically valid for R1
but
A1 is not valid for the current evidence state
```

`verifySignedAttestation()` therefore returns two deliberately separate concepts:

- `validForSignedEvidence` — the stored manifest/root still matches the signed payload and the signatures verify
- `validForCurrentEvidence` — the current case graph also reproduces that same root

It reports changed, missing, and newly introduced provenance nodes.

## Signed attestation bundle

A signed attestation contains:

- attestation ID
- attester identity
- statement
- claim references
- optional verification reference
- evidence root
- manifest version
- issue time
- signature envelope
- lifecycle events
- challenges

The actual signatures use the crypto-agile provider from #18. The attestation model itself does not depend on Ed25519, ML-DSA, a wallet, or a chain.

## Lifecycle

Supported statuses are:

```text
pending
attested
challenged
superseded
revoked
final
```

Allowed transitions are explicit. `superseded` and `revoked` are terminal.

Challenges can identify:

- changed source
- conflicting evidence
- recalculation mismatch
- model disagreement
- methodological dispute

Every challenge carries actor, time, reason, and evidence references. Resolution records the new state rather than deleting the dispute history.

## Non-ledger append-only log

`appendSignedLogRecord()` provides a ledger-independent provenance history.

Each record contains:

- monotonically increasing sequence
- timestamp
- previous-record digest
- event payload
- current-record digest
- one or more signatures

`verifySignedLog()` checks:

- hash-chain continuity
- record digest integrity
- signatures

This provides a useful local/server audit mechanism even when a blockchain is not justified.

## Ledger decision gate

`assessLedgerNeed()` requires all four conditions before recommending an external ledger path:

1. multiple independent parties need the same state
2. there is no single trusted record keeper
3. outsiders must later verify historical state
4. the shared state fits a compact commitment

If any condition is unmet, ClimateChain returns `defer-ledger` and continues with signed evidence, attestations, and append-only provenance.

This is deliberate: adding a chain is not itself evidence of climate impact or truth.

## Ledger adapter boundary

The ledger interface from #18 accepts only:

- evidence-root digest
- attestation digest
- attestation reference

A future adapter may return a network/record ID and status, but it does not receive raw datasets, PDFs, model weights, or signing private keys.

No testnet adapter is added in this issue because the project has not yet selected a deployment case whose trust assessment passes the ledger decision gate. When a concrete module/case does pass it, the adapter can be added without changing Claim/Evidence types.

## Invariants

- ledger history proves commitment/history, not physical truth
- signatures prove that keys signed exact bytes, not that measurements were truthful
- changed evidence requires a new current verification/attestation
- historical attestations remain attributable to the exact old bytes
- provenance remains traversable without access to a blockchain
- raw and large data stay off-chain
