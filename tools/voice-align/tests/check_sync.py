#!/usr/bin/env python3
"""Check that sentences.json and kana.INVENTORY match what tools/voice.html embeds."""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
import kana as K  # noqa: E402

html = open(os.path.join(ROOT, "..", "voice.html"), encoding="utf-8").read()
emb = json.loads(re.search(r'<script type="application/json" id="sample-sentences">(.*?)</script>', html, re.S).group(1))
src = json.load(open(os.path.join(ROOT, "sentences.json"), encoding="utf-8"))["sentences"]
ok = True
if emb != src:
    print("NG: sentences differ between sentences.json and voice.html")
    ok = False
cov = {K.normalize(m) for s in src for m in K.split_morae(s["kana"])}
miss = [k for k in K.INVENTORY if k not in cov]
if miss:
    print("NG: sentences miss", miss)
    ok = False
base = re.search(r"const BASE = \[\.\.\.'(.*?)'\]", html).group(1)
dak = re.search(r"const DAK = \[\.\.\.'(.*?)'\]", html).group(1)
yb = re.search(r"for \(const b of '(.*?)'\)", html).group(1)
js_inv = list(base) + list(dak) + [b + s for b in yb for s in "ゃゅょ"]
if js_inv != K.INVENTORY:
    print("NG: inventory differs", set(js_inv) ^ set(K.INVENTORY))
    ok = False
print("OK: %d sentences, %d morae, inventory %d" % (len(src), sum(len(K.split_morae(s["kana"])) for s in src), len(K.INVENTORY)) if ok else "FAILED")
sys.exit(0 if ok else 1)
