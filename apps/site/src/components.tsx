import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { CLAIMS, deriveResult } from "../../demo/src/claims-meta";
import type { DemoModule } from "../../demo/src/modules";

export type Tone = "good" | "bad" | "warn";

const RESULT_WORDS: Record<string, string> = {
  reconciled: "Verified",
  "insufficient-evidence": "Needs evidence",
  mismatch: "Mismatch",
  "source-changed": "Source changed",
};

/** A status as a word with a colour; the word carries the meaning, the colour only reinforces it. */
export function State({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <strong className={"state " + tone}>{children}</strong>;
}

export function Result({ result }: { result: string }) {
  const tone: Tone = result === "reconciled" ? "good" : result === "insufficient-evidence" ? "warn" : "bad";
  return <State tone={tone}>{RESULT_WORDS[result] ?? result}</State>;
}

export const outcomeTone = (outcome: string): Tone => (outcome === "pass" ? "good" : outcome === "fail" ? "bad" : "warn");

/** While a live check runs, or if it failed. */
export function Pending({ value }: { value: unknown }) {
  if (value instanceof Error) return <span className="error">Could not run the check: {value.message}</span>;
  return <span className="note">Checking in your browser…</span>;
}

/** A definition list; a value holding several lines becomes a bulleted list. */
export function Rows({ rows, className = "boundary" }: { rows: Array<[string, string]>; className?: string }) {
  return (
    <dl className={className}>
      {rows.map(([name, value]) => {
        const lines = value.split("\n").filter(Boolean);
        return (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{lines.length > 1 ? <ul>{lines.map((line) => <li key={line}>{line}</li>)}</ul> : value}</dd>
          </div>
        );
      })}
    </dl>
  );
}

/** The six claims as links, each with its live result once the browser has checked it. */
export function ClaimIndex({ results }: { results: Partial<Record<string, DemoModule | Error>> }) {
  return (
    <>
      <div className="claim-head" aria-hidden="true">
        <span>Claim</span><span>What is checked</span><span>Result</span>
      </div>
      {CLAIMS.map((claim) => {
        const item = results[claim.id];
        return (
          <Link key={claim.id} className="claim-row" to="/claims/$id" params={{ id: claim.id }}>
            <span className="claim-title">{claim.title}</span>
            <span className="claim-what">
              {claim.what}
              {item && !(item instanceof Error) && <span className="claim-figure">{item.kpi + " " + item.kpiLabel}</span>}
            </span>
            <span>
              {item && !(item instanceof Error) ? <Result result={deriveResult(item.checks)} /> : <Pending value={item} />}
            </span>
          </Link>
        );
      })}
    </>
  );
}

export function SiteHeader() {
  return (
    <header className="topbar">
      <Link className="brand" to="/">ClimateChain</Link>
      <nav aria-label="Sections">
        <Link to="/" hash="case">How it works</Link>
        <Link to="/" hash="claims">Six claims</Link>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer>
      <p>ClimateChain: evidence, then judgement, then signature.</p>
      <p>Third-party data is bundled only where its licence allows, with attribution.</p>
    </footer>
  );
}
