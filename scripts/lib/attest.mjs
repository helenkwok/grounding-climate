// Signing and independent verification shared by every module's run script. Each run makes fresh demo keys
// (one Ed25519, one ML-DSA-65); they identify the run, not a person or an organisation. The verifier gets
// only the published key metadata, never the signer's private keys.
import {
  createSignedAttestation,
  HYBRID_SIGNATURE_POLICY,
  publishedKeyResolver,
  verifySignedAttestation,
} from "@climatechain/core";
import { InMemoryNodeCryptoProvider } from "@climatechain/crypto-node";

/** Signs `climateCase` and returns the attestation, the published keys and a verify function for any case. */
export async function signCase({ climateCase, module, statement, claimRef, verificationRef, createdAt }) {
  const signer = new InMemoryNodeCryptoProvider();
  const keyOptions = { controller: "org:climatechain-demo", createdAt };
  const ed = signer.generateEd25519Key({ keyId: "key:demo-ed25519:" + createdAt, ...keyOptions });
  const pq = signer.generateMlDsa65Key({ keyId: "key:demo-ml-dsa-65:" + createdAt, ...keyOptions });
  const attestation = await createSignedAttestation(climateCase, {
    id: "attestation:" + module + ":" + createdAt,
    attester: { subjectId: "org:climatechain-demo", name: "ClimateChain demo run" },
    statement,
    claimRefs: [claimRef],
    verificationRef,
    issuedAt: createdAt,
    hashProvider: signer,
    signers: [
      { provider: signer, key: ed.signingKey },
      { provider: signer, key: pq.signingKey },
    ],
  });
  const publishedKeys = [await signer.describeKey(ed.signingKey.keyId), await signer.describeKey(pq.signingKey.keyId)];
  const verifier = new InMemoryNodeCryptoProvider();
  const verify = (someCase) =>
    verifySignedAttestation(someCase, attestation, {
      hashProvider: verifier,
      resolveKey: publishedKeyResolver(publishedKeys, verifier),
      policy: HYBRID_SIGNATURE_POLICY,
    });
  return { attestation, publishedKeys, verify };
}

/** The parts of a verification worth recording in a run report. */
export function verificationSummary(verification) {
  return {
    attestationValidForSignedEvidence: verification.validForSignedEvidence,
    attestationValidForCurrentEvidence: verification.validForCurrentEvidence,
    changedRefs: verification.changedRefs,
    signatures: verification.signature.signatures.map((item) => ({
      algorithm: item.signature.algorithm,
      signatureValid: item.signatureValid,
    })),
  };
}
