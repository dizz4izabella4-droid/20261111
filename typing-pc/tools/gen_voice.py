#!/usr/bin/env python3
"""CMD Typing PC版: 出題語の読み上げ音声を作る道具。

どの端末でも同じ声（ロボット風）で鳴らすため、読み上げは端末の音声合成ではなく、
ここで作った音声ファイル（typing-pc/voice/<単語>.mp3）を再生している。
voice/ を作り直すときに使う（語を増やしたときも、これを実行する）。

必要なもの: python3、ffmpeg（libmp3lame 付き）、pip の espeakng-loader（espeak-ng 本体と辞書を同梱）
    pip install --break-system-packages espeakng-loader
使い方（リポジトリのどこからでも）:
    python3 typing-pc/tools/gen_voice.py          # 足りない語だけ作る
    python3 typing-pc/tools/gen_voice.py --all    # 全部作り直す
index.html の LEVELS にある語を読み取って作る。LEVELS から消えた語のファイルは消す。
"""
import array, ctypes, os, re, subprocess, sys
import espeakng_loader

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.join(HERE, '..', 'index.html')
OUT = os.path.join(HERE, '..', 'voice')
VOICE, RATE, PITCH, RANGE = b'en-us', 135, 38, 30      # ロボット風: 低め・抑揚少なめ・ゆっくり

def words():
    s = open(PAGE, encoding='utf-8').read()
    a = s.index('const LEVELS=['); b = s.index('];', a); ws = []
    for m in re.finditer(r'raw:`(.*?)`', s[a:b], re.S):          # LEVELS の raw: `…` の中の「英単語 訳」の行だけ
        ws += [l.split(' ')[0] for l in m.group(1).split('\n') if l.strip()]
    assert all(re.fullmatch(r'[a-z]+', w) for w in ws), '語は小文字のアルファベットだけ'
    return sorted(set(ws))

class Synth:
    CB = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.POINTER(ctypes.c_short), ctypes.c_int, ctypes.c_void_p)
    def __init__(self):
        self.lib = ctypes.CDLL(espeakng_loader.get_library_path())
        self.lib.espeak_Initialize.restype = ctypes.c_int
        self.sr = self.lib.espeak_Initialize(1, 0, espeakng_loader.get_data_path().encode(), 0)   # 1 = データを受け取る
        if self.sr <= 0: raise SystemExit('espeak-ng を初期化できません')
        self.buf = array.array('h')
        def cb(wav, n, ev):
            if wav and n > 0: self.buf.extend(wav[:n])
            return 0
        self.cb = self.CB(cb); self.lib.espeak_SetSynthCallback(self.cb)
        self.lib.espeak_SetVoiceByName(VOICE)
        for k, v in ((1, RATE), (3, PITCH), (4, RANGE)): self.lib.espeak_SetParameter(k, v, 0)
    def say(self, text):
        self.buf = array.array('h'); t = text.encode()
        self.lib.espeak_Synth(t, len(t) + 1, 0, 0, 0, 1, None, None); self.lib.espeak_Synchronize()
        return self.buf

def trim_norm(x, sr):
    th = 400                                    # 無音とみなす大きさ
    i = next((k for k, v in enumerate(x) if abs(v) > th), 0)
    j = len(x) - next((k for k, v in enumerate(reversed(x)) if abs(v) > th), 0)
    pad = int(sr * .03); x = x[max(0, i - pad):min(len(x), j + pad)]
    peak = max(1, max(abs(v) for v in x)); g = 0.89 * 32767 / peak
    y = array.array('h', (int(v * g) for v in x))
    f = int(sr * .012)                          # 端のプツ音を消す
    for k in range(min(f, len(y))): y[k] = int(y[k] * k / f); y[-1 - k] = int(y[-1 - k] * k / f)
    return y

def encode(pcm, sr, path):
    p = subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 's16le', '-ar', str(sr), '-ac', '1', '-i', '-',
                        '-ar', '22050', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '40k', path], input=pcm.tobytes())
    if p.returncode: raise SystemExit('ffmpeg に失敗しました: ' + path)

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True); ws = words(); allw = '--all' in sys.argv
    sy = Synth(); made = 0
    for w in ws:
        path = os.path.join(OUT, w + '.mp3')
        if os.path.exists(path) and not allw: continue
        encode(trim_norm(sy.say(w), sy.sr), sy.sr, path); made += 1
    gone = [f for f in os.listdir(OUT) if f.endswith('.mp3') and f[:-4] not in set(ws)]
    for f in gone: os.remove(os.path.join(OUT, f))
    print(f'語 {len(ws)} / 作った {made} / 消した {len(gone)}')
