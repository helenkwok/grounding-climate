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

What signing the time does not do: whoever holds a key chooses the time they sign with. A stolen key can still sign with a date before its revocation. Ruling that out needs a time the signer does not control, such as an external timestamp or ledger anchor recorded when the signature is made.

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

Do not assume browser WebCrypto supports ML-DSA.

The browser/WebMCP layer should call an application service implementing the crypto contract. A Rust service can own ML-DSA keys or call an HSM/KMS later.

Consequential operations such as:

- create attestation
- publish bundle
- anchor commitment

remain human-approved operations in #7.

## Ledger boundary

A ledger adapter receives only compact commitment material:

```ts
interface LedgerCommitmentRequest {
  evidenceRoot: ContentDigest
  attestationDigest: ContentDigest
  attestationRef: string
}
```

It does not receive signing private keys and the domain model has no wallet field.

This makes the chain responsible for a narrow statement such as:

> this commitment existed in this ledger history

while the crypto verifier is responsible for:

> these keys signed these exact canonical bytes

and the evidence/verification layer remains responsible for:

> what the source evidence supports

Issue #8 will implement the evidence-root, challenge lifecycle, signed log, and optional ledger adapter against this boundary.

## What PQ does not solve

Post-quantum cryptography does not establish physical truth.

- ML-KEM protects transport key establishment.
- ML-DSA authenticates exact signed bytes.
- A ledger records a commitment/history property.
- None of these proves that a meter, satellite scene, supplier declaration, or public carbon disclosure was truthful before it entered the system.
