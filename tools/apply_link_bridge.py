#!/usr/bin/env python3
"""連携部品 (link/link-bridge.js) を、連携するアプリの HTML へ埋め込む。何度実行しても同じ結果になる。

  python3 tools/apply_link_bridge.py          # 埋め込み（更新）
  python3 tools/apply_link_bridge.py --check  # 最新でないファイルがあれば一覧して終了コード1

埋め込み位置は、HTML 内の <!--IZ-LINK-BRIDGE:START--> と <!--IZ-LINK-BRIDGE:END--> の間。
共通ゲーム基盤のブロックがあればその手前、無ければ </head> の直前に入れる。
連携するアプリ（保管庫・レッドライン・端末）を増やすときは TARGETS に足す。
"""
import os, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SRC = os.path.join(ROOT, 'link', 'link-bridge.js')
START = '<!--IZ-LINK-BRIDGE:START-->'
END = '<!--IZ-LINK-BRIDGE:END-->'
GAME_BASE_START = '<!--IZ-GAME-BASE:START-->'
TARGETS = [
    'link/index.html',
    'shoko/index.html',
]


def block():
    with open(SRC, encoding='utf-8') as f:
        js = f.read().rstrip('\n')
    return START + '<script id="izlink-bridge">\n' + js + '\n</script>' + END


def apply(html, blk):
    # 既存ブロックを外してから入れ直す（何度実行しても同じ結果）
    s = html.find(START)
    if s >= 0:
        e = html.find(END, s)
        if e < 0:
            raise ValueError('END marker missing')
        tail = html[e + len(END):]
        if tail.startswith('\n'):
            tail = tail[1:]
        html = html[:s] + tail
    # 共通ゲーム基盤（apply_game_base.py）のブロックは常に </head> の直前に置かれるので、その手前に入れる
    i = html.find(GAME_BASE_START)
    if i < 0:
        i = html.find('</head>')
    if i < 0:
        raise ValueError('</head> not found')
    return html[:i] + blk + '\n' + html[i:]


def main():
    check = '--check' in sys.argv
    blk = block()
    stale = []
    for rel in TARGETS:
        p = os.path.join(ROOT, rel)
        with open(p, encoding='utf-8') as f:
            html = f.read()
        new = apply(html, blk)
        if new != html:
            stale.append(rel)
            if not check:
                with open(p, 'w', encoding='utf-8') as f:
                    f.write(new)
    if check:
        for rel in stale:
            print('stale:', rel)
        sys.exit(1 if stale else 0)
    for rel in stale:
        print('updated:', rel)


if __name__ == '__main__':
    main()
