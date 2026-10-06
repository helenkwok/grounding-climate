import { Link, createFileRoute } from "@tanstack/react-router";

import { CaseMap } from "../case-map";
import { ClaimList, STAGES, useAllClaims } from "../components";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "ClimateChain · Climate claims that can show their work" }] }),
  component: Home,
});


function Home() {
  const results = useAllClaims();
  return (
    <main id="top">
      <section className="hero home-hero" aria-labelledby="hero-title">
        <p className="kicker">IEEE ClimateChain Global Hackathon 2026 · Climate Data &amp; Environmental Monitoring</p>
        <h1 id="hero-title">Climate claims that can show their work.</h1>
        <p className="lede">
          A reported climate figure is usually just a number. ClimateChain turns it into a record you can check: the
          evidence, the figure rebuilt from it, every call a person made, and a signature that breaks if anything changes.
        </p>
        <div className="actions">
          <Link className="button primary" to="/inbox">Review a claim</Link>
          <Link className="button" to="/verify">Verify a signed record</Link>
        </div>
      </section>

      <section className="section where" aria-labelledby="where-title">
        <div className="where-map">
          <h2 id="where-title" className="sr-only">Claims on the map</h2>
          <CaseMap />
          <p className="note map-note">
            Two claims carry a location in their evidence: the building's site and the satellite scene. Select one to review
            it. The other four have no location in their evidence, so they are not placed.
          </p>
        </div>
        <div className="where-list">
          <p className="kicker">Six claims waiting for review</p>
          <ClaimList results={results} compact />
        </div>
      </section>

      <section className="section stages-section" aria-labelledby="stages-title">
        <h2 id="stages-title">How it works</h2>
        <ol className="stages">
          {STAGES.map(([title, text], index) => (
            <li key={title}>
              <span className="step-n">{index + 1}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ol>
        <p className="answer">
          You can do all five here: <Link to="/inbox">review a claim</Link>, sign your decision in this browser, and{" "}
          <Link to="/verify">verify the record</Link> you download.
        </p>
      </section>

      <section id="problem" className="section problem" aria-labelledby="problem-title">
        <h2 id="problem-title">Why a number on its own isn't enough</h2>
        <ol className="problem-list">
          <li>You see the total. You don't see the meter readings, the emission factor, or the readings someone left out.</li>
          <li>You can't tell who decided what about the odd data, or whether anything changed after they did.</li>
          <li>Putting it on a blockchain proves a record wasn't changed. It doesn't prove the number was right.</li>
        </ol>
        <p className="answer">
          ClimateChain keeps the evidence, the judgements and the signature together. <Link to="/how-it-fits">How it fits your work →</Link>
        </p>
      </section>
    </main>
  );
}
