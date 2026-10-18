# American Carbon Registry records (full OffsetsDB export)

`credits.csv` (13,481 rows) is every American Carbon Registry (ACR) credit row in CarbonPlan's OffsetsDB export
generated 2026-06-01T20:33:13Z (`offsets-db.csv.zip`, SHA-256
`c037be30f54fac47b625b8fdebc02ca459e49d627d3214a90eb90ce0a45bb61e`). Grounding keeps only the columns the scoreboard
reads: project, vintage, transaction type (issuance, retirement or cancellation), quantity and date. Values are
unchanged. Beneficiary, account and note fields are left out: no check uses them, and some name individuals.

`projects.csv` (979 rows) is every ACR project in the same export's project table, reduced to its ID and its stated
issued and retired totals.

`manifest.json` records the source URL, snapshot time, zip SHA-256, row counts and each committed file's SHA-256. To
reproduce (the zip is pinned; a different download fails):

    node scripts/prepare-offsetsdb-snapshot.mjs   # downloads to the gitignored data/cache/offsetsdb and writes this folder
    node scripts/run-carbon-scoreboard.mjs        # writes reports/carbon-registry/scoreboard.json

OffsetsDB updates are paused upstream. This is OffsetsDB's processed copy of ACR's public reports, not ACR's own
export.

**Terms:** ACR's Website Terms of Use allow information and data from ACR public reports to be used for adaptation,
reproduction or derivative works, provided it is accurately represented and cited, and not used or presented in an
unfair, misleading or discriminatory manner (https://acrcarbon.org/term-and-condition/). CarbonPlan's terms of data
access: https://github.com/carbonplan/offsets-db-data/blob/main/TERMS_OF_DATA_ACCESS.

**Cite:** Registry data via CarbonPlan OffsetsDB, snapshot 2026-06-01: American Carbon Registry public reports,
https://github.com/carbonplan/offsets-db-data. Grounding is not affiliated with or endorsed by ACR or CarbonPlan.
