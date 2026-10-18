import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import type { Verification, VerificationResult } from "@grounding-climate/core";
import { useEffect, useState, type FormEvent } from "react";

import { CLAIMS, claimMeta, deriveResult, type ClaimId } from "../../../../demo/src/claims-meta";
import type { DemoModule } from "../../../../demo/src/modules";
import { Pending, Result, Rows, State, STATUS_NOTE, outcomeTone } from "../../components";
import { loadClaim, setTampered, signedRecords } from "../../live";
import scoreboard from "../../../../../reports/carbon-registry/scoreboard.json";
import type { SignedRecord } from "../../signing";

export const Route = createFileRoute("/claims/$id")({
  beforeLoad: ({ params }) => {
    if (!CLAIMS.some((claim) => claim.id === params.id)) throw notFound();
  },
  head: ({ params }) => ({ meta: [{ title: claimMeta(params.id as ClaimId).title + " · Grounding" }] }),
  component: ClaimPage,
});

const VERDICTS: Array<{ value: VerificationResult; label: string; help: string }> = [
  { value: "reconciled", label: "Accept", help: "The evidence supports the claim as stated." },
  { value: "insufficient-evidence", label: "Needs evidence", help: "The claim may hold, but the evidence here doesn't settle it." },
  { value: "mismatch", label: "Reject", help: "The evidence contradicts the claim." },
];

function ClaimPage() {
  const id = Route.useParams().id as ClaimId;
  const meta = claimMeta(id);
  const [item, setItem] = useState<DemoModule | Error>();
  const [tampered, setTamperedState] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setItem(undefined);
    setTamperedState(false);
    // A claim left changed on another visit to this page is restored first, so the page starts from the committed data.
    setTampered(id, false).then(setItem, (error: Error) => setItem(error));
  }, [id]);

  async function change(on: boolean) {
    setBusy(true);
    setItem(await setTampered(id, on).catch((error: Error) => error));
    setTamperedState(on);
    setBusy(false);
  }

  const ready = item && !(item instanceof Error) ? item : undefined;
  const index = CLAIMS.findIndex((claim) => claim.id === id);
  const previous = CLAIMS[index - 1];
  const next = CLAIMS[index + 1];
  const attestation = ready?.checks.find((check) => check.id === "attestation");

  return (
    <>
      <header className="page-head">
        <p className="kicker"><Link to="/">All claims</Link> · {meta.title}</p>
        <h1 className="claim-h1">{meta.claim}</h1>
        <p className="data"><strong>Claimed by:</strong> {meta.claimant}. <strong>Evidence:</strong> {meta.data}</p>
        <div className="page-result">
          {ready ? (
            <>
              <span>Rechecked in your browser:</span>
              <span className="figure">{ready.kpi}</span>
              <span className="note">{ready.kpiLabel}</span>
              <Result result={deriveResult(ready.checks)} />
              <span className="note status-note">{STATUS_NOTE}</span>
            </>
          ) : (
            <Pending value={item} />
          )}
        </div>
      </header>

      <ol className="case-steps">
        <li className="case-step">
          <h2><span className="step-n">1</span>Rechecked from the evidence</h2>
          {ready ? (
            <div className="detail-cols">
              <ul className="checks">
                {ready.checks.map((check) => (
                  <li key={check.id + check.name}>
                    <span>{check.name}</span>
                    <State tone={outcomeTone(check.outcome)}>{check.outcome}</State>
                    {check.detail && <small>{check.detail}</small>}
                  </li>
                ))}
              </ul>
              <Rows className="figures" rows={ready.metrics} />
            </div>
          ) : <Pending value={item} />}
        </li>

        <li className="case-step">
          <h2><span className="step-n">2</span>Already decided, and by whom</h2>
          {ready ? (
            <div className="detail-cols">
              <div>
                <h3>{ready.decisionTitle}</h3>
                <p className="note">{ready.decisionCopy}</p>
                <p className="limit"><strong>Limits.</strong> {ready.limitation}</p>
              </div>
              <Rows rows={ready.decisions ?? []} />
            </div>
          ) : <Pending value={item} />}
        </li>

        <li className="case-step">
          <h2><span className="step-n">3</span>Your verdict, signed in this browser</h2>
          {ready ? <Review claimId={id} item={ready} tampered={tampered} /> : <Pending value={item} />}
        </li>

        <li className="case-step">
          <h2><span className="step-n">4</span>Try to change the evidence</h2>
          <div className="detail-cols">
            <div>
              <p className="note">
                Change one input of this claim in your browser. Grounding rebuilds the claim and checks the signature made
                on the committed evidence again.
              </p>
              {ready && <p><strong>What changes:</strong> {ready.tamper.change}</p>}
              <div className="actions">
                <button className="button danger" type="button" disabled={!ready || busy || tampered} onClick={() => change(true)}>Change one input</button>
                <button className="button" type="button" disabled={!ready || busy || !tampered} onClick={() => change(false)}>Reset</button>
              </div>
            </div>
            <div className={"step-figure tamper-output " + (attestation ? (attestation.outcome === "pass" ? "is-good" : "is-bad") : "")} aria-live="polite">
              {attestation ? (
                <>
                  <p className={"verdict " + (attestation.outcome === "pass" ? "good" : "bad")}>
                    {attestation.outcome === "pass" ? "The signatures match the evidence." : "The signatures no longer match the evidence."}
                  </p>
                  <p className="note">{attestation.detail}</p>
                  <p>Overall: <Result result={deriveResult(ready!.checks)} /></p>
                </>
              ) : <Pending value={item} />}
            </div>
          </div>
        </li>
      </ol>

      {id === "carbon" && <Scoreboard />}

      {ready && (
        <details className="more case-more">
          <summary>Technical detail: sources and digests</summary>
          <p className="detail-source">Source: {ready.source}</p>
          <Rows className="provenance" rows={ready.provenance} />
        </details>
      )}

      <nav className="claim-nav" aria-label="Other claims">
        {previous ? <Link to="/claims/$id" params={{ id: previous.id }}>← {previous.title}</Link> : <Link to="/">← All claims</Link>}
        {next ? <Link to="/claims/$id" params={{ id: next.id }}>{next.title} →</Link> : <Link to="/">All claims →</Link>}
      </nav>
    </>
  );
}

