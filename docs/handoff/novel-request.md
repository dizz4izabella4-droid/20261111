# 依頼：ミステリー・サウンドノベルを1本つくる（全スタッフ共通）

依頼ID: NV-001 ／ 依頼元: Nora ／ 2026-11-16

## 依頼

レトロPC風ノベルエンジン（iz2611）で遊ぶ、**ミステリーのサウンドノベルを1本**書いてください。底力を出して、きちんと仕上げてください。

- 読了 **約5分**（本文 2,500〜3,500字が目安）
- **一本道**（ルート分岐なし・エンディング1つ）。**選択肢なし、証拠品なし、謎解きなし**（読者は読むだけ）
- **伏線は1つだけ**（序盤で張って、結末で回収する）
- **どんでん返しを1回**。読み返すと「確かに書いてあった」と分かる作りにする
- 舞台・人物・題名は自由
- 絵は描かなくてよい（背景は仮表示になる）

## 納めるもの（1通のメッセージにまとめる）

1. `config.json`（`gameId` は `nv_<あなたの名前の小文字>`、`title`、`subtitle`）。**作者名を必ず入れる**：`"titleNote": "脚本：<あなたの名前>（<AI名>）"`、`"copyright": "© <あなたの名前> (<AI名>)"`（例：`脚本：Giulia（ChatGPT）`）
2. `scenario.txt`（下の書き方）
3. `characters.json`、`endings.json`（1件）、`backgrounds.json`（`{"ID": {"label": "場所の説明"}}` だけでよい）
4. 最後に、伏線の一行メモ（どこで張って、どこで回収するか）

## scenario.txt の書き方

1行に1つ。`*` はシーン、`@` は命令、`-` は選択肢、それ以外は文章、`#` はメモ。

```
*opening                                   ← シーンの始まり（最初のシーンから始まる）
@status 1994年3月14日 23:10 | 旧校舎前 | 序章
@bg school_night fade=600                  ← 背景（ID は自由。絵がなければ仮表示）
@bgm mystery                               ← BGM
私「……変わってないな」                      ← 名前「せりふ」（名前は characters.json のもの）
[通行人]「こんばんは」                       ← その場かぎりの名前は [ ] で
地の文は、そのまま書く。\nで改行。
@se door                                   ← 効果音
@char yuki [表情] [left/center/right]       ← 立ち絵（仮表示）／ @hide
@effect shake | flash | blackout | fadein 800   ← 画面演出
@info diary                                ← 証拠品を入手（info.json の ID）
@flag solved1                              ← フラグを立てる
@choice q1 | 犯人は誰？                     ← 選択肢（ID | 問いかけ）
- 管理人 -> wrong1 | wrong                  ← 不正解（移動先のシーンでヒントを出し、@jump #q1_label で戻す）
- 弟 -> q1_ok | correct | set solved1        ← 正解
@label q1_label                            ← シーン内の目印（#名前 で飛べる）
@if solved1 && info:diary -> next           ← 条件（フラグ・info:ID・&& || !）
@jump scene_name                           ← 移動
@ending end_true                           ← 結末へ
@end
```

- 使える BGM: `mystery` `tension` `calm` `ending`、環境音 `@env wind`、効果音: `click` `door` `step` `bell` `shock` `piano`
- `info.json`: `{"diary": {"title": "布張りの日記", "text": "本文\n2行目"}}`
- `characters.json`: `{"me": {"name": "私", "color": "#c8ccd8"}}`
- `endings.json`: `[{"id":"end_true","type":"TRUE","name":"結末の名前","scene":"ep_end","text":"結末画面に出す一文"}]`（`scene` の最後に `@ending end_true`）
- 画面は英語表示が基本だが、本文は日本語でよい

書式の質問は不要です。迷ったら自分で決めて、最後に一行で書いてください。

## 受け入れ

Nora は中身（物語の出来）を確認しません。`build.js --check` が通り、起動画面から動けば採用します。書式の間違いだけ Nora が直します。
