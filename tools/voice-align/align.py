#!/usr/bin/env python3
"""voice-align: cut a read-aloud recording into morae (syllables).

Input : a "cut request" exported by tools/voice.html
        (<name>.cutreq.zip, or a directory holding request.json + WAV files)
Output: labels.json that tools/voice.html imports.

Methods
  julius : forced alignment with Julius + the segmentation-kit monophone model
           (built locally by setup_julius.sh; nothing is downloaded at run time)
  signal : signal analysis guided by the known kana sequence (numpy only)
  auto   : julius when it is installed, else signal. A recording that Julius
           cannot align falls back to signal and gets a warning.

Formats are specified in tools/voice-DESIGN.md.

    python3 tools/voice-align/align.py my.cutreq.zip -o labels.json
"""
import argparse
import datetime
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import wave
import zipfile
import zlib

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kana as K  # noqa: E402

VERSION = "voice-align/1.0"
HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(HERE, ".build")
DEFAULT_JULIUS = os.path.join(BUILD, "julius", "julius", "julius")
DEFAULT_MODEL = os.path.join(BUILD, "segmentation-kit", "models", "hmmdefs_monof_mix16_gid.binhmm")

FS = 16000          # analysis rate
HOP = 0.010         # 10 ms frames
JULIUS_OFFSET = 0.0125  # same offset segmentation-kit applies to frame times
EDGE_KEEP = 0.010   # silence kept at label edges after trimming


# ---------------------------------------------------------------- audio io
def read_wav_bytes(b):
    with wave.open(io.BytesIO(b)) as w:
        ch, sw, sr, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        raw = w.readframes(n)
    if sw == 2:
        x = np.frombuffer(raw, "<i2").astype(np.float64) / 32768.0
    elif sw == 3:
        a = np.frombuffer(raw, np.uint8).reshape(-1, 3)
        v = (a[:, 0].astype(np.int32) | (a[:, 1].astype(np.int32) << 8) | (a[:, 2].astype(np.int32) << 16))
        v = np.where(v >= 1 << 23, v - (1 << 24), v)
        x = v / float(1 << 23)
    elif sw == 4:
        x = np.frombuffer(raw, "<i4").astype(np.float64) / 2147483648.0
    elif sw == 1:
        x = (np.frombuffer(raw, np.uint8).astype(np.float64) - 128) / 128.0
    else:
        raise ValueError("unsupported sample width %d" % sw)
    if ch > 1:
        x = x.reshape(-1, ch).mean(axis=1)
    return x, sr


def resample(x, sr, to):
    if sr == to:
        return x.copy()
    n_out = int(round(len(x) * to / sr))
    X = np.fft.rfft(x)
    keep = n_out // 2 + 1
    Y = np.zeros(keep, complex)
    m = min(keep, len(X))
    Y[:m] = X[:m]
    return np.fft.irfft(Y, n_out) * (n_out / len(x))


