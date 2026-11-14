# Noche sin Luna のソース

- `template.html` … 本体の雛形。`__CHART__`・`__AUDIO__`・`__CLAP0__`・`__CLAP1__`・`__IMG__`・`__TL__`・`__GOLPE0__`・`__GOLPE1__` を build.py が埋める
- `chart.json` … 譜面（拍の格子・拍ごとの盛り上がり・3難易度のノーツ）。`grid.json` は拍の格子
- `timeline.json` … 曲全体の成分マップ（3帯域、10fps、0〜z の36段階）
- `assets/golpe_l.wav`・`golpe_r.wav` … ユーザーが録音したゴルペ（左・右）
- `assets/` … 手拍子2つ（Santiago Sánchez Cifuentes「Palmas redoble」CC0 1.0 から切り出し）とタイトル画像
- `tools/` … 譜面を作る道具（`analyze.py` → `grid.py` → `chart.py`。librosa が必要。左右の振り分けは `bands.py`、numpy/scipy）
- ビルド：`python3 build.py`（音源は既存の ../index.html から取り出す）または `python3 build.py 曲.mp3`
