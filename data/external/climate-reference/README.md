# Climate reference data (context only)

Two small tables that give Grounding's claims their real-world scale. No check reads them.

`ember-grid-intensity.json` (209 countries) is the electricity emissions intensity per country from Ember's Yearly
Electricity Data: rows with "Area type" = "Country or economy" and "Electricity source" = "Total generation", and for
each country the latest year with a value of "Emissions intensity (gCO2e/kWh)" (2025 for most countries; the year is
recorded per row). Ember's intensity is **lifecycle**: it includes upstream methane, supply chain and manufacturing,
covers all gases as CO2e over 100 years, and is per kWh generated in the country (Ember methodology PDF). It is not
comparable one-for-one with eGRID's plant-output rates, which count only emissions at the power plant.

`gcb-fossil-co2.json` (216 countries) is the territorial fossil CO2 total ("Total": coal, oil, gas, cement, flaring,
other) per country for the latest year (2024), from the Global Carbon Budget 2025 national file
`GCB2025v15_MtCO2_flat.csv`. The file is already in MtCO2, so no carbon-to-CO2 conversion is applied. The world total
(`WLD`) and international aviation and shipping bunkers (`XIA`, `XIS`), which belong to no country, are kept separately.

`manifest.json` records each source URL, retrieval date, the SHA-256 of the raw download (and Zenodo's MD5 for the GCB
file), and the SHA-256 of each committed file. To reproduce (the raw files are pinned; a different download fails):

    node scripts/prepare-climate-reference.mjs   # downloads to the gitignored data/cache/climate-reference and writes this folder
    node scripts/verify-climate-reference.mjs    # offline: checks the digests and prints the figures for the write-up

**Cite:**

- Ember (2026), Yearly Electricity Data, CC BY 4.0. https://ember-energy.org/data/yearly-electricity-data/
- Global Carbon Budget 2025 (Friedlingstein et al.), fossil CO2 emissions dataset, CC BY 4.0,
  doi:10.5281/zenodo.17417124.

Rows filtered and the latest year per country selected by Grounding; values unchanged. Grounding is not affiliated with
or endorsed by Ember or the Global Carbon Project.
