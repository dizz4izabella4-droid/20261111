"""Kana utilities shared by the aligner and its tests.

The mora inventory here must stay identical to INVENTORY in tools/voice.html
(see tools/voice-DESIGN.md, "Mora inventory").
"""

SMALL = "ゃゅょぁぃぅぇぉゎ"

ROWS = {
    "": "あいうえお", "k": "かきくけこ", "s": "さしすせそ", "t": "たちつてと",
    "n": "なにぬねの", "h": "はひふへほ", "m": "まみむめも", "r": "らりるれろ",
    "g": "がぎぐげご", "z": "ざじずぜぞ", "d": "だぢづでど", "b": "ばびぶべぼ",
    "p": "ぱぴぷぺぽ",
}
VOWELS = "aiueo"

# Kana that are pronounced identically to another kana (decision E + spec gap).
ALIASES = {"を": "お", "ぢ": "じ", "づ": "ず", "ゎ": "わ", "ゐ": "い", "ゑ": "え"}

YOON_BASE = "きしちにひみりぎじびぴ"
FOREIGN = ["ふぁ", "ふぃ", "ふぇ", "ふぉ", "てぃ", "でぃ", "とぅ", "どぅ", "うぃ", "うぇ",
           "うぉ", "しぇ", "じぇ", "ちぇ", "つぁ", "つぃ", "つぇ", "つぉ", "いぇ",
           "ゔぁ", "ゔぃ", "ゔ", "ゔぇ", "ゔぉ", "ふゅ", "てゅ", "でゅ"]


def _phones():
    p = {}
    for c, row in ROWS.items():
        for k, v in zip(row, VOWELS):
            p[k] = ([c] if c else []) + [v]
    p.update({"し": ["sh", "i"], "ち": ["ch", "i"], "つ": ["ts", "u"], "ふ": ["f", "u"],
              "じ": ["j", "i"], "ぢ": ["j", "i"], "づ": ["z", "u"],
              "や": ["y", "a"], "ゆ": ["y", "u"], "よ": ["y", "o"], "わ": ["w", "a"],
              "ん": ["N"], "っ": ["q"]})
    ycons = {"き": "ky", "し": "sh", "ち": "ch", "に": "ny", "ひ": "hy", "み": "my",
             "り": "ry", "ぎ": "gy", "じ": "j", "び": "by", "ぴ": "py"}
    for base, c in ycons.items():
        for s, v in zip("ゃゅょ", "auo"):
            p[base + s] = [c, v]
    f = {"ふぁ": "f a", "ふぃ": "f i", "ふぇ": "f e", "ふぉ": "f o", "てぃ": "t i",
         "でぃ": "d i", "とぅ": "t u", "どぅ": "d u", "うぃ": "w i", "うぇ": "w e",
         "うぉ": "w o", "しぇ": "sh e", "じぇ": "j e", "ちぇ": "ch e", "つぁ": "ts a",
         "つぃ": "ts i", "つぇ": "ts e", "つぉ": "ts o", "いぇ": "y e", "ゔぁ": "b a",
         "ゔぃ": "b i", "ゔ": "b u", "ゔぇ": "b e", "ゔぉ": "b o", "ふゅ": "hy u",
         "てゅ": "ty u", "でゅ": "dy u"}
    for k, v in f.items():
        p[k] = v.split()
    return p


PHONES = _phones()

INVENTORY = (
    [k for k in "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわん"]
    + [k for k in "がぎぐげござじずぜぞだでどばびぶべぼぱぴぷぺぽ"]
    + [b + s for b in YOON_BASE for s in "ゃゅょ"]
)
assert len(INVENTORY) == 101, len(INVENTORY)


def kata2hira(s):
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in s)


def normalize(kana):
    """Normalize one mora string (aliases applied)."""
    k = kata2hira(kana)
    if len(k) == 2 and k[0] in ALIASES and k[1] in "ゃゅょ":  # ぢゃ -> じゃ
        k = ALIASES[k[0]] + k[1]
    return ALIASES.get(k, k)


def split_morae(text):
    """Split a kana string into morae. Spaces/punctuation are dropped."""
    s = kata2hira(text)
    out, i = [], 0
    while i < len(s):
        c = s[i]
        if c in " 　、。，．？！?!・":
            i += 1
            continue
        if i + 1 < len(s) and s[i + 1] in SMALL and (c + s[i + 1]) in PHONES:
            out.append(c + s[i + 1])
            i += 2
            continue
        if c in "ぁぃぅぇぉ":
            c = "あいうえお"["ぁぃぅぇぉ".index(c)]
        out.append(c)
        i += 1
    return out


def phones_of(mora):
    m = normalize(mora)
    if m == "ー":
        return [":"]
    if m not in PHONES:
        raise KeyError("no phoneme mapping for mora %r" % mora)
    return PHONES[m]
