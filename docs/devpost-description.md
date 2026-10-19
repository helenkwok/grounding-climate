# Devpost description (draft 3)

Paste each section into the matching Devpost field. Every figure is traced in `docs/video-script.md` (Facts) or named
inline.

**Tagline:** Climate claims that show their work.

## Inspiration

> A figure is only as good as the work it can show.

One registry alone has issued 369,472,197 carbon credits, each standing for a tonne of CO₂ (American Carbon Registry,
via CarbonPlan OffsetsDB). A climate figure like that is asked to carry a lot: the meter readings or registry records,
the method, the readings someone dropped and why, the model that flagged them, the person who decided, what could not be
checked, and whether anything changed since. It arrives as one number, and none of that travels with it. A verifier is
left to trust the number or redo the work.

Most of that work does not need trust. It can be recorded, recomputed or checked by software.

## What it does

**Track: Climate Data & Environmental Monitoring.** Grounding checks climate data where it is reported: hourly meter
readings, a satellite burn-scar map, a battery's capacity tests, a grid load forecast, carbon registry records and a
company's own emissions report. For each, it recomputes what software can recompute, records what a person decided and
on which exact data, and states what could not be checked. Blockchain does one narrow job: proving that a signed record
existed by a given time and has not changed since, and refusing to record the same carbon credits as retired twice. No
data is stored on chain.

```text
Can software recompute or check this?
   ├─ yes             → rechecked in your browser, from the evidence
   ├─ needs judgement → a model may suggest; a named person decides,
   │                    and the decision is bound to the exact data
   └─ cannot be checked → the claim says so: "Needs evidence"
```

**One claim, end to end.** A public-assembly building in Berkeley used grid electricity worth 278.92 tCO₂e from January
to March 2016. Grounding rebuilds that figure from 2,160 hourly meter readings and the EPA's 2016 California grid factor.
Five zero readings are flagged, and a model suggests each is a meter fault. A person treats four as meter dropouts, and
the claim discloses what they may hide (about 2,425 kWh, 0.58 tCO₂e). The fifth is the hour the clocks skipped for
daylight saving: the model was 98% sure it was a fault, but the hour never existed. Each decision is tied to a
fingerprint of the exact readings, so changing one reading makes the decision stale.

**The record.** The verifier signs a verdict in the browser with two signatures, Ed25519 and ML-DSA-65 (FIPS 204,
post-quantum), and downloads the record. Change one input and the signatures no longer match the evidence. Anyone can
drop the record on the Verify page, with no account and no server, and see whether it is valid or which parts changed.
Each case is also:

- a **W3C Verifiable Credential 2.0** in the UNTP shape (a conformity credential for each check, and a battery record
  shaped as a Digital Product Passport), signed with EdDSA and ML-DSA-65 JWS and a Data Integrity proof set;
- **timestamped in Bitcoin** through OpenTimestamps, with a verifier we wrote that checks the merkle path to the block
  header and the header's proof of work;
- **anchored on Ethereum's Sepolia test network** by `RetirementRegistry`, a small contract deployed from MetaMask. Its
  deployed code matches a build of the pinned source, and all six cases are anchored;
- **content-addressed**: every evidence file and record has an IPFS CID (CIDv1, raw, sha2-256) computed from its own
  bytes.

The anchors are chain-agnostic by design (`AnchorAdapter`, chains named by CAIP-2); Bitcoin and EVM are the two adapters
today.

**Every claim, the same page.** Each claim page walks the same five steps (recompute, check, decide, sign, change one
input) over its own evidence, drawn from the data in your browser: the building's hourly readings with each flagged
reading numbered; the battery's capacity per cycle against the policy's second-life line, and its resistance trend; the
energy request asked, capped and allowed; the burned area detected against the reference labels; the carbon records'
reconciliation counts; and the company's reported figure beside the recalculation nobody can do. Change one input and the
drawing, the decisions and the signed record all show it at once.

**A page for judges.** `/judge` rebuilds all six claims in the browser and puts them on one receipt: each claim's figure,
result, both signatures, Bitcoin block and Sepolia transaction. One button changes an input in all six, and every row
turns red. Below it: how each part is known, the offline commands to rerun everything with no account or key, and what
it does not prove.

**Who it is for.**
- Verifiers who recheck a figure before giving an opinion: they get the recomputation, the decisions and the gaps in one
  record.
