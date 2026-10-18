# Battery Digital Product Passport

Issue: #12

Primary user: **second-life battery operator**.

The operational question is deliberately narrow:

> Given a traceable battery cycle history and a transparent health estimate, should this asset proceed to reuse, repurpose, service review, or retirement/recycling review?

Grounding does not claim that a health prediction itself reduces emissions, and the passport is not a battery-safety certification.

## Evidence flow

```text
NASA Ames cycle and impedance history (cell B0005)
→ canonical input digest
→ transparent SOH / RUL baseline
→ explicit disposition policy
→ battery passport claim
→ shared Verification
→ evidence root
→ optional signed attestation
```

The module uses the shared #6/#8/#18 domain and trust layers rather than inventing a battery-specific ledger.

## Real data

The smoke intentionally pins two BatteryLife releases for different purposes.

### Paper-era benchmark input

- Zenodo v1 DOI `10.5281/zenodo.14890219`
- `CALB_labels.json` MD5 `6a9eff3b988d0faf03a08b5b2aca42ed`
- paper-era code reference: commit `f2fc7ab17b3311ea3ef62514f20bc8275a3efaf4`

This is the immutable label artifact linked by the paper-era repository. The referenced code is immediately before the 26 February 2025 `fix calb random` commit.

### Current passport input

BatteryLife Processed **v11**:

- Zenodo DOI `10.5281/zenodo.19688272`
- `CALB.zip` MD5 `2b1006e96e0ca42765a732060f964687`
- `Life labels.zip` MD5 `cd0cc01a7211972be45e8e38d86cdeca`

The CI workflow downloads these artifacts at runtime. One cell's cycle history (CALB_0_B182, 100 cycles, 7 KB) is committed under `data/external/batterylife-processed` with the MIT licence text and the BatteryLife citation; the demo page and `scripts/run-battery-case.mjs` read it. Keeping the historical benchmark source separate from the current corrected passport source makes version changes visible instead of silently mixing them.

## Published benchmark reference and measured rerun

BatteryLife defines the Dummy battery-life predictor as:

```text
prediction for every test battery
= mean life label of the training split
```

For CALB, BatteryLife publishes results across the fixed seeds/splits 42, 2021 and 2024:

| Metric | Published Dummy |
| --- | ---: |
| MAPE | 1.811 ± 0.550 |
| 15%-Acc | 0.267 ± 0.094 |

The exact file lists are pinned in:

`packages/battery-dpp/references/batterylife-calb.json`

Grounding's evaluator intentionally mirrors one upstream implementation detail: BatteryLife's 15%-accuracy check divides absolute error by the **dummy prediction / training mean**, not by the ground-truth life label. That convention is preserved only for reproduction of the published benchmark.

Using the immutable v1 labels, the paper-era Dummy semantics, and the pinned 42/2021/2024 split definitions, Grounding measures:

| Metric | Grounding v1 rerun | Published Dummy |
| --- | ---: | ---: |
| MAPE mean | 1.8760243941 | 1.811 |
| MAPE population std. | 0.6060759892 | 0.550 |
| 15%-Acc mean | 0.2000000000 | 0.267 |
| 15%-Acc population std. | ~0 | 0.094 |

The released paper-era code/data therefore **do not reproduce the published summary row exactly**.

This is retained as a reproducibility finding rather than hidden by widening a tolerance. Upstream history also records later CALB split fixes, including `fix calb random` (26 February 2025) and `fix CALB issue` (15 April 2025). The smoke fails if the immutable v1 rerun changes from the measured values above; the published row remains a separate reference.

This distinction matters for provenance: “published benchmark value” and “reproduced from released artifacts” are different claims.

The measured real-data smoke is committed at:

`reports/battery-dpp/batterylife-calb-smoke.json`

The BatteryLife smoke above is a benchmark; the passport case uses a different cell (below).

## Passport case: NASA Ames cell B0005

The passport case reads `data/external/nasa-battery/battery-history.json`: cell B0005 of the NASA PCoE Battery Data Set,
tested at NASA Ames Research Center (README in that folder; rebuilt by `scripts/prepare-nasa-battery.py`).

- 168 discharge cycles at 2 A and 24 °C; rated capacity 2 Ah
- SoH 0.6625 against the rated capacity; 0.7138 against the first recorded cycle (1.856 Ah), the initial-condition basis
  of Regulation (EU) 2023/1542 Art. 3(28). Both are in the claim; the thresholds below use the rated basis.
