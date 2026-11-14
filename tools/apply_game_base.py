#!/usr/bin/env python3
"""全作品へ「基本設計モジュール」(shared/game-base.js) を埋め込む。何度実行しても同じ結果になる。

  python3 tools/apply_game_base.py          # 全作品に適用（更新）
  python3 tools/apply_game_base.py --check  # 最新でない作品があれば一覧して終了コード1

新作を作ったら、その index.html を TARGETS に足して実行する（HANDOFF.md「基本設計」参照）。
埋め込み位置は </head> の直前。viewport は maximum-scale=1,user-scalable=no を含むように直す。
"""
import os, re, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
START = '<!--IZ-GAME-BASE:START-->'
END = '<!--IZ-GAME-BASE:END-->'
# 本体とソース(テンプレート)の両方を列挙する。rules.html のような説明ページは対象外
TARGETS = [
    'index.html',
    'typing-pc/index.html',
    'typing-mobile/index.html',
    'tori-to-kemono/index.html',
    'kumiwake-bou/index.html',
    'glass-breaker/index.html',
    'dentaku-drill/index.html',
    'nobiru-hige/index.html',
    'fire-hakoniwa/index.html',
    'icarus/index.html',
    'icarus/_src/src/template.html',
    'where-which/index.html',
    'noche-sin-luna/index.html',
    'noche-sin-luna/_src/template.html',
    'pc98-novel/_engine/template.html',
    'pc98-novel/index.html',
]
PWA_META = (
    '<meta name="apple-mobile-web-app-capable" content="yes">'
    '<meta name="mobile-web-app-capable" content="yes">'
    '<meta name="apple-mobile-web-app-status-bar-style" content="black">'
)


def fix_viewport(html):
    def repl(m):
        tag = m.group(0)
        c = re.search(r'content\s*=\s*(["\'])(.*?)\1', tag, re.S)
        if not c:
            return tag
        parts = [p.strip() for p in c.group(2).split(',') if p.strip()]
        parts = [p for p in parts if p.split('=')[0].strip().lower() not in ('maximum-scale', 'minimum-scale', 'user-scalable')]
        parts += ['maximum-scale=1', 'user-scalable=no']
        return tag[:c.start(2)] + ','.join(parts) + tag[c.end(2):]
    # 先頭の viewport だけ直す（本文中に同じ文字列が埋め込まれていても触らない）
    head_end = html.find('</head>')
    head = html[:head_end]
    head2, n = re.subn(r'<meta\s+name\s*=\s*["\']?viewport["\']?[^>]*>', repl, head, count=1)
    return head2 + html[head_end:]


def apply(path, js):
    html = open(path, encoding='utf-8', newline='').read()
    if '</head>' not in html:
        raise SystemExit('</head> が見つかりません: ' + path)
    # 既存ブロックを除去（再実行用）
    html = re.sub(re.escape(START) + r'.*?' + re.escape(END) + r'(\r?\n)?', '', html, flags=re.S)
    html = fix_viewport(html)
    block = START + '\n' + PWA_META + '\n<script>\n' + js.replace('</script>', '<\\/script>') + '\n</script>\n' + END + '\n'
    if '\r\n' in html[:html.find('</head>')]:
        block = block.replace('\n', '\r\n')
    i = html.find('</head>')
    return html[:i] + block + html[i:]


def main():
    js = open(os.path.join(ROOT, 'shared', 'game-base.js'), encoding='utf-8').read().rstrip('\n')
    check = '--check' in sys.argv
    stale = []
    for t in TARGETS:
        p = os.path.join(ROOT, t)
        if not os.path.exists(p):
            print('skip (なし):', t)
            continue
        old = open(p, encoding='utf-8', newline='').read()
        new = apply(p, js)
        if old != new:
            stale.append(t)
            if not check:
                open(p, 'w', encoding='utf-8', newline='').write(new)
                print('更新:', t)
        else:
            print('最新:', t)
    if check and stale:
        print('最新でない作品:', *stale, sep='\n  ')
        sys.exit(1)


if __name__ == '__main__':
    main()
