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
- `npm test`：18 件（同梱 GLB の読み込み、立ち姿と同じ関節なら動かない、サンプルの動き 180 コマで骨の向きが一致、立ち姿に戻せる、壊れた JSON を断る）。
- `npm run shots`：固定 4 視点と、サンプルの動きの指定秒（`--motion`）の画像を `kugutsu/screenshots/<名前>/` に保存。
- `npm run build`：`kugutsu/index.html` と `assets/`、`samples/` に出力。

## ファイルの場所

| ファイル | 中身 |
|---|---|
| `src/motion/clip.ts` | 動きの JSON（dizz-mocap-v1）の読み込み・確認、時刻での関節位置の補間 |
| `src/motion/rig.ts` | GLB の骨格から「リグ」を作る（立ち姿の位置・回転、足りない骨、つま先） |
| `src/motion/retarget.ts` | 関節位置 → 骨の回転（`computePose`）、骨への適用（`applyPose`） |
| `src/motion/demo.ts` | サンプルの動き（機械的なダッシュ／エレベーターをこじ開ける）をプログラムで作る |
| `src/viewer.ts` / `src/main.ts` | 表示と画面 |
| `public/samples/` | 同梱：`spare_body_male.glb`・`spare_body_female.glb`（スペアボディで書き出したもの）、`sample_motion_dash.json`・`sample_motion_pry.json`・`sample_motion_thrust.json` |
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

## サンプルの操作（2026-11-26 更新）

「サンプル」は選択中の体に応じてランダムに動きを読み込む。男性はダッシュ・こじ開け・上からの突き刺し（各6秒、既定でループ）、女性はフラメンコ・サンバ・ヒップホップ（各4秒の一振り、既定で一回再生）。女性サンプルを選ぶとダンスが自動再生される。表示名は「サンプル」。

こじ開けは、0〜0.55秒で胸元に両手を合わせ、0.85〜1.01秒で前方へ差し込み、1.3秒から左右へ開く。

男性サンプルは傀儡用に細身・シルバーへ調整（身長1.88m）。再生成は `_src/` で `node scripts/male-sample.mjs`。隣のスペアボディの生成処理を使い、傀儡の男性GLBだけを更新する。

男性シルバーの環境反射は `src/viewer.ts` でRoomEnvironmentをPMREM化し、金属材質に適用（強度0.85）。環境マップは初回のみ生成して再利用。

背景は「背景」欄から白・黒を選択可能。男性サンプルを読み込むと黒へ切り替わる。どちらも床・奥の縦面・側面にグリッドを表示。

## ゲーム用GLB出力（2026-11-26）

「ゲーム用に書き出す」から、現在の体とモーションを1つのGLBへ保存できる。導入先はThree.jsのWebゲーム。動きの名前、画面の速さ、くり返しの接続、移動あり／その場に対応。元の体や画面の姿勢には触れず、複製した骨格へ各フレームのローカル回転・位置を焼き込む。最終キーはクリップの長さに置き、くり返しなら先頭姿勢、一回再生なら最終姿勢を保持する。

- `src/motion/export.ts`：骨格の複製、アニメーション生成、GLTFExporterでバイナリ出力。
- `tests/export.test.ts`：GLBを再読込し、全フレームの骨と変形後頂点を比較。速度・移動有無・ループ端点・1フレーム・元の姿勢保持・材質も検証。
- `npm run check:export`：実ブラウザでファイル読み込み→保存→独立したThree.jsシーンで再生を確認。成果物は `test-output/browser_export.glb`・`export-ui.png`・`game-import-preview.png`。
- `../integration/three-character.js` と `../integration/README.md`：ゲーム側へコピーする読み込みコードと導入手順。アニメーション計算処理はゲームへ不要。

`scene.userData.kugutsu` に速度・元fps・移動有無・ループ指定を記録。ループの指定自体はglTF標準のアニメーション設定にはないため、ゲーム側のAnimationActionで指定（同梱補助コードが対応）。環境反射やグリッド・照明は出力に含めず、材質と埋め込みテクスチャは維持。

## 柔らかさの読み込みと出力（2026-11-26）

