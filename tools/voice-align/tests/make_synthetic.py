#!/usr/bin/env python3
"""Build synthetic cut requests with exact ground-truth mora boundaries.

macOS only (uses the `say` command). Each mora is rendered on its own by a
Japanese system voice, trimmed, and the pieces are joined with short
crossfades, so every boundary position is known exactly. This is *not*
natural continuous speech (no coarticulation across morae); see
voice-DESIGN.md "Alignment accuracy" for what that means for the numbers.

    python3 make_synthetic.py OUTDIR

Writes OUTDIR/<variant>/request.json, *.wav and truth.json for each variant.
"""
import json
import os
import subprocess
import sys
import tempfile
import zlib

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import kana as K  # noqa: E402
from align import read_wav_bytes, resample, write_wav16  # noqa: E402

VARIANTS = {
    # name: voice, output rate, crossfade s, tail trim fraction, pause at spaces s, noise dBFS
    "kyoko-clean": dict(voice="Kyoko", sr=48000, xf=0.008, trim=0.0, pause=0.06, noise=-60),
    "kyoko-tight": dict(voice="Kyoko", sr=48000, xf=0.025, trim=0.15, pause=0.0, noise=-50),
    "flo-tight": dict(voice="Flo", sr=44100, xf=0.025, trim=0.15, pause=0.0, noise=-50),
    "kyoko-singles": dict(voice="Kyoko", sr=48000, xf=0.0, trim=0.0, pause=0.45, noise=-55, singles=True),
}
SR_RENDER = 22050
_cache = {}


def render(mora, voice):
    key = (mora, voice)
    if key in _cache:
        return _cache[key]
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "m.wav")
        subprocess.run(["say", "-v", voice, "--data-format=LEI16@%d" % SR_RENDER, "-o", p, mora], check=True)
        x, sr = read_wav_bytes(open(p, "rb").read())
    x = resample(x, sr, SR_RENDER)
    a = np.abs(x)
    thr = a.max() * 0.02
    idx = np.where(a > thr)[0]
    x = x[idx[0]:idx[-1] + 1] if len(idx) else x
    x = x / (np.abs(x).max() + 1e-9) * 0.5
    _cache[key] = x
    return x


def build(kana_text, v, rng):
    sr = SR_RENDER
    units = []  # (mora, samples or None for silence)
    words = kana_text.split()
    seq = []
    for wi, w in enumerate(words):
        for m in K.split_morae(w):
            seq.append(m)
        if wi < len(words) - 1:
            seq.append(" ")
    out = [np.zeros(int(0.25 * sr))]
    pos = len(out[0])
    truth = []
    xf = int(v["xf"] * sr)
    prev_abut = False
    for m in seq:
        if m == " ":
            if v["pause"] > 0:
                z = np.zeros(int(v["pause"] * sr))
                out.append(z)
                pos += len(z)
                prev_abut = False
            continue
        if m == "っ":
            u = np.zeros(int(0.07 * sr))
        else:
            u = render(K.normalize(m), v["voice"]).copy()
            if v["trim"]:
                u = u[:int(len(u) * (1 - v["trim"]))]
            f = min(int(0.004 * sr), len(u) // 4)
            if f > 0:
                u[:f] *= np.linspace(0, 1, f)
                u[-f:] *= np.linspace(1, 0, f)
        if v.get("singles"):
            z = np.zeros(int(v["pause"] * sr))
            out.append(z)
            pos += len(z)
            prev_abut = False
        if prev_abut and xf > 0 and len(u) > 2 * xf:
            # overlap-add: the new unit starts xf samples before the current end
            tail = out[-1]
            ov = min(xf, len(tail))
            ramp = np.linspace(0, 1, ov)
            tail[-ov:] = tail[-ov:] * (1 - ramp) + u[:ov] * ramp
            start = pos - ov
            body = u[ov:]
            out.append(body)
            # truth boundary: middle of the crossfade
            mid = (pos - ov / 2.0) / sr
            truth[-1]["end"] = mid
            truth.append({"kana": m, "start": mid, "end": None})
            pos += len(body)
        else:
            truth.append({"kana": m, "start": pos / sr, "end": None})
            out.append(u)
            pos += len(u)
        truth[-1]["end"] = pos / sr
        prev_abut = True
    out.append(np.zeros(int(0.25 * sr)))
    x = np.concatenate(out)
    x = x + rng.normal(0, 10 ** (v["noise"] / 20), len(x))
    return x, [m for m in seq if m != " "], truth


def main():
    outdir = sys.argv[1]
    sents = json.load(open(os.path.join(os.path.dirname(HERE), "sentences.json")))["sentences"]
    rng = np.random.default_rng(7)
    singles_kana = ["ぴゃ", "ぬ", "へ", "みゅ", "ぎょ", "ぜ", "りゃ", "ぽ", "じゃ", "ひゅ", "べ", "にょ"]
    for name, v in VARIANTS.items():
        d = os.path.join(outdir, name)
        os.makedirs(d, exist_ok=True)
        recs, truths = [], {}
        items = [{"id": "single", "text": "", "kana": " ".join(singles_kana)}] if v.get("singles") else sents
        for s in items:
            x, morae, truth = build(s["kana"], v, rng)
            x = resample(x, SR_RENDER, v["sr"])
            fn = "%s.wav" % s["id"]
            write_wav16(os.path.join(d, fn), x, v["sr"])
            raw = open(os.path.join(d, fn), "rb").read()
            recs.append({"recId": s["id"], "file": fn, "sampleRate": v["sr"], "duration": len(x) / v["sr"],
                         "crc32": "%08x" % (zlib.crc32(raw) & 0xFFFFFFFF), "text": s["text"],
                         "kana": s["kana"], "expected": morae})
            truths[s["id"]] = truth
        json.dump({"format": "voice-cutreq", "version": 1, "requestId": "synthetic-" + name,
                   "project": "synthetic", "recordings": recs},
                  open(os.path.join(d, "request.json"), "w"), ensure_ascii=False, indent=1)
        json.dump(truths, open(os.path.join(d, "truth.json"), "w"), ensure_ascii=False, indent=1)
        print(name, len(recs), "recordings")


if __name__ == "__main__":
    main()
