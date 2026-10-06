import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { CLAIMS, type ClaimId } from "../../../demo/src/claims-meta";
import type { DemoModule } from "../../../demo/src/modules";
import { ClaimIndex, Pending, Result, Rows, State } from "../components";
import { loadClaim } from "../live";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "ClimateChain · Climate claims that can show their work" }] }),
  component: Home,
});

type BuildingLive = typeof import("../../../demo/src/building-live");
type Modules = typeof import("../../../demo/src/modules");
interface Story {
  live: Awaited<ReturnType<BuildingLive["checkBuilding"]>>;
  b: BuildingLive;
  m: Modules;
}

function Home() {
  const [story, setStory] = useState<Story | Error>();
  const [results, setResults] = useState<Partial<Record<ClaimId, DemoModule | Error>>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void Promise.all([import("../../../demo/src/building-live"), import("../../../demo/src/modules")])
      .then(async ([b, m]) => setStory({ live: await b.checkBuilding(), b, m }))
      .catch((error: Error) => setStory(error));
    for (const { id } of CLAIMS) {
      loadClaim(id).then(
        (item) => setResults((all) => ({ ...all, [id]: item })),
        (error: Error) => setResults((all) => ({ ...all, [id]: error })),
      );
    }
  }, []);

  /** Changes one reading (or restores it), rebuilds the building case and checks both signatures again. */
  async function tamper(on: boolean) {
    if (!story || story instanceof Error) return;
    setBusy(true);
    story.b.setTampered(on);
    const live = await story.b.checkBuilding();
    setStory({ ...story, live });
    setResults((all) => ({ ...all, building: story.m.buildingModule(live) }));
    setBusy(false);
  }

  const ready = story && !(story instanceof Error) ? story : undefined;
  return (
    <main id="top">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="kicker">IEEE ClimateChain Global Hackathon 2026 · Climate Data &amp; Environmental Monitoring</p>
          <h1 id="hero-title">Climate claims that can show their work.</h1>
          <p className="lede">
            A reported climate figure is usually just a number. ClimateChain shows what it rests on: the source data,
            the analysis rerun in your browser, every call a person made, and a signature that breaks if any of it changes.
          </p>
          <div className="actions">
            <a className="button primary" href="#case">Walk through a real case</a>
            <a className="button" href="#step-tamper">Change one reading</a>
          </div>
        </div>
        <ClaimStub story={ready} pending={story} />
      </section>

      <section id="problem" className="section problem" aria-labelledby="problem-title">
        <h2 id="problem-title">A climate number arrives on its own.</h2>
        <ol className="problem-list">
          <li>You see the total. You don't see the meter readings, the emission factor, or the readings someone left out.</li>
          <li>You can't tell who decided what about the odd data, or whether anything changed after they did.</li>
          <li>Putting it on a blockchain proves a record wasn't changed. It doesn't prove the number was right.</li>
        </ol>
        <p className="answer">ClimateChain keeps the evidence, the judgements and the signature together, and rechecks all three in your browser.</p>
      </section>

      <section id="case" className="section case" aria-labelledby="case-title">
        <p className="kicker">One real case</p>
        <h2 id="case-title">Five steps from meter to signed claim</h2>
        <p className="intro">
          A real office building from the open Building Data Genome 2 dataset. The question a verifier brings:{" "}
          <em>can this building's Scope 2 figure be trusted, and who decided what about each odd reading?</em>
        </p>
        <Steps story={ready} pending={story} busy={busy} tamper={tamper} />
      </section>

      <section id="claims" className="section claims" aria-labelledby="claims-title">
        <p className="kicker">Same steps, different evidence</p>
        <h2 id="claims-title">Six kinds of climate claim</h2>
        <p className="intro">
          Each claim is rebuilt from committed open data, and its signature is checked, in your browser. Open one to see
          its evidence, the person's decision, and what it leaves out.
        </p>
        <ClaimIndex results={results} />
      </section>

      <section id="limits" className="section limits" aria-labelledby="limits-title">
        <div>
          <h2 id="limits-title">What this does not prove</h2>
          <ul className="limit-list">
            <li><strong>Who signed.</strong> The signing keys are demo keys made per run. A signature shows nothing changed since signing; it does not yet identify a real organisation.</li>
            <li><strong>Why data was odd.</strong> A person's decision is a recorded judgement, not a confirmed cause. Site records don't confirm why the building's meter read zero.</li>
            <li><strong>Company figures.</strong> A disclosed figure can't be recalculated from public data. It is accepted only as the company's own statement.</li>
            <li><strong>Registry gaps.</strong> The ACR records are a 100-row sample. Ten groups of retirements have no matching issuance in it and are marked for investigation.</li>
            <li><strong>Satellite area.</strong> The burn-scar detector reproduces the reference pixel by pixel, but its burned area is 36% below the reference map's, and that gap is recorded, not explained.</li>
          </ul>
        </div>
        <div>
          <h2>Who would use it</h2>
          <ul className="limit-list">
            <li><strong>Verifiers and auditors</strong> checking a figure before they sign it off.</li>
            <li><strong>Facility, energy and battery managers</strong> recording what they decided about bad data, and on which data.</li>
            <li><strong>Registries and reporting teams</strong> publishing figures that carry their own evidence.</li>
          </ul>
          <p className="note">It runs in an ordinary browser, on open data formats, with no account and no token.</p>
        </div>
      </section>
    </main>
  );
}

