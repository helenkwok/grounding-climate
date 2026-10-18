//! Native cryptography for Grounding.
//!
//! This crate deliberately keeps post-quantum attestation signatures separate
//! from optional ledger/wallet logic. ML-DSA authenticates the evidence bundle;
//! an optional ledger may later commit only the resulting digest.

use boring::error::ErrorStack;
use boring::mldsa::{Algorithm, MlDsaPrivateKey, MlDsaPublicKey};

pub const ML_DSA_65_ALGORITHM: &str = "ML-DSA-65";

/// An ML-DSA-65 key pair backed by Cloudflare's `boring` bindings.
pub struct MlDsa65KeyPair {
    private_key: MlDsaPrivateKey,
    public_key: MlDsaPublicKey,
}

impl MlDsa65KeyPair {
    /// Generates a fresh ML-DSA-65 key pair.
    pub fn generate() -> Result<Self, ErrorStack> {
        let (public_key, private_key) =
            MlDsaPrivateKey::generate(Algorithm::MlDsa65)?;

        Ok(Self {
            private_key,
            public_key,
        })
    }

    /// Serializes the verification key to the BoringSSL ML-DSA public-key form.
    pub fn public_key_bytes(&self) -> Result<Vec<u8>, ErrorStack> {
        self.public_key.to_bytes()
    }

    /// Signs exact bytes. Canonicalization/domain separation is performed by
    /// the application layer before this boundary.
    pub fn sign(&self, message: &[u8]) -> Result<Vec<u8>, ErrorStack> {
        self.private_key.sign(message)
    }

    /// Verifies an ML-DSA-65 signature using serialized public-key bytes.
    ///
    /// A structurally invalid public key is an error. A bad signature or
    /// modified message returns `Ok(false)`.
    pub fn verify(
        public_key: &[u8],
        message: &[u8],
        signature: &[u8],
    ) -> Result<bool, ErrorStack> {
        let public_key =
            MlDsaPublicKey::from_slice(Algorithm::MlDsa65, public_key)?;
        Ok(public_key.verify(message, signature).is_ok())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mldsa65_round_trip() {
        let key = MlDsa65KeyPair::generate().unwrap();
        let public_key = key.public_key_bytes().unwrap();
        let message = b"grounding canonical attestation payload";
        let signature = key.sign(message).unwrap();

        assert!(MlDsa65KeyPair::verify(&public_key, message, &signature).unwrap());
    }

    #[test]
    fn mldsa65_rejects_tampered_message() {
        let key = MlDsa65KeyPair::generate().unwrap();
        let public_key = key.public_key_bytes().unwrap();
        let signature = key.sign(b"evidence-root:A").unwrap();

        assert!(
            !MlDsa65KeyPair::verify(
                &public_key,
                b"evidence-root:B",
                &signature,
            )
            .unwrap()
        );
    }

    #[test]
    fn mldsa65_rejects_tampered_signature() {
        let key = MlDsa65KeyPair::generate().unwrap();
        let public_key = key.public_key_bytes().unwrap();
        let message = b"evidence-root:A";
        let mut signature = key.sign(message).unwrap();
        signature[0] ^= 1;

        assert!(
            !MlDsa65KeyPair::verify(&public_key, message, &signature).unwrap()
        );
    }

    fn vector_field(json: &str, name: &str) -> Vec<u8> {
        let start = json.find(&format!("\"{name}\": \"")).unwrap() + name.len() + 5;
        let hex = &json[start..start + json[start..].find('"').unwrap()];
        (0..hex.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
            .collect()
    }

    // The same vector, made by Node, is checked by Node and noble in packages/crypto-node/test/provider.test.ts.
    #[test]
    fn mldsa65_verifies_the_node_vector() {
        let json = include_str!("../../../test-vectors/ml-dsa-65.json");
        let spki = vector_field(json, "publicKeySpkiHex");
        let public_key = &spki[22..];
        let message = vector_field(json, "messageHex");
        let mut signature = vector_field(json, "signatureHex");

        assert!(MlDsa65KeyPair::verify(public_key, &message, &signature).unwrap());
        signature[0] ^= 1;
        assert!(!MlDsa65KeyPair::verify(public_key, &message, &signature).unwrap());
    }
}
