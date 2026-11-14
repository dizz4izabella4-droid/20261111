"""Noche sin Luna のビルド。template.html に譜面・成分マップ・音源・画像・打音を埋め込んで ../index.html を作る。
音源(mp3, 約4.4MB)はリポジトリに二重に置かないため、引数で渡すか、既存の ../index.html から取り出して使う。
  python3 build.py                 # 既存の ../index.html から音源を取り出して作り直す
  python3 build.py path/to/Noche_sin_Luna.mp3
"""
import base64, os, re, sys
here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, '..', 'index.html')
p = lambda f: f if os.path.isabs(f) else os.path.join(here, f)
b64 = lambda f: base64.b64encode(open(p(f), 'rb').read()).decode()
if len(sys.argv) > 1:
    audio = b64(os.path.abspath(sys.argv[1]))
else:
    m = re.search(r'const AUDIO_B64 = "([^"]+)"', open(out, encoding='utf-8').read())
    if not m: sys.exit('音源が見つかりません。mp3 のパスを引数で渡してください')
    audio = m.group(1)
t = open(p('template.html'), encoding='utf-8').read()
t = (t.replace('__CHART__', open(p('chart.json')).read()).replace('__TL__', open(p('timeline.json')).read())
      .replace('__AUDIO__', audio)
      .replace('__CLAP0__', b64('assets/c0.wav')).replace('__CLAP1__', b64('assets/c1.wav'))
      .replace('__GOLPE0__', b64('assets/golpe_l.wav')).replace('__GOLPE1__', b64('assets/golpe_r.wav'))
      .replace('__IMG__', b64('assets/guitar.jpg')))
open(out, 'w', encoding='utf-8').write(t)
print('wrote', out, len(t))
