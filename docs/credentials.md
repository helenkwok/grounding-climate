# Credentials: each case as a W3C Verifiable Credential

Every signed case in `reports/<module>/case-run.json` also has a credential view, made by
`scripts/export-credentials.mjs` from `packages/core/src/vc.ts`. The credential is a view of the case,
not a replacement: the case's own hybrid attestation is still the record of truth, and the credential
names it by SHA-256 and CID. `npm run check` (through `check:cases`) recomputes every credential from its
committed case and checks all of its signatures.

| File | What it is |
|---|---|
| `reports/<module>/credential.json` | The credential, with a Data Integrity proof set (Ed25519, then ML-DSA-65) |
| `reports/<module>/credential.eddsa.jws` | The same credential as a VC-JOSE-COSE envelope, `alg: EdDSA` |
| `reports/<module>/credential.ml-dsa-65.jws` | The same credential as a VC-JOSE-COSE envelope, `alg: ML-DSA-65` |
| `reports/did.json` | The issuer's DID document: public keys only, as JsonWebKey and Multikey |

## Shapes

- **Building, energy, earth, carbon and disclosure**: a UNTP **Digital Conformity Credential**. The
  subject (`ConformityAttestation`) holds the claim, what Grounding rechecked (each check, its outcome,
  the findings) and the recheck status. `recheck.status` is rolled up the way the site shows it: never better
  than the result the case recorded or any of its checks (`rollUp()` in `packages/core/src/vc.ts`), so earth,
  carbon and disclosure read "insufficient-evidence" here as on the site. The case's own result is kept beside
  it as `recheck.recordedResult`. It carries findings only. It sets no UNTP `conformance` verdict and
  is not an assurance or certification opinion.
- **Battery**: a UNTP **Digital Product Passport** (`ProductPassport`), at **item** level and **dynamic**.
  - It carries the EN 18223 passport header (Table 1): `digitalProductPassportId`,
    `uniqueProductIdentifier`, `granularity`, `dppSchemaVersion`, `dppStatus`, `lastUpdated` and
    `economicOperatorId`.
  - Its state of health is named as DIN DKE SPEC 99100 names it (6.7):
    - `stateOfHealth`: %, relative to the first recorded cycle (the initial state);
    - `capacityFade`: integer %;
    - `ratedCapacity`: Ah;
    - `remainingCapacity`: Ah.

    Each value carries its date, method, level and whether it is static or dynamic.
  - `stateOfHealthVsRated` is the ratio the disposition policy reads.
  - Each attribute that has one also names its counterpart in the Battery Pass data model,
    io.BatteryPass.Performance 1.2.1 (Battery Pass consortium, CC BY 4.0,
    github.com/batterypass/BatteryPassDataModel; entry `batterypass-data-model` in
    `sources/rights-manifest.json`). Only the names are reused.
  - The values are recomputed from the committed cycle history at export, and must equal the signed case's.
- **Identifiers.**
  - `credentialSubject.id` is a URL, as EN 18219 asks: `https://helenkwok.github.io/grounding-climate/id/...`.
    These URLs are placeholders. They are not registered GS1 or ISO/IEC 15459 identifiers and do not resolve.
  - Evidence is linked by its https source URL where it has one, and always by a CIDv1 (raw, sha2-256)
    built from its recorded SHA-256.
- **Anchor.** The case's Bitcoin anchor is a separate `evidence` item, never a `proof`. It gives:
  - the chain as CAIP-2: `bip122:000000000019d6689c085ae165831e93`;
  - the anchored digest of the signed case record;
  - the status, and the block height and hash once known.

  An anchored proof shows only that the record "existed no later than block H". A credential
  whose anchor is upgraded (`npm run anchor:upgrade`) must be exported again.

Records are **tamper-evident**, in ISO 22739's term, not immutable: a case can be re-signed, and every
re-signing gives a new credential.

## Securing

- Both forms are made over the same credential, and both need both algorithms to verify.
- **Ed25519 is the proof other verifiers can check today. ML-DSA-65 is a second proof**, kept so the record
  stays checkable after Ed25519 is retired (NIST IR 8547 draft: 2035).