function signatureState(story: Story, algorithm: string) {
  const { attestation } = story.live;
  const found = attestation.signature.signatures.find((item) => item.signature.algorithm === algorithm);
  return found?.signatureValid && attestation.validForCurrentEvidence
    ? <State tone="good">matches</State>
    : <State tone="bad">no longer matches</State>;
}

function ClaimStub({ story, pending }: { story?: Story; pending: unknown }) {
  const flags = story?.live.decided.statuses ?? [];
  const decided = flags.filter((flag) => flag.state === "decided").length;
  const stale = flags.filter((flag) => flag.state === "stale").length;
  return (
    <aside className="stub" aria-label="The claim this page checks">
      <p className="stub-label">Claim under review</p>
      <p className="stub-subject">Scope 2 electricity emissions, one office building, January to March 2016</p>
      <p className="stub-value">
        {story ? story.live.decided.analysis.emissions.emissionsTCo2e.toFixed(2) : "…"} <span className="unit">tCO₂e</span>
      </p>
      {story ? (
        <ul className="stub-rows">
          <li><span>Rebuilt from the meter data</span><Result result={story.live.decided.climateCase.verifications[0]!.result} /></li>
          <li>
            <span>Flagged readings decided by a person</span>
            {stale
              ? <State tone="bad">{stale} of {flags.length} stale</State>
              : <State tone={decided === flags.length ? "good" : "warn"}>{decided} of {flags.length}</State>}
          </li>
          <li><span>Ed25519 signature</span>{signatureState(story, "Ed25519")}</li>
          <li><span>ML-DSA-65 signature (post-quantum)</span>{signatureState(story, "ML-DSA-65")}</li>
        </ul>
      ) : (
        <p><Pending value={pending} /></p>
      )}
      <p className="stub-foot">Checked in your browser, not on a server.</p>
    </aside>
  );
}

