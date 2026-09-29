# Energy forecast + bounded action

Issue: #10

Primary user: **microgrid operator**.

The first Energy-EVA integration deliberately chooses the `active_power_load` load-forecasting sub-dataset because its original Mendeley source is small, traceable, and CC-BY-4.0.

## Upstream benchmark semantics

Energy-EVA 2.0 defines the load task for `active_power_load` as:

- horizon: 48
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

They are **references** until the standardized Energy-EVA parquet is executed locally/CI; the JSON marks them `reproducedByClimateChain: false`.

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