- transparent linear-fit R² over the last 50 cycles: 0.889
- estimated RUL at the configured 80% SoH threshold: 0 cycles
- disposition under the demo policy: `retire-review`
- ohmic resistance Re (median of the first and last five of 278 impedance sweeps): 0.0451 Ω after cycle 19, 0.0578 Ω by
  cycle 168, an increase of 28.2%. Recorded as DIN DKE SPEC 99100 6.7.5.2 and 6.7.5.3 (Battery Pass
  `initialInternalResistance`, `internalResistanceIncrease`). The first sweep came after cycle 19, so the base is not a
  beginning-of-life value, and Re is fitted from EIS by the data provider, not a DC resistance test.

The tamper run raises the last cycle's capacity by 20% (1.325 to 1.590 Ah), which changes the input digest and the
shared evidence root.

## Passport health estimate

The passport uses a separate transparent local decision-support baseline:

1. take valid discharge-capacity observations
2. sort by cycle
3. fit a linear trend over the latest observations
4. compute current SOH against nominal capacity
5. extrapolate the configured EOL SOH threshold
6. estimate remaining cycles where the capacity trend is negative

This is intentionally not presented as BatteryLife's best AI model.

Limitations are carried into the verification:

- degradation can be nonlinear
- future operating conditions can change
- a linear trend is not a warranty or safety prediction
- electrical/thermal/mechanical/regulatory checks remain necessary

## Disposition policy

Default demo policy:

```text
low trend-fit confidence
→ service-review

SOH >= 0.85
AND estimated RUL >= 200 cycles
→ reuse

otherwise SOH >= 0.75
→ repurpose

otherwise
→ retire-review
```

The thresholds are explicit policy inputs. They are not universal battery-industry rules.

## Sign-off by a person

The policy only proposes a disposition. A person signs it off (`approve`) or chooses another (`reuse`, `repurpose`, `recycle`, `service-review`), with a reason, using the shared review step in `@grounding-climate/core`. The decision is bound to the digest of the cycle history: if the history changes, the sign-off is stale and the case returns to `insufficient-evidence`. The case result is derived from these checks; it is `reconciled` only with a current sign-off.

For NASA B0005 the policy proposes `retire-review` (SoH 0.663, below 0.75). The recorded sign-off
(`reports/battery-dpp/disposition-decisions.json`, by the role `person:energy-manager`) is `recycle`: the cell is past the
test's own end-of-life rule (1.4 Ah), its ohmic resistance rose about 28%, and its condition and safety are not assessed.

The claim states its accounting boundary separately from the measurement: what it counts (capacity over cycles 1 to 168, SoH against the 2 Ah rating, ohmic resistance from the impedance sweeps), what it leaves out (later cycles, calendar ageing), the policy choices (thresholds, linear fit, sign-off), and what it does not assess (electrical, thermal, mechanical and safety condition; carbon footprint and other EU Battery Regulation passport fields; published life-prediction models).

`scripts/run-battery-case.mjs` signs the case with Ed25519 and ML-DSA-65 and records a tamper run; `scripts/verify-battery-case.mjs`, part of `npm run check`, rebuilds the case from the committed inputs and checks the committed signature.

## Shared provenance

`buildBatteryPassport()` emits normal Grounding objects:

- Evidence — exact cycle-history digest and source
- ModelRun — model/version/input/fit metadata
- Claim — passport disposition statement
- Verification — integrity + policy checks
- Evidence root — generated by the shared #8 provenance layer

The passport also carries:

- battery ID
- source dataset/version
- chemistry/form factor where available
- nominal capacity
- observed cycle
- SOH
- estimated RUL
- disposition
- input digest
- model/version
- fit R²
- caveat

## Tamper demo

The real-data smoke changes the final discharge-capacity observation after preparation.

Expected behavior:

```text
real cycle history
→ input digest D1
→ passport P1
→ evidence root R1

change one capacity value
→ input digest D2 != D1
→ health/passport may change
→ evidence root R2 != R1
→ old attestation remains tied to R1
```

This demonstrates provenance integrity. It does not imply that a cryptographic digest can prove the original physical measurement was truthful.

## WebMCP

The same `BatteryDppService` backs:

- `battery_predict_health`
- `battery_compare_baseline`
- `battery_build_passport_claim`

The tool surface is registered only when the active case advertises `battery-dpp`.

## Reproduce

Local unit/acceptance tests:

```bash
npm run check
```

Real BatteryLife smoke:

```bash
python scripts/prepare-batterylife-calb.py /tmp/batterylife-v1 v1
python scripts/prepare-batterylife-calb.py /tmp/batterylife-v11 v11
npm install
npm run build
node scripts/smoke-batterylife-calb.mjs /tmp/batterylife-v1 /tmp/batterylife-v11
```

The GitHub Actions workflow `BatteryLife CALB data smoke` performs the same path on changes to the Battery DPP module.
