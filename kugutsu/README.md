# 傀儡（kugutsu）

スペアボディ（[`../spare-body/`](../spare-body/)）で作った骨格つきの体（`.glb`）を読み込み、作品「モーション」で撮った動き（`.json`）を付けて動かすブラウザアプリ。

引き継ぎ・ファイル形式・起動方法は [HANDOFF.md](HANDOFF.md)、判断の記録は [ASSUMPTIONS.md](ASSUMPTIONS.md)。

体と動きを読み込んだ後、「ゲーム用に書き出す」から骨格・材質・アニメーション入りGLBを保存できます。Three.jsのWebゲームへの導入は [integration/README.md](integration/README.md)、読み込み用コードは [integration/three-character.js](integration/three-character.js)。

スペアボディの柔らかさ付きGLBにも対応。「やわらかさを反映」でモーション連動の揺れを表示し、ゲーム用GLBにも揺れを含めて保存できます。

「指モーション」の左右別JSON（hand-mocap-v1）を全身の動きへ重ね、指まで含めたGLBを保存できます。指付きの体が必要です。詳細は [指モーションの接続](integration/HAND_MOTION.md)。

単独で開けるHTMLは [releases/kugutsu.html](releases/kugutsu.html)。Three.jsと男女サンプルを埋め込んでおり、ネット接続やローカルサーバーは不要です。既存ビルドからの出力は `_src/` で `npm run export:html`、直接起動と保存の検証は `npm run check:html`。ソースを変更した場合は先に `npm run build` を実行します。
