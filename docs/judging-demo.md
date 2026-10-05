# Judging demo

Issue: #15

The browser demo lives in:

```text
apps/demo/
```

It is deliberately static and Cloudflare-Pages-friendly. The heavy reproducibility workflows remain separate from the presentation path.

Building MRV runs live: the page recomputes the building case in the browser from the committed BDG2 subset (`data/external/bdg2`), using the same `building-mrv` code as `scripts/run-building-case.mjs`. It shows the decision-model advice and the person's decision on each flagged reading, and checks the committed signed attestation (`reports/building-mrv/case-run.json`) against the recomputed evidence. Both signatures are verified in the browser, and the policy requires both: Ed25519 through WebCrypto, and ML-DSA-65 through WebCrypto where the browser supports it (the WICG "Modern Algorithms in the Web Cryptography API" draft), otherwise through `@noble/post-quantum` 0.7.1. As of Chrome 154 no browser ships ML-DSA, so the page names which implementation checked it. The building tamper changes a reading in the browser: the decisions go stale and the attestation stops matching. The building WebMCP tools, including `building_review_flags`, call the same service.

Battery DPP runs the same way: the page recomputes the passport from the committed BatteryLife cycle history (`data/external/batterylife-processed`), shows the policy's proposed disposition and the person's sign-off (here `service-review`, overriding the proposed `repurpose`), states the claim's accounting boundary, and checks the signed attestation (`reports/battery-dpp/case-run.json`). Its tamper raises the last cycle's capacity by 20%: the sign-off goes stale and the attestation stops matching.

The energy forecast runs the same way: the page recomputes Energy-EVA's dummy baseline over the 7 committed series (`data/external/energy-eva-active-power-load`), checks it against Energy-EVA's published results for all 5 windows, and evaluates an illustrative 120 MWh load shift against the policy, which takes the measured mean LOAD_ACC as its confidence and caps the shift at 100 MWh. A person approved the capped amount; the attestation is `reports/energy-forecast/case-run.json`. Its tamper raises one load value by 20%: one window no longer matches the published result, the approval goes stale and the attestation stops matching.

What the page does not do yet: earth, carbon and disclosure replay committed reports, so their tool outputs are labelled `replayedFrom` and ignore inputs other than `caseId`. The carbon tamper is a recorded run; for earth and disclosure the page states the expected effect only. Signing keys are per-run demo keys, not an identity, and the advice is overconfident on labelled data: on 296 labelled GEPIII flags it called 91% faults against 55% labelled bad (see `docs/building-mrv.md`).

## Build and run

```bash
npm install
npm run demo:build
npm run demo:serve
```

Open:

```text
http://localhost:4173
```

The build bundles the committed measured reports, so the demo starts instantly and does not download multi-hundred-megabyte or multi-gigabyte datasets during judging.

## What the demo shows

### Building MRV

Measured source:
- Building Data Genome Project 2 v1.0
- EPA eGRID2016 CAMX factor

Measured result:
- temporal holdout RMSLE 0.34198
- 1,160.43 MWh accepted electricity
- 278.92 tCO2e reconstructed location-based emissions

Tamper:
- one holdout interval 295.3 → 5,906 kWh
- anomaly flagged
- digest changes
- reconstructed accepted emissions change

### Energy forecasting

Measured source:
- Energy-EVA 2.0 standardized active-power load task

Measured result:
- all five published dummy windows reproduced within pinned tolerances
- mean LOAD_ACC shown from the measured report

Bounded action:
- the WebMCP tool is consequential and goes through human approval
- the static demo does not submit market bids or dispatch hardware

### Earth observation

Measured source:
- pinned IBM/NASA HLS burn-scar scene

Measured result:
- NBR threshold IoU 0.61635
- precision 0.97567
- recall 0.62597
- real labelled/predicted hectares

Limitation:
- one pinned scene does not establish geographic generalisation

### Battery DPP

