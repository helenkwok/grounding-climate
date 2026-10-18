# Video script (draft 5)

Voice: Kokoro-82M `af_heart`, about 165 words a minute plus pauses. Limit 3 to 5 min; target 4:30 to 4:45. Lines are
written for the ear: numbers and abbreviations are spelled the way they should be said. On-screen text is held for at
least 1 s + words / 3, and never under 3 s. No music bed, no sound effects (decision F).

Draft 3 (with its last local edits) is kept, gitignored, at `video/video-script-draft3-local-backup.md`.

| # | Shot (the real site unless it says card) | Narration |
|---|---|---|
| 1 | Card: "369,472,197 carbon credits, one registry" (held 3 s), then the map tour (`/?tour=1`) | Three hundred and seventy million carbon credits, from one registry. Each stands for a tonne of C O two. The data, the method and the decisions behind them do not travel with the number. Grounding makes a climate claim show its work. |
| 2 | Panel: six claims, Rechecked and Needs evidence | It is built for the people who check climate figures. Six claims built on real public data, each checked in your browser as far as its evidence allows. |
| 3 | Building claim, step 1: checks and figures | Take a public assembly building in Berkeley. From January to March twenty sixteen, its grid electricity comes to two hundred and seventy nine tonnes of C O two equivalent, rebuilt from two thousand one hundred and sixty hourly readings and the E P A's grid factor. |
| 4 | Step 2: five flagged readings and the decisions | Five readings are zero. A model suggests each is a meter fault; a person decides. Four are treated as dropouts, and the claim says what they may hide: just over half a tonne. The fifth is the hour daylight saving skipped. The model was ninety eight percent sure it was a fault. It never existed. |
| 5 | Step 3: verdict, name, sign; step 4: change one input, then reset | Now you are the reviewer. Choose a verdict, give your name, and sign twice: Ed twenty five five one nine, and M L D S A sixty five, designed to resist quantum computers. It says rechecked, not verified. Change one input, and the signatures no longer match the evidence. |
| 6 | Verify page: the record Valid; an edited copy Broken; the credential rows | Anyone can check a record on the Verify page, with no account and no server. Edit one number, and it reads broken. Each record is also a W3C verifiable credential. |
| 7 | Verify page anchor row (block number on screen), then Sepolia on Etherscan | Each signed record is timestamped in a Bitcoin block, and anchored on Ethereum's Sepolia test network by a contract we deployed from MetaMask. Every file also has an I P F S address, made from its own hash. Nothing on chain holds the data, only proof the record existed by that block's time. |
| 8 | Carbon claim: the scoreboard section | Now scale it up. Grounding checks over half a million public carbon credit records across seven registries. In the American Carbon Registry, no project vintage retired more credits than it issued. Eighty retirements are dated before their project's first issuance, all on one day: flagged, not accused. Each check names the integrity principle it rests on. |
| 9 | Card: Toucan on Polygon (21.89 M t in confirmed batches; 0 overlapping pairs among 834 readable; refusal tested on a local chain) | Tokenised credits too. On Polygon, about twenty two million tonnes of Verra credits sit in Toucan's confirmed batches, and no two readable serial ranges overlap. Our own contract is built to refuse a second retirement of the same range. |
| 10 | Energy claim, then the burn scar | An illustrative energy request is capped by a policy in code, and allowed only because the forecast's measured accuracy clears it. The satellite detector finds less burned area than the reference labels, and Grounding shows the gap. |
| 11 | Battery claim: capacity and resistance charts, the sign-off, then a changed cycle (shown, not narrated) | The battery claim is shaped as a digital product passport, which the E U will require for larger batteries from twenty twenty seven. This NASA test cell kept seventy one percent of its first recorded capacity, sixty six percent of its rating, and its internal resistance rose twenty eight percent. The policy proposed retirement review, and a person signed it off for recycling. |
| 12 | Disclosure claim; Needs evidence on the list | A company's own report cannot be recalculated, so Grounding links the source and says what it rests on. Three of the six claims read needs evidence. That is the point. |
| 13 | Card: two bars, "Ember 2025, lifecycle CO2e; illustration" | Why it matters. The world emitted thirty eight point six billion tonnes of fossil C O two in twenty twenty four, by the Global Carbon Budget. Where electricity is made changes the answer: by Ember's twenty twenty five lifecycle figures, the same electricity would mean about four hundred and fifty tonnes on the average U S grid, and under fifty in France. |
| 14 | Card: the standards crosswalk | Each check is mapped to the clause it supports, or partly supports, in ISO fourteen oh sixty four, the carbon integrity principles and the E U battery rules. |
| 15 | End card: site URL, repo URL, track | Grounding. Climate claims that show their work. Open the site, change one number, and watch it break. Open source, under Apache two point oh. |

