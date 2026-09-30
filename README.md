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

## Building MRV prototype

The first analytical module is documented in [docs/building-mrv.md](docs/building-mrv.md).

```bash
npm run building:prepare -- --out data/external/bdg2/demo --hours 2160
npm run building:analyze -- \
  --dir data/external/bdg2/demo \
  --factor <kgCO2e-per-kWh> \
  --factor-geography "<matching geography>" \
  --factor-source "<original source URL>"
```

The grid factor is deliberately not guessed from anonymised BDG2 site IDs. The CLI records the supplied factor source as provenance and produces a ClimateChain case, report, and evidence root.

## Battery DPP prototype

The BatteryLife/CALB digital-product-passport slice is documented in [docs/battery-dpp.md](docs/battery-dpp.md). It reproduces the published CALB Dummy life-prediction baseline from pinned real labels, builds a traceable SOH/RUL decision-support passport from one processed battery, and demonstrates evidence-root failure after a cycle-capacity tamper.
