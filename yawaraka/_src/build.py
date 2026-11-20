#!/usr/bin/env python3
"""yawaraka/index.html を作る（three.js を埋め込んだ単一HTML）。
  使い方:  cd yawaraka/_src && npm i three@0.160.1 esbuild && python3 build.py
  app.js を esbuild で1本にまとめ、template.html の /*@@APP@@*/ に埋め込む。
  最後に tools/apply_game_base.py を実行して基本設計ブロックを入れる。"""
import os, subprocess, sys
here = os.path.dirname(os.path.abspath(__file__))
nm = os.path.join(here, 'node_modules')
if not os.path.isdir(nm):
    nm = os.environ.get('YAW_NODE_MODULES', '/home/claude/work/bundle/node_modules')
env = dict(os.environ, NODE_PATH=nm)
r = subprocess.run([os.path.join(nm, '.bin', 'esbuild'), os.path.join(here, 'app.js'), '--bundle', '--minify', '--format=iife', '--target=es2019', '--legal-comments=none'],
                   capture_output=True, text=True, env=env)
if r.returncode:
    sys.exit(r.stderr)
js = r.stdout.replace('</script', '<\\/script')
t = open(os.path.join(here, 'template.html'), encoding='utf-8').read()
out = t.replace('/*@@APP@@*/', js.replace('\\', '\\\\') if False else js)
open(os.path.join(here, '..', 'index.html'), 'w', encoding='utf-8').write(out)
print('index.html', len(out) // 1024, 'KB')