type Check = { label: string; basis: string } & Record<string, unknown>;
type Board = { registry: string; name: string; countsPublished?: boolean; checks?: Record<string, Check> };

/** The figure each check counts, in the order the checks are listed. */
const CHECK_COUNTS: Array<[key: string, count: string, unit: string]> = [
  ["overRetired", "projectVintages", "project-vintages"],
  ["retiredBeforeIssuance", "rows", "retirements"],
  ["issuedBeforeVintage", "rows", "issuances"],
  ["projectTotals", "mismatches", "projects"],
];

/** The same four checks over every registry in the OffsetsDB snapshot; counts are shown only where we may publish them. */
function Scoreboard() {
  const boards = scoreboard.registries as Board[];
  const shown = boards.filter((board) => board.checks);
  const withheld = boards.filter((board) => board.countsPublished === false).map((board) => board.name);
  const first = shown[0]!.checks!;
  return (
    <section className="scoreboard case-steps" aria-labelledby="scoreboard-h">
      <h2 id="scoreboard-h">The same checks over whole registries</h2>
      <p className="note">
        {scoreboard.question} {scoreboard.creditRows.toLocaleString("en-US")} credit rows from {boards.length} registries.{" "}
        {scoreboard.finding} {scoreboard.order}
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Check, and the rule it rests on</th>
              {shown.map((board) => (
                <th scope="col" key={board.registry}>
                  {board.registry === "american-carbon-registry" ? <abbr title={board.name}>ACR</abbr> : board.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CHECK_COUNTS.map(([key, count, unit]) => (
              <tr key={key}>
                <th scope="row">{first[key]!.label}<small>{first[key]!.basis}</small></th>
                {shown.map((board) => {
                  const value = board.checks![key]![count] as number;
                  return <td key={board.registry} className={value ? "flagged" : undefined}>{value.toLocaleString("en-US")} <small>{unit}</small></td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="limit">
        <strong>Not shown.</strong> {withheld.join(", ")} are checked by the same code, but their counts stay unpublished
        while their terms on derived data are unclear. <code>{"node scripts/run-carbon-scoreboard.mjs"}</code> computes them for anyone.
      </p>
      <p className="detail-source">{scoreboard.attribution}</p>
    </section>
  );
}

/** The reviewer's verdict becomes a verification node in the case, which is then signed and offered as a download. */
function Review({ claimId, item, tampered }: { claimId: ClaimId; item: DemoModule; tampered: boolean }) {
  const [verdict, setVerdict] = useState<VerificationResult>();
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [signed, setSigned] = useState<{ record: SignedRecord; href: string; file: string } | Error>();
  const [busy, setBusy] = useState(false);

  async function sign(event: FormEvent) {
    event.preventDefault();
    if (!verdict || !name.trim()) return;
    setBusy(true);
    try {
      const [{ signRecord }, { WebCryptoProvider }] = await Promise.all([import("../../signing"), import("../../../../demo/src/web-crypto")]);
      const signedAt = new Date().toISOString();
      const climateCase = structuredClone(item.climateCase);
      const subjectId = "person:" + name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const review: Verification = {
        nodeType: "verification",
        id: "verification:review:" + signedAt,
        createdAt: signedAt,
        provenance: [
          ...climateCase.claims.map((claim) => ({ nodeType: "claim" as const, id: claim.id })),
          ...climateCase.verifications.map((node) => ({ nodeType: "verification" as const, id: node.id })),
        ],
        verifier: { id: subjectId, kind: "person", name: name.trim() },
        profile: "grounding-review/0.1",
        result: verdict,
        checks: item.checks.map(({ id, name: checkName, outcome }) => ({ id: "recheck:" + id, name: checkName + " (rerun by the reviewer)", outcome })),
        findings: [note.trim() || VERDICTS.find((option) => option.value === verdict)!.help],
        verifiedAt: signedAt,
      };
      climateCase.verifications.push(review);
      const record = await signRecord({
        climateCase,
        base: new WebCryptoProvider(),
        signer: { subjectId, name: name.trim() },
        statement: name.trim() + " reviewed this claim and recorded: " + VERDICTS.find((option) => option.value === verdict)!.label + ".",
        claimRefs: climateCase.claims.map((claim) => ({ nodeType: "claim", id: claim.id })),
        verificationRef: { nodeType: "verification", id: review.id },
        signedAt,
      });
      signedRecords.unshift({ claimId, record, verdict: VERDICTS.find((option) => option.value === verdict)!.label, signedAt });
      const href = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: "application/json" }));
      setSigned({ record, href, file: "grounding-" + claimId + "-" + signedAt.replaceAll(":", "") + ".json" });
    } catch (error) {
      setSigned(error instanceof Error ? error : new Error(String(error)));
    }
    setBusy(false);
  }

  if (signed && !(signed instanceof Error)) {
    return (
      <div className="signed">
        <p className="verdict good">Signed in your browser.</p>
        <Rows
          rows={[
            ["Statement", signed.record.attestation.payload.statement],
            ["Signed at", signed.record.attestation.payload.issuedAt],
            ["Signatures", signed.record.publishedKeys.map((key) => key.algorithm + " (" + key.suite + ")").join("\n")],
            ["Evidence fingerprint", signed.record.attestation.payload.evidenceRoot.value],
          ]}
        />
        <div className="actions">
          <a className="button primary" href={signed.href} download={signed.file}>Download the signed record</a>
          <Link className="button" to="/verify">Verify it</Link>
        </div>
        <p className="note">
          The keys were made in this browser for this record only. A valid signature shows the record hasn't changed since
          you signed it. It doesn't prove who you are: that needs keys tied to an identity, which this demo doesn't have.
        </p>
      </div>
    );
  }

  return (
    <form className="review" onSubmit={sign}>
      <fieldset>
        <legend>Your verdict on this claim</legend>
        {VERDICTS.map((option) => (
          <label key={option.value} className="choice">
            <input type="radio" name="verdict" value={option.value} checked={verdict === option.value} onChange={() => setVerdict(option.value)} required />
            <span><strong>{option.label}</strong> {option.help}</span>
          </label>
        ))}
      </fieldset>
      <label>Your name, as it should appear in the record
        <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} autoComplete="name" />
      </label>
      <label>Why (optional)
        <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={600} />
      </label>
      {tampered && <p className="error">Reset the changed input first: you'd be signing altered evidence.</p>}
      {signed instanceof Error && <p className="error">Could not sign: {signed.message}</p>}
      <div className="actions">
        <button className="button primary" type="submit" disabled={busy || tampered}>Sign in this browser</button>
      </div>
    </form>
  );
}