function Steps({ story, pending, busy, tamper }: { story?: Story; pending: unknown; busy: boolean; tamper: (on: boolean) => void }) {
  const live = story?.live;
  const flags = live?.decided.statuses ?? [];
  const decided = flags.filter((flag) => flag.state === "decided").length;
  const stale = flags.filter((flag) => flag.state === "stale").length;
  const undecided = flags.filter((flag) => flag.state === "undecided").length;
  const emissions = live?.decided.analysis.emissions;
  const wait = <Pending value={pending} />;
  const valid = live?.attestation.validForCurrentEvidence ?? true;
  const point = story && live?.tampered ? story.b.service.analysis().anomalies.points[story.b.caseRun.tamper.index] : undefined;
  const choices = [...new Set(flags.filter((flag) => flag.decision).map((flag) => flag.decision!.decision + " by " + flag.decision!.decidedBy))];

  return (
    <>
      <ol className="steps">
        <li className="step">
          <div className="step-text">
            <h3><span className="step-n">1</span>Measure</h3>
            <p>2,160 hourly electricity readings from the building's meter, and the grid's emission factor from EPA eGRID 2016 (California, CAMX).</p>
          </div>
          <div className="step-figure">
            {emissions ? (
              <>
                <span className="figure-big">{emissions.acceptedEnergyMWh.toFixed(2)} MWh</span>
                <span className="figure-cap">accepted electricity, from {live.decided.analysis.anomalies.points.length.toLocaleString("en-US")} readings rebuilt in your browser</span>
              </>
            ) : wait}
          </div>
        </li>
        <li className="step">
          <div className="step-text">
            <h3><span className="step-n">2</span>Flag</h3>
            <p>A screen flags readings that look wrong: exact zeros, long runs of identical values, extreme jumps. A decision model advises on each one. Its advice is a suggestion; it never sets an outcome.</p>
          </div>
          <div className="step-figure">
            {story ? (
              <ul className="flag-list">
                {flags.map((flag) => {
                  const run = story.b.adviceRuns.find((item) => item.inferenceParameters.interval === flag.timestamp);
                  const advice = run && run.output.kind === "qualitative"
                    ? "Model advice: " + run.output.statement.replace("advice: ", "").replaceAll("_", " ") + " (" + run.confidence?.toFixed(2) + "), " + (run.extensions?.handOff ?? "needs a person")
                    : "No advice recorded";
                  return <li key={flag.timestamp}><time>{flag.timestamp.slice(0, 16)}</time><span>{advice}</span></li>;
                })}
              </ul>
            ) : wait}
          </div>
        </li>
        <li className="step">
          <div className="step-text">
            <h3><span className="step-n">3</span>A person decides</h3>
            <p>The facility energy manager decides each flagged reading. Every decision is tied to a fingerprint of the whole meter series, so if one reading changes, the decisions go stale.</p>
          </div>
          <div className="step-figure">
            {live ? (
              <>
                <span className="figure-big">{decided} of {flags.length} decided</span>
                <span className="figure-cap">
                  {stale ? stale + " decisions are stale: they were made on different meter data." : choices.join("; ") + ". Nothing flagged counts until a person keeps it."}
                </span>
              </>
            ) : wait}
          </div>
        </li>
        <li className="step">
          <div className="step-text">
            <h3><span className="step-n">4</span>Sign</h3>
            <p>The result is signed twice: with Ed25519, used widely today, and with ML-DSA-65, a post-quantum signature standard. Both are checked here, in your browser.</p>
          </div>
          <div className="step-figure">
            {story && emissions ? (
              <>
                <span className="figure-big">{emissions.emissionsTCo2e.toFixed(2)} tCO₂e</span>
                <ul className="flag-list">
                  <li><span>Ed25519</span>{signatureState(story, "Ed25519")}</li>
                  <li><span>ML-DSA-65</span>{signatureState(story, "ML-DSA-65")}</li>
                </ul>
                <span className="figure-cap">Signed {story.b.caseRun.runAt.slice(0, 10)}; checked just now in your browser.</span>
              </>
            ) : wait}
          </div>
        </li>
        <li className="step step-tamper" id="step-tamper">
          <div className="step-text">
            <h3><span className="step-n">5</span>Try to change it</h3>
            <p>Multiply one reading by 20. The page recomputes everything downstream and checks both signatures again.</p>
            <div className="actions">
              <button className="button danger" type="button" disabled={!story || busy} onClick={() => tamper(true)}>Change one reading</button>
              <button className="button" type="button" disabled={!story || busy} onClick={() => tamper(false)}>Reset</button>
            </div>
          </div>
          <div className={"step-figure tamper-output " + (live ? (valid ? "is-good" : "is-bad") : "")} aria-live="polite">
            {story && live ? (
              <>
                <p className={"verdict " + (valid ? "good" : "bad")}>
                  {valid ? "Both signatures match the evidence." : "The signatures no longer match the evidence."}
                </p>
                <Rows
                  className="boundary tamper-rows"
                  rows={[
                    ...(point ? [["Changed", "×" + story.b.caseRun.tamper.multiplier + " at " + story.b.caseRun.tamper.timestamp + ": now " + point.value + " kWh"] as [string, string]] : []),
                    ["Meter series fingerprint", live.decided.digest.value],
                    ["Flags", flags.length + " flagged, " + stale + " decisions stale, " + undecided + " undecided"],
                    ["Changed since signing", valid ? "nothing" : live.attestation.changedRefs.map((ref) => ref.id).join("\n")],
                    ["Next", live.tampered ? "Reset restores the committed reading, and the signatures match again." : "Press “Change one reading”."],
                  ]}
                />
              </>
            ) : wait}
          </div>
        </li>
      </ol>
      <details className="more">
        <summary>What this figure counts, and what it leaves out</summary>
        {story ? <Rows rows={story.m.boundaryRows(story.live.decided.climateCase.claims[0]!)} /> : wait}
      </details>
    </>
  );
}
