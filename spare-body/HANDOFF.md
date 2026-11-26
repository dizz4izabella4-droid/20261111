# スペアボディ — 引き継ぎメモ（別チャットで再開するときに最初に読む）

最終更新：2026-11-26

## これは何か

スライダーで全身の素体（マネキンのような体）を形づくり、
- **体の設定**（`*.spare.json`）として保存・再読み込みし、
- **骨格つきの体**（`*.glb`）として書き出す

ブラウザアプリ。書き出した GLB は、姉妹アプリ **傀儡（`kugutsu/`）** で読み込んで動かす。

由来：写真分析成形（`photo-tex/`、凍結）の胴・胸のモデル → 動く素体（`body-motion/`、分離前の元）→ 形づくりの部分がここ。

## 起動とテスト（`spare-body/_src/` で）

Node.js は `~/.local/node`（公式 v24、システムには入れていない）。

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
npm run shots -- --milestone S1 --ui
```

```bash
npm run build
```

- `npm run dev` は Vite（`.claude/launch.json` に `spare-body`、ポート 5181 の設定あり。Claude のブラウザ欄で開ける）。
- `npm test`：34 件（体の閉じた形・寸法・周径・左右対称・スキンの重み・骨格つき GLB の読み直し）。
- `npm run shots`：固定 4 視点の画像を `spare-body/screenshots/<名前>/` に保存（Playwright＋ヘッドレス Chromium。`--skeleton` で骨格表示、`--project <file>` で体の設定を読み込む）。
- `npm run build`：`spare-body/index.html` と `assets/` に出力（サイトの GitHub Pages で `/20261111/spare-body/` になる）。

## ファイルの場所

| ファイル | 中身 |
|---|---|
| `src/model/params.ts` | パラメータ一覧（大項目→中項目→小項目、49 項目）、体型プリセット（女性・男性） |
| `src/model/torso.ts` | 胴（股〜首の付け根）：超楕円の断面を高さ方向になめらかに補間。肩の切断面、脇の広がり |
| `src/model/breast.ts` | 胸：胴の表面に足すドーム（放射方向に押し出す＝面が折り返さない） |
| `src/model/mesh.ts` | 胴のメッシュ（胸・乳頭に頂点を集める格子）、`BodyModel` |
| `src/model/parts.ts` | 腕・脚の筒（両端が丸い）、箱（頭・手・足） |
| `src/model/body.ts` | 全身の組み立て、骨格 19 本、スキンの重み |
| `src/export/glb.ts` | GLB 書き出し（`writeSkinnedGlb` = 骨格つき） |
| `src/export/exportBody.ts` | 傀儡用の GLB |
| `src/main.ts` / `src/ui/panel.ts` | 画面（スライダーの木、保存・開く・書き出し、ドラッグで開く） |
| `tests/body.test.ts` | テスト |

## 座標と骨格

- メートル、+Y 上、+Z 体の前、+X 体の左、床 y = 0（両足の中央が原点）。
- 骨（親子）：`hips` ─ `spine` ─ `chest` ─ `neck` ─ `head`、`chest` ─ `upperarm_l` ─ `forearm_l` ─ `hand_l`（_r も）、`hips` ─ `thigh_l` ─ `shin_l` ─ `foot_l` ─ `toe_l`（_r も。toe は頂点のない端）。
- 立ち姿（バインドポーズ）ではすべての骨の回転なし。脚はまっすぐ、腕は「腕の開き」の角度だけ横に開く。
- 部位はそれぞれ 1 本の骨に固定（胴だけ 腰→背骨→胸 になめらかに分ける）。関節は部位の重なり（マネキン状）。

## ファイル形式

**体の設定**（`*.spare.json`）
```json
{ "format": "spare-body-settings-v1", "name": "spare_body", "preset": "standard", "bodyPreset": "male", "params": { "torsoHeight": 0.67, "...": 0 } }
```
値は内部単位（長さ m、角度 °、指数 0〜100）。キーは `src/model/params.ts` の `GROUPS`。

**体の GLB**（傀儡が読む）：glTF 2.0、スキンメッシュ 1 つ、上の骨 19 本（ノード名＝骨の名前）、立ち姿で回転なし、逆バインド行列は平行移動のみ。シーンの `extras` に `format: "spare-body-glb-v1"`・`heightMeters`・`params`。Blender 5.3 で骨格・頂点グループつきで読み込めることを確認済み。

## わかっている問題・次の候補

- 関節は部位の重なりなので、大きく曲げると継ぎ目が見える。なめらかにつなぐ（肩・股・肘・ひざのブレンド）のが次の大きな改善。
- 顔・手・足は仮の箱（ユーザーの指示で保留中）。指を付けるなら手の骨も増やす（指モーション `hand-motion/` と合わせる）。
- 女性の胴・胸は photo-tex で調整した値。手足・頭はそれに合わせて縮めた（身長約 153cm）。男性はゴツい体型（約 188cm）。
- 作品一覧（`data/works.json`）には未登録、push もまだ（2026-11-26 時点で main 未反映。作業はブランチ `photo-tex`）。

## ユーザーの好み・進め方（引き継ぎ）

- 画面と説明は日本語。スライダーは大項目→中項目→小項目に分ける。
- 数値はスライダーで本人が調整する。初期値は仮の値でよい。
- AI のやりとりを減らすため、Mac の計算力を使う（まとめて流して表で比べる、並列で回す）。
- push・公開は毎回本人に確認してから。
- 変えた理由は `ASSUMPTIONS.md` に 1 行ずつ残す。
