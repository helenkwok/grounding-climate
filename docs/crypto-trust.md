# Crypto-agile trust layer

Issue: #18

Grounding keeps three trust problems separate:

```text
transport confidentiality
≠ evidence / attestation authenticity
≠ shared public commitment
```

A blockchain is not the TLS layer and is not the identity/signature layer. The application can verify an attestation without a wallet or chain.

## Current standards profile

### Transport

For service-to-service TLS, the preferred hybrid group is:

```text
TLS 1.3 + X25519MLKEM768
```

RFC 10024 standardizes hybrid post-quantum/traditional TLS 1.3 key agreement, including X25519MLKEM768.

Cloudflare `boring` 5.2.0 uses its patched BoringSSL TLS path for post-quantum key agreement. Its separate `mlkem` Cargo feature exposes the low-level FIPS 203 ML-KEM API and explicitly does not control TLS ciphers/groups.

Grounding therefore does **not** enable the low-level `mlkem` feature merely to get PQ TLS.

### Long-lived authenticity

Attestations use algorithm-agile signature envelopes.

The post-quantum native implementation currently uses:

```text
ML-DSA-65 (FIPS 204)
```

through Cloudflare `boring`'s `mldsa` feature.

The classical Node implementation uses:

```text
Ed25519
```

for current ecosystem interoperability and local development.

### Parameters that show where they came from

Grounding asks a climate figure to show its work. The same test applies to its own cryptography: a parameter should
come with the procedure that produced it, so anyone can rederive it instead of trusting it.

- **Ed25519** (RFC 8032) runs over Curve25519, whose parameters RFC 7748 derives by a stated deterministic procedure
  (Appendix A).
- **ML-DSA-65** (FIPS 204) uses no elliptic curve; its parameter set is fixed in the standard.
- **Not chosen: the NIST P-curves** (P-256 and others, FIPS 186). They were published in 2000 with seeds whose origin
  went unexplained for over two decades. In October 2026 Anthropic's Frontier Red Team reported reconstructing them:
  - The P-192 to P-521 seeds are outputs of the C library's `lrand48` generator, seeded with Unix timestamps from 1997
    and 1998, not hash outputs.
  - Some base points, including P-256's, are still unexplained.
  - The authors state this is not a weakness in ECDSA, and that the finding makes a hidden backdoor less plausible.

  The work was done by recomputing rather than trusting, which is the method Grounding applies to climate claims. A
  model proposed the hypothesis, and the published code lets anyone reproduce the seeds.
- **The chains' own curves are outside Grounding's records.** Bitcoin and Ethereum (Sepolia) sign their transactions
  with secp256k1, which the report does not cover. The Bitcoin anchor's proof rests on SHA-256 and proof of work, not
  on secp256k1.

Reference: J. Wood, H. de Valence, A. Howell, Z. Voase, L. Sweet, A. Omidi, P. Crowley, I. McGinniss, N. Carlini and
S. Weis, "Claude reveals ECDSA curve origins", Anthropic, 16 October 2026,
<https://www.anthropic.com/research/ecdsa-curve-origins>.

## Signed bytes

The application does not sign arbitrary JSON serialization.

```text
domain
+ schema version
+ canonical { envelopeVersion, createdAt, payload } bytes
→ SHA-256 content identifier
→ one or more signatures over the same domain-separated canonical bytes
```

The signature covers the exact domain-separated payload bytes and the envelope's `createdAt`, not only a human-readable field or mutable database row. Envelope version 0.1 left `createdAt` unsigned, so editing it could move a signature to before a key's revocation and make it verify; version 0.2 signs it, and 0.1 envelopes are refused.

The envelope stores the SHA-256 digest as an identifier and tamper check:

```json
{
  "version": "grounding.signature-envelope/0.2",
  "domain": "grounding.attestation",
  "schemaVersion": "0.1",
  "payloadHash": {
    "algorithm": "SHA-256",
    "value": "..."
  },
  "createdAt": "...",
  "signatures": [
    {
      "suite": "classical",
      "algorithm": "Ed25519",
      "keyId": "...",
      "encoding": "base64url",
      "value": "..."
    },
    {
      "suite": "post-quantum",
      "algorithm": "ML-DSA-65",
      "keyId": "...",
      "encoding": "base64url",
      "value": "..."
    }
  ]
}
```

The core `createSignatureEnvelope()` API accepts signers from multiple providers. That permits a classical provider and a Rust-backed ML-DSA provider/service to contribute signatures to one envelope without teaching Claim/Evidence about either algorithm.

## CryptoProvider boundary

The application-facing TypeScript contract is:

```ts
interface CryptoProvider {
  hash(data: Uint8Array, algorithm: "SHA-256"): Promise<ContentDigest>
  sign(payload: Uint8Array, key: SigningKeyRef): Promise<CryptoSignature>
  verify(
    payload: Uint8Array,
    signature: CryptoSignature,
    key: VerificationKey
  ): Promise<boolean>
  describeKey(keyId: string): Promise<KeyMetadata | undefined>
}
```

Implementations are free to live in Node, a native Rust service, an HSM/KMS adapter, or a future browser capability.

No domain object assumes:

- secp256k1
- an Ethereum/Solana/etc. address
- Ed25519
- ML-DSA
- a browser wallet
- a specific chain

