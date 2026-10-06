# American Carbon Registry records (bounded test subset)

`issuances.csv` (100 rows) and `retirements.csv` (100 rows) are American Carbon Registry (ACR) public report records
as collected by CarbonPlan's OffsetsDB pipeline in its test fixtures, at pinned commit
`c34ec955df0988009ac14e8abd91013f3b03e4f5` (`tests/data/american-carbon-registry`). ClimateChain keeps only the
columns its reconciliation reads: project, vintage, quantity, date and, for retirements, the serial range. Values are
unchanged. Beneficiary and account-holder names are left out: no check uses them, and some name individuals.

`projects.csv` (14 rows) is the same fixture set's project list (`projects.csv`, same commit), reduced to the projects
in the sample that it names and to ID, name, type, state and country. Only the map reads it, to place those projects
by state; the other projects in the sample have no location in these records.

`manifest.json` records each upstream file's Git blob SHA and each committed file's SHA-256. To reproduce:

    node scripts/prepare-carbonplan-registry-fixtures.mjs <dir>   # downloads and checks the Git blob SHAs
    node scripts/prepare-acr-subset.mjs <dir>

This is a bounded sample, not ACR's full registry: an issuance missing from it may exist upstream.

**Terms:** ACR's Website Terms of Use allow information and data from ACR public reports to be used for adaptation,
reproduction or derivative works, provided it is accurately represented and cited, and not used or presented in an
unfair, misleading or discriminatory manner (https://acrcarbon.org/term-and-condition/).

**Cite:** American Carbon Registry public reports, via CarbonPlan OffsetsDB, https://github.com/carbonplan/offsets-db-data.
ClimateChain is not affiliated with or endorsed by ACR or CarbonPlan.
