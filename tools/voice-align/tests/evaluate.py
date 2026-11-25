#!/usr/bin/env python3
"""Compare labels.json against truth.json produced by make_synthetic.py.

    python3 evaluate.py VARIANT_DIR labels.json

Boundary error = |label edge - true edge| over every label start and end.
Also reports how well low confidence flags large errors.
"""
import json
import sys

import numpy as np


def main():
    d, lab = sys.argv[1], sys.argv[2]
    truth = json.load(open(d + "/truth.json"))
    labels = json.load(open(lab))
    errs, conf_err = [], []
    count_bad = 0
    for r in labels["recordings"]:
        t = truth[r["recId"]]
        if len(t) != len(r["labels"]):
            count_bad += 1
            continue
        for a, b in zip(r["labels"], t):
            e = max(abs(a["start"] - b["start"]), abs(a["end"] - b["end"])) * 1000
            errs.append(abs(a["start"] - b["start"]) * 1000)
            errs.append(abs(a["end"] - b["end"]) * 1000)
            conf_err.append((a["confidence"], e))
    e = np.array(errs)
    ce = np.array(conf_err)
    big = ce[:, 1] > 50
    low = ce[:, 0] < 0.5
    res = {
        "variant": d.rstrip("/").split("/")[-1],
        "method": sorted({r["method"] for r in labels["recordings"]}),
        "edges": int(len(e)),
        "mean_ms": round(float(e.mean()), 1),
        "median_ms": round(float(np.median(e)), 1),
        "p90_ms": round(float(np.percentile(e, 90)), 1),
        "within_20ms": round(float((e <= 20).mean() * 100), 1),
        "within_50ms": round(float((e <= 50).mean() * 100), 1),
        "labels_err_gt50ms": int(big.sum()),
        "flagged_low_conf": int(low.sum()),
        "big_errors_flagged": int((big & low).sum()),
        "count_mismatch_recordings": count_bad,
    }
    print(json.dumps(res, ensure_ascii=False))


if __name__ == "__main__":
    main()