## Key identity and rotation

Subject identity and key identity are distinct.

Key metadata records:

- key ID
- controller
- suite / algorithm
- created time
- validity interval
- revocation time
- superseding key
- verification key

Rotation behavior:

```text
old key signs at T1
→ key rotates at T2
→ old private key becomes unavailable
→ historical public key + metadata remain
→ signature from T1 remains verifiable
→ old key is invalid for new signatures after T2
```

Verification checks validity at the **envelope creation/signing time**, not merely whether the key is active today. That time is signed, so nobody without the key can change it; an attestation's `createdAt` must also equal the `issuedAt` in its signed payload. Signed-log records are checked the same way against their signed timestamp.

What signing the time does not do: whoever holds a key chooses the time they sign with. A stolen key can still sign with a date before its revocation. Ruling that out needs a time the signer does not control, such as an external timestamp or ledger anchor recorded when the signature is made. Grounding anchors each signed record in Bitcoin for this; see [Bitcoin anchor](provenance-attestation.md#bitcoin-anchor).

### Signature policy

`minimumSignatures` counts **distinct keys**, not signatures: the same signature copied twice, or two signatures from one key, count once, and the result lists any `duplicateKeyIds`. `requiredSuites` needs at least one valid signature from each named suite, so a hybrid policy (`["classical", "post-quantum"]`) needs both an Ed25519 and an ML-DSA signature. Distinct keys are not necessarily distinct people: two keys held by one controller still count as two.

## Implementations

### `@grounding-climate/crypto-node`

Provides a real Ed25519 `CryptoProvider` using Node's built-in cryptography.

Tests cover:

- signature round trip
- payload tampering
- key rotation
- historical verification after rotation
- ML-DSA-65 (Node 24), and a hybrid policy that fails without either signature
- adversarial cases (`test/adversarial.test.ts`): a backdated `createdAt`, one signature copied twice, an old-version envelope, and a signed-log record made after its key was revoked

This is suitable for signing in local and server workflows. It now also signs and verifies ML-DSA-65 through Node's built-in cryptography; the Rust crate below remains the TLS and BoringSSL path.

### `grounding-crypto-boring`

Rust crate backed by:

```text
boring = 5.2.0 + feature "mldsa"
```

It provides an ML-DSA-65 key wrapper with:

- generation
- public-key serialization
- signing
- verification
- tamper tests

It does not expose or persist private seed bytes.

## Hybrid PQ TLS smoke test

The Rust test creates a local self-signed TLS server and client, forces both ends to:

```text
X25519MLKEM768
```

using `set_curves_list()`, completes the handshake, exchanges an application byte, then checks the negotiated BoringSSL group ID (`0x11ec`) through `SslRef::curve()` on both connections.

The test therefore checks the **negotiated key-exchange group**, not merely that the configuration string was accepted. `boring` 5.2.0 can return no textual `curve_name()` for this hybrid group, so the test deliberately asserts the BoringSSL/IANA wire group ID instead.

## Browser/WebMCP boundary

The site signs and verifies in the browser. Ed25519 uses WebCrypto. ML-DSA-65 verifies through WebCrypto where the browser has it (Chrome 155 does, with default settings) and falls back to `@noble/post-quantum` 0.7.1 otherwise, only when WebCrypto reports the algorithm as unsupported; signing uses noble. The page names which implementation checked each signature. Those keys are made in the browser for one record and prove no identity: an organisation that needs identity would keep its keys in a service, HSM or KMS behind the same crypto contract.

Node 24 (`packages/crypto-node`), `@noble/post-quantum` and the BoringSSL crate (`crates/crypto-boring`) all verify one fixed ML-DSA-65 vector made by Node (`test-vectors/ml-dsa-65.json`), and reject it after a one-byte change, in CI.

Ed25519 verification in Node and the browser accepts some weak public keys that RFC 8032 §5.1.3 rejects (small-order points, non-canonical encodings). That does not matter while each record carries its own keys, because anyone can already sign with a key they make, and a valid ML-DSA-65 signature is still required; it would matter if keys were tied to an identity, and those keys should then be checked at import.

Consequential operations such as:

- create attestation
- publish bundle
- anchor commitment

remain human-approved operations in #7.

## Ledger boundary

An anchor adapter (`AnchorAdapter` in `packages/core/src/anchor.ts`) receives only a 32-byte digest of the
signed record, never the record itself:

```ts
submit(digest: Uint8Array): Promise<AnchorSubmission>
```

It does not receive signing private keys and the domain model has no wallet field.

This makes the chain responsible for a narrow statement such as:

> this commitment existed in this ledger history

while the crypto verifier is responsible for:

> these keys signed these exact canonical bytes

and the evidence/verification layer remains responsible for:

> what the source evidence supports

The anchors that exist today (Bitcoin via OpenTimestamps, and the EVM contract) implement this boundary; see
`docs/evm-anchor.md`.

## What PQ does not solve

Post-quantum cryptography does not establish physical truth.

- ML-KEM protects transport key establishment.
- ML-DSA authenticates exact signed bytes.
- A ledger records a commitment/history property.
- None of these proves that a meter, satellite scene, supplier declaration, or public carbon disclosure was truthful before it entered the system.
