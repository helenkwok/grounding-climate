# Grounding

Evidence-first climate verification workspace for the IEEE ClimateChain Global Hackathon 2026.

## Demo

The integrated judging demo is the fastest way to see the product:

```bash
npm install
npm run demo:build
npm run demo:serve
```

Open `http://localhost:4173`.

The demo combines measured outputs from Building MRV, Energy-EVA forecasting, HLS Earth observation, BatteryLife DPP, CarbonPlan registry reconciliation, and real CaDI-confirmed public disclosure sources. It also exposes the capability-aware WebMCP surface when `document.modelContext` is available.

See [docs/judging-demo.md](docs/judging-demo.md) for the 3–5 minute presentation flow.

> Submission blocker: this repository is currently private. The hackathon requirements tracked in [#1](https://github.com/helenkwok/grounding-climate/issues/1) require a public GitHub (or equivalent) repository before final submission.

The project is organised around verifiable climate claims rather than tokens:

```text
evidence
→ deterministic/model analysis
→ claim
→ verification
→ attestation
→ optional commitment/ledger anchor
```

Development roadmap: see [#17](https://github.com/helenkwok/grounding-climate/issues/17).

## Current work

- [#6](https://github.com/helenkwok/grounding-climate/issues/6) — evidence-first domain model
- [#14](https://github.com/helenkwok/grounding-climate/issues/14) — source rights manifest
- [#18](https://github.com/helenkwok/grounding-climate/issues/18) — crypto-agile trust layer
- [#8](https://github.com/helenkwok/grounding-climate/issues/8) — provenance/attestation lifecycle
- [#7](https://github.com/helenkwok/grounding-climate/issues/7) — capability-aware WebMCP surface

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

The grid factor is deliberately not guessed from anonymised BDG2 site IDs. The CLI records the supplied factor source as provenance and produces a Grounding case, report, and evidence root.

## Battery DPP prototype

The BatteryLife/CALB digital-product-passport slice is documented in [docs/battery-dpp.md](docs/battery-dpp.md). It reruns the CALB Dummy life-prediction baseline from the pinned v1 release (which does **not** exactly reproduce the published summary row; the discrepancy is recorded), builds a traceable SOH/RUL decision-support passport from one processed battery, and demonstrates evidence-root failure after a cycle-capacity tamper.
