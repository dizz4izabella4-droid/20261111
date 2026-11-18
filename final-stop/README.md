# FINAL STOP

パトカーで逃走車を追跡し、窓が開いたらスワイプで当てて止め、降車命令（英語）で逮捕する単一HTMLのミニゲーム。
設計書：claude.ai の「FINAL STOP 設計書 v2（Opus）」。設計の B0〜B5 まで実装済み（v1.0 テスト版）。実機（iPhone）での確認待ち。

- B1 絵：夜の道路・街灯・遠景、車の後ろ姿（逃走車とパトカーで共通の描画関数）、窓の輪と矢印
- B2 音：Web Audio の合成音（エンジン、サイレン3種、衝突、無線、ドア、手錠）。マナーモードではiOSの標準の動きで鳴らない
- B3 衝突：ヒットストップ、画面の揺れ、火花、白フラッシュ、3回目はスローと周辺減光、停止時の砂煙
- B4 イベント：照射ライト、ハザード、ドア、容疑者のポーズ（車内→降車→伏せ）、警官、手錠のきらめき、ARREST のゆっくりしたズーム
- B5 仕上げ：END 画面の配置、テスト一式、ドキュメント

- `index.html` … 本体。`/*@TESTABLE*/` の区間（CONFIG と CORE）が純ロジック
- `_test/core.test.mjs` … `node final-stop/_test/core.test.mjs`（CORE 単体）
- `_test/shots.py` … `python3 final-stop/_test/shots.py`（Playwright で縦横を撮影し、逃走車の大きさを設計書の表と照合）
- URL: `?debug=1`（状態表示）／`?auto=1`（自動プレイ）／`?seed=N`／`?shot=HIT2&t=0.5`（その場面で止めて撮影）

- 音声入力：タイトルの MIC ON/OFF（初期はOFF）。SAY IT! の間だけ SpeechRecognition（en-US）で聞き、命令の重要語の6割以上が合えば NICE! で先へ進む。合わなくても待ち時間（4.5秒）の後は進む。非対応・拒否のときは MIC N/A で従来どおり。判定は CORE の MATCH（純ロジック）。`python3 final-stop/_test/mic.py` で擬似の聞き取りを差し込んで3経路を確認
