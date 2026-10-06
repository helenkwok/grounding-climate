import { Link, createFileRoute } from "@tanstack/react-router";

import { MapClaims } from "../case-map";
import { ClaimList, STAGES, useAllClaims } from "../components";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "ClimateChain · Climate claims that can show their work" }] }),
  component: Home,
});

function Home() {
  const results = useAllClaims();
  return (
    <>
      <section className="panel-section hero-intro" aria-labelledby="hero-title">
        <p className="kicker">IEEE ClimateChain Global Hackathon 2026 · Climate Data &amp; Environmental Monitoring</p>
        <h1 id="hero-title">Climate claims that can show their work.</h1>
        <p className="lede">
          A reported climate figure is usually just a number. ClimateChain turns it into a record you can check: the
          evidence, the figure rebuilt from it, every call a person made, and a signature that breaks if anything changes.
        </p>
        <p className="note">
          You are the verifier. Pick a claim: it is rebuilt in your browser, you record your verdict and sign it, and anyone
          can <Link to="/verify">verify the record</Link>.
        </p>
      </section>

      <section className="panel-section" aria-labelledby="claims-title">
        <h2 id="claims-title">Six claims waiting for review</h2>
        <ClaimList results={results} compact />
      </section>

      <section className="panel-section">
        <MapClaims />
      </section>

      <section className="panel-section" aria-labelledby="stages-title">
        <h2 id="stages-title">How it works</h2>
        <ol className="stages stacked">
          {STAGES.map(([title, text], index) => (
            <li key={title}>
              <span className="step-n">{index + 1}</span>
              <div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="panel-section" aria-labelledby="problem-title">
        <h2 id="problem-title">Why a number on its own isn't enough</h2>
        <ol className="problem-list">
          <li>You see the total. You don't see the meter readings, the emission factor, or the readings someone left out.</li>
          <li>You can't tell who decided what about the odd data, or whether anything changed after they did.</li>
          <li>Putting it on a blockchain proves a record wasn't changed. It doesn't prove the number was right.</li>
        </ol>
        <p><Link to="/how-it-fits">How it fits your work →</Link></p>
      </section>
    </>
  );
}
