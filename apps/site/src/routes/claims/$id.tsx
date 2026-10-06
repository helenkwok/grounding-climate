import { Link, createFileRoute, notFound } from "@tanstack/react-router";

import { CLAIMS, claimMeta, deriveResult, type ClaimId } from "../../../../demo/src/claims-meta";
import { Pending, Result, Rows, State, outcomeTone } from "../../components";
import { loadClaim, useLive } from "../../live";

export const Route = createFileRoute("/claims/$id")({
  beforeLoad: ({ params }) => {
    if (!CLAIMS.some((claim) => claim.id === params.id)) throw notFound();
  },
  head: ({ params }) => ({ meta: [{ title: claimMeta(params.id as ClaimId).title + " · ClimateChain" }] }),
  component: ClaimPage,
});

function ClaimPage() {
  const id = Route.useParams().id as ClaimId;
  const meta = claimMeta(id);
  const item = useLive(() => loadClaim(id), [id]);
  const ready = item && !(item instanceof Error) ? item : undefined;
  const index = CLAIMS.findIndex((claim) => claim.id === id);
  const previous = CLAIMS[index - 1];
  const next = CLAIMS[index + 1];

  return (
    <main id="top">
      <header className="page-head">
        <p className="kicker">Claim {index + 1} of {CLAIMS.length}</p>
        <h1>{meta.title}</h1>
        <p className="question">{meta.question}</p>
        <p className="data">{meta.data}</p>
        <div className="page-result">
          {ready ? (
            <>
              <span className="figure">{ready.kpi}</span>
              <span className="note">{ready.kpiLabel}</span>
              <Result result={deriveResult(ready.checks)} />
            </>
          ) : (
            <Pending value={item} />
          )}
        </div>
      </header>

      {ready && (
        <div className="claim-body detail">
          <div className="detail-cols">
            <div>
              <h4>Checks run in your browser</h4>
              <ul className="checks">
                {ready.checks.map((check) => (
                  <li key={check.id + check.name}>
                    <span>{check.name}</span>
                    <State tone={outcomeTone(check.outcome)}>{check.outcome}</State>
                    {check.detail && <small>{check.detail}</small>}
                  </li>
                ))}
              </ul>
              <h4>Figures</h4>
              <Rows className="figures" rows={ready.metrics} />
            </div>
            <div>
              <h4>{ready.decisionTitle}</h4>
              <p className="note">{ready.decisionCopy}</p>
              <Rows rows={ready.decisions ?? []} />
              <p className="limit"><strong>Limits.</strong> {ready.limitation}</p>
            </div>
          </div>
          <details className="more">
            <summary>Technical detail: sources and digests</summary>
            <p className="detail-source">Source: {ready.source}</p>
            <Rows className="provenance" rows={ready.provenance} />
          </details>
        </div>
      )}

      <nav className="claim-nav" aria-label="Other claims">
        {previous ? <Link to="/claims/$id" params={{ id: previous.id }}>← {previous.title}</Link> : <Link to="/" hash="claims">← All claims</Link>}
        {next ? <Link to="/claims/$id" params={{ id: next.id }}>{next.title} →</Link> : <Link to="/" hash="claims">All claims →</Link>}
      </nav>
    </main>
  );
}
