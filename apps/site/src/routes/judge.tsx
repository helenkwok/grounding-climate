import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { CLAIMS, deriveResult, type ClaimId } from "../../../demo/src/claims-meta";
import type { DemoModule } from "../../../demo/src/modules";
import { Pending, Result, STATUS_NOTE } from "../components";
import { setTampered } from "../live";
import scoreboard from "../../../../reports/carbon-registry/scoreboard.json";
import toucan from "../../../../reports/carbon-registry/toucan-onchain.json";
import sepolia from "../../../../reports/evm-sepolia.json";
import buildingAnchor from "../../../../reports/building-mrv/anchor.json";
import energyAnchor from "../../../../reports/energy-forecast/anchor.json";
import earthAnchor from "../../../../reports/earth-observation/anchor.json";
import batteryAnchor from "../../../../reports/battery-dpp/anchor.json";
import carbonAnchor from "../../../../reports/carbon-registry/anchor.json";
import disclosureAnchor from "../../../../reports/disclosure/anchor.json";

export const Route = createFileRoute("/judge")({
  head: () => ({ meta: [{ title: "The 30-second check · Grounding" }] }),
  component: Judge,
});

// Each claim's committed record: its folder under reports/ and its Bitcoin timestamp.
const RECORDS: Record<ClaimId, { folder: keyof typeof sepolia.anchors; bitcoin: { height?: number; blockHash?: string; blockTime?: string } }> = {
  building: { folder: "building-mrv", bitcoin: buildingAnchor },
  energy: { folder: "energy-forecast", bitcoin: energyAnchor },
  earth: { folder: "earth-observation", bitcoin: earthAnchor },
  battery: { folder: "battery-dpp", bitcoin: batteryAnchor },
  carbon: { folder: "carbon-registry", bitcoin: carbonAnchor },
  disclosure: { folder: "disclosure", bitcoin: disclosureAnchor },
};

const PROVENANCE: Array<[string, string]> = [
  ["Recomputed here", "Rebuilt in this browser from the committed evidence, with the same code as the offline runs."],
  ["Model suggested", "Advice on a flagged reading. It never sets a status."],
  ["A person decided", "A role-labelled decision, bound to a fingerprint of the exact data it was made on."],
  ["Committed proof", "A Bitcoin timestamp and a Sepolia anchor of the record's digest. Proof it existed then, not that it is true."],
  ["Not checkable here", "Each claim names what its evidence cannot settle; three of six read Needs evidence."],
];

const LIMITS = [
  "Rechecking is not assurance: no ISSA 5000 opinion, closest to the agreed-upon procedures of ISO 14064-3 Annex C.",
  "Signing keys are made per record, so a signature shows the record is unchanged, not who signed it.",
  "An anchor proves a record existed by a block's time, not that the claim is right. Sepolia is a test network.",
  "The building's zero readings are decided, not explained: site records would be needed.",
  "Four of seven registries are checked but their counts stay unpublished while their terms on derived data are unclear.",
];

const STEPS: Array<[string, string]> = [
  ["git clone https://github.com/helenkwok/grounding-climate && cd grounding-climate", "the code and every committed record"],
  ["npm ci && npm run build", "installs the locked dependencies and builds the packages"],
  ["npm run check:cases", "rebuilds all six claims and checks every signature, Bitcoin proof and IPFS address, offline"],
  ["npm run evm:verify", "optional: reads the Sepolia anchors through a public node; still no key or wallet"],
];

const short = (hex: string) => hex.slice(0, 10) + "…" + hex.slice(-6);

