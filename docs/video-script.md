# Video script (draft 2)

Voice: Kokoro-82M `af_heart`. Target: about 4 min 20 s (limit 3 to 5 min). About 600 spoken words at about 165 words a minute,
plus pauses. Lines are written for the ear: numbers and abbreviations are spelled the way they should be said.

| # | Time | Shot (the real site) | Narration |
|---|---|---|---|
| 1 | 0:00 | Front page: the map of the US with the wildfire risk layer, panel collapsed, then opened | A climate figure usually arrives as one number. Two hundred and seventy nine tonnes. Six hundred and one tonnes. Twelve thousand hectares. Behind it are meter readings, a factor, readings someone dropped, and a person who decided. None of that travels with the number. Grounding makes a climate claim show its work. |
| 2 | 0:22 | Panel: the six claims as sentences | It is built for a verifier: someone who has to decide whether a figure can be trusted. Here are six claims on real open data: a building, an energy forecast, a burn scar, a battery, carbon credits, and a company's own disclosure. Each is a plain sentence, and each is rechecked in your browser when you open it. |
| 3 | 0:42 | Building claim, step 1: the checks and figures | Take the building. Its facility manager says this office in California emitted two hundred and seventy eight point nine two tonnes of C O two equivalent from grid electricity, January to March twenty sixteen. Grounding rebuilds that figure from two thousand one hundred and sixty hourly meter readings and the E P A's grid factor, here, in the browser. |
| 4 | 1:05 | Step 2: the flagged readings and the decisions | Five hourly readings are zero, in the middle of normal use. A model suggests each one is a meter fault. It does not decide. A person did: four are meter dropouts, and the fifth is the hour the clocks skipped for daylight saving, so nothing is missing there. Each reason is recorded, and the case says how much use the four dropouts may hide. That decision is tied to a fingerprint of the exact readings. If any reading changes, the decision goes stale and has to be made again. |
| 5 | 1:35 | Step 3: choose Accept, type a name and reason, sign, download | Now you are the reviewer. Choose a verdict, give your name and a reason, and sign in this browser. Two signatures: Ed twenty five five one nine, and M L D S A sixty five, which is built to resist quantum computers. You download the signed record. |
| 6 | 1:57 | Step 4: change one input, the signatures fail, reset | Change one input. The claim is rebuilt, and both signatures stop matching the evidence. Reset, and they match again. |
| 7 | 2:10 | Verify page: drop the downloaded record, Valid; drop an edited copy, Broken | Anyone can check a record on the Verify page. No account, no server: the file never leaves the browser. Valid means nothing has changed since it was signed. Edit one number in a text editor, drop it in again, and it reads broken, and names the claim that changed. |
| 8 | 2:35 | Energy, burn scar, battery claim pages, a few seconds each | The same steps run on every claim. The energy forecast scores zero point six four seven on its published benchmark, so a shift of one hundred and twenty megawatt hours is capped at one hundred, and a person approved it. The satellite detector reproduces the reference burn map pixel for pixel, yet finds less burned area than the reference reports. Grounding shows that gap instead of hiding it. The battery cell keeps seventy seven point six percent of its rated capacity, or ninety point six percent of what it held when first tested, and a person held it for service review. |
| 9 | 3:08 | Carbon and disclosure claim pages; the status words on the claim list | Two hundred carbon registry records show no credit retired twice, or beyond what was issued. A company's own disclosure cannot be recalculated at all, so Grounding links the source and records what the figure may rest on. Three of the six claims read needs evidence. That is the point: it says what it could not check. |
| 10 | 3:32 | The map: zoom from the US to the building and the burn scar; toggle 2011 and 2047 | On the map, each claim sits where it happened, over open wildfire risk data for the whole United States, building by building, today and as projected for twenty forty seven. |
| 11 | 3:50 | How it fits your work: roles, the command line, the agent audit | It fits work verifiers already do. Every case is a plain JSON file. The same checks run from the command line and in continuous integration. An agent can walk through the audit, and a person still decides. |
| 12 | 4:08 | Front page, panel open, title card | Grounding. Climate claims that show their work. Open source, under Apache two point oh. |

## Facts each line rests on (check before recording)

- 1: 278.92 tCO₂e (building), 601.26 tCO₂e (disclosure), 11,974 ha (burn scar, said as "twelve thousand").
- 3 and 4: BDG2 Bear_assembly_Angel, 2,160 readings, eGRID 2016 California factor; 5 flags, all isolated zero readings (Jev suggested
  meter_fault for each), all excluded by person:energy-manager: four as meter dropouts, one (2016-03-13 02:00) as the hour US/Pacific skipped for daylight saving (reports/building-mrv/interval-decisions.json); the case discloses about 2,425 kWh (0.58 tCO₂e) the baseline expects at the four dropouts. Decisions bind to the meter-series digest.
- 5: signing on the claim page uses Ed25519 and ML-DSA-65 keys made in the browser for that record only (the page says
  this does not prove identity; the narration does not claim it does).
- 8: Energy-EVA accuracy 0.647, 120 to 100 MWh cap, approved by person:energy-manager. Burn scar 11,974 ha against
  18,664 ha in the reference. Battery 77.6% SoH against nominal 58 Ah, 90.6% against the first recorded cycle (the basis in Regulation (EU) 2023/1542 Art. 3(28)), after 100 cycles, service review.
- 9: live statuses: building, energy, battery Rechecked; earth, carbon, disclosure Needs evidence.
- 10: CarbonPlan Open Climate Risk tiles (ODbL), Overture building footprints; credited on screen, no endorsement implied.

Capture: headless (page only). Reviewer name on screen: "Verifier". Build: `video/` (gitignored): `narrate.py`, `record.mjs`, `assemble.py`.
