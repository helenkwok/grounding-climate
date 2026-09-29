import json
import sys
import pyarrow.parquet as pq

path = sys.argv[1]
table = pq.read_table(path)
data = table.to_pydict()

item_ids = []
if "item_id" in data:
    item_ids = sorted({str(v) for v in data["item_id"] if v is not None})

summary = {
    "rows": table.num_rows,
    "columns": table.column_names,
    "schema": str(table.schema),
    "itemCount": len(item_ids),
    "itemIds": item_ids[:20],
}

for name in ["datetime", "target", "item_id"]:
    if name in data:
        values = data[name]
        summary[name + "Sample"] = [str(v) for v in values[:5]]

print("CLIMATECHAIN_ENERGY_EVA_PARQUET=" + json.dumps(summary))