スペアボディが出力する`_SOFTNESS`・`_MAX_OFFSET`・`_DAMPING`に対応。最大変位は柔らかさ適用済みとして扱う。属性なしは従来どおり、属性の不整合は読み込み時にエラー表示する。

- `integration/softness.js`：頂点の骨ウェイトと最大変位から変形の基底を作成。骨に追従する部位の中心の加速度を求め、減衰ばねで遅れを表現。硬い頂点は動かさず、最大変位を超えないよう制限する。係数の積分は最大1/120秒刻み。シーク・立ち姿・切替時はリセットする。
- 画面に「やわらかさを反映」と対応頂点数を表示。再生を止めると残りの揺れが減衰する。
- GLB出力は骨格アニメーションに加えてモーフの重みを記録。繰り返しは2周期の準備計算後に記録し、端点を先頭へ接続する。`scene.userData.kugutsu.softnessBaked`がtrueなら、標準AnimationMixerだけで揺れも再生できる。
- `src/motion/sparse-glb.ts`：モーフPOSITIONのゼロ部分を標準sparseアクセサへ変換。柔らかさの頂点属性・設定は保持する。再読み込み時は既存の基底を再利用し、二重追加しない。
- 男女サンプルを柔らかさ付きへ更新。`node scripts/male-sample.mjs`／`node scripts/male-sample.mjs --female`でスペアボディの現在の出力処理を再利用して生成。
- `tests/softness.test.ts`：静止、回転への応答、頂点ごとの上限、固定部位、減衰、旧形式、リセット、二重追加防止、GLB再生を検証。テストは合計33件。
- `npm run check:export`は実ブラウザで揺れの発生・切替と、別シーンでの焼き込み済み揺れの再生も検証する。

衝突や体積保持を計算する軟体物理エンジンではなく、入力された柔らかさを使ったモーション連動の二次変形。ゲーム内で追加した力への反応は焼き込まれない。

## 指モーション（2026-11-26）

`src/motion/hand.ts`で`hand-mocap-v1`（21点、左右別、手首原点）を検証・補間し、全身の姿勢を当てた後に指を回転する。指だけでの再生・保存も可能。手首の向きは既定で全身を優先し、左右それぞれの開始時間と手首の反映を選べる。JSONのファイル読み込みとドラッグの両方で形式を自動判別する。

指名は`thumb_cmc_l`等、元アプリの関節名に合わせる。手首の`wrist_l`は`hand_l`へ対応（右も同様）。指のない体でもデータを保持し、体の交換後に反映する。指の骨が不足している間は、不完全な保存を避けるためGLB出力を無効にする。

ゲーム用GLBは全身・左右の指・柔らかさを同じクリップへ焼き込む。全身があれば全身の長さ、なければ最長の指クリップの長さ。保存fpsは全身と指の最大値。詳細・骨の親子関係は`../integration/HAND_MOTION.md`。

テストは合計39件。`tests/hand.test.ts`と`npm run check:export`で全身＋指、指だけ、旧体の表示、体交換、時間差、手首、別Three.jsシーンでの再生を確認。`public/samples/sample_hand_left.json`と`sample_hand_right.json`は実際の指モーションの出力処理から生成。スペアボディは別チャットで改修中のため本体や同梱GLBをこの作業で上書きしていない。検証用の指骨付きGLBは`test-output/`内のみ。

2026-11-27：実画面からの指読み込み・保存・別シーン再生、最終ビルドを確認済み。全身＋指・指のみ・画面から保存したGLBの3ファイルをKhronosのglTF Validatorで確認し、いずれもエラー・警告0件。

2026-11-27：`releases/kugutsu.html`を単独HTMLとして出力。既存ビルドのJS・CSSと男女のGLBを内包し、サンプルURLだけを内蔵データへ振り分ける。約5.5MB。`npm run export:html`は入力ハッシュが同じなら再生成しない。`npm run check:html`でfile://直接起動、男女サンプル、指JSON・GLB読み込み、GLB保存を通信0件で検証済み。

ダンスは `src/motion/demo.ts` の `danceClip` で生成。同梱JSONは `sample_motion_flamenco.json`・`sample_motion_samba.json`・`sample_motion_hiphop.json`。
