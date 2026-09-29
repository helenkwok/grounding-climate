# ClimateChain

Evidence-first climate verification workspace for the IEEE ClimateChain Global Hackathon 2026.

The project is organised around verifiable climate claims rather than tokens:

```text
evidence
→ deterministic/model analysis
→ claim
→ verification
→ attestation
→ optional commitment/ledger anchor
```

Development roadmap: see [#17](https://github.com/helenkwok/climatechain/issues/17).

## Current work

- [#6](https://github.com/helenkwok/climatechain/issues/6) — evidence-first domain model
- [#14](https://github.com/helenkwok/climatechain/issues/14) — source rights manifest
- [#18](https://github.com/helenkwok/climatechain/issues/18) — crypto-agile trust layer
- [#8](https://github.com/helenkwok/climatechain/issues/8) — provenance/attestation lifecycle
- [#7](https://github.com/helenkwok/climatechain/issues/7) — capability-aware WebMCP surface

## External data policy

Raw external datasets and reports are not committed unless redistribution rights are explicit.

The authoritative project audit is [`sources/rights-manifest.json`](sources/rights-manifest.json). Unknown rights fail closed: use the upstream source, but do not redistribute its bytes.

- [Source-rights policy](docs/source-rights.md)
- [Generated source attribution](docs/source-attribution.md)

Run:

```bash
npm run check
```

This builds/tests the core domain model, validates the source-rights manifest, rejects unauthorized content under `data/external/`, and checks that generated attribution is current.
