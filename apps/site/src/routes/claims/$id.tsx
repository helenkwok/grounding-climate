import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import type { Verification, VerificationResult } from "@grounding-climate/core";
import { useEffect, useState, type FormEvent } from "react";

import { CLAIMS, claimMeta, deriveResult, type ClaimId } from "../../../../demo/src/claims-meta";
import type { DemoModule, EvidenceChart } from "../../../../demo/src/modules";
import { CaseMap, hasPlace } from "../../case-map";
import { Pending, Result, Rows, State, STATUS_NOTE, outcomeTone } from "../../components";
import { setTampered, signedRecords } from "../../live";
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

/** The five parts of every claim; each step highlights its part of the page without hiding the rest. */
const PATH: Array<[step: string, how: string]> = [
  ["Recompute", "From the evidence"],
  ["Check", "Software checks"],
  ["Decide", "A person decided"],
  ["Sign", "Signed twice"],
  ["Change one input", "Try it"],
];

function ClaimPage() {
  const id = Route.useParams().id as ClaimId;
  const meta = claimMeta(id);
  const [item, setItem] = useState<DemoModule | Error>();
  const [tampered, setTamperedState] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    setItem(undefined);
    setTamperedState(false);
    setStep(0);
    // A claim left changed on another visit to this page is restored first, so the page starts from the committed data.
    setTampered(id, false).then(setItem, (error: Error) => setItem(error));
  }, [id]);

  async function change(on: boolean) {
    setBusy(true);
    setStep(4);
    setItem(await setTampered(id, on).catch((error: Error) => error));
    setTamperedState(on);
    setBusy(false);
  }

  const ready = item && !(item instanceof Error) ? item : undefined;
  const index = CLAIMS.findIndex((claim) => claim.id === id);
  const previous = CLAIMS[index - 1];
  const next = CLAIMS[index + 1];
  const attestation = ready?.checks.find((check) => check.id === "attestation");
  const matches = attestation?.outcome === "pass";

  return (
    <div className={"combined focus-" + step}>
      <header className={"c-head" + (hasPlace(id) ? "" : " no-map")}>
        <div>
          <p className="kicker"><Link to="/">All claims</Link> · {meta.title}</p>
          <h1 className="claim-h1">{meta.claim}</h1>
          <p className="data"><strong>Claimed by:</strong> {meta.claimant}. <strong>Evidence:</strong> {meta.data}</p>
          <div className="page-result part-0 part-4">
            {ready ? (
              <>
                <span>{ready.kpiLead ?? "Rechecked in your browser:"}</span>
                <span className="figure">{ready.kpi}</span>
                <span className="note">{ready.kpiLabel}</span>
                <Result result={deriveResult(ready.checks)} />
                <span className="note status-note">{STATUS_NOTE}</span>
              </>
            ) : (
              <Pending value={item} />
            )}
          </div>
          {!hasPlace(id) && <p className="note no-place">{meta.place}</p>}
        </div>
        {hasPlace(id) && (
          <figure className={"lab-map part-0" + (id === "energy" ? " no-shading" : "")}>
            <CaseMap />
            <figcaption>{meta.place}{id !== "energy" && " Shading: annual wildfire risk to US buildings (Open Climate Risk v1.1.0, CarbonPlan); context, not evidence."}</figcaption>
          </figure>
        )}
      </header>

      <ol className="stepper">
        {PATH.map(([name, how], i) => (
          <li key={name}>
            <button type="button" aria-current={i === step ? "step" : undefined} onClick={() => setStep(i)}>
              <span>{i + 1}</span>{name}<small>{how}</small>
            </button>
          </li>
        ))}
      </ol>

      <section className="lab-chart part-0 part-1 part-4" aria-label="The evidence">
        {ready ? ready.evidence.map((chart) => <Evidence key={chart.caption} chart={chart} />) : <Pending value={item} />}
      </section>

      <div className="c-row">
        <div>
          <section className="part-1">
            <h2>What software rechecked</h2>
            {ready ? (
              <ul className="checks">
                {ready.checks.map((check) => (
                  <li key={check.id + check.name}>
                    <span>{check.name}</span>
                    <State tone={outcomeTone(check.outcome)}>{check.outcome}</State>
                    {check.detail && <small>{check.detail}</small>}
                  </li>
                ))}
              </ul>
            ) : <Pending value={item} />}
          </section>
          <section className="part-2 c-decide">
            <h2>What a person decided</h2>
            {ready ? (
              <>
                <p className="note">{ready.decisionCopy}</p>
                <ol className="flags">
                  {ready.flags.map((flag, n) => (
                    <li key={flag.when + n} className={flag.state}>
                      <span className="n">{n + 1}</span>
                      <span className="when">{flag.when}</span>
                      <span className="what">{flag.what}</span>
                      <span className="who">{flag.who}</span>
                    </li>
                  ))}
                </ol>
              </>
            ) : <Pending value={item} />}
          </section>
        </div>
        <aside className="record part-3 part-4">
          <p className="kicker">The signed record</p>
          {ready ? (
            <div className={"seals " + (matches ? "ok" : "broken")} aria-live="polite">
              {ready.seals.map((seal) => (
                <div key={seal.algorithm} className="seal">
                  <strong>{seal.algorithm}</strong>
                  <span>{seal.valid ? "matches the evidence" : "no longer matches the evidence"}</span>
                </div>
              ))}
            </div>
          ) : <Pending value={item} />}
          <div className="part-4">
            {ready && <p className="note"><strong>Try it:</strong> {ready.tamper.change.replace(/, applied in this browser$/, "")}.</p>}
            <div className="actions">
              <button className="button danger" type="button" disabled={!ready || busy || tampered} onClick={() => change(true)}>Change one input</button>
              <button className="button" type="button" disabled={!ready || busy || !tampered} onClick={() => change(false)}>Reset</button>
            </div>
            {attestation && tampered && (
              <p className="verdict bad">
                The signatures no longer match the evidence. Overall: <Result result={deriveResult(ready!.checks)} />
              </p>
            )}
          </div>
          {ready && <p className="not-checked"><strong>Not checkable here:</strong> {ready.limitation}</p>}
        </aside>
      </div>

      <section className="case-steps c-verdict">
        <h2>Your verdict, signed in this browser</h2>
        {ready ? <Review claimId={id} item={ready} tampered={tampered} /> : <Pending value={item} />}
      </section>

      {id === "carbon" && <Scoreboard />}

      {ready && (
        <>
          {ready.decisions && ready.decisions.length > 0 && (
            <details className="more case-more">
              <summary>What the claim counts, and what it leaves out</summary>
              <h3>{ready.decisionTitle}</h3>
              <Rows rows={ready.decisions} />
              <Rows className="figures" rows={ready.metrics} />
            </details>
          )}
          <details className="more case-more">
            <summary>Technical detail: sources and digests</summary>
            <p className="detail-source">Source: {ready.source}</p>
            <Rows className="provenance" rows={ready.provenance} />
          </details>
        </>
      )}

      <nav className="claim-nav" aria-label="Other claims">
        {previous ? <Link to="/claims/$id" params={{ id: previous.id }}>← {previous.title}</Link> : <Link to="/">← All claims</Link>}
        {next ? <Link to="/claims/$id" params={{ id: next.id }}>{next.title} →</Link> : <Link to="/">All claims →</Link>}
      </nav>
    </div>
  );
}

