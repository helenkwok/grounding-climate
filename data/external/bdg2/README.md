# BDG2 subset: Bear_assembly_Angel, first 2,160 hours of 2016

Electricity (cleaned), weather and metadata for one building, prepared by
`npm run building:prepare -- --out data/external/bdg2 --hours 2160` from the
Building Data Genome Project 2 v1.0 release (doi:10.5281/zenodo.3887306).
`source.json` records the upstream members and the SHA-256 digest of each file.

**Attribution:** Building Data Genome Project 2 / BUDS Lab. Miller, C. et al. (2020),
"The Building Data Genome Project 2, energy meter data from the ASHRAE Great Energy
Predictor III competition", *Scientific Data* 7, 368.

**Licence:** [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Changes: rows
cut to one building and the first 2,160 hours, columns renamed, no values altered.
These files, and data derived from them, are shared under the same licence.

The demo page and `scripts/run-building-case.mjs` read these files.