- Registries checking their own published records against themselves.
- Buyers of carbon credits who need to see whether a retirement could have been counted twice.
- Teams preparing battery passport data, who need state of health they can recompute and sign.

**At scale.** Beyond the six cases, Grounding runs the same checks over 532,799 public carbon credit records from seven
registries (CarbonPlan OffsetsDB, snapshot 2026-06-01). In the American Carbon Registry, 0 of 1,993 project-vintages
retired more than they issued, and all 979 project totals match their credit rows; 80 retirements are dated before their
project's first issuance, all on one day, and are flagged as an inconsistency in the published data, not an accusation.
Each check names the ICVCM principle it rests on. On Polygon, Toucan's contracts hold about 21.9 million tonnes of Verra
credits in 835 confirmed batches; among the 834 whose serials we could read, no two serial ranges overlap, and 0 of
369 tokens exceed their backing batches.

**Why it matters for the climate.** The world emitted 38.6 billion tonnes of fossil CO₂ in 2024 (Global Carbon Budget
2025). Decisions about that total (which credits to buy, which grid to draw from, which battery to reuse) run on
reported figures. Where power is made changes a figure several times over: by Ember's 2025 lifecycle figures, the
building's 1,160,425 kWh would mean about 446 tCO₂e on the average US grid and about 48 in France (an illustration on a
different basis from the claim's own 2016 factor). Grounding does not cut emissions by itself. It makes the figures
behind those decisions checkable: anyone can see what was recomputed, what a person decided and what is still missing,
and any later change to a signed record shows.

Each claim's page has a map of where its data comes from: the building's site in Berkeley, the satellite scene in
northern California, NASA Ames where the battery cell was tested, the states the carbon projects are in, and the whole of
India for the energy market. The company's page names no site, so its claim says so instead of guessing one. In the
United States the map is shaded with open wildfire-risk data for around 2011 and as projected for about 2047, as context,
not evidence.

## Principles

1. **Recompute, don't restate.**
2. **A model suggests; a person decides.** The model's advice never changes a claim's status.
3. **Software enforces the policy.** The advice threshold (0.97) and the energy cap (an illustrative 120 MWh request,
   100 MWh allowed) are set in code.
4. **A decision is tied to the data it was made on.** Change one reading and the decision goes stale.
5. **Say what could not be checked.** Three of the six claims read "Needs evidence", on the site and in their
   credentials.
6. **Show a gap rather than hide it.** The satellite detector reproduces the reference run pixel for pixel, yet finds
   11,974 ha burned against 18,664 ha in the reference labels; Grounding flags the 35.8% gap.
7. **Anyone can check a record,** with no account and no server.
8. **Every check is measured.** The advice threshold was set from a stated cost (a wrong exclusion costs five reviews)
   on 296 labelled readings: at 0.97, 42 of 48 suggestions (88%) were labelled bad, measured on the same sample.

## How we built it

- **Site:** TanStack Start with React on Rsbuild, prerendered to static pages; MapLibre for the map.
- **Checks:** one TypeScript package per claim type (building MRV, energy forecast, earth observation, battery passport,
  carbon registry, disclosure), each building the same case: claim, evidence, calculations, model run, verification,
  attestation. Every piece of evidence is hashed, so a changed input is named, not just detected.
- **Signing:** Ed25519 through WebCrypto and ML-DSA-65 through `@noble/post-quantum`, over the same canonical record; a
  hybrid policy needs both. Shared test vectors are checked by Node, noble and a Rust crate, which also tests the hybrid
  X25519MLKEM768 TLS path.
- **Chains:** OpenTimestamps proofs built and verified by our own code; `RetirementRegistry` in Solidity 0.8.37 with
  Foundry 1.8.5 (pinned and checksummed), tested on a local chain, deployed and anchored on Sepolia from MetaMask; an EVM
  adapter over raw JSON-RPC that builds unsigned transactions only, so no key is ever in the code or the repo. The
  Toucan check reads Polygon through Multicall3 with read-only calls.
- **Credentials:** W3C VC 2.0, UNTP contexts, VC-JOSE-COSE with RFC 9964 for ML-DSA, and a Data Integrity proof set.
- **Model advice:** a small structured model suggests why a flagged reading looks wrong. Its threshold was calibrated on
  labelled readings from the ASHRAE Great Energy Predictor III data, using aggregates only.
