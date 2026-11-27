# テクスチャ貼り — 開発者用メモ

更新日: 2026-11-27
公開先: https://dizz4izabella4-droid.github.io/20261111/texture-app/
公開用本体: `texture-app/index.html`
関連設計書: [texture_app_design.md](texture_app_design.md)

## 現在の実装

受領した単体HTMLを公開用本体として配置した。現在の画面とコードで確認できる機能:

- GLB/GLTF、OBJ+MTL、FBX、DAE、STL、PLY、およびZIPからモデルを読み込む。
- 既存UVを使い、UVがないモデルには簡易UVを生成する。通常メッシュは箱型投影、骨格つきメッシュは頭・胴・腕・手・脚・足ごとの円筒投影を使う。
- 画像の全体貼り、3Dビュー上の塗り、レイヤー追加・並べ替え・複製・結合・不透明度調整、消しゴム、左右対称、色塗りを提供する。
- GLB、PNG、UV図PNGの書き出しと、作業データの保存・読込を提供する。

## 実装上の注意

- UVなしモデルの展開は簡易方式。xatlasは組み込まれていない。展開品質、継ぎ目、骨格属性の保持は対象モデルごとに確認する。
- three.js r128、各ローダー／GLTFExporter、JSZipなどをcdnjsから読み込むため、初回表示・関連機能にネット接続が必要。
- 骨格付きGLBのUV展開後のウェイト保持、ポーズ変形、GLB書き出し後の再読込は公開時点で未検証。設計書のM0〜M5は今後の確認・拡張案として扱う。
- このメモは公開HTMLの確認事項を記録する。設計書の「実装前」という記述は作成時点の記録であり、現状のHTMLの状態を示さない。

## 関連物

- `texture-app/index.html`: 公開アプリ本体
- `docs/texture-app/texture_app_design.md`: 技術調査・当初設計（v0.1）
- `docs/texture-app/DEVELOPER_MEMO.md`: このメモ
- `data/works.json`: 実験カテゴリの作品台帳
