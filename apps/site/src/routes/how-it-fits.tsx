import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { CLAIMS } from "../../../demo/src/claims-meta";
import { STAGES } from "../components";

export const Route = createFileRoute("/how-it-fits")({
  head: () => ({ meta: [{ title: "How it fits your work · Grounding" }] }),
  component: HowItFits,
});

const ROLES: Array<[string, string]> = [
  ["Whoever makes the claim", "publishes the figure with its evidence: the meter export, the registry report, the satellite scene, the page it came from."],
  ["The person closest to the data", "decides each flagged reading or gap, for example a facility energy manager or a registry auditor. Each decision is tied to the exact data."],
  ["The verifier", "rechecks the claim, records a verdict and signs it. That's you, on any claim in the inbox."],
  ["Anyone downstream", "an investor, a regulator, a buyer of credits: opens the signed record and checks it, without trusting anyone's server."],
];

const RUN: Array<[string, string]> = [
  ["npm run check:cases", "Rebuilds all six claims from the committed data and checks each signed result, on your own machine."],
  ["node scripts/run-carbon-case.mjs --import climate-action-reserve:retirement:<file>.csv:<page URL> --out <run.json>", "Reconciles a registry export you downloaded yourself. It is kept as a fingerprint only, and decisions made on other records go stale."],
  ["node scripts/verify-<claim>-case.mjs", "Checks one claim's committed signed result, for building, energy, earth, battery, carbon or disclosure."],
];

function HowItFits() {
  return (
    <>
      <header className="page-head">
        <p className="kicker">For verifiers, reporting teams and registries</p>
        <h1>How it fits your work</h1>
        <p className="data">
          Grounding doesn't replace your data systems. It sits between a reported figure and the people who rely on it:
          evidence goes in, a signed record comes out, and anyone can check that record.
        </p>
      </header>

      <section className="section">
        <h2>The five stages, and who does each</h2>
        <ol className="stages">
          {STAGES.map(([title, text], index) => (
            <li key={title}>
              <span className="step-n">{index + 1}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ol>
        <dl className="boundary roles">
          {ROLES.map(([who, what]) => (
            <div key={who}><dt>{who}</dt><dd>{what}</dd></div>
          ))}
        </dl>
      </section>

      <section className="section fit-io">
        <div>
          <h2>What goes in</h2>
          <dl className="boundary">
            {CLAIMS.map((claim) => (
              <div key={claim.id}>
                <dt><Link to="/claims/$id" params={{ id: claim.id }}>{claim.title}</Link></dt>
                <dd>{claim.data}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div>
          <h2>What comes out</h2>
          <p>One signed record per claim: a JSON file holding</p>
          <ul className="limit-list">
            <li><strong>a fingerprint of each piece of evidence</strong>, and where to find it, so anyone holding the data can confirm it is the same;</li>
            <li><strong>the figure</strong>, and the calculation or model run behind it;</li>
            <li><strong>every decision</strong>, who made it, and the data it was made on;</li>
            <li><strong>what the claim counts and leaves out</strong>, and what was not assessed;</li>
            <li><strong>two signatures</strong>: Ed25519, and ML-DSA-65, a post-quantum standard, so the record stays checkable after quantum computers can forge today's signatures.</li>
          </ul>
          <p><Link className="button" to="/verify">Verify a record</Link></p>
        </div>
      </section>

      <section className="section">
        <h2>Run it on your own machine</h2>
        <p className="intro">The same code runs from the command line, on the committed data. From a copy of the repository, after <code>npm install</code>:</p>
        <dl className="boundary commands">
          {RUN.map(([command, what]) => (
            <div key={command}><dt><code>{command}</code></dt><dd>{what}</dd></div>
          ))}
        </dl>
      </section>

      <Agents />

      <section id="limits" className="section limits" aria-labelledby="limits-title">
        <div>
          <h2 id="limits-title">What this does not prove yet</h2>
          <ul className="limit-list">
            <li><strong>Who signed.</strong> Keys are made per run or per record. A signature shows nothing changed since signing; tying keys to a real person or organisation is the next step.</li>
            <li><strong>Why data was odd.</strong> A decision is a recorded judgement, not a confirmed cause. Site records don't confirm why the building's meter read zero.</li>
            <li><strong>Company figures.</strong> A disclosed figure can't be recalculated from public data. It is accepted only as the company's own statement.</li>
            <li><strong>Registry gaps.</strong> The ACR records are a 100-row sample. Ten groups of retirements have no matching issuance in it and are marked for investigation.</li>
            <li><strong>Satellite area.</strong> The detector reproduces the reference pixel by pixel, but its burned area is 36% below the reference map's. The gap is recorded, not explained.</li>
          </ul>
        </div>
        <div>
          <h2>What it takes to adopt</h2>
          <ul className="limit-list">
            <li><strong>No account, no token, no server.</strong> Checking runs in an ordinary browser or with Node.js.</li>
            <li><strong>Open formats.</strong> Evidence stays in CSV, JSON and the providers' own files; records are plain JSON.</li>
            <li><strong>Data rights respected.</strong> Sources that can't be shared are linked or fingerprinted, never copied.</li>
          </ul>
        </div>
      </section>
    </>
  );
}

type Agents = typeof import("../../../demo/src/agents");

/** The agent tools, registered through WebMCP when the browser has it, with a guided audit for browsers without it. */
function Agents() {
  const [agents, setAgents] = useState<Agents | Error>();
  const [, refresh] = useState(0);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    import("../../../demo/src/agents").then(setAgents, (error: Error) => setAgents(error));
  }, []);
  const ready = agents && !(agents instanceof Error) ? agents : undefined;
  const calls = ready?.activity.list().slice(-30).reverse() ?? [];

  return (
    <section id="agents" className="section" aria-labelledby="agents-title">
      <h2 id="agents-title">AI agents use the same checks</h2>
      <p className="intro">
        Through WebMCP, this page offers Grounding's checks to an AI agent in your browser as tools, only those that fit
        the open case. Anything consequential still waits for a person. No agent in your browser? The guided audit makes
        the same calls here.
      </p>
      <div className="agent">
        <div>
          <p>
            {ready
              ? ready.surface.available
                ? "WebMCP found: " + ready.surface.toolNames.length + " tools offered to your browser's agent."
                : "No WebMCP in this browser. The " + ready.surface.toolNames.length + " tools run through the guided audit instead."
              : agents instanceof Error
                ? "Could not start the agent tools: " + agents.message
                : "Starting the agent tools…"}
          </p>
          <ol className="audit-steps">
            <li>List what this case can check.</li>
            <li>Rebuild the building's baseline and review its flagged readings.</li>
            <li>Recompute the building's emissions.</li>
            <li>Reconcile the carbon registry records.</li>
            <li>Read the company's public claim.</li>
          </ol>
          <button
            className="button primary"
            type="button"
            disabled={!ready || running}
            onClick={async () => {
              setRunning(true);
              await ready!.guidedAudit(() => refresh((n) => n + 1));
              setRunning(false);
            }}
          >
            Run the guided audit
          </button>
        </div>
        <div className="activity">
          <div className="activity-head"><h3>Tool calls</h3></div>
          <div className="activity-log">
            {calls.length ? (
              calls.map((event, index) => (
                <div className="activity-entry" key={index}>
                  <time>{event.at.slice(11, 19)}</time>
                  <strong>{event.tool}</strong>
                  <em>{event.phase}</em>
                </div>
              ))
            ) : (
              <p className="note">No tool calls yet.</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
