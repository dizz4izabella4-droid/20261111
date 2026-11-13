
## 25. キャラクター刷新(v27)
- 全キャラ(主人公・四天王・社長・用心棒・赤ちゃん)を約1.3倍(`SC=1.3`)に拡大。画面解像度(160×120)は不変。
- draw.js末尾に新描画ライブラリ: `R/pline`のスケール対応(`SCL/SCX/SCY`)、`withScale(px,F,s,fn)`、`limb/tline/ikElbow`、`PAL`、`drawHead/drawTorso/drawMan`(多色の服・ネクタイ・カフス・ベルト・手袋・メガネ等)。
- 主人公(player.js): `drawMan`で描画。`hands()`は拡大後座標(`hands0()`が旧座標)、`poseAt`のtx/tyにSC倍→バットのリーチも1.3倍。演出ポーズ(drawCut/後ろ姿)は旧絵を`withScale`で拡大。
- 四天王(pres.js `drawFoe0`/`FSTY`): 種類ごとにスーツ/ネクタイ/肌/髪型の配色を持ち`drawMan`で描画。`FOE.rng/ev.r`もSC倍。当たり判定(foeHit/samHit)の幅・高さを拡大。
- 社長/用心棒/赤ちゃん/土下座/後ろ姿は`withScale`ラッパー(`drawPres`→`drawPres0`等)。クリスタル/赤ちゃんのマスク領域も拡大。
- 左レバー位置: `.stick{left:10cqw→4cqw}`(assemble.pyでパッチ)。

## 26. 主人公モデル刷新(v28)
- 参考画像に合わせ、主人公を「ミラーサングラス(銀フレーム)・後ろに流した黒髪・黒のピンストライプスーツ・紺に銀ストライプのネクタイ・白ポケットチーフ・腕時計・日焼け肌」に変更。
- draw.js: `drawHead`に`hs:'swept'`/`shades`、`drawTorso`に`m.pin`(縦ストライプ)/`m.tieStripe`(斜めストライプ)、`drawMan`の腕に`m.watch`を追加。player.jsの`drawFigure`のmオプションで指定。
