"""Noche sin Luna のビルド。template.html に譜面・成分マップ・音源・画像・打音を埋め込んで ../index.html を作る。
音源(mp3。曲1 約4.4MB・曲2 約2.9MB)はリポジトリに二重に置かないため、引数で渡すか、既存の ../index.html から取り出して使う。
  python3 build.py                              # 既存の ../index.html から2曲の音源を取り出して作り直す
  python3 build.py 曲1.mp3 曲2.mp3              # 音源を渡して作る（"-" と書いた曲は既存の ../index.html から取り出す）
"""
import base64, os, re, sys
here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, '..', 'index.html')
p = lambda f: f if os.path.isabs(f) else os.path.join(here, f)
b64 = lambda f: base64.b64encode(open(p(f), 'rb').read()).decode()
old = open(out, encoding='utf-8').read() if os.path.exists(out) else ''
def audio(arg, name):
    if arg and arg != '-': return b64(os.path.abspath(arg))
    m = re.search(r'const %s = "([^"]+)"' % name, old)
    if not m: sys.exit('%s の音源が見つかりません。mp3 のパスを引数で渡してください' % name)
    return m.group(1)
a = sys.argv[1:] + [None, None]
t = open(p('template.html'), encoding='utf-8').read()
t = (t.replace('__CHART2__', open(p('chart2.json')).read()).replace('__CHART__', open(p('chart.json')).read())
      .replace('__TL__', open(p('timeline.json')).read())
      .replace('__AUDIO2__', audio(a[1], 'AUDIO2_B64')).replace('__AUDIO__', audio(a[0], 'AUDIO_B64'))
      .replace('__CLAP0__', b64('assets/c0.wav')).replace('__CLAP1__', b64('assets/c1.wav'))
      .replace('__GOLPE0__', b64('assets/golpe_l.wav')).replace('__GOLPE1__', b64('assets/golpe_r.wav'))
      .replace('__IMG__', b64('assets/guitar.jpg')))
open(out, 'w', encoding='utf-8').write(t)
print('wrote', out, len(t))
