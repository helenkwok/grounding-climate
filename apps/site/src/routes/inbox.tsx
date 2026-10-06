import { createFileRoute } from "@tanstack/react-router";

import { CLAIMS, deriveResult } from "../../../demo/src/claims-meta";
import { ClaimList, useAllClaims } from "../components";
import { signedRecords } from "../live";

export const Route = createFileRoute("/inbox")({
  head: () => ({ meta: [{ title: "Inbox · ClimateChain" }] }),
  component: Inbox,
});

function Inbox() {
  const results = useAllClaims();
  const done = Object.values(results).filter((item) => item && !(item instanceof Error));
  const verified = done.filter((item) => deriveResult(item!.checks) === "reconciled").length;
  return (
    <main id="top">
      <header className="page-head">
        <p className="kicker">You are the verifier</p>
        <h1>Inbox</h1>
        <p className="data">
          Six claims, each with its evidence. Open one: ClimateChain rebuilds it in your browser, shows what has already
          been decided and by whom, and asks for your verdict. You sign that verdict here and download the record.
        </p>
        <p className="page-result">
          {done.length < CLAIMS.length
            ? "Rechecking " + (CLAIMS.length - done.length) + " of " + CLAIMS.length + " claims in your browser…"
            : verified + " of " + CLAIMS.length + " pass every check. " + (CLAIMS.length - verified) + " need more evidence or a closer look."}
          {signedRecords.length > 0 && " You have signed " + signedRecords.length + " this visit."}
        </p>
      </header>
      <section className="section">
        <ClaimList results={results} />
      </section>
    </main>
  );
}
