# EVM anchor and double-use guard

`contracts/src/RetirementRegistry.sol` is one small Solidity contract with two jobs:

- **Double-use guard.** It records a credit retirement once, and refuses a second on-chain retirement of the same
  credits (ICVCM criterion 6.2, no double use; see the [Scoreboard](carbon-registry.md#scoreboard-each-registrys-published-records-checked-against-themselves)).
- **EVM anchor.** `anchor(bytes32 digest)` emits `Anchored(digest, sender, time)`, so a signed case record's anchored
  digest can be committed to an EVM chain as well as to Bitcoin ([Bitcoin anchor](provenance-attestation.md#bitcoin-anchor)).

`packages/core/src/evm.ts` is the matching `AnchorAdapter`, over raw JSON-RPC with `fetch` and hand-written ABI
encoding. It has no runtime dependency and never holds a key.

It runs only on a local dev chain (anvil) so far.

## What the contract enforces

A credit series is named by the issuing registry and the registry's own series id, for example a project, vintage and
batch prefix. Credits in a series are numbered serials. `retire(registry, series, first, last, hintPrev, claimDigest,
evidence)` retires the inclusive serial range `[first, last]`:

- **Overlaps revert.** Within a series, any range that overlaps one already retired reverts with `AlreadyRetired`.
  That covers the exact same range, a single serial inside an earlier range, and a range straddling either end.
- **Gas stays O(1).** Retired ranges are kept as a sorted linked list. The caller passes `hintPrev`, the first serial
  of the retired range just below the new one (0 if none), which an off-chain reader finds from the `Retired` logs.
  The contract checks the hint, so a wrong hint reverts (`BadHint`) and cannot hide an overlap.
- **Keys.** `seriesKey = keccak256(abi.encode(registry, series))` and `unitKey = keccak256(abi.encode(seriesKey,
  first, last))`. A unit with no numeric serial is a series of its own, with `first = last = 1`.
- **Records.** Each retirement stores the beneficiary claim hash, the evidence digest (for example Grounding's
  anchored digest, or a CID's multihash digest), the recorder and the block time. It emits
  `Retired(bytes32 indexed unitKey, bytes32 claimDigest, address recorder, uint256 time)`.

## What it does not enforce

- **A registry can still issue twice.** If the same tonne is issued under two series ids, the contract sees two series.
- **Off-chain retirements are invisible to it.** A credit retired in a registry's own database and again on chain is
  not caught. The guard only refuses a second *on-chain* retirement of overlapping serials.
- **The registry name is a claim.** Anyone may record, and nothing checks that the recorder speaks for the registry
  named in the key. The record says who claimed it (`recorder`), not that the registry agreed.
- **The claim itself is not checked.** Like the Bitcoin anchor, it proves a record existed by a block's time.

A real deployment would restrict recorders to the registries themselves, run as a consortium. The real-world precedent
is the Climate Action Data Trust (CAD Trust): a shared metadata layer that registries publish their issuances and
retirements to.

## No tokens, no payments, no owner

The contract has no token, no transfer, no payable function and no owner or admin role. There is nothing of value to
hold or steal, and no privilege to capture. Tokenising credits would add what the guard does not need: custody,
pricing and a second ledger that could disagree with the registry. One record per retirement is enough to refuse a
second one.

## Chain naming (CAIP-2)

The adapter names its chain with CAIP-2: `eip155:<chainId>`. The local anvil chain is `eip155:31337`; Sepolia is
`eip155:11155111`. CAIP-2 has no transaction reference format, so the EVM proof is our own small JSON:
`{chain, contract, digest, txHash}`.

## The adapter (`evm.ts`)

- **`submit(digest)`** returns the unsigned request `{to, data}` for `anchor(digest)` and a proof without a
  transaction. The caller's wallet sends the request (in the browser, MetaMask through EIP-1193), then
  `withTransaction(proof, txHash)` records the hash.
- **`upgrade(proof)`** finds the transaction from the contract's `Anchored` logs (`eth_getLogs`) if the hash was not
  recorded.
- **`verify(proof, digest)`** reports one of three statuses:
  - `invalid` if the RPC is on another chain, the transaction reverted, or it has no `Anchored` log from the contract
    carrying the digest;
  - `pending` if nothing is mined yet;
  - `anchored` otherwise, with the block number, hash and time.
- **Helpers.** `encodeRetire` and `decodeRetiredLog` build `retire(...)` calls and read `Retired` logs.

The event topics and selectors are fixed constants, computed with `cast` and checked by the tests: the unit test
compares `encodeRetire` with `cast calldata`, and the integration test uses them against the deployed contract.

## Tests and tools

| Tool | Version | How it is pinned |
| --- | --- | --- |
| Foundry (`forge`, `anvil`, `cast`) | v1.8.5 (commit `51a52c59`) | Local: `npm run contracts:install` (`scripts/install-foundry.sh`) downloads the GitHub release into the gitignored `tools/foundry` and checks its SHA-256 against the digest GitHub records for the asset. CI: `foundry-rs/foundry-toolchain` v1.9.1, pinned by commit, with `version: v1.8.5` |
| Solidity | 0.8.37 | `pragma solidity 0.8.37` and `solc_version` in `contracts/foundry.toml`. Forge fetches it from binaries.soliditylang.org and checks the published checksum |

Foundry was chosen over the npm `solc` package because it gives a compiler, a test runner and a local chain in one
pinned, checksummed release, and adds nothing to `package.json`. The tests use no `forge-std`: the few cheatcodes they
need are declared in the test file.

- `npm run contracts:test` runs `forge test`, then the anvil integration test, which may not skip there.
- `forge test` covers the first retirement (stored fields and event), a second retirement of the same unit,
  overlapping ranges, different units (adjacent ranges, another series, another registry), wrong hints, empty ranges
  and the anchor event.
- `packages/core/test/evm-anvil.test.ts` is the integration test:
  1. starts anvil;
  2. deploys with anvil's first well-known dev account, which is unlocked, so no key is handled;
  3. anchors the building case's anchored digest and verifies it through `evm.ts`;
  4. retires serials 1 to 100 and checks the `Retired` log;
  5. checks that the same range, and an overlapping 50 to 150, revert with `AlreadyRetired`.

  Under `npm run check` it skips when Foundry is not installed.
- CI runs `contracts:test` in the `contracts` job.

## Planned: Sepolia, through MetaMask

Not done yet. Nothing in the repo holds a key or sends a transaction to a public network. The plan:

1. Helen deploys `RetirementRegistry` to Sepolia (`eip155:11155111`) from her own MetaMask, approving the
   transaction there. The bytecode is `contracts/out/RetirementRegistry.sol/RetirementRegistry.json` after `forge
   build`. The site would send it through EIP-1193 (`eth_sendTransaction` with no `to`).
2. The deployed address and the transaction hash are committed, so anyone can check the bytecode against a build of
   the pinned source.
3. Each case's anchored digest is sent with `submit()`'s request, and each transaction is approved in MetaMask. The
   proofs (`{chain, contract, digest, txHash}`) are committed next to the Bitcoin ones.
4. `verify()` runs against any public Sepolia RPC.

## Limits

- **A testnet is a demonstration.** Sepolia's ether has no value and its history depends on its validators; it shows
  the mechanism works on a public EVM chain, nothing more. The Bitcoin anchor remains the timestamp that carries weight.
- **Production would be a consortium.** Registries would run a permissioned EVM network (for example Hyperledger
  Besu) with recorders restricted to registries. That fits the ledger decision gate in
  [provenance-attestation.md](provenance-attestation.md) only if several independent parties write to it.
- **The adapter trusts the RPC it is given.** `verify()` checks the receipt and logs the node returns. It does not
  check headers or proof of stake. For an independent check, ask a second RPC or run a node.
