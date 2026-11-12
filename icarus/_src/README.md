# イカロス のソース（開発用。遊ぶのは ../index.html）

- `src/*.js` を番号順に連結し、three.js r160 (`three.min.js`) と一緒に `src/template.html` へ埋め込んで1ファイルにする。
- ビルド: `npm i three@0.160.1` のあと `python3 build.py ../index.html`（アーティファクト用の断片は `FRAG=1 python3 build.py out.html`）。
- three.js は `node_modules/three/build/three.min.js` を読む（リポジトリには含めない）。
