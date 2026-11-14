# PC98 NOVEL ENGINE

ブラウザで動く、PC-98ふうのノベルゲームエンジン。**シナリオデータと素材を入れ替えるだけで、新しい作品を作れる**ことを目標にした土台。
同梱の「零時の記録」は、全機能を通るための動作確認用サンプル（5〜10分、エンディング5種）。

- 公開ページ: https://dizz4izabella4-droid.github.io/20261111/pc98-novel/
- 1枚の `index.html` だけで動く（外部サーバー・外部読み込みなし）。GitHub Pages でも、ファイルを直接開いても動く。

## 起動方法

`pc98-novel/index.html` をブラウザで開く。データを直したら、ビルドし直す（Node.js だけあればよい）。

```
node pc98-novel/_engine/build.js            # サンプルをビルド（pc98-novel/index.html を作り直す）
node pc98-novel/_engine/build.js --check    # 検証だけ
```

ビルドは、データの誤り（JSON の書き損じ、存在しない移動先・エンディング・命令など）を見つけると、場所を示して止まる。
同じ検証はブラウザの起動時にも行い、誤りがあれば画面に一覧を出す（黙って止まらない）。

## ファイル構成

```
pc98-novel/
├── index.html            公開される本体（build.js が作る。直接は直さない）
├── data/                 ★作品のデータ（ここを書き換える）
│   ├── config.json       作品ID・題名・版・文章表示の初期値・フラグの初期値
│   ├── scenario.txt      シナリオ（簡易テキスト記法）。これが正
│   ├── scenario.json     scenario.txt から自動で作られる JSON（手では直さない）
│   ├── characters.json   登場人物（名前・色・仮の立ち絵の色）
│   ├── endings.json      エンディング（種類・名前・条件）
│   ├── backgrounds.json  背景（画像がないときの仮の絵）
│   ├── info.json         入手情報（題と本文）
│   └── audio.json        BGM・環境音・効果音（合成音の指定）
├── assets/               ★素材（置くだけで差し替わる）
│   ├── background/ character/ cg/ bgm/ se/ fonts/
└── _engine/              エンジン本体（作品に依存しない）
    ├── build.js          検証して1枚にまとめる
    ├── template.html     HTML のひな形
    ├── css/              base / pc98-theme / dialogue / menu / effects
    ├── js/               下の表
    └── tools/scn-parse.js  簡易テキスト記法 → JSON
```

| js/ | 役割 |
|---|---|
| core | 共通の道具・ログ |
| scenario | データの正規化と検証（ブラウザと build.js の両方で使う） |
| state | 進行状態（セーブされるもの）・セーブデータの検証と版の移行 |
| branching | 条件の判定、STORY難易度の補完、シーン到達条件 |
| text-display | 文章表示（TYPEWRITER / INSTANT / FADE / LINE / CUSTOM） |
| renderer | 画面の拡大縮小、背景・立ち絵（仮表示）、選択肢、お知らせ |
| effects | 画面演出 |
| audio | BGM・環境音・効果音（Web Audio。音源がなければ合成音） |
| save | IndexedDB へのセーブ、エクスポート・インポート |
| screens | 画面の管理と TITLE / MENU / SAVE / LOAD / CONFIG |
| backlog / information / ending | それぞれの記録と画面 |
| engine | 命令の実行 |
| dev | 開発者モード |
| input | マウス・キーボード・タッチ |
| main | 起動 |

## 新しい作品の作り方

1. リポジトリ直下に作品フォルダを作る（例 `shin-saku/`）。`pc98-novel/data/` と `pc98-novel/assets/` をそこへコピーする。
2. `data/config.json` の **`gameId` を必ず変える**（半角英数字と `_` `-`）。セーブは gameId ごとに別の保存領域になるので、作品どうしで混ざらない。
3. `data/scenario.txt` などを書き換える。
4. `node pc98-novel/_engine/build.js shin-saku` → `shin-saku/index.html` ができる。
5. おもちゃ箱に載せるときは、`tools/apply_game_base.py` の `TARGETS` に `shin-saku/index.html` を足し、トップの `APPS` に1件足す。

エンジン（`_engine/`）は全作品で共通。エンジンを直したら、各作品をビルドし直す。

## シナリオの書き方（scenario.txt）

1行に1つ。`*` はシーン、`@` は命令、`-` は選択肢、それ以外は文章。`#` で始まる行はメモ。

```
*opening                                   ← シーンの始まり（最初のシーンから始まる）
@status 1994年3月14日 23:10 | 旧校舎前 | 序章   ← 上の情報欄（日時 | 場所 | 章）
@bg school_night fade=600                  ← 背景
@bgm mystery
三月の夜風は、まだ冬の匂いがした。            ← 地の文
私「……変わってないな」                      ← 名前「せりふ」（名前は characters.json にあるもの）
[通行人]「こんばんは」                       ← その場かぎりの名前は [ ] で
一行目\n二行目                              ← \n で改行
@choice first | どうする？                  ← 選択肢（ID | 問いかけ。どちらも省略可）
- 校舎の中へ入る -> classroom
- 周囲を調べる -> around | set looked_around
- 音楽室を見上げる -> secret | if ending:end_true
```

