# Provenance, attestation, challenge, and anchoring

Issue: #8

Grounding treats blockchain as downstream of evidence and verification.

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

If any condition is unmet, Grounding returns `defer-ledger` and continues with signed evidence, attestations, and append-only provenance.

This is deliberate: adding a chain is not itself evidence of climate impact or truth.

## Ledger adapter boundary

The ledger interface from #18 accepts only:

- evidence-root digest
- attestation digest
- attestation reference

A future adapter may return a network/record ID and status, but it does not receive raw datasets, PDFs, model weights, or signing private keys.

No ledger is used as a shared record keeper, because no case yet passes the ledger decision gate. A public timestamp is a narrower thing and needs no ledger of our own: see [Bitcoin anchor](#bitcoin-anchor).

## Bitcoin anchor

Each case's signed record is timestamped in Bitcoin through [OpenTimestamps](https://opentimestamps.org) calendars, with no wallet, key, fee or account.

What is anchored: SHA-256 over `grounding.anchor` + `grounding.anchor/0.1` + the canonical JSON of `{payload, envelope}`, the signed record including both signatures (`anchoredDigest()` in `packages/core/src/anchor.ts`). Status, lifecycle and challenges are left out because they change after signing. Before submission the digest is extended with a random 16-byte nonce and hashed again, so the calendars never see it.

What it proves: the signed record existed by the time of the block that commits to it. A key stolen later cannot backdate a record to before that block.

What it does not prove:

- that the claim is true; the anchor covers the record, not the evidence behind it
- when checked offline, that the block header is on Bitcoin's main chain; the check shows the header commits to the record and carries the proof of work its bits declare (at least 10^12 difficulty), which a forger would have to spend; confirming the block hash needs a node or a block explorer
- an exact time: block timestamps can differ from real time by up to about two hours

The calendars are trusted for liveness only: a calendar that is down, or never commits, leaves a proof pending; it cannot make a false proof verify. Three calendars are asked, and one is enough.

Files per case:

- `reports/<case>/anchor.ots`: the proof, in the OpenTimestamps format (our own reader and writer in `packages/core/src/ots.ts`, using WebCrypto and fetch only)
- `reports/<case>/anchor.json`: the anchored digest, the calendars asked, when it was submitted and, once confirmed, the block height, hash and time
- `reports/<case>/headers/<height>.hex`: the 80-byte block header, fetched from blockstream.info and checked against mempool.space

`node scripts/anchor-cases.mjs` stamps any case whose anchor is missing or whose signed record changed. Bitcoin confirms the calendars' commitments within a few hours; `node scripts/anchor-cases.mjs --upgrade` then fetches the finished proofs and headers. `scripts/verify-anchors.mjs` runs in `npm run check:cases`, offline: it recomputes each anchored digest from the committed case, checks the proof commits to it, and for an anchored proof checks the merkle path to the committed header and its proof of work. A pending proof passes and reports when it was submitted.

The design is chain-agnostic. `AnchorAdapter` (`submit`, `upgrade`, `verify`) takes and returns only a 32-byte digest and opaque proof bytes; Bitcoin through OpenTimestamps (`bitcoinOtsAdapter`) is the first adapter, and another chain would be another adapter over the same anchored digest.

Rights: block headers are public chain data. The unit tests use synthetic proof trees and one mainnet header (block 358391); the OpenTimestamps project's example proofs are not vendored, because their licence is not stated.

## Invariants

- ledger history proves commitment/history, not physical truth
- signatures prove that keys signed exact bytes, not that measurements were truthful
- changed evidence requires a new current verification/attestation
- historical attestations remain attributable to the exact old bytes
- provenance remains traversable without access to a blockchain
- raw and large data stay off-chain
