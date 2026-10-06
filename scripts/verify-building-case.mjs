// Rebuilds the building case from the committed inputs (BDG2 subset, advice, decisions) with the current
// code, and checks the committed signed attestation against it with only the published public keys.
// Fails if a code change alters the signed case, or if either signature no longer verifies.
import { readFile } from "node:fs/promises";

import {
  HYBRID_SIGNATURE_POLICY,
  openClimateRiskContext,
  publishedKeyResolver,
  verifySignedAttestation,
} from "@climatechain/core";
import { InMemoryNodeCryptoProvider } from "@climatechain/crypto-node";
import {
  adviceModelRun,
  buildDecidedBuildingCase,
  loadPreparedBuildingDataset,
} from "@climatechain/building-mrv";

const read = (path) => readFile(new URL("../" + path, import.meta.url), "utf8");
const json = async (path) => JSON.parse(await read(path));

const run = await json("reports/building-mrv/case-run.json");
const reference = await json("packages/building-mrv/references/epa-egrid2016-camx.json");
const crypto = new InMemoryNodeCryptoProvider();
const dataset = loadPreparedBuildingDataset({
  meterCsv: await read("data/external/bdg2/meter.csv"),
  weatherCsv: await read("data/external/bdg2/weather.csv"),
  metadataJson: await read("data/external/bdg2/metadata.json"),
  sourceJson: await read("data/external/bdg2/source.json"),
});
const advice = [];
for (const record of await json("reports/building-mrv/triage-advice.json")) {
  advice.push(await adviceModelRun({ ...record, hashProvider: crypto }));
}
const { climateCase } = await buildDecidedBuildingCase({
  caseId: run.case.caseId,
  createdAt: run.runAt,
  dataset,
  meter: dataset.meter,
  factor: { ...reference, valueKgCo2ePerKwh: reference.conversion.valueKgCo2ePerKwh },
  advice,
  decisions: await json("reports/building-mrv/interval-decisions.json"),
  hashProvider: crypto,
  context: [await openClimateRiskContext(await json("data/external/open-climate-risk/ocr-context.json"), "buildingSite", run.runAt, crypto)],
});

const result = await verifySignedAttestation(climateCase, run.attestation, {
  hashProvider: crypto,
  resolveKey: publishedKeyResolver(run.publishedKeys, crypto),
  policy: HYBRID_SIGNATURE_POLICY,
});

if (!result.validForCurrentEvidence) {
  console.error(
    "Building case no longer matches its signed attestation: " +
      JSON.stringify({
        signatureValid: result.signature.valid,
        changedRefs: result.changedRefs,
        missingRefs: result.missingRefs,
        unexpectedRefs: result.unexpectedRefs,
      }),
  );
  process.exit(1);
}
console.log("Building case matches its signed attestation (Ed25519 + ML-DSA-65, " + run.runAt + ").");
