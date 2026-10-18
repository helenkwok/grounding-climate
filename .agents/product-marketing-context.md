# Product marketing context

## Product overview

- **One line:** Climate claims that can show their work.
- **What it does:** Grounding takes a reported climate figure and shows what it rests on: the source data, the
  analysis rerun in the reader's browser, each decision a person made, and a signature that breaks if anything changes.
- **Category:** climate data verification (MRV and claim assurance), not a token or a trading platform.
- **Type:** open-source workspace and library; hackathon entry (IEEE ClimateChain Global Hackathon 2026, primary track
  Climate Data & Environmental Monitoring).

## Target audience

- **Primary user:** a climate or carbon verifier reviewing the evidence behind a reported claim.
- **Also:** facility energy managers, battery second-life assessors, registry reviewers, ESG analysts.
- **Jobs to be done:** decide whether a figure can be trusted; see who decided what about questionable data; prove
  later that nothing changed since sign-off.

## Problems and pain points

- A climate figure arrives as one number. The meter data, the factor, the readings someone dropped and who decided are
  invisible, so the verifier either trusts it or starts again.
- Registries and disclosures cannot always be copied or recomputed; today that gap is silent.
- "On the blockchain" proves a record was not changed, not that it was true.

## Differentiation

- Recomputes the claim in the reader's browser from committed open data, rather than asking for trust.
- Model advice is a suggestion; a named person decides, and the decision goes stale if the data changes.
- Hybrid classical plus post-quantum signatures (Ed25519 + ML-DSA-65), verified in the browser.
- States what was not assessed next to every result.

## Proof points (all real, all reproducible)

- Building: 2,160 hourly readings from a real office building (BDG2), 5 flagged, 5 decided, 278.92 tCO2e signed.
- Change one reading and both signatures stop matching; reset and they match again.
- Six modules on real open data: BDG2, Energy-EVA, NASA HLS burn scars, BatteryLife, ACR registry records, CaDI disclosures.

## Voice

Rigorous, honest, calm. Plain words. No hype, no exclamation marks, no claims a reader cannot check on the page.

## Words to avoid

"revolutionary", "trustless", "immutable truth", "AI-powered", "seamless", "blockchain-verified".