- **VC-JOSE-COSE**: two compact JWS (`typ: vc+jwt`), one per algorithm.
  - `alg: EdDSA` (RFC 8037);
  - `alg: ML-DSA-65` (RFC 9964, pure ML-DSA with the empty context, which is what Grounding already signs);
  - `kid` names a JsonWebKey method in `did.json` (OKP Ed25519, and AKP for ML-DSA-65).
  - The verifier rejects an `alg` that does not match the key named by `kid`, `alg: none`, any other `typ`,
    and any `crit`.
- **Data Integrity proof set**:
  - `eddsa-jcs-2022`: the W3C Recommendation suite;
  - `grounding-mldsa65-jcs-2026`: an ML-DSA-65 proof hashed the same way as the draft's `mldsa44-jcs-2024`.
    No W3C suite defines ML-DSA-65, so the name is ours and the proof is experimental.
  - Both point at Multikey methods. Ed25519 uses `0xed`. ML-DSA-65 uses `0x1211`, which is draft in the
    multicodec table.
- Keys are fresh for each export, like the case runs' keys. Only their public halves are kept, in `reports/did.json`.

## Standards and their status

| Standard | Status | Used for |
|---|---|---|
| W3C Verifiable Credentials Data Model 2.0 | Recommendation (May 2025) | Credential structure, `evidence` |
| W3C Securing VCs using JOSE and COSE | Recommendation (2025) | `vc+jwt` envelopes |
| IETF RFC 9964, ML-DSA for JOSE and COSE | Proposed Standard (May 2026) | `alg: ML-DSA-65`, AKP keys |
| IETF RFC 8037 (EdDSA in JOSE) | Proposed Standard | `alg: EdDSA`, OKP keys |
| W3C Data Integrity 1.0 and `eddsa-jcs-2022` | Recommendations (2025) | Ed25519 proof |
| W3C Quantum-Resistant Cryptosuites | First Public Working Draft (Jun 2026), ML-DSA-44 only | Construction of the experimental ML-DSA-65 proof |
| UN/CEFACT UNTP DPP and DCC | Pre-1.0. 0.6.0 contexts resolve at `test.uncefact.org`; 0.7.0's returned 403 on 2026-10-18 | Credential types and contexts |
| CAIP-2 (bip122 namespace profile) | CAIP-2 Final; the bip122 profile is Draft | Anchor chain id |
| EN 18219 / EN 18223 / EN 18246 | Published 2026 | Identifier form, passport header, the trust-framework limit below |
| DIN DKE SPEC 99100:2025-02 | DIN SPEC (not a standard) | Battery attribute names and units |
| ESPR (EU) 2024/1781, Art. 10 to 12 | In force; delegated acts for batteries pending | Context only: what a passport will have to do |

## What it does not claim

- **It is not a compliant EU product passport.** No ESPR delegated act is met. The identifiers are
  placeholders, and no registry has been consulted.
- **The issuer is not identified.** `did:web:helenkwok.github.io:grounding-climate` is a placeholder.
  The site build copies `did.json` to its root, which is where did:web would look, but nothing is hosted
  there yet.
  - EN 18246 asks for writers whose keys sit in a trust framework, with identity-proofed certificates.
    A self-asserted key in a self-published DID document does not meet that.
  - A valid signature shows the credential has not changed since it was signed. It does not show who
    signed it.
- **No revocation.** UNTP makes Bitstring Status List mandatory; there is no `credentialStatus` yet.
- **No JSON-LD processing was run.** The proofs use JCS (sorted-key JSON), not RDF canonicalisation, so
  they do not depend on it. Grounding's own terms fall under an `@vocab` namespace that is not hosted.

## How to verify

- `node scripts/verify-credentials.mjs` checks four things for each case:
  - the credential still matches its committed case;
  - the proof set verifies;
  - both JWS envelopes verify;
  - all of it against `reports/did.json`.
- **In a browser**: drop a `credential.json` on the site's Verify page. It checks both Data Integrity
  proofs in the browser:
  - Ed25519 through WebCrypto;
  - ML-DSA-65 through WebCrypto where the browser has it, otherwise the noble fallback.

  It checks them against the DID document the site was built with.
- **Re-export** after any re-signing or anchor upgrade: `npm run credentials:export`.