const fmt = (value: number) => (value === 0 ? "0" : Math.abs(value) >= 100 ? Math.round(value).toLocaleString("en-US") : Math.abs(value) >= 1 ? value.toFixed(2) : value.toPrecision(3));

/** One drawing of the claim's evidence: a series with its flagged points, or bars comparing figures. */
function Evidence({ chart }: { chart: EvidenceChart }) {
  if (chart.kind === "bars") {
    const top = Math.max(...chart.bars.map((bar) => bar.value ?? 0)) || 1;
    return (
      <figure className="ev">
        <div className="bars" role="list">
          {chart.bars.map((bar) => (
            <div key={bar.label} className={"bar tone-" + bar.tone + (bar.value === null ? " none" : "")} role="listitem">
              <span className="bar-label">{bar.label}</span>
              <span className="bar-track">
                <span className="bar-fill" style={{ width: bar.value === null ? "100%" : Math.max(0.4, (bar.value / top) * 100) + "%" }} />
              </span>
              <span className="bar-value">
                {bar.value === null ? "—" : bar.value.toLocaleString("en-US") + (chart.unit ? " " + chart.unit : "")}
                {bar.note && <small>{bar.note}</small>}
              </span>
            </div>
          ))}
        </div>
        <figcaption>
          {chart.caption}
          {chart.link && <> <a href={chart.link.href} rel="noreferrer" target="_blank">{chart.link.text}</a></>}
        </figcaption>
      </figure>
    );
  }
  const width = 1200;
  const height = 260;
  const pad = { l: 56, r: 12, t: 16, b: 26 };
  const min = chart.min ?? 0;
  const x = (i: number) => pad.l + (i / Math.max(1, chart.values.length - 1)) * (width - pad.l - pad.r);
  const y = (value: number) => pad.t + (1 - (Math.min(Math.max(value, min), chart.max) - min) / (chart.max - min)) * (height - pad.t - pad.b);
  const path = chart.values.map((value, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(value).toFixed(1)).join("");
  return (
    <figure className="ev">
      <svg className="series" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={chart.caption}>
        {[0, 0.5, 1].map((f) => {
          const value = min + (chart.max - min) * f;
          return (
            <g key={f}>
              <line x1={pad.l} x2={width - pad.r} y1={y(value)} y2={y(value)} className="grid" />
              <text x={pad.l - 6} y={y(value) + 4} className="axis" textAnchor="end">{fmt(value)}</text>
            </g>
          );
        })}
        {chart.ticks.map(([i, label]) => <text key={label} x={x(i) + 4} y={height - 6} className="axis">{label}</text>)}
        <text x={pad.l} y={pad.t - 4} className="axis">{chart.unit}</text>
        {chart.line && (
          <g className="ref">
            <line x1={pad.l} x2={width - pad.r} y1={y(chart.line.value)} y2={y(chart.line.value)} />
            <text x={width - pad.r - 4} y={y(chart.line.value) - 6} textAnchor="end">{chart.line.label}</text>
          </g>
        )}
        <path d={path} className="line" />
        {chart.changed && (
          <g className="changed">
            <line x1={x(chart.changed.index)} x2={x(chart.changed.index)} y1={y(min)} y2={pad.t} />
            <circle cx={x(chart.changed.index)} cy={y(chart.values[chart.changed.index]!)} r={7} />
            <text x={x(chart.changed.index) - 10} y={pad.t + 30} textAnchor={chart.changed.index > chart.values.length * 0.7 ? "end" : "start"}>{chart.changed.note}</text>
          </g>
        )}
        {chart.marks?.map((mark, n) => (
          <g key={mark.index} className={"flag " + mark.state}>
            <line x1={x(mark.index)} x2={x(mark.index)} y1={pad.t} y2={height - pad.b} />
            <circle cx={x(mark.index)} cy={y(chart.values[mark.index]!)} r={8} />
            <text x={x(mark.index)} y={pad.t + 12} textAnchor="middle">{n + 1}</text>
          </g>
        ))}
      </svg>
      <figcaption>{chart.caption}</figcaption>
    </figure>
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