function Judge() {
  const [items, setItems] = useState<Partial<Record<ClaimId, DemoModule | Error>>>({});
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    for (const { id } of CLAIMS) {
      // A claim left changed on a claim page is restored first, so the receipt starts from the committed data.
      setTampered(id, false).then(
        (item) => setItems((all) => ({ ...all, [id]: item })),
        (error: Error) => setItems((all) => ({ ...all, [id]: error })),
      );
    }
  }, []);

  const ready = CLAIMS.map(({ id }) => items[id]).filter((item): item is DemoModule => Boolean(item && !(item instanceof Error)));
  const done = ready.length === CLAIMS.length;
  useEffect(() => {
    (window as { __ready?: boolean }).__ready = done && !busy;
  }, [done, busy]);

  const results = ready.map((item) => deriveResult(item.checks));
  const seals = ready.flatMap((item) => item.seals);

  async function changeAll(on: boolean) {
    setBusy(true);
    const next = await Promise.all(CLAIMS.map(({ id }) => setTampered(id, on).catch((error: Error) => error)));
    setItems(Object.fromEntries(CLAIMS.map(({ id }, i) => [id, next[i]])));
    setChanged(on);
    setBusy(false);
  }

  const registries = scoreboard.registries.length;
  return (
    <div className="judge">
      <header className="judge-head">
        <p className="kicker">For judges · about 30 seconds · no account, no wallet, no install</p>
        <h1>Six climate claims, rebuilt and checked in your browser while you read this.</h1>
        <dl className="judge-numbers" aria-live="polite">
          <div><dt>Claims rebuilt here</dt><dd>{ready.length} of 6</dd></div>
          <div><dt>Rechecked</dt><dd>{done ? results.filter((r) => r === "reconciled").length : "…"}</dd></div>
          <div><dt>Needs evidence or mismatch</dt><dd>{done ? results.filter((r) => r !== "reconciled").length : "…"}</dd></div>
          <div><dt>Signatures matching the evidence</dt><dd className={done && seals.some((s) => !s.valid) ? "bad" : undefined}>{done ? seals.filter((s) => s.valid).length + " of " + seals.length : "…"}</dd></div>
          <div><dt>Registry records checked</dt><dd>{scoreboard.creditRows.toLocaleString("en-US")}<small> in {registries} registries</small></dd></div>
          <div><dt>Toucan serial ranges bridged twice</dt><dd>{toucan.checks.serialRangeBridgedTwice.pairs}<small> of {toucan.verraBatchesConfirmed} batches, {(toucan.tonnesBridgedConfirmed / 1e6).toFixed(1)} Mt</small></dd></div>
        </dl>
      </header>

      <section className="judge-try">
        <div>
          <h2>Try to break it</h2>
          <p className="note">Change one input in every claim at once: a meter reading, a battery cycle, a forecast value, a pixel, a registry row, an extracted figure. Each claim is rebuilt, and its signed record is checked again.</p>
        </div>
        <div className="actions">
          <button type="button" className="button danger" disabled={!done || busy || changed} onClick={() => changeAll(true)}>Change one input in all six</button>
          <button type="button" className="button" disabled={!done || busy || !changed} onClick={() => changeAll(false)}>Restore</button>
        </div>
      </section>

      <section aria-labelledby="receipt-h">
        <h2 id="receipt-h">The receipt</h2>
        <div className="table-scroll">
          <table className="receipt">
            <thead>
              <tr>
                <th scope="col">Claim</th>
                <th scope="col">Figure <small>recomputed here</small></th>
                <th scope="col">Result <small>recomputed here</small></th>
                <th scope="col">Signatures <small>checked here</small></th>
                <th scope="col">Bitcoin <small>committed proof</small></th>
                <th scope="col">Sepolia <small>committed proof</small></th>
              </tr>
            </thead>
            <tbody>
              {CLAIMS.map((claim) => {
                const item = items[claim.id];
                const ok = item && !(item instanceof Error) ? item : undefined;
                const record = RECORDS[claim.id];
                const tx = sepolia.anchors[record.folder]?.txHash;
                return (
                  <tr key={claim.id} className={ok && ok.seals.some((s) => !s.valid) ? "broken" : undefined}>
                    <th scope="row"><Link to="/claims/$id" params={{ id: claim.id }}>{claim.title}</Link></th>
                    <td>{ok ? <><strong>{ok.kpi}</strong> <small>{ok.kpiLabel}</small></> : <Pending value={item} />}</td>
                    <td>{ok ? <Result result={deriveResult(ok.checks)} /> : null}</td>
                    <td>{ok ? ok.seals.map((s) => <span key={s.algorithm} className={"sig " + (s.valid ? "ok" : "bad")}>{s.algorithm} {s.valid ? "✓" : "✗"}</span>) : null}</td>
                    <td>
                      {record.bitcoin.height ? (
                        <a href={"https://mempool.space/block/" + record.bitcoin.blockHash} target="_blank" rel="noreferrer">block {record.bitcoin.height.toLocaleString("en-US")}</a>
                      ) : "pending"}
                    </td>
                    <td>{tx ? <a href={"https://sepolia.etherscan.io/tx/" + tx} target="_blank" rel="noreferrer">{short(tx)}</a> : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="note status-note">
          {STATUS_NOTE} {changed && "The anchors still point at the committed records: the changed evidence no longer matches them."}
        </p>
      </section>

      <div className="judge-cols">
        <section aria-labelledby="prov-h">
          <h2 id="prov-h">How each part is known</h2>
          <dl className="prov">{PROVENANCE.map(([k, d]) => <div key={k}><dt>{k}</dt><dd>{d}</dd></div>)}</dl>
        </section>
        <section aria-labelledby="run-h">
          <h2 id="run-h">Reproduce it yourself</h2>
          <p className="note">No account, no API key, no wallet. Node 24 or later.</p>
          <ol className="judge-run">
            {STEPS.map(([command, what]) => <li key={command}><code>{command}</code><span>{what}</span></li>)}
          </ol>
          <p className="note">Or drop any downloaded record on <Link to="/verify">the Verify page</Link>: it runs in this browser, with no server.</p>
        </section>
      </div>

      <section aria-labelledby="limits-h" className="judge-limits">
        <h2 id="limits-h">What this does not prove</h2>
        <ul>{LIMITS.map((limit) => <li key={limit}>{limit}</li>)}</ul>
      </section>
    </div>
  );
}
