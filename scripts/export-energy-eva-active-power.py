import json
import sys
import pyarrow.parquet as pq

src = sys.argv[1]
dst = sys.argv[2]

table = pq.read_table(src)
data = table.to_pydict()

series = []
for item_id, datetimes, targets in zip(
    data["item_id"],
    data["datetime"],
    data["target"],
):
    points = [
        {
            "timestamp": dt.isoformat() + ("Z" if dt.tzinfo is None else ""),
            "value": float(value),
        }
        for dt, value in zip(datetimes, targets)
    ]
    series.append({
        "itemId": str(item_id),
        "unit": "MW",
        "stepMinutes": 60,
        "points": points,
        "source": {
            "dataset": "active_power_load",
            "sourceUri": "https://zenodo.org/records/17099628",
            "sourceManifestId": "energy-eva-active-power-load",
        },
    })

with open(dst, "w", encoding="utf-8") as handle:
    json.dump({"series": series}, handle)

print(
    "CLIMATECHAIN_ENERGY_EVA_EXPORT=" +
    json.dumps({
        "items": len(series),
        "lengths": [len(item["points"]) for item in series],
        "out": dst,
    })
)
