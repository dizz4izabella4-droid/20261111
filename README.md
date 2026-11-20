# 20261111 ゲーム集

ブラウザで遊べる自作ゲームの置き場所です。トップページで遊ぶ作品を選びます。

公開ページ: https://dizz4izabella4-droid.github.io/20261111/

| 作品 | フォルダ | 端末 |
|---|---|---|
| CMD Typing（タイピング PC版） | `typing-pc/` | PC（キーボード） |
| CMD Typing Mobile（タイピング スマホ版） | `typing-mobile/` | スマホ（フリック入力） |
| 鳥と獣の戦い | `tori-to-kemono/` | スマホ（2人対戦） |
| ワイヤダ（数字で輪を作るパズル。ルール説明つき） | `kumiwake-bou/` | スマホ・PC |
| ガラス割り（GLASS BREAKER） | `glass-breaker/` | スマホ |
| 電卓ドリル（電卓ドリルの自動生成） | `dentaku-drill/` | スマホ・PC |
| 確定申告 聞き流し（音声講座。画面を閉じても流れるプレイヤーつき。実用の部屋） | `kakutei-kikinagashi/` | スマホ・PC |
| 消費税を学ぶ（実用の部屋。自治体職員向け入門講義・6コース46レッスン） | `shohizei-nyumon/` | スマホ・PC |
| 損益通算・繰越控除（実用の部屋。24案件と10講義で学ぶ研修） | `sonneki-tsusan/` | スマホ・PC |
| 農業所得 経費判定ドリル（実用の部屋。帳簿から算入できない経費を見分ける練習） | `nogyo-keihi-drill/` | スマホ・PC |
| 机上の空論CL（脳内交通事故。実験室。test ver.） | `jiko-sim/` | スマホ・PC |
| WHERE WHICH（ひらがなを教える育成アプリ） | `where-which/` | スマホ・PC |
| Noche sin Luna（フラメンコの音ゲー。test ver.） | `noche-sin-luna/` | スマホ・PC |
| PC98 NOVEL（PC-98ふうノベルゲームエンジンの土台。サンプル「零時の記録」つき。test ver.） | `pc98-novel/` | スマホ・PC |
| ファンタジー（ローポリ3Dキャラを2D背景で歩かせた試作の記録。実験室。test ver.） | `fantasy/` | スマホ・PC |

作品を増やすときは、フォルダを作って中に `index.html` を置き、`python3 tools/build_history.py --add-stubs` で `data/works.json`（作品台帳）に仮登録して題名などを直し、`python3 tools/build_history.py` で日付を集計します。詳しくは [docs/site-guide.md](docs/site-guide.md) を見てください。

## 全作品共通の基本設計

全作品に、①iOSのダブルタップ拡大の無効化、②全画面表示の選択、③縦横表示（自動／縦／横）の選択を入れています。本体は `shared/game-base.js`、各作品への埋め込みは `python3 tools/apply_game_base.py`（新作は `TARGETS` に追加）。詳しくは [HANDOFF.md](HANDOFF.md) の26章。

## 部屋どうしの行き来（2026-11-19）
- `shared/roomnav.js`：おもちゃ箱／実験室／実用の部屋に、下の小さなナビ（おもちゃ箱・実験室・実用の部屋・あそびば）と、いちばん下の小さな脳みそ（BRAINトップへ）を出す。
- 実験室・実用の部屋の「おもちゃ箱へもどる」は `../toybox/` へ（以前はBRAINトップだった）。スタッフの戻るリンクも同様。
- 映画館：トップ（BRAIN）の窓は残し、幕を下ろしたまま（COMING SOON・入れない）。`cinema/` のページ自体は残してある。
- 実用の部屋：背景は真っ白＋灰色の線画（うねる線・多角形）がゆっくり動く。文字・カードも明るい配色に。