## Facts each line rests on (check before recording)

- 1: ACR issued 369,472,197 credits (`reports/carbon-registry/scoreboard.json`, ACR `creditsByKind.issuance`), one credit
  per tonne (the overRetired basis).
- 2: the energy request is illustrative and its forecast a baseline; the disclosure is a company report, linked, not
  recalculated.
- 3: BDG2 `Bear_assembly_Angel`, primary use "Entertainment/public assembly"; 2016-01-01 to 2016-03-30; 2,160 readings
  (one of them the non-existent daylight-saving hour); eGRID2016 CAMX. 278.918 tCO2e in `reports/building-mrv/case-run.json`.
- 4: `reports/building-mrv/triage-advice.json`: five meter_fault suggestions, P 0.98 to 1.00; the daylight-saving hour
  2016-03-13 02:00 is in `interval-decisions.json`; 2,425 kWh, 0.58 tCO2e disclosed (`docs/building-mrv.md`).
- 5: both signatures are required by the hybrid policy; ML-DSA-65 is FIPS 204. Ed25519 is not quantum-resistant, so the
  line attaches "designed to resist" to ML-DSA-65 only.
- 6: VC 2.0 in the UNTP shape (`docs/credentials.md`). Do not imply issuer identity.
- 7: Bitcoin block numbers come from `npm run anchor:upgrade` and must be confirmed by `verify-anchors` before filming;
  the six records may sit in different blocks, so the narration says "a Bitcoin block". Sepolia: `reports/evm-sepolia.json`,
  code matches the build, blocks 11,938,791 to 11,938,797. CIDs: `reports/cid-manifest.json` (the file's own SHA-256; not
  pinned anywhere).
- 8: 532,799 rows, 7 registries; ACR 0 of 1,993 project-vintages over-retired, 80 retirements before first issuance on
  one date, quantities only (no serials).
- 9: `reports/carbon-registry/toucan-onchain.json`: 21,889,962 t in confirmed batches; 0 overlapping pairs among 834
  parseable confirmed Verra batches; Polygon blocks 95,727,408 to 95,727,509. This is Toucan's on-chain count, not a
  Verra count (decision B). The `AlreadyRetired` refusal is tested in `forge test` and on anvil, not on Sepolia.
- 10: 120 to 100 MWh by policy; forecast accuracy 0.647 clears the 0.6 minimum; 11,974 vs 18,664 ha.
- 11: NASA Ames cell B0005, 168 cycles (`reports/battery-dpp/credential.json`): SoH 71.38% vs the first recorded cycle
  (1.856 Ah), 0.6625 vs the 2 Ah rating; Re +28.2% (medians of the first and last 5 of 278 sweeps; the base is after
  cycle 19, not beginning of life). The policy proposes retire-review (0.663 < 0.75); the sign-off is recycle, by the
  role `person:energy-manager` (`disposition-decisions.json`). A single 2 Ah lab cell is outside the passport's scope
  (EU 2023/1542 Art. 77 from 18 Feb 2027); the record is passport-shaped. The tamper leaves the signatures valid over what was signed; the evidence no longer matches and the
  sign-off goes stale.
- 12: site statuses and credentials agree after PR #84: earth, carbon, disclosure insufficient-evidence.
- 13: GCB 2025 world fossil CO2 38,598.6 Mt (2024); 1,160,425 kWh x Ember 2025 lifecycle intensity: US 446.1 t, France
  47.8 t. Do not put 278.92 on the same card: different method, area and year.
- 14: `docs/standards-crosswalk.md` (it has PARTIAL rows).
- 15: `LICENSE` (Apache-2.0).

Capture: headless (page only), Method 1, plus cards built in the page. Reviewer name on screen: "Verifier". Build:
`video/` (gitignored): `narrate.py`, `record.mjs`, `assemble.py`. Production plan: `video/review-video.md`.
