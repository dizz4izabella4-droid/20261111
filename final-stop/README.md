# FINAL STOP

パトカーで逃走車を追跡し、窓が開いたらスワイプで当てて止め、降車命令（英語）で逮捕する単一HTMLのミニゲーム。
設計書：claude.ai の「FINAL STOP 設計書 v2（Opus）」。いまは B0（骨格）。絵は矩形と文字、音はビープ1種。

- `index.html` … 本体。`/*@TESTABLE*/` の区間（CONFIG と CORE）が純ロジック
- `_test/core.test.mjs` … `node final-stop/_test/core.test.mjs`（CORE 単体）
- `_test/shots.py` … `python3 final-stop/_test/shots.py`（Playwright で縦横を撮影し、逃走車の大きさを設計書の表と照合）
- URL: `?debug=1`（状態表示）／`?auto=1`（自動プレイ）／`?seed=N`／`?shot=HIT2&t=0.5`（その場面で止めて撮影）
