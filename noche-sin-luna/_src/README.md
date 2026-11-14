# Noche sin Luna のソース

- `template.html` … 本体の雛形。`__CHART__`・`__AUDIO__`・`__CLAP0__`・`__CLAP1__`・`__IMG__`・`__TL__`・`__GOLPE0__`・`__GOLPE1__` を build.py が埋める
- `chart.json` … 譜面（拍の格子・拍ごとの盛り上がり・3難易度のノーツ）。`grid.json` は拍の格子
- `timeline.json` … 曲全体の成分マップ（3帯域、10fps、0〜z の36段階）
- `assets/golpe_l.wav`・`golpe_r.wav` … ユーザーが録音したゴルペ（左・右）
- `assets/` … 手拍子2つ（Santiago Sánchez Cifuentes「Palmas redoble」CC0 1.0 から切り出し）とタイトル画像
- `tools/` … 譜面を作る道具（`analyze.py` → `grid.py` → `chart.py`。librosa が必要。左右の振り分けは `bands.py`、numpy/scipy）
- ビルド：`python3 build.py`（2曲の音源は既存の ../index.html から取り出す）または `python3 build.py 曲1.mp3 曲2.mp3`（`-` と書いた曲は既存から取り出す）
- `chart2.json` … 2曲目（Llama pura de amor）の譜面。`songs/llama/` に元資料（拍・小節・ノーツのCSVと仕様書）、`tools/llama_chart.py` で作る

## 曲の足しかた（曲選択画面あり・難易度選択なし）
- 難易度は NORMAL 固定（`LEVEL`）。`chart.json` の easy / hard は使っていない。
- 曲リストは `template.html` の `SONGS`（曲名と再生時間だけを画面に出す。再生時間は音源から自動）。
- 曲ごとに `{id, name, data(譜面), audio(音源のbase64), sections(区間名), buf, dur}` を `SONGS` に持たせる。いまは2曲（`DATA`/`AUDIO_B64` と `DATA2`/`AUDIO2_B64`）。
- 曲を選ぶと `startGame()` が `ensureBuf()`（音源のデコード。曲1は起動時、ほかは裏で）→ `applySong()`（`beats`・`energy`・`SECTIONS`・`musicBuf` を入れ替え）の順に進む。
- 3曲目を足すとき：`chart3.json` と mp3 を用意し、`template.html` に `__CHART3__`・`__AUDIO3__` を足して `SONGS` に1行、`build.py` の置換に1行足す。拍の配列は、小節頭が 3, 7, 11… 番目になるよう頭を揃える（描画が `(i-3)%4` で小節頭を決めている）。
- `TL`（成分マップ）はいまは使っていない（曲1のみ入っている）。