### 命令一覧

| 書き方 | JSON の type | 働き |
|---|---|---|
| （文章の行） | TEXT | 文章表示 |
| `@status 日時 \| 場所 \| 章`（`-` は変えない、`@status clear`） | STATUS | 上部の情報欄 |
| `@bg 背景ID [fade=ミリ秒]`（`@bg none`） | BG | 背景変更 |
| `@char キャラID [表情] [left/center/right]` | CHARACTER | キャラクター表示・表情変更 |
| `@hide [キャラID]`（省略で全員） | HIDE_CHARACTER | キャラクター非表示 |
| `@bgm ID [fade=ミリ秒]`、`@bgm stop` | BGM | BGM 再生・切り替え・停止 |
| `@env ID`、`@env stop` | BGM（channel:env） | 環境音 |
| `@se ID` | SE | 効果音 |
| `@choice [ID] [\| 問いかけ]` と `- 項目` | CHOICE | 選択肢 |
| `@flag a b=2 c+=1 d=false` | FLAG | フラグ設定（`a` だけなら true、`+=` で加算） |
| `@if 条件 -> 移動先 [else 移動先]` | IF | 条件分岐（移動） |
| `@if 条件` … `@else` … `@endif` | IF・LABEL・JUMP | 条件分岐（かこみ。入れ子可） |
| `@jump 移動先` | JUMP | シーン移動 |
| `@call 移動先`、`@return` | CALL / RETURN | 別のシーンを挟んで戻る |
| `@label 名前` | LABEL | シーンの中の目印（`#名前` で飛べる） |
| `@wait ミリ秒` | WAIT | 演出待機（クリックで飛ばせる） |
| `@info 情報ID [silent]` | INFO | 情報取得 |
| `@effect 名前 [ミリ秒] [on/off] [nowait]` | EFFECT | 画面演出 |
| `@fx glitch`、`@fx garble` | TEXT の fx | 次の文章1つを、グリッチ／文字化け風に出す |
| `@style 方式 [speed= punct= line= fade= linems=]`、`@style reset` | TEXT_STYLE | 文章表示方式を一時的に変える |
| `@require 条件 [-> 補完シーン] [\| grant 情報ID…] [\| set フラグ…]` | REQUIRE | 条件未達なら補う（下記） |
| `@ending [エンディングID]` | ENDING | エンディング到達（ID 省略で自動判定） |
| `@end` | END | シナリオ終了（タイトルへ） |
| `@raw {…JSON…}` | 任意 | JSON をそのまま書く |

**移動先**は `シーン名`、`シーン名#ラベル`、`#ラベル`（同じシーン内）。

**選択肢の項目**: `- 文 -> 移動先 | 指定 | 指定…`（`-> 移動先` を省くと、次の行へ進む）

| 指定 | 働き |
|---|---|
| `set a b=2`／`add trust=1` | 選んだらフラグを設定／加算 |
| `info 情報ID` | 選んだら情報を入手 |
| `if 条件` | 条件を満たすときだけ出す |
| `once` | 一度選んだら消える |
| `id 名前` | 条件 `chose:選択肢ID.名前` で参照できる |
| `correct`／`wrong` | 正解・不正解の印（選択履歴に残る。判定に使うかは作者しだい） |

**演出**（`@effect`）: `fadein` `fadeout` `blackout` `flash` `shake` `noise` `invert` `garble` `glitch`。
`blackout` `noise` `invert` は `on`／`off` で出しっぱなしにできる（セーブにも残る）。

**表示方式**（`@style`）: `typewriter` `instant` `fade` `line` `custom`。
`speed`=1字あたり、`punct`=句読点の待ち、`line`=改行の間隔、`fade`=フェード時間、`linems`=行ごとの間隔（すべてミリ秒）。

### 条件の書き方

```
found_key                     フラグが立っている
!found_key                    立っていない
trust >= 2                    数の比較（== != > >= < <=）
info:diary                    情報を持っている
ending:end_true               そのエンディングを見たことがある（周回要素）
chose:first.2                 選択肢 first で2番目を選んだ（.名前 でも可）
a && (b || !c)                組み合わせ
```

JSON で書くときは `"found_key"` `"!found_key"` `"info:diary"` `{"flag":"trust","op":">=","value":2}` `{"all":[…]}` `{"any":[…]}` `{"not":…}`。

### STORY難易度（進行不能にしない）のための仕組み

- **補完** `@require info:clipping -> hosoku | grant rumor` … 必要な情報がなければ、補完シーン `hosoku` を挟み（`@return` で戻る）、情報 `rumor` を渡す。
- **代わりの道** `*secret | require ending:end_true | fallback classroom` … 条件を満たさずに来たら `classroom` へ回す。
- **誤答のあとの追加会話** … 選択肢の移動先をラベルにして会話を書き、`@jump #選択肢の前のラベル` で戻す（項目に `once` を付けると、選んだものは消える）。
- 出せる項目が1つもない選択肢は、止まらずに次へ進む。

