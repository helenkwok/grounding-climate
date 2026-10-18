# Devpost description (draft)

Paste each section into the matching Devpost field. Track: Climate Data & Environmental Monitoring.

**Tagline:** Climate claims that show their work.

## Inspiration

> A figure is only as good as the work it can show.

A climate figure is asked to carry a lot: the meter readings, the emission factor, the readings someone dropped and why, the model that flagged them, the person who decided, what could not be checked, and whether anything changed since. It arrives as one number (278.92 tonnes, 601.26 tonnes, 11,974 hectares), and none of that travels with it. A verifier is left to trust the number or redo the work.

Most of that work does not need trust. It can be recorded, recomputed or checked by software.

## What it does

Grounding is built for a verifier: someone who has to decide whether a climate figure can be trusted. It takes six real claims on open data (a building's emissions, an energy forecast, a burn scar, a battery's health, carbon registry records and a company's own disclosure) and sorts every part of each one:

```text
Can software recompute or check this?
   ├─ yes             → rechecked in your browser, from the evidence
   ├─ needs judgement → a model may suggest; a named person decides,
   │                    and the decision is bound to the exact data
   └─ cannot be checked → the claim says so: "Needs evidence"
```

Open a claim and it is rebuilt in the browser. The building's 278.92 tCO₂e is recomputed from 2,160 hourly meter readings and the EPA grid factor. Five zero readings are flagged; a model suggests each is a meter fault, and the facility energy manager's decision to exclude them is recorded and tied to a fingerprint of the exact readings.

The verifier then signs a verdict in the browser with two signatures, Ed25519 and ML-DSA-65 (post-quantum), and downloads the record. Change one input and both signatures stop matching. Anyone can drop the record on the Verify page, with no account and no server, and see whether it is valid or which claim changed since signing.

A map places each claim where it happened, over open wildfire-risk data for the United States, today and as projected for 2047.

## Principles

1. **Recompute, don't restate.**
2. **A model suggests; a person decides.** The model's advice never changes a claim's status.
3. **Software enforces the policy.** The advice threshold (0.97) and the energy cap (120 MWh asked, 100 MWh allowed) are set in code.
4. **A decision is tied to the data it was made on.** Change one reading and the decision goes stale.
5. **Say what could not be checked.** Three of the six claims read "Needs evidence".
6. **Show a gap rather than hide it.** The satellite detector finds 11,974 ha burned against 18,664 ha in the reference labels; Grounding flags the 35.8% gap.
7. **Anyone can verify a record,** with no account and no server.
8. **Every check is measured.** The advice threshold was set on 296 labelled readings: at 0.97, 88% of suggestions were labelled bad.

## How we built it

- **Site:** TanStack Start with React on Rsbuild, prerendered to static pages; MapLibre for the map.
- **Checks:** one TypeScript package per claim type (building MRV, energy forecast, earth observation, battery passport, carbon registry, disclosure), each building the same case: claim, evidence, calculations, model run, verification, attestation. Every piece of evidence is hashed, so a changed input is named, not just detected.
- **Signing:** Ed25519 and ML-DSA-65 over the same record, in the browser through WebCrypto, with `@noble/post-quantum` as a fallback; a Rust crate tests the hybrid X25519MLKEM768 TLS path.
- **Model advice:** a small structured model suggests why a flagged reading looks wrong. Its threshold was calibrated on labelled readings from the ASHRAE Great Energy Predictor III data, using aggregates only.
- **Data:** BDG2 meter data with EPA eGRID 2016, Energy-EVA load forecasts (CC BY 4.0), IBM/NASA HLS burn scars (CC BY 4.0), BatteryLife/CALB (MIT), ACR registry records via OffsetsDB, CarbonPlan Open Climate Risk and Overture building footprints. Every source's licence is recorded in a machine-checked rights manifest, and raw third-party data is never redistributed without explicit rights.
- **Checks in CI:** the same verification runs from the command line and in continuous integration, with locked dependencies.

## Challenges we ran into

- Being honest about what could not be checked. A company's disclosure cannot be recalculated from public data, so Grounding links the source and records what the figure rests on instead of pretending to verify it.
- Making a person's decision durable. A decision recorded against data that later changes is worse than no decision, so every decision is bound to a fingerprint of its inputs and goes stale when they change.
- Calibrating the model. Shown at any confidence, it called 91% of flagged readings faults when 55% were labelled bad, so its advice is shown as a suggestion only above a threshold set from measured precision.

## Accomplishments that we're proud of

- Six real claims, each rechecked from evidence in the browser.
- A tamper test anyone can run: change one value and both signatures fail, naming what changed.
- A record anyone can verify offline, with no account.
- Gaps and limits shown on screen, not hidden.

## What we learned

How much of a climate claim can software check before a person has to decide? On six real claims: three rechecked, three needing evidence. The useful answer is not that every figure checks out; it is that each record says which parts were checked, which were decided, and by whom.

## What it does not prove

Rechecking is not assurance. Grounding reports findings from rechecking the evidence, close to the agreed-upon procedures of ISO 14064-3 Annex C, and gives no assurance opinion of the kind ISSA 5000 governs. Signing keys are made in the browser for one record, so a signature does not prove who signed. Identity would come from an organisation's own keys.

## What's next

- Signing keys tied to an organisation's identity.
- More registries (CAR, Gold Standard) as reviewer imports, within their terms.
- More energy cases, and claims submitted by verifiers themselves.
