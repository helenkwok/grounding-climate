import { Link, createFileRoute } from "@tanstack/react-router";
import {
  cidFromSha256,
  type DidDocument,
  type ProofCheck,
  type SignedAttestationVerification,
  type VerifiableCredential,
} from "@grounding-climate/core";
import { useState, type DragEvent } from "react";

import cidManifest from "../../../../reports/cid-manifest.json";
// The issuer's DID document as committed with the credentials; the page checks credentials against it.
import issuerDid from "../../../../reports/did.json";
import { claimMeta } from "../../../demo/src/claims-meta";
import { Result, Rows, State } from "../components";
import { signedRecords } from "../live";
import type { SignedRecord } from "../signing";

export const Route = createFileRoute("/verify")({
  head: () => ({ meta: [{ title: "Verify a signed record · Grounding" }] }),
  component: VerifyPage,
});

type Outcome =
  | { name: string; record: SignedRecord; result: SignedAttestationVerification; cid: string }
  | { name: string; credential: VerifiableCredential; proofs: ProofCheck[]; valid: boolean; cid: string }
  | { name: string; error: string };

const isCredential = (value: unknown): value is VerifiableCredential =>
  typeof value === "object" && value !== null && Array.isArray((value as { type?: unknown }).type) &&
  ((value as { type: unknown[] }).type).includes("VerifiableCredential");

// Committed files by SHA-256, so an evidence digest that is a whole file's digest can name that file.
const committedFiles = new Map(cidManifest.files.map((file) => [file.sha256, file.path]));

/** Every SHA-256 digest an evidence node carries: its integrity, and any "SHA-256:…" fingerprint in its extensions. */
function evidenceDigests(record: SignedRecord): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  for (const evidence of record.case.evidence) {
    if (evidence.integrity?.algorithm === "SHA-256") found.push([evidence.id, "SHA-256:" + evidence.integrity.value]);
    for (const [key, value] of Object.entries(evidence.extensions ?? {})) {
      if (typeof value === "string" && value.startsWith("SHA-256:")) found.push([evidence.id + " · " + key, value]);
    }
  }
  return found;
}

