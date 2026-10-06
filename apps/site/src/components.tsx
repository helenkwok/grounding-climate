import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import { CLAIMS, deriveResult, type ClaimId } from "../../demo/src/claims-meta";
import type { DemoModule } from "../../demo/src/modules";
import { loadClaim } from "./live";

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

/** The claims as sentences, each with who makes it and its live result once this browser has checked it. */
export function ClaimList({ results, compact = false }: { results: Partial<Record<string, DemoModule | Error>>; compact?: boolean }) {
  return (
    <ul className={"claim-list" + (compact ? " compact" : "")}>
      {CLAIMS.map((claim) => {
        const item = results[claim.id];
        const ready = item && !(item instanceof Error) ? item : undefined;
        return (
          <li key={claim.id}>
            <Link className="claim-card" to="/claims/$id" params={{ id: claim.id }}>
              <span className="claim-meta">
                <span className="claim-type">{claim.title}</span>
                {ready ? <Result result={deriveResult(ready.checks)} /> : <Pending value={item} />}
              </span>
              <span className="claim-sentence">{claim.claim}</span>
              {!compact && <span className="claim-who">Claimed by: {claim.claimant}. Checked here: {claim.what.toLowerCase()}.</span>}
              <span className="claim-open">Review this claim →</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Loads all six claims in the browser; each result arrives as its check finishes. */
export function useAllClaims() {
  const [results, setResults] = useState<Partial<Record<ClaimId, DemoModule | Error>>>({});
  useEffect(() => {
    for (const { id } of CLAIMS) {
      loadClaim(id).then(
        (item) => setResults((all) => ({ ...all, [id]: item })),
        (error: Error) => setResults((all) => ({ ...all, [id]: error })),
      );
    }
  }, []);
  return results;
}

/** The five stages of a claim, used on the home page and the "how it fits" page. */
export const STAGES: Array<[string, string]> = [
  ["A claim comes in", "with its evidence: meter data, a registry export, a satellite scene, a company's own page."],
  ["It is rechecked", "ClimateChain rebuilds the figure from that evidence, in your browser, and flags data that looks wrong."],
  ["A person decides", "each flag, and the claim itself, gets a named decision tied to the exact data it was made on."],
  ["It is signed", "the evidence, the decisions and the result become one record, signed with Ed25519 and post-quantum ML-DSA-65."],
  ["Anyone verifies", "open the record on any computer. Change one number in it and the signatures no longer match."],
];

export function SiteHeader() {
  return (
    <header className="topbar">
      <Link className="brand" to="/">ClimateChain</Link>
      <nav aria-label="Sections">
        <Link to="/inbox">Inbox</Link>
        <Link to="/verify">Verify a record</Link>
        <Link to="/how-it-fits">How it fits your work</Link>
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
