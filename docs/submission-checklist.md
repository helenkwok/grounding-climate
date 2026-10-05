# Submission checklist

Issue: #15

## Current ready state

- [x] Integrated browser demo exists
- [x] Clean static demo build is CI-tested
- [x] All five analytical modules use real upstream data
- [x] Measured baseline/check results are committed as small JSON reports
- [x] Tamper/failure paths are deterministic
- [x] WebMCP uses application tools rather than DOM scraping
- [x] Consequential WebMCP actions require human approval
- [x] Classical + ML-DSA crypto implementation is CI-tested
- [x] Hybrid X25519MLKEM768 TLS path is CI-tested
- [x] Source rights and attribution are machine checked
- [x] Raw third-party data are excluded from the submission bundle

## Required human/external actions

- [ ] Make the source repository public, or provide an equivalent public source repository
- [ ] Resolve #2 eligibility ambiguity with the organisers
- [ ] Confirm the exact final submission deadline/timezone from the organisers
- [ ] Review #16 Session 1 recording if access becomes available
- [ ] Select the primary Devpost track explicitly
- [ ] Record the 3–5 minute video
- [ ] Upload the video
- [ ] Upload the generated submission ZIP
- [ ] Fill the Devpost problem/solution/user/adoption text
- [ ] Re-check Devpost configuration immediately before submission

## Primary-track working recommendation

The integrated workspace is broad, but the clearest umbrella for the product as currently demonstrated is:

**Climate Data & Environmental Monitoring**

Reason:
- the product's common job is evidence verification/provenance across climate data
- Building MRV, Earth observation, battery telemetry, registry records, and public disclosures all enter one evidence workspace
- the demo does not depend on token trading as the product premise

There is also strong secondary alignment with:

- Carbon Markets & Emissions Transparency
- Renewable Energy & Energy Trading
- Sustainable Supply Chains

Do not describe the project as entering every track unless the Devpost form explicitly supports that.

## Primary presentation user

For the 3–5 minute video, keep one user throughout the main story:

**climate / carbon verifier reviewing evidence behind a reported climate claim**

This user can:
- inspect Building MRV evidence
- ask the WebMCP agent for provenance
- see source/model/factor boundaries
- view the recorded tamper results (building, battery, carbon)
- distinguish public disclosure from independently reproduced evidence

The other module-specific users remain evidence that the workspace architecture generalises; they do not all need equal airtime.

## Generate the required ZIP

From a clean checkout:

```bash
npm install
python3 scripts/build-submission.py
```

Output:

```text
dist/submission/climatechain-submission.zip
```

The generator:

1. builds the static demo
2. copies only selected project-owned documentation/metadata/measured summaries
3. excludes downloaded raw benchmark data
4. creates `MANIFEST.json` with SHA-256 for every bundled file
5. marks `thirdPartyRawDataIncluded: false`

The ZIP is a judging/review artifact. Full source code remains in the repository.

## Final video structure

Use [judging-demo.md](judging-demo.md).

Target approximately 4:20, leaving margin below the five-minute maximum:

- 0:00–0:30 problem/user
- 0:30–1:20 Building MRV measured result
- 1:20–1:50 breadth across the shared workspace
- 1:50–2:35 WebMCP audit
- 2:35–3:25 deterministic tamper/failure
- 3:25–3:55 real public disclosure boundary
- 3:55–4:20 trust architecture / adoption / limitations