- **Data:** BDG2 meter data with EPA eGRID 2016, Energy-EVA load forecasts, IBM/NASA HLS burn scars, the NASA Ames battery data set (with a BatteryLife/CALB benchmark rerun),
  CarbonPlan OffsetsDB, Toucan's contracts on Polygon, Global Carbon Budget 2025 and Ember (both CC BY 4.0), CarbonPlan
  Open Climate Risk and Overture building footprints. Every source's licence is recorded in a machine-checked rights
  manifest; raw third-party data is never redistributed without explicit rights, and registries whose terms on derived
  data are unclear are checked locally and not published.
- **Standards:** each check is mapped to the clause it supports, or only partly supports, in ISO 14064-1/-3, the ICVCM
  Core Carbon Principles, the EU Battery Regulation 2023/1542 and the battery-passport standards (crosswalk in the repo).
  Our signature choice follows the same rule as the claims: Curve25519's parameters come from a published, rerunnable
  procedure (RFC 7748), and ML-DSA uses no curve. The recent reconstruction of the NIST curve seeds by Anthropic's
  Frontier Red Team ("Claude reveals ECDSA curve origins", 16 Oct 2026) shows why parameters should show their work.
- **Checks in CI:** the same verification runs from the command line and in continuous integration, with locked
  dependencies.

## Challenges we ran into

- Being honest about what could not be checked. A company's disclosure cannot be recalculated from public data, so
  Grounding links the source and records what the figure rests on instead of pretending to verify it.
- Making a person's decision durable. A decision recorded against data that later changes is worse than no decision, so
  every decision is bound to a fingerprint of its inputs and goes stale when they change.
- Calibrating the model. Shown at any confidence, it called about 90% of flagged readings faults when 55% were labelled
  bad, so its advice is shown as a suggestion only above a threshold set from measured precision.
- Keeping blockchain to what it can prove. An anchor proves a record existed by a block's time, not that the claim is
  true. The double-use contract cannot stop a registry issuing the same tonne twice, or see a retirement made off chain;
  we say so.
- Reading registries within their terms. Four of the seven registries are checked but their counts are kept local while
  their terms on derived data are unclear.

## Accomplishments that we're proud of

- Six claims built on real public data, each checked in the browser as far as its evidence allows.
- A tamper test anyone can run: change one value, the signatures no longer match the evidence, and the record names what
  changed.
- A contract whose deployed code anyone can match to its source, and which refuses a second or overlapping retirement
  of the same credits.
- Records anchored on two chains and content-addressed, without storing any data on chain.

## What we learned

How much of a climate claim can software check before a person has to decide? On six claims: three rechecked, three
needing evidence. The useful answer is not that every figure checks out; it is that each record says which parts were
checked, which were decided, and by whom.

## What it does not prove

Rechecking is not assurance. Grounding reports findings from rechecking the evidence, close to the agreed-upon
procedures of ISO 14064-3 Annex C, and gives no assurance opinion of the kind ISSA 5000 governs. Signing keys are made
in the browser for one record, so a signature does not prove who signed; identity would come from an organisation's own
keys. The battery cell is too small to need an EU passport; its record is passport-shaped. Sepolia is a test network: it
shows the mechanism, and the Bitcoin anchor is the timestamp that carries weight.

## What's next (adoption)

- Cases are plain JSON files that a verifier reruns from the command line or in CI; the site is static and needs no
  account; credentials use a W3C standard shape; the code is Apache-2.0.
- Signing keys tied to an organisation's identity.
- Registry imports by reviewers, within each registry's terms.
- The double-use contract run as a permissioned network where only registries record retirements.

## Built with

TypeScript, React, TanStack Start, Rsbuild, MapLibre, WebCrypto, @noble/post-quantum, Rust, Solidity, Foundry,
OpenTimestamps, IPFS CIDs, W3C VC 2.0, UNTP, MetaMask.

## Try it out

- **For judges, about 30 seconds:** https://helenkwok.github.io/grounding-climate/judge/
- **The site:** https://helenkwok.github.io/grounding-climate/
- **Verify a record, no account or server:** https://helenkwok.github.io/grounding-climate/verify/
- **Code, and an offline rerun:** https://github.com/helenkwok/grounding-climate, then
  `npm ci && npm run build && npm run check:cases`
- **Video:** https://youtu.be/UvnaIW0SFvY
