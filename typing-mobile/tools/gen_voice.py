#!/usr/bin/env python3
"""CMD Typing スマホ版（フリック）: 出題語の読み上げ音声（女性の声）を作る道具。

どの端末でも同じ声で鳴らすため、読み上げは端末の音声合成ではなく、ここで作った音声ファイル
（typing-mobile/voice/<読みの文字コード>.mp3）を再生している。語を増やしたときも、これを実行する。
読み（ひらがな）をそのまま読み上げる。ファイル名は、読みの各文字の文字コード（16進）を「-」でつないだもの
（例: しんえん → 3057-3093-3048-3093.mp3）。index.html の voiceFile() と同じ規則。

声: HTS Voice "Mei"（MMDAgent Project Team / 名古屋工業大学, CC BY 3.0）を pyopenjtalk 経由で使う。
    表記（クレジット）は typing-mobile/voice/CREDITS.txt に置いてある。消さないこと。

必要なもの: python3、ffmpeg（libmp3lame 付き）、pip の pyopenjtalk（初回の実行で辞書を取りに行く）
    pip install --break-system-packages pyopenjtalk
使い方（リポジトリのどこからでも）:
    python3 typing-mobile/tools/gen_voice.py          # 足りない語だけ作る
    python3 typing-mobile/tools/gen_voice.py --all    # 全部作り直す
    python3 typing-mobile/tools/gen_voice.py --check  # 読みの発音を検算するだけ（ファイルは作らない）
index.html の WORDSETS にある読みを取り出して作る。WORDSETS から消えた読みのファイルは消す。
"""
import os, re, subprocess, sys
import numpy as np
import pyopenjtalk

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.join(HERE, '..', 'index.html')
OUT = os.path.join(HERE, '..', 'voice')
SPEED = 0.95                                   # 学習向けに、ほんの少しゆっくり

def readings():
    """読み → その読みの表示（漢字など）のリスト"""
    s = open(PAGE, encoding='utf-8').read()
    a = s.index('const WORDSETS={'); b = s.index('};', a); d = {}
    for m in re.finditer(r"mkW\('(.*?)'\)", s[a:b], re.S):
        for x in m.group(1).split('|'):
            if x.strip(): r, disp = x.split(' ')[:2]; d.setdefault(r, []).append(disp)
    return d

def fname(r): return '-'.join('%x' % ord(c) for c in r) + '.mp3'
def kata(r): return ''.join(chr(ord(c) + 0x60) if 'ぁ' <= c <= 'ゖ' else c for c in r)

VROW = (('アカサタナハマヤラワガザダバパァャ', 'ア'), ('イキシチニヒミリギジヂビピィ', 'イ'), ('ウクスツヌフムユルグズヅブプゥュヴ', 'ウ'),
        ('エケセテネヘメレゲゼデベペェ', 'エ'), ('オコソトノホモヨロヲゴゾドボポォョ', 'オ'))
def vowel(ch):
    for row, c in VROW:
        if ch in row: return c
    return ''

def norm_pron(k):
    """発音の比較用: 同じ音になる綴りをそろえ、長音（ー・オウ・エイ・同じ母音の連続）を「ー」にそろえる"""
    for a, b in (('ヴァ', 'バ'), ('ヴィ', 'ビ'), ('ヴェ', 'ベ'), ('ヴォ', 'ボ'), ('ヴ', 'ブ'), ('ヂ', 'ジ'), ('ヅ', 'ズ'),
                 ('ヲ', 'オ'), ('ヰ', 'イ'), ('ヱ', 'エ')): k = k.replace(a, b)
    out = ''; prev = ''
    for ch in k:
        if ch == 'ー' or (ch in 'アイウエオ' and prev and (ch == prev or (ch == 'ウ' and prev == 'オ') or (ch == 'イ' and prev == 'エ'))): out += 'ー'
        else: out += ch; prev = {'ャ': 'ア', 'ュ': 'ウ', 'ョ': 'オ', 'ッ': '', 'ン': ''}.get(ch, vowel(ch))
    return out

def trim_norm(x, sr):
    th = 400
    i = next((k for k, v in enumerate(x) if abs(v) > th), 0)
    j = len(x) - next((k for k, v in enumerate(x[::-1]) if abs(v) > th), 0)
    pad = int(sr * .04); x = x[max(0, i - pad):min(len(x), j + pad)]
    g = 0.89 * 32767 / max(1.0, float(np.abs(x).max()))
    y = np.clip(x * g, -32767, 32767).astype('<i2')
    f = int(sr * .012)                          # 端のプツ音を消す
    r = np.linspace(0, 1, min(f, len(y)))
    y[:len(r)] = (y[:len(r)] * r).astype('<i2'); y[len(y) - len(r):] = (y[len(y) - len(r):] * r[::-1]).astype('<i2')
    return y

def encode(pcm, sr, path):
    p = subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 's16le', '-ar', str(sr), '-ac', '1', '-i', '-',
                        '-ar', '24000', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '40k', path], input=pcm.tobytes())
    if p.returncode: raise SystemExit('ffmpeg に失敗しました: ' + path)

def text_for(r, disp):
    """発音が読みと一致する入力文字を探す。まず読み（カタカナ）、だめなら表示の文字（辞書の読みを使う）"""
    for t in [kata(r)] + disp:
        if norm_pron(pyopenjtalk.g2p(t, kana=True)) == norm_pron(kata(r)): return t
    return None

if __name__ == '__main__':
    rd = readings(); rs = sorted(rd)
    if '--check' in sys.argv:
        bad = [r for r in rs if text_for(r, rd[r]) is None]
        for r in bad: print('発音が合わない:', r, rd[r], '→', pyopenjtalk.g2p(kata(r), kana=True))
        print(f'読み {len(rs)} / 発音が合わない {len(bad)}'); sys.exit(1 if bad else 0)
    os.makedirs(OUT, exist_ok=True); allw = '--all' in sys.argv; made = 0
    for r in rs:
        path = os.path.join(OUT, fname(r))
        if os.path.exists(path) and not allw: continue
        t = text_for(r, rd[r])
        if t is None: raise SystemExit('発音が合いません（--check で確認）: ' + r)
        x, sr = pyopenjtalk.tts(t, speed=SPEED)
        encode(trim_norm(np.asarray(x, dtype=np.float64), sr), sr, path); made += 1
    keep = {fname(r) for r in rs}
    gone = [f for f in os.listdir(OUT) if f.endswith('.mp3') and f not in keep]
    for f in gone: os.remove(os.path.join(OUT, f))
    print(f'読み {len(rs)} / 作った {made} / 消した {len(gone)}')
