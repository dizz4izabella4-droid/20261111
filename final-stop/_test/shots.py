#!/usr/bin/env python3
"""全場面を縦・横で撮影し、逃走車の外接矩形を設計書の表と照合する。
   python3 final-stop/_test/shots.py   → _test/out/*.png と probe.json"""
import json, os, sys
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, 'out'); os.makedirs(OUT, exist_ok=True)
URL = 'file://' + os.path.abspath(os.path.join(HERE, '..', 'index.html'))
SHOTS = [('TITLE', 0), ('INTRO', 1.0), ('APPROACH', 2.0), ('WINDOW', 0), ('HIT1', 0), ('HIT1', 0.5), ('HIT2', 0), ('HIT3', 0), ('HIT3', 0.5), ('MISS', 0.3), ('PULLOVER', 1.2), ('PULLOVER', 2.6), ('PULLOVER', 3.9), ('EVENT', 2.0), ('PREVIEW0', 0), ('REACT0', 0.8), ('PREVIEW1', 0), ('PREVIEW2', 0), ('REACT2', 1.5), ('PREVIEW3', 0), ('REACT3', 2.0), ('ARREST', 1.0), ('END', 0.2), ('YOURTURN0', 0.5), ('YOURTURN0', 1.6), ('YOURTURN0', 4.2), ('DEAD', 0.4), ('DEAD', 0.75), ('DEAD', 1.6), ('DEAD', 2.8), ('REACT3', 0.3), ('HIT1', 0.1), ('HIT2', 0.1)]
VPS = {'port': (390, 844), 'land': (844, 390)}
# 設計書 3.3 縦の表: (幅, 上, 下)
EXPECT_PORT = {'WINDOW': (121, 347, 444)}
res = {}; bad = 0
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    for vn, (w, h) in VPS.items():
        pg = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=1)
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        for lab, t in SHOTS:
            pg.goto(URL + '?shot=%s&t=%s&debug=1' % (lab, t)); pg.wait_for_function('window.__ready===true', timeout=20000)
            name = '%s_%s_%s.png' % (vn, lab, str(t).replace('.', '_')); pg.screenshot(path=os.path.join(OUT, name))
            pr = pg.evaluate('JSON.parse(JSON.stringify(window.__probe))'); res['%s/%s@%s' % (vn, lab, t)] = pr
            if vn == 'port' and lab in EXPECT_PORT and t == 0:
                ew, et, eb = EXPECT_PORT[lab]; s = pr['suspect']
                okk = abs(s['w'] - ew) <= 4 and abs(s['top'] - et) <= 4 and abs(s['bot'] - eb) <= 4
                print('照合 %s: 幅%.0f/%d 上%.0f/%d 下%.0f/%d → %s' % (lab, s['w'], ew, s['top'], et, s['bot'], eb, 'OK' if okk else 'NG')); bad += 0 if okk else 1
        if errs: print(vn, 'エラー:', errs[:5]); bad += 1
        pg.close()
    b.close()
json.dump(res, open(os.path.join(OUT, 'probe.json'), 'w'), indent=1, ensure_ascii=False)
print('撮影 %d 枚、不一致 %d' % (len(SHOTS) * len(VPS), bad)); sys.exit(1 if bad else 0)
