# Energy forecast + bounded action

Issue: #10

Primary user: **microgrid operator**.

The first Energy-EVA integration deliberately chooses the `active_power_load` load-forecasting sub-dataset because its original Mendeley source is small, traceable, and CC-BY-4.0.

## Upstream benchmark semantics

Energy-EVA 2.0 defines the load task for `active_power_load` as:

- horizon: 48 hourly steps (two days)
- target: `target`
- rolling windows: 5
- context lengths: 512 / 1024 / 2048
- metric: `LOAD_ACC`
- extra metrics: MAE, RMSE, MAPE

Its `dummy_model` is not a mean forecast. For every task/window it returns:

```text
the most recent historical target values
with length exactly equal to the forecast horizon
```

ClimateChain's `runEnergyEvaDummy()` reproduces that exact semantic operation.

The LOAD_ACC implementation is also mirrored from Energy-EVA:

```text
per day:
  1 - min(RMSE(day) / (max(day) - min(day)), 1)

then average the daily scores
```

The pinned upstream values for `active_power_load` at context length 512 are stored in:

`packages/energy-forecast/references/energy-eva-active-power-load.json`

The standardized Energy-EVA parquet has now been executed in the path-filtered CI smoke. The JSON marks the dummy baseline `reproducedByClimateChain: true` and records the exact five-window comparison.

## Original data

Original active-power data:

- Mendeley Data
- DOI: `10.17632/jxm8d4w4cv.1`
- 23,304 samples
- hourly load from 2021-01-01 through 2023-08-31
- load in MW
- CC-BY-4.0

Energy-EVA standardizes this source into its own load parquet/task representation. The source and standardized artifact must remain separately identified in provenance.

## Forecast provenance

The ClimateChain evidence graph records:

```text
energy-series evidence + input digest
→ model-run
  model/version
  horizon/window settings
  LOAD_ACC / MAE / RMSE / MAPE
→ forecast-quality claim
→ verification
→ evidence root / attestation
```

Changing source values changes the canonical input digest and therefore changes the evidence root.

## Bounded action

The module does **not** place a bid, dispatch a battery, or modify a microgrid.

`energy_prepare_bounded_action` produces a policy decision for one of:

- `shift-load`
- `charge-storage`
- `discharge-storage`

The policy is code, not an LLM instruction:

```ts
{
  enabled,
  allowedActionTypes,
  maxActionMWh,
  minimumConfidence,
  humanApprovalAboveMWh,
  allowedCounterparties
}
```

A request may therefore be:

- refused by kill switch
- refused for unsupported action type
- refused for low confidence
- refused for unlisted counterparty
- capped to a maximum MWh
- marked as requiring human approval

Even a policy-permitted action still passes through #7's serialized WebMCP consequential approval gate.

## Climate claim boundary

A better forecast is **not** itself an emissions reduction.

The current prototype may claim:

- forecast metric
- difference from a baseline
- MWh represented by a bounded proposed action
- whether deterministic guardrails permit/cap/refuse that proposal

It must not claim avoided tCO2e unless a separate causal dispatch/counterfactual calculation is supplied.


## Measured real-data reproduction

ClimateChain streams only the standardized member:

`load/active_power_load.parquet`

from Energy-EVA's pinned Zenodo record `10.5281/zenodo.17099628`; the full archive is not committed.

Measured standardized data:

- 7 item series
- series lengths: 744, 720, 744, 720, 744, 744, 744 hourly points
- forecast horizon: 48 hours
- context length: 512
- cutoffs: -240, -192, -144, -96, -48

For all five windows, ClimateChain's independent dummy implementation matched the published Energy-EVA values within:

- LOAD_ACC: 1e-6
- MAE: 0.001
- MAPE: 1e-6
- RMSE: 0.001

The measured record is:

`reports/energy-forecast/active-power-dummy.json`

The published EnergyTS V3.0 values remain an upstream comparison target. ClimateChain does not claim to have rerun the proprietary/large forecasting model merely because it reproduces the baseline.

## Live case and approval

`node scripts/run-energy-case.mjs` builds the signed case from the committed series
(`data/external/energy-eva-active-power-load`, CC BY 4.0), Energy-EVA's published results
(`packages/energy-forecast/references/energy-eva-active-power-load.json`) and the operator's request and policy
(`reports/energy-forecast/action-request.json`). The request and policy are illustrative; the confidence is not: it is
the mean LOAD_ACC measured over the 5 windows (0.6470).

The policy caps the requested 120 MWh at 100 MWh, and amounts of 50 MWh or more need a person's approval. The approval in
`reports/energy-forecast/action-decisions.json` (approve, `person:energy-manager`) is bound to a digest of the series, the
request and the policy, so changing any of them makes it stale. The claim states its accounting boundary: nothing is sent
to a market or a device, and forecast quality is not claimed as avoided emissions. `npm run check` rebuilds the case and
verifies it against the signed attestation (`scripts/verify-energy-case.mjs`).

## Acceptance scope

For the hackathon slice, "model metric against baseline" means:

- the **baseline** is locally reproduced from the real standardized Energy-EVA data;
- the selected advanced-model numbers are precisely attributed upstream benchmark results;
- the operational policy consumes forecast confidence/result provenance but does not pretend the upstream model was locally trained or inferred.

A later research run may swap in a locally executable forecasting model through the same service without changing the evidence/provenance or bounded-action architecture.