### JSON で書く場合

`scenario.txt` を置かなければ、`data/scenario.json` をそのまま読む。

```json
{ "start": "scene_001",
  "scenes": { "scene_001": { "commands": [
    { "type": "BG", "value": "school_night" },
    { "type": "TEXT", "speaker": "me", "text": "時計の針は、午前零時を指していた。" },
    { "type": "CHOICE", "options": [
      { "text": "校舎の中へ入る", "next": "scene_002", "setFlag": { "entered_school": true } },
      { "text": "周囲を調べる", "next": "scene_003" } ] } ] } } }
```

## エンディング（endings.json）

```json
{ "id": "end_true", "type": "TRUE", "name": "零時の約束",
  "cond": { "all": ["apologized", "info:clipping", { "flag": "trust", "op": ">=", "value": 2 }] },
  "scene": "ep_true", "text": "結末の画面に出す一文" }
```

- `type` は `NORMAL` `BAD` `GOOD` `TRUE` `SECRET`。数は自由。
- `@ending`（ID なし）に着くと、**上から順に** `cond` を調べ、最初に満たしたものになる。`cond` のないものは、どれにも当たらないときの受け皿。
- `scene` があれば、結末ごとのシーンを挟む（そのシーンの最後に `@ending` を書く）。
- `"auto": false` は自動判定に入れない（`@ending end_secret` と名指ししたときだけ）。`"hint"` は一覧のロック中に出す手がかり。
- 到達すると ID・名前・到達日時・回数を記録し、ENDING LIST に出る。未到達はロック表示。

## 素材の差し替え

**決まった名前でファイルを置いて、ビルドし直すだけ**（JSON は直さなくてよい）。ファイルがなければ、図形の仮表示・合成音になる。読み込みに失敗しても止まらない。

| 素材 | 置き場所と名前 |
|---|---|
| 背景 | `assets/background/<背景ID>.png`（jpg / webp / gif も可。640×400 の比率） |
| 立ち絵 | `assets/character/<キャラID>_<表情>.png`（`<キャラID>.png` は normal） |
| BGM・環境音 | `assets/bgm/<ID>.mp3`（ogg / m4a / wav も可） |
| 効果音 | `assets/se/<ID>.mp3` |

仮の背景は `backgrounds.json` の `draw` に、図形（`rect` `poly` `circle` `line` `text`、色 `color`、2色の網かけ `dither`＋`mix`、縦の濃淡 `grad`、くり返し `repeat`）で書く。
合成音は `audio.json` の `synth` で選ぶ（BGM: `mystery` `tension` `calm` `ending`／環境音: `wind` `rain` `hum`／効果音: `click` `select` `cancel` `get` `save` `bell` `step` `door` `shock` `noise` `piano`）。
音は Web Audio だけで鳴らすので、スマホのマナーモードでは鳴らない。

## 操作

| 操作 | 動作 |
|---|---|
| 左クリック・タップ | 文章送り（表示途中なら全文を出す）・決定 |
| 右クリック | メニュー／キャンセル |
| Enter・Space | 決定・文章送り |
| ↑↓ | 選択肢・項目の移動（←→ で設定値の変更） |
| Esc | メニュー・キャンセル |
| Ctrl（押している間） | スキップ |
| Tab | 情報画面 |
| PageUp・ホイール上 | バックログ |
| 本文欄の下のボタン | AUTO / SKIP / LOG / INFO / Q.SAVE / Q.LOAD / MENU |

横画面は 640×400、縦持ちは絵を上・本文欄を下に広げる（比率は崩さない）。全画面・向きの選択は、おもちゃ箱共通の ⛶ ボタン。

## セーブ

IndexedDB に保存する（データベース名 `pc98novel__<gameId>`）。通常20・クイック1・オート1。
オートセーブは、シーンの最初の文章と、選択肢が出たときに行う。SAVE / LOAD 画面の EXPORT / IMPORT で、JSON の書き出し・取り込みができる（形式・作品ID・版・シーンの有無を検証し、上書き前に確認する）。
IndexedDB が使えない環境では localStorage、それも使えなければメモリに保存する（その旨を画面に出す）。

シナリオを直して公開し直すときは、`config.json` の `version` を上げる。セーブデータの形そのものを変えたときは、`js/00-core.js` の `SAVE_VERSION` を上げ、`js/20-state.js` の `MIGRATE` に直し方を足す。

## 開発者モード

CONFIG の「開発者モード」を ON にすると、DEV ボタンが出る。
シーン一覧と移動 / フラグと情報の変更 / 選択肢の強制実行（隠れている項目も） / エンディング条件の今の真偽と強制到達 / ログ・エラー。画面左上に、今のシーンと命令の番号が出る。

## 命令を足すには

`js/80-engine.js` の `E.init` に `E.register('名前', function (cmd) { … })` を足し、`js/10-scenario.js` の `COMMANDS` に名前を足す。
戻り値は、なし＝次へ／Promise＝終わるまで待つ／`{jump:"移動先"}`／`'stop'`。画面は `PN.screens.define`、演出は `PN.fx.register` で足せる。
