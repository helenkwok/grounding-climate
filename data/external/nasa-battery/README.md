# NASA Ames battery B0005: cycle capacity and impedance

One Li-ion cell (B0005, rated 2 Ah) from the NASA Prognostics Center of Excellence "Battery Data Set"
(`BatteryAgingARC-FY08Q4`), tested at NASA Ames Research Center, Moffett Field, California, from April 2008 at 24 °C:
charged at 1.5 A (CC) to 4.2 V then CV to 20 mA, discharged at 2 A to 2.7 V, with EIS impedance sweeps from 0.1 Hz to
5 kHz, until 30% capacity fade (2 Ah to 1.4 Ah).

`battery-history.json` keeps, for each of the 168 discharge cycles, the measured capacity, and for each of the 278
impedance sweeps, the electrolyte (ohmic) resistance `Re` and charge-transfer resistance `Rct` as NASA fitted them,
with the number of discharge cycles completed before the sweep. The raw `.mat` files are not committed.

Rebuild it from NASA's own download (the script checks the archive's SHA-256,
`82302a7db4fc1b34e0b6676326610438d43b816bdf11a69d1d012a464ef2f92e`):

    curl -L -o battery-data-set.zip "https://phm-datasets.s3.amazonaws.com/NASA/5.+Battery+Data+Set.zip"
    python3 scripts/prepare-nasa-battery.py battery-data-set.zip data/external/nasa-battery/battery-history.json

**Rights:** a work of the US federal government (17 U.S.C. §105, https://www.usa.gov/government-copyright). The NASA
PCoE repository states no licence; it asks publications to acknowledge the repository and the data donors, and says
the data are used at the user's own risk.

**Cite:** B. Saha and K. Goebel (2007), "Battery Data Set", NASA Prognostics Data Repository, NASA Ames Research Center,
Moffett Field, CA. With thanks to the NASA Prognostics Data Repository and the data donors.
