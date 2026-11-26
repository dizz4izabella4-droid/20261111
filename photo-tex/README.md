# 写真分析成形（photo-tex）

> **保留（凍結）— 2026-11-26**　写真からの形の推定が実用の精度に届かなかったため、開発を止めています（M2 の途中）。素体（胴・胸のパラメトリックモデル）、GLB 書き出し、目印・カメラ合わせの画面は動作します。経緯と数値は [reports/M2.md](reports/M2.md) の 10 章。

写真の陰影から胴の形を読み取り、素体（青）に肌色のパーツを重ねて GLB に書き出すブラウザアプリ。仕様は [SPEC.md](SPEC.md)、判断の記録は [ASSUMPTIONS.md](ASSUMPTIONS.md)、進み具合の報告は [reports/](reports/)。

- ソース：`_src/`（TypeScript・Vite・three.js）
- 公開用のビルド出力：`index.html`・`assets/`（`npm run build` で作る。手で編集しない）

## 使い方（`_src/` で実行）

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
npm run shots -- --milestone M1 --ui
```

```bash
npm run build
```

- `npm run shots` のオプション：`--project <file>`（既定 `projects/default.json`）、`--preset light|standard|high`、`--ui`（画面全体と拡大図も撮る）、`--built`（本番ビルドで撮る）。
- main に push すると `.github/workflows/build-photo-tex.yml` がテスト・ビルドを行い、出力をコミットします。
