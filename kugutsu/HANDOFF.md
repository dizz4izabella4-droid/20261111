# 傀儡（くぐつ）— 引き継ぎメモ（別チャットで再開するときに最初に読む）

最終更新：2026-11-26

## これは何か

**スペアボディ（`spare-body/`）で作った骨格つきの体（GLB）** を読み込み、**作品「モーション」（`motion/`）で撮った動き（JSON）** を付けて動かすブラウザアプリ。
再生・一時停止・1コマ送り・再生位置・速さ・くり返し・立ち姿に戻す。体も動きも、ボタンかドラッグで開ける。

体はファイルで受け取るので、スペアボディのコードは持たない（骨の名前が同じなら、ほかの GLB でも動く）。

## 起動とテスト（`kugutsu/_src/` で）

Node.js は `~/.local/node`（公式 v24）。

```bash
export PATH=~/.local/node/bin:$PATH
```

```bash
npm ci
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run shots -- --milestone K1 --ui --motion 0.75,5.2
```

```bash
npm run build
```

- `npm run dev`：`.claude/launch.json` に `kugutsu`（ポート 5182）の設定あり。
- `npm test`：7 件（同梱 GLB の読み込み、立ち姿と同じ関節なら動かない、サンプルの動き 180 コマで骨の向きが一致、立ち姿に戻せる、壊れた JSON を断る）。
- `npm run shots`：固定 4 視点と、サンプルの動きの指定秒（`--motion`）の画像を `kugutsu/screenshots/<名前>/` に保存。
- `npm run build`：`kugutsu/index.html` と `assets/`、`samples/` に出力。

## ファイルの場所

| ファイル | 中身 |
|---|---|
| `src/motion/clip.ts` | 動きの JSON（dizz-mocap-v1）の読み込み・確認、時刻での関節位置の補間 |
| `src/motion/rig.ts` | GLB の骨格から「リグ」を作る（立ち姿の位置・回転、足りない骨、つま先） |
| `src/motion/retarget.ts` | 関節位置 → 骨の回転（`computePose`）、骨への適用（`applyPose`） |
| `src/motion/demo.ts` | サンプルの動き（歩く→右手を振る）をプログラムで作る |
| `src/viewer.ts` / `src/main.ts` | 表示と画面 |
| `public/samples/` | 同梱：`spare_body_male.glb`・`spare_body_female.glb`（スペアボディで書き出したもの）、`sample_motion_walk_wave.json` |
| `tests/motion.test.ts` | テスト |

同梱の GLB を作り直すとき：スペアボディ側で体を書き出して `public/samples/` に置き換える（男性・女性の初期値から作った）。

## ファイル形式

**動き**（「モーション」の「JSONを保存」、`motion.json`）
```json
{ "format": "dizz-mocap-v1", "fps": 30, "joints": ["nose", "...33個"], "frames": [[x,y,z, ... 99個], "..."], "root": [[x,y,z], "..."], "bones": ["..."], "boneDirs": ["..."], "hip": ["..."] }
```
- 関節は MediaPipe Pose の 33 点（`src/motion/clip.ts` の `JOINT_NAMES`）。three.js と同じ向き（+Y 上、人は +Z を向く、`l_` は本人の左＝+X）、メートル。
- 傀儡が使うのは `fps`・`frames`・`root`（任意）。`bones`・`boneDirs`・`hip` は使っていない（関節位置の方が情報が多いため）。

**体**（スペアボディの GLB）：スキンメッシュ 1 つ、骨の名前 `hips, spine, chest, neck, head, upperarm_l, forearm_l, hand_l, thigh_l, shin_l, foot_l, toe_l`（_r も）。読み込んだときの姿勢を立ち姿とする。詳しくは `spare-body/HANDOFF.md`。

## 動きの当て方（要点）

- 立ち姿からの回転をワールド空間で求め、最終の回転 = その回転 × 立ち姿の回転。
- 腰：左右の腰の線＋背骨（腰の中点→肩の中点）。胸：左右の肩の線＋背骨。背骨は腰と胸の中間。頭：耳の線＋胸の上方向。首は胸と頭の中間。腰・胸は体の立ち姿の線を基準（立ち姿と同じ姿勢＝回転なし）。
- 腕・脚・手・足：親の骨に対していちばん小さい回転で、骨の向きを関節の向きに合わせる。
- 移動：`root` があれば、腰を最初のフレームからの差だけ動かす。

## わかっている問題・次の候補

- **実際に「モーション」で撮った JSON ではまだ試していない**（サンプルの動きのみ）。最初にやること。
- 腕・脚のねじれ、頭のうなずき（ピッチ）は反映しない（関節位置からは決まらない／顔の点を使えば頭は改善できる）。
- 足が床に沈む・浮くことがある（足の接地の補正なし）。撮影した人と体の脚の長さの違いも補正していない。
- 指（作品「指モーション」`hand-motion/`）の組み込み。
- 動きつきの GLB の書き出し（ゲーム用）。
- 体側（スペアボディ）の関節は部位の重なりなので、大きく曲げると継ぎ目が見える。
- 作品一覧には未登録、push もまだ（2026-11-26 時点。作業はブランチ `photo-tex`）。

## ユーザーの好み・進め方（引き継ぎ）

- 画面と説明は日本語。実験用のサンプルは男性素体。
- Mac の計算力を使ってAIのやりとりを減らす（まとめて流して表で比べる）。
- push・公開は毎回本人に確認してから。
- 変えた理由は `ASSUMPTIONS.md` に 1 行ずつ残す。