Measured source:
- BatteryLife / CALB

Measured result:
- current SOH 77.59%
- fit R² 0.8981
- disposition: repurpose

Reproducibility finding:
- pinned historical release reproduces ClimateChain's measured rerun
- the released paper-era data/code do not exactly reproduce the published summary row, and the discrepancy is retained rather than hidden

### Carbon registry

Measured source:
- CarbonPlan OffsetsDB
- ACR, Gold Standard, Climate Action Reserve bounded snapshots

Measured result:
- 600 real normalized records
- deterministic issuance/retirement checks
- clean bounded result remains insufficient-evidence where issuance is missing

Tamper:
- one quantity change alters the evidence root
- an injected duplicate retirement row produces mismatch
- the injected duplicate is a test mutation, not an allegation about an upstream registry

### Public disclosure

Real first-party source:
- LPL Construction
- publication on CaDI confirmed by its own page
- 2025 Scope 1 reported as 601.26 tCO2e

The UI deliberately keeps:
- disclosed
- source found
- calculation reproduced
- factor traced
- independent assurance

as separate concepts.

## WebMCP

When the host provides:

```ts
document.modelContext
```

the demo registers the shared capability-aware WebMCP surface.

The active demo case includes:

- building-meter-mrv
- carbon-recalculation
- renewable-forecasting
- earth-observation
- battery-dpp
- carbon-registry
- public-disclosure
- claim-reconciliation

The demo does **not** advertise `pq-attestation` because the static browser does not pretend to run ML-DSA locally.

The PQ path remains the real Rust/native implementation from #18 and is verified in CI.

## Guided audit

The “Run guided audit” button calls the same gated WebMCP handlers through their fallback executor:

1. list capabilities
2. run the Building MRV baseline summary
3. reconstruct Building MRV emissions
4. reconcile the carbon-registry snapshot
5. retrieve the real public disclosure claim

It does not scrape the DOM.

## Suggested 3–5 minute flow

### 0:00–0:35 — problem

Use the headline:

> Climate claims that can show their work.

Explain that a public climate number can have:
- source evidence
- calculations/models
- independent checks
- signatures
- later historical commitments

without conflating those layers.

### 0:35–1:20 — measured module

Open Building MRV.

Show:
- real upstream source
- baseline metric
- MWh
- tCO2e
- factor provenance

### 1:20–2:00 — breadth without losing depth

Briefly click:
- Earth Observation
- Battery DPP
- Carbon Registry

The point is that the shared evidence/trust workspace is reusable across climate domains.

### 2:00–2:45 — WebMCP

Run the guided audit or invoke the tools from an agent.

Show the activity trail.

Explain:
- agents call application tools, not rendered DOM
- consequential tools require human approval

### 2:45–3:35 — tamper

Use Building MRV or Carbon Registry.

Inject the deterministic test mutation.

Show:
- changed input
- changed digest/evidence root
- current verification failure
- historical provenance still tied to the old bytes

### 3:35–4:15 — public disclosure boundary

Open Public Disclosure.

Show:
- real CaDI-confirmed organisation
- real numeric claim
- calculation/factor checks remain not assessed

This is a strong anti-greenwashing point: publication is not automatically independent verification.

### 4:15–4:50 — trust architecture

Explain:

```text
raw data off-chain
→ canonical evidence root
→ Ed25519 + ML-DSA capable trust layer
→ signed append-only log
→ optional ledger only when the trust model requires it
```

The carbon-registry prototype currently returns `defer-ledger`, demonstrating that ClimateChain does not force blockchain into every workflow.

## Presentation rule

Do not say:
- “blockchain proves the emissions are true”
- “AI reduced emissions”
- “the public disclosure is verified” when only publication/source has been checked

Do say:
- “this measurement/calculation was reproduced”
- “this source was located”
- “this evidence root changed after the test mutation”
- “this signature authenticates these exact bytes”
- “this deployment currently does / does not justify shared ledger state”
