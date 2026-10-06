import json
import math
import sys
from statistics import mean

import pyarrow.parquet as pq

path = sys.argv[1]
table = pq.read_table(path)
data = table.to_pydict()

item_ids = [str(v) for v in data.get("item_id", [])]
datetimes = data.get("datetime", [])
targets = data.get("target", [])

published = {
    -240: {
        "loadAcc": 0.6541815764756919,
        "mae": 986.5416870117188,
        "mape": 0.1751946955919265,
        "rmse": 1248.2540283203125,
    },
    -192: {
        "loadAcc": 0.6024020617190764,
        "mae": 968.2142944335938,
        "mape": 0.1883271634578704,
        "rmse": 1294.0782470703125,
    },
    -144: {
        "loadAcc": 0.6838674485620156,
        "mae": 983.9984130859376,
        "mape": 0.2025707364082336,
        "rmse": 1233.4937744140625,
    },
    -96: {
        "loadAcc": 0.6196193054631517,
        "mae": 911.0060424804688,
        "mape": 0.186459794640541,
        "rmse": 1172.994384765625,
    },
    -48: {
        "loadAcc": 0.6750032319520225,
        "mae": 1105.62353515625,
        "mape": 0.1777740269899368,
        "rmse": 1396.9505615234375,
    },
}


def metrics(actual, pred):
    errors = [p - a for a, p in zip(actual, pred)]
    mae = mean(abs(e) for e in errors)
    rmse = math.sqrt(mean(e * e for e in errors))
    mape_values = [
        abs((p - a) / a)
        for a, p in zip(actual, pred)
        if a != 0
    ]
    return {
        "mae": mae,
        "rmse": rmse,
        "mape": mean(mape_values) if mape_values else None,
    }


def load_acc_for_instance(times, actual, pred):
    by_day = {}
    for dt, a, p in zip(times, actual, pred):
        day = dt.date().isoformat()
        by_day.setdefault(day, []).append((a, p))

    scores = []
    for values in by_day.values():
        gt = [v[0] for v in values]
        capacity = max(gt) - min(gt)
        if capacity == 0:
            continue
        rmse = math.sqrt(
            mean((p - a) ** 2 for a, p in values)
        )
        scores.append(1 - min(rmse / capacity, 1))
    return mean(scores) if scores else None


def evaluate_cutoff(cutoff, horizon=48):
    per_instance = []
    all_actual = []
    all_pred = []

    for item_id, times, values in zip(item_ids, datetimes, targets):
        n = len(values)
        start = n + cutoff if cutoff < 0 else cutoff
        end = start + horizon
        history_start = start - horizon
        if history_start < 0 or end > n:
            raise RuntimeError(
                f"insufficient data for item {item_id} cutoff {cutoff}"
            )

        actual = [float(v) for v in values[start:end]]
        pred = [float(v) for v in values[history_start:start]]
        actual_times = times[start:end]
        m = metrics(actual, pred)
        per_instance.append({
            "itemId": item_id,
            **m,
            "loadAcc": load_acc_for_instance(actual_times, actual, pred),
        })
        all_actual.extend(actual)
        all_pred.extend(pred)

    global_metrics = metrics(all_actual, all_pred)
    mean_instance = {
        key: mean(
            row[key] for row in per_instance
            if row[key] is not None
        )
        for key in ["mae", "rmse", "mape", "loadAcc"]
    }

    return {
        "cutoff": cutoff,
        "global": global_metrics,
        "meanInstance": mean_instance,
        "published": published[cutoff],
        "deltaGlobal": {
            key: (
                global_metrics[key] - published[cutoff][key]
                if key in global_metrics and global_metrics[key] is not None
                else None
            )
            for key in ["mae", "rmse", "mape"]
        },
        "deltaMeanInstance": {
            key: mean_instance[key] - published[cutoff][key]
            for key in ["mae", "rmse", "mape", "loadAcc"]
        },
    }


summary = {
    "rows": table.num_rows,
    "columns": table.column_names,
    "itemCount": len(item_ids),
    "itemIds": item_ids,
    "seriesLengths": [len(v) for v in targets],
    "firstSeries": {
        "itemId": item_ids[0] if item_ids else None,
        "start": str(datetimes[0][0]) if datetimes and datetimes[0] else None,
        "end": str(datetimes[0][-1]) if datetimes and datetimes[0] else None,
        "firstTargets": [float(v) for v in targets[0][:5]] if targets else [],
        "lastTargets": [float(v) for v in targets[0][-5:]] if targets else [],
    },
    "dummyComparisons": [
        evaluate_cutoff(cutoff)
        for cutoff in [-240, -192, -144, -96, -48]
    ],
}

print("GROUNDING_ENERGY_EVA_PARQUET=" + json.dumps(summary))