def write_wav16(path, x, sr):
    y = np.clip(np.round(x * 32767), -32768, 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(y.tobytes())


# ---------------------------------------------------------------- request io
def load_request(path):
    """Return (request_dict, {file: bytes})."""
    files = {}
    if os.path.isdir(path):
        for f in os.listdir(path):
            p = os.path.join(path, f)
            if os.path.isfile(p):
                with open(p, "rb") as fh:
                    files[f] = fh.read()
    else:
        with zipfile.ZipFile(path) as z:
            for n in z.namelist():
                files[os.path.basename(n)] = z.read(n)
    if "request.json" not in files:
        raise SystemExit("request.json not found in %s" % path)
    req = json.loads(files["request.json"].decode("utf-8"))
    if req.get("format") != "voice-cutreq":
        raise SystemExit("not a voice-cutreq file (format=%r)" % req.get("format"))
    return req, files


# ---------------------------------------------------------------- features
def frame_features(x):
    """Per-10ms-frame features of a 16 kHz signal."""
    win = int(0.025 * FS)
    hop = int(HOP * FS)
    nfr = max(1, 1 + (len(x) - win) // hop) if len(x) >= win else 1
    pad = np.zeros(max(len(x), (nfr - 1) * hop + win))
    pad[:len(x)] = x
    idx = np.arange(win)[None, :] + hop * np.arange(nfr)[:, None]
    fr = pad[idx] * np.hanning(win)[None, :]
    spec = np.abs(np.fft.rfft(fr, 512, axis=1)) ** 2
    freqs = np.fft.rfftfreq(512, 1.0 / FS)
    # 24 log-spaced bands 100..7000 Hz
    edges = np.geomspace(100, 7000, 25)
    bands = np.stack([spec[:, (freqs >= lo) & (freqs < hi)].sum(axis=1) for lo, hi in zip(edges[:-1], edges[1:])], 1)
    logb = np.log10(bands + 1e-10)
    energy = 10 * np.log10(spec.sum(axis=1) + 1e-10)
    hi = spec[:, freqs >= 2500].sum(axis=1)
    hfr = hi / (spec.sum(axis=1) + 1e-12)  # high-frequency ratio (fricatives)
    sgn = np.signbit(fr[:, 1:]) != np.signbit(fr[:, :-1])
    zcr = sgn.mean(axis=1)
    return {"E": energy, "logb": logb, "hfr": hfr, "zcr": zcr, "n": nfr}


def speech_span(E):
    floor = np.percentile(E, 5)
    peak = np.percentile(E, 98)
    thr = floor + max(10.0, 0.25 * (peak - floor))
    on = np.where(E > thr)[0]
    if len(on) == 0:
        return 0, len(E), thr
    return int(on[0]), int(on[-1]) + 1, thr


def silence_runs(E, thr, min_frames):
    sil = E <= thr
    runs, i = [], 0
    while i < len(sil):
        if sil[i]:
            j = i
            while j < len(sil) and sil[j]:
                j += 1
            if j - i >= min_frames:
                runs.append((i, j))
            i = j
        else:
            i += 1
    return runs


# ---------------------------------------------------------------- mora classes
STOPS = {"k", "t", "p", "g", "d", "b", "ky", "gy", "by", "py", "ty", "dy", "ch", "ts", "q"}
FRICS = {"s", "sh", "h", "f", "z", "j", "hy"}
NASALS = {"m", "n", "ny", "my", "N"}


def onset_class(mora):
    try:
        ph = K.phones_of(mora)
    except KeyError:
        return "vowel"
    c = ph[0]
    if c in STOPS:
        return "stop"
    if c in FRICS:
        return "fric"
    if c in NASALS:
        return "nasal"
    if c in ("r",):
        return "liquid"
    if c in ("y", "w"):
        return "glide"
    return "vowel"


def dur_factor(mora):
    if mora == "ん":
        return 0.85
    if mora == "っ":
        return 0.9
    if mora == "ー":
        return 0.9
    if len(mora) == 2:
        return 1.1
    return 1.0


# ---------------------------------------------------------------- signal backend
def _z(v):
    s = v.std()
    return (v - v.mean()) / (s if s > 1e-9 else 1.0)


def boundary_scores(F):
    """Return dict class -> score array over frame index t (boundary before frame t)."""
    E, logb, hfr = F["E"], F["logb"], F["hfr"]
    n = F["n"]
    k = 3
    cs = np.vstack([np.zeros((1, logb.shape[1])), np.cumsum(logb, 0)])
    t = np.arange(n)
    lo = np.clip(t - k, 0, n)
    hi = np.clip(t + k, 0, n)
    left = (cs[t] - cs[lo]) / np.maximum(t - lo, 1)[:, None]
    right = (cs[hi] - cs[t]) / np.maximum(hi - t, 1)[:, None]
    flux = np.sqrt(((left - right) ** 2).sum(1))
    flux = _z(flux)
    # energy: falling edge (closure start) and local dip
    Ep = np.concatenate([[E[0]], E[:-1]])
    En = np.concatenate([E[1:], [E[-1]]])
    fall = _z(np.clip(Ep - En, 0, None))
    rise = _z(np.clip(En - Ep, 0, None))
    from numpy.lib.stride_tricks import sliding_window_view as swv
    padE = np.pad(E, 6, mode="edge")
    locmax = swv(padE, 13).max(1)
    dip = _z(locmax - E)
    hp = np.concatenate([[hfr[0]], hfr[:-1]])
    hrise = _z(np.clip(np.concatenate([hfr[2:], [hfr[-1]] * 2]) - hp, 0, None))
    return {
        "stop": 0.6 * flux + 1.0 * fall + 0.6 * dip,
        "fric": 0.6 * flux + 1.0 * hrise + 0.4 * dip,
        "nasal": 0.9 * flux + 0.5 * fall + 0.6 * dip,
        "liquid": 0.9 * flux + 0.5 * dip + 0.3 * fall,
        "glide": 1.0 * flux + 0.3 * dip,
        "vowel": 1.0 * flux + 0.4 * dip + 0.2 * rise,
    }


def _lse(a, axis=0):
    with np.errstate(divide="ignore", invalid="ignore"):
        return _lse_inner(a, axis)


def _lse_inner(a, axis):
    m = a.max(axis=axis)
    mm = np.where(np.isfinite(m), m, 0.0)
    return np.where(np.isfinite(m), mm + np.log(np.exp(a - np.expand_dims(mm, axis)).sum(axis=axis)), -np.inf)


def dp_align(morae, B, s0, s1, sil_mask):
    """Segment frames [s0, s1) into len(morae) contiguous parts.

    score = sum_j durationLogPrior_j + sum_inner boundaryScore(t_j, class of next mora).
    Returns (N+1 absolute boundary frames, posterior confidence of each inner boundary).
    """
    N = len(morae)
    T = s1 - s0
    if N == 0:
        return [s0, s1], []
    w = np.array([dur_factor(m) for m in morae])
    mu = T * w / w.sum()
    ds = np.arange(2, int(max(8, min(T, 3.2 * mu.max()))) + 1)
    sigma, lam = 0.45, 1.6
    sil = np.zeros(T + 1)
    if sil_mask is not None:
        seg = sil_mask[s0:s1 + 1].astype(float)
        sil[:len(seg)] = seg

    def bvec(j):  # boundary score after mora j (1-based), j < N
        arr = B[onset_class(morae[j])]
        v = np.full(T + 1, arr[-1])
        seg = arr[s0:s1 + 1]
        v[:len(seg)] = seg
        return v - 1.5 * sil

    def dcost(j):
        return -lam * (np.log(ds / mu[j - 1]) ** 2) / (2 * sigma ** 2)

    def shift_fwd(a):  # out[d_i, t] = a[t - d]
        out = np.full((len(ds), T + 1), -np.inf)
        for i, d in enumerate(ds):
            out[i, d:] = a[:T + 1 - d]
        return out

    def shift_bwd(a):  # out[d_i, t] = a[t + d]
        out = np.full((len(ds), T + 1), -np.inf)
        for i, d in enumerate(ds):
            out[i, :T + 1 - d] = a[d:]
        return out

    am = np.full((N + 1, T + 1), -np.inf)
    asum = np.full((N + 1, T + 1), -np.inf)
    back = np.zeros((N + 1, T + 1), int)
    am[0, 0] = asum[0, 0] = 0.0
    bs = [None] + [bvec(j) if j < N else np.zeros(T + 1) for j in range(1, N + 1)]
    for j in range(1, N + 1):
        dc = dcost(j)[:, None]
        cm = shift_fwd(am[j - 1]) + dc
        k = np.argmax(cm, axis=0)
        am[j] = cm[k, np.arange(T + 1)] + bs[j]
        back[j] = np.arange(T + 1) - ds[k]
        asum[j] = _lse(shift_fwd(asum[j - 1]) + dc, 0) + bs[j]
    if not np.isfinite(am[N, T]):
        # too few frames for the requested morae: fall back to an even split
        b = np.linspace(0, T, N + 1).round().astype(int)
        return [s0 + int(v) for v in b], [0.0] * (N - 1)
    bounds = [T]
    t = T
    for j in range(N, 0, -1):
        t = int(back[j, t])
        bounds.append(t)
    bounds = bounds[::-1]
    beta = np.full((N + 1, T + 1), -np.inf)
    beta[N, T] = 0.0
    for j in range(N - 1, -1, -1):
        nxt = beta[j + 1] + bs[j + 1]
        beta[j] = _lse(shift_bwd(nxt) + dcost(j + 1)[:, None], 0)
    total = asum[N, T]
    conf = []
    for j in range(1, N):
        post = np.exp(np.clip(asum[j] + beta[j] - total, -60, 0))
        b = bounds[j]
        conf.append(float(np.clip(post[max(0, b - 2):b + 3].sum(), 0, 1)))
    return [s0 + b for b in bounds], conf


def align_signal(x16, morae):
    F = frame_features(x16)
    s0, s1, thr = speech_span(F["E"])
    warnings = []
    # Fast path: morae spoken one by one with pauses -> silence split matches count
    runs = [r for r in silence_runs(F["E"][s0:s1], thr, 12)]
    segs, prev = [], 0
    for a, b in runs:
        segs.append((s0 + prev, s0 + a))
        prev = b
    segs.append((s0 + prev, s1))
    segs = [s for s in segs if s[1] - s[0] >= 4]
    if len(segs) == len(morae) and len(morae) > 1:
        labels = []
        for (a, b), m in zip(segs, morae):
            labels.append((a * HOP, b * HOP + 0.025, 0.9))
        return labels, warnings, "signal-silence"
    B = boundary_scores(F)
    sil_mask = F["E"] <= thr
    bounds, conf = dp_align(morae, B, s0, s1, sil_mask)
    labels = []
    for j, m in enumerate(morae):
        c_left = conf[j - 1] if j > 0 else 0.95
        c_right = conf[j] if j < len(conf) else 0.95
        labels.append((bounds[j] * HOP + 0.0125, bounds[j + 1] * HOP + 0.0125, min(c_left, c_right)))
    return labels, warnings, "signal"


# ---------------------------------------------------------------- julius backend
def julius_available(jbin, model):
    return os.path.isfile(jbin) and os.access(jbin, os.X_OK) and os.path.isfile(model)


def align_julius(x16, morae, jbin, model):
    words = []
    for m in morae:
        if m == "ー":
            prev = words[-1] if words else ["a"]
            v = [p for p in prev if p in "aiueo"]
            words.append([v[-1] if v else "a"])
        else:
            words.append(K.phones_of(m))
    tmp = tempfile.mkdtemp(prefix="valign-")
    try:
        wav = os.path.join(tmp, "a.wav")
        peak = np.abs(x16).max() or 1.0
        write_wav16(wav, x16 * (0.5 / peak), FS)
        allw = [["silB"]] + words + [["silE"]]
        n = len(allw)
        with open(os.path.join(tmp, "a.dfa"), "w") as f:
            for i in range(n):
                f.write("%d %d %d 0 %d\n" % (i, n - 1 - i, i + 1, 1 if i == 0 else 0))
            f.write("%d -1 -1 1 0\n" % n)
        with open(os.path.join(tmp, "a.dict"), "w") as f:
            for i, w in enumerate(allw):
                f.write("%d [w_%d] %s\n" % (i, i, " ".join(w)))
                if 0 < i < n - 1:
                    f.write("%d [w_%d] %s sp\n" % (i, i, " ".join(w)))
        cmd = [jbin, "-h", model, "-dfa", os.path.join(tmp, "a.dfa"), "-v", os.path.join(tmp, "a.dict"),
               "-walign", "-palign", "-input", "file", "-nostrip"]
        p = subprocess.run(cmd, input=wav + "\n", capture_output=True, text=True, timeout=300)
        out = p.stdout
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    cms = None
    for line in out.splitlines():
        if line.startswith("cmscore1:"):
            cms = [float(v) for v in line.split()[1:]]
            break
    # phoneme alignment block
    blk = out.split("-- phoneme alignment --")
    if len(blk) < 2 or cms is None:
        raise RuntimeError("julius produced no alignment")
    phones = []
    for line in blk[1].split("=== end forced alignment ===")[0].splitlines():
        line = line.strip()
        if line.startswith("["):
            a, b = line[1:line.index("]")].split()
            rest = line[line.index("]") + 1:].split()
            phones.append((int(a), int(b), float(rest[0]), rest[1]))
    # group phones into words (silB, morae..., silE); sp may follow any mora
    seq = [("silB",)] + [tuple(w) for w in words] + [("silE",)]
    k = 0
    spans = []
    for wi, w in enumerate(seq):
        got = phones[k:k + len(w)]
        if [g[3] for g in got] != list(w):
            raise RuntimeError("phone sequence mismatch at word %d" % wi)
        k += len(w)
        spans.append((got[0][0], got[-1][1], float(np.mean([g[2] for g in got]))))
        if k < len(phones) and phones[k][3] == "sp":
            k += 1
    labels = []
    for j, m in enumerate(morae):
        a, b, sc = spans[j + 1]
        st = a * 0.01 + JULIUS_OFFSET
        en = (b + 1) * 0.01 + JULIUS_OFFSET
        cm = cms[j + 1] if j + 1 < len(cms) else 0.5
        dur = en - st
        dpen = 1.0 if 0.035 <= dur <= 0.45 else 0.6
        spen = float(np.clip((sc + 40.0) / 12.0, 0.3, 1.0))
        labels.append((st, en, float(np.clip(cm * dpen * spen, 0, 1))))
    return labels


# ---------------------------------------------------------------- post-process
def trim_edges(labels, x16):
    """Trim silence inside each label's edges, keeping EDGE_KEEP of it."""
    F = frame_features(x16)
    E = F["E"]
    _, _, thr = speech_span(E)
    out = []
    for st, en, c in labels:
        a = int(st / HOP)
        b = int(en / HOP)
        a2, b2 = a, b
        while a2 < b2 - 3 and a2 < len(E) and E[a2] <= thr:
            a2 += 1
        while b2 > a2 + 3 and b2 - 1 < len(E) and E[b2 - 1] <= thr:
            b2 -= 1
        nst = max(st, a2 * HOP - EDGE_KEEP) if a2 > a else st
        nen = min(en, b2 * HOP + 0.025 + EDGE_KEEP) if b2 < b else en
        out.append((nst, nen, c))
    return out


def align_recording(rec, files, method, jbin, model, trim=True):
    raw = files.get(rec["file"])
    if raw is None:
        raise SystemExit("missing audio file %s" % rec["file"])
    x, sr = read_wav_bytes(raw)
    x16 = resample(x, sr, FS)
    morae = [K.normalize(m) if m not in ("っ", "ー") else m for m in rec["expected"]]
    warnings = []
    used = method
    labels = None
    if method in ("auto", "julius"):
        if julius_available(jbin, model):
            try:
                labels = align_julius(x16, morae, jbin, model)
                used = "julius"
            except Exception as e:  # noqa: BLE001
                warnings.append("julius failed (%s); used signal method" % e)
                if method == "julius":
                    warnings.append("requested julius explicitly")
        elif method == "julius":
            raise SystemExit("julius not found; run tools/voice-align/setup_julius.sh")
    if labels is None:
        labels, w2, used = align_signal(x16, morae)
        warnings += w2
    if trim:
        labels = trim_edges(labels, x16)
    dur = len(x) / sr
    res = []
    for i, (m, (st, en, c)) in enumerate(zip(rec["expected"], labels)):
        st = max(0.0, min(st, dur))
        en = max(st, min(en, dur))
        res.append({"i": i, "kana": m, "start": round(st, 4), "end": round(en, 4), "confidence": round(c, 3)})
    crc = "%08x" % (zlib.crc32(raw) & 0xFFFFFFFF)
    if rec.get("crc32") and rec["crc32"] != crc:
        warnings.append("audio crc32 differs from request (%s != %s)" % (crc, rec["crc32"]))
    return {"recId": rec["recId"], "crc32": crc, "method": used, "duration": round(dur, 4),
            "labels": res, "warnings": warnings}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("request", help=".cutreq.zip or a directory with request.json")
    ap.add_argument("-o", "--out", default="labels.json")
    ap.add_argument("--method", choices=["auto", "julius", "signal"], default="auto")
    ap.add_argument("--julius", default=os.environ.get("VOICE_ALIGN_JULIUS", DEFAULT_JULIUS))
    ap.add_argument("--model", default=os.environ.get("VOICE_ALIGN_MODEL", DEFAULT_MODEL))
    ap.add_argument("--no-trim", action="store_true", help="do not trim silence at label edges")
    a = ap.parse_args(argv)
    req, files = load_request(a.request)
    recs = []
    for rec in req["recordings"]:
        r = align_recording(rec, files, a.method, a.julius, a.model, trim=not a.no_trim)
        low = sum(1 for l in r["labels"] if l["confidence"] < 0.5)
        print("%s: %d labels via %s, %d low-confidence%s" % (
            rec["recId"], len(r["labels"]), r["method"], low,
            ("; " + "; ".join(r["warnings"])) if r["warnings"] else ""), file=sys.stderr)
        recs.append(r)
    out = {"format": "voice-labels", "version": 1, "generator": VERSION,
           "created": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
           "request": req.get("requestId"), "recordings": recs}
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print("wrote %s" % a.out, file=sys.stderr)


if __name__ == "__main__":
    main()
