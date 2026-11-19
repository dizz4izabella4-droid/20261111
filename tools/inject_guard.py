#!/usr/bin/env python3
"""全ゲームHTMLに「ダブルタップ拡大の防止」と「マナーモード(消音)に従う」ガードを入れる。何度実行しても同じ結果（冪等）。"""
import re, sys, json, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
MARK = 'iz-guard'
SNIP = ('<script>/*iz-guard v1: ダブルタップ拡大の防止／iPhoneのマナーモードに従う*/'
 "try{navigator.audioSession&&(navigator.audioSession.type='ambient')}catch(e){}"
 "(function(){try{var s=document.createElement('style');s.textContent='html{-webkit-text-size-adjust:100%}*{touch-action:manipulation}';"
 "document.documentElement.appendChild(s);"
 "['gesturestart','gesturechange','gestureend','dblclick'].forEach(function(n){document.addEventListener(n,function(e){e.preventDefault()},{passive:false})});}catch(e){}})();"
 '</script>')
works = json.load(open(ROOT/'data/works.json'))
works = works['works'] if isinstance(works, dict) else works
dirs = {w['path'].strip('/') for w in works if w.get('category') != 'tool'}
files = set()
for d in dirs:
    for f in (ROOT/d).rglob('*.html'): files.add(f)
for extra in ['pc98-novel/_engine/template.html']:
    if (ROOT/extra).exists(): files.add(ROOT/extra)
n = 0
for f in sorted(files):
    s = f.read_text(encoding='utf-8')
    if '<head' not in s.lower(): continue
    o = s
    if MARK not in s:
        s = re.sub(r'(<head[^>]*>)', lambda m: m.group(1) + SNIP, s, count=1, flags=re.I)
    # viewport：拡大を禁止
    def vp(m):
        c = m.group(2)
        if 'maximum-scale' not in c: c += ',maximum-scale=1'
        if 'user-scalable' not in c: c += ',user-scalable=no'
        return m.group(1) + c + m.group(3)
    s = re.sub(r'(<meta[^>]*name=["\']viewport["\'][^>]*content=["\'])([^"\']*)(["\'])', vp, s, flags=re.I)
    if s != o:
        f.write_text(s, encoding='utf-8'); n += 1; print('更新', f.relative_to(ROOT))
print(n, 'ファイル')