function VerifyPage() {
  const [outcome, setOutcome] = useState<Outcome>();
  const [dragging, setDragging] = useState(false);

  async function check(name: string, text: string) {
    try {
      const parsed: unknown = JSON.parse(text);
      const [{ verifyRecord }, { WebCryptoProvider }, core] = await Promise.all([
        import("../signing"),
        import("../../../demo/src/web-crypto"),
        import("@grounding-climate/core"),
      ]);
      const provider = new WebCryptoProvider();
      const cid = cidFromSha256(await provider.hash(new TextEncoder().encode(text), "SHA-256"));
      if (isCredential(parsed)) {
        const proofs = await core.verifyProofSet(parsed, issuerDid as DidDocument, provider);
        setOutcome({ name, credential: parsed, proofs, valid: core.hybridSatisfied(proofs), cid });
        return;
      }
      const record = parsed as SignedRecord;
      setOutcome({ name, record, result: await verifyRecord(record, provider), cid });
    } catch (error) {
      setOutcome({ name, error: error instanceof SyntaxError ? "This file is not JSON." : error instanceof Error ? error.message : String(error) });
    }
  }

  function drop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void file.text().then((text) => check(file.name, text));
  }

  return (
    <>
      <header className="page-head">
        <p className="kicker">Anyone can do this</p>
        <h1>Verify a signed record</h1>
        <p className="data">
          A signed record holds the evidence, every decision, the result and two signatures. Checking it needs nothing but
          this page: no account, no server. Your file is read in this browser and never uploaded.
        </p>
      </header>

      <section className="section verify">
        <label
          className={"drop" + (dragging ? " dragging" : "")}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={drop}
        >
          <strong>Drop a record here, or choose a file</strong>
          <span className="note">
            A .json file downloaded from any claim's “Your verdict” step, or a case's <code>credential.json</code> (W3C
            Verifiable Credential) from the repository's <code>reports/</code> folder.
          </span>
          <input
            type="file"
            accept=".json,application/json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void file.text().then((text) => check(file.name, text));
            }}
          />
        </label>

        {signedRecords.length > 0 && (
          <div className="recent">
            <h2>Signed during this visit</h2>
            <ul className="limit-list">
              {signedRecords.map((item) => (
                <li key={item.signedAt}>
                  <button className="text-button" type="button" onClick={() => void check(claimMeta(item.claimId).title + " record", JSON.stringify(item.record))}>
                    {claimMeta(item.claimId).title}: {item.verdict}, signed {item.signedAt.slice(11, 19)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {outcome && <Report outcome={outcome} />}

        <p className="note try">
          Try breaking one: open a downloaded record in a text editor, change any number in its <code>case</code>, save,
          and drop it here again. No record yet? <Link to="/">Review a claim</Link> and sign your verdict.
        </p>
      </section>
    </>
  );
}

function Report({ outcome }: { outcome: Outcome }) {
  if ("error" in outcome) {
    return (
      <div className="step-figure tamper-output is-bad" aria-live="polite">
        <p className="verdict bad">Could not check {outcome.name}.</p>
        <p>{outcome.error}</p>
      </div>
    );
  }
  if ("credential" in outcome) return <CredentialReport outcome={outcome} />;
  const { record, result } = outcome;
  const valid = result.validForCurrentEvidence;
  const review = record.case.verifications.find((node) => node.id === record.attestation.payload.verificationRef?.id);
  return (
    <div className={"step-figure tamper-output " + (valid ? "is-good" : "is-bad")} aria-live="polite">
      <p className={"verdict " + (valid ? "good" : "bad")}>
        {valid
          ? "Valid: nothing in this record has changed since it was signed."
          : !result.validForSignedEvidence
            ? "Broken: the signatures don't match what was signed."
            : "Broken: the evidence in this record has changed since it was signed."}
      </p>
      <Rows
        className="boundary tamper-rows"
        rows={[
          ["File", outcome.name],
          ["Statement", record.attestation.payload.statement],
          ["Signed by", (record.attestation.payload.attester.name ?? record.attestation.payload.attester.subjectId) + ", " + record.attestation.payload.issuedAt],
          ["Claim", record.case.claims.map((claim) => claim.subject.name ?? claim.id).join("\n")],
          ...(review ? [["Verdict in the record", review.findings.join(" ")] as [string, string]] : []),
          ["Changed since signing", result.changedRefs.length ? result.changedRefs.map((ref) => ref.id).join("\n") : "nothing"],
        ]}
      />
      <ul className="checks">
        {result.signature.signatures.map((item) => (
          <li key={item.signature.keyId}>
            <span>{item.signature.algorithm} signature</span>
            <State tone={item.signatureValid ? "good" : "bad"}>{item.signatureValid ? "valid" : "invalid"}</State>
          </li>
        ))}
        <li><span>Evidence matches what was signed</span><State tone={result.currentEvidenceMatches ? "good" : "bad"}>{result.currentEvidenceMatches ? "yes" : "no"}</State></li>
        {review && <li><span>Reviewer's verdict</span><Result result={review.result} /></li>}
      </ul>
      <h3>Content addresses</h3>
      <p className="note">
        Content addresses: anyone holding these files can serve them over IPFS; the address itself proves the bytes.
      </p>
      <ul className="checks">
        <li><span>This record file</span><span className="note">the bytes checked here</span><small>{outcome.cid}</small></li>
        {evidenceDigests(record).map(([name, digest]) => {
          const file = committedFiles.get(digest);
          return (
            <li key={name + digest}>
              <span>{name}</span>
              <span className="note">{file ? "committed file " + file : "digest of prepared data, not one file"}</span>
              <small>{cidFromSha256(digest)}</small>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CredentialReport({ outcome }: { outcome: { name: string; credential: VerifiableCredential; proofs: ProofCheck[]; valid: boolean; cid: string } }) {
  const { credential, proofs, valid } = outcome;
  const subject = credential.credentialSubject as {
    id?: string;
    claim?: { statement?: string };
    recheck?: { status?: string; findings?: string[] };
  };
  const kind = credential.type.includes("DigitalProductPassport") ? "Digital Product Passport" : "Digital Conformity Credential";
  const anchor = (credential.evidence as Array<{ type?: string[]; chain?: string; statement?: string }> | undefined)?.find((item) =>
    item.type?.includes("TimestampAnchor"),
  );
  const label = (suite: string) => (suite === "eddsa-jcs-2022" ? "Ed25519 (eddsa-jcs-2022)" : "ML-DSA-65 (" + suite + ", experimental)");
  return (
    <div className={"step-figure tamper-output " + (valid ? "is-good" : "is-bad")} aria-live="polite">
      <p className={"verdict " + (valid ? "good" : "bad")}>
        {valid
          ? "Valid: nothing in this credential has changed since the issuer signed it."
          : "Broken: the credential doesn't match what the issuer signed."}
      </p>
      <Rows
        className="boundary tamper-rows"
        rows={[
          ["File", outcome.name],
          ["Content address", outcome.cid],
          ["Format", "W3C Verifiable Credential 2.0 (UNTP 0.6.0 " + kind + ")"],
          ["Issuer", credential.issuer.id + " (placeholder, not yet hosted: it does not prove who issued it)"],
          ["Issued", credential.validFrom],
          ["Subject", subject.id ?? ""],
          ["Claim", subject.claim?.statement ?? ""],
          ["Findings", (subject.recheck?.findings ?? []).join(" ")],
          ...(anchor ? [["Anchor", (anchor.chain ?? "") + ": " + (anchor.statement ?? "")] as [string, string]] : []),
        ]}
      />
      <ul className="checks">
        {proofs.map((proof) => (
          <li key={proof.cryptosuite}>
            <span>{label(proof.cryptosuite)} proof</span>
            <State tone={proof.valid ? "good" : "bad"}>{proof.valid ? "valid" : "invalid"}</State>
          </li>
        ))}
        {proofs.length < 2 && <li><span>Both proofs present</span><State tone="bad">no</State></li>}
        {subject.recheck?.status && <li><span>Recheck result in the credential</span><Result result={subject.recheck.status} /></li>}
      </ul>
    </div>
  );
}
