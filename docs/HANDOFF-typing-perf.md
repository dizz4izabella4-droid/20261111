# 引き継ぎ書: CMD Typing（PC版・モバイル版）プレイ中の重さの修正

作成日: 2026-11-14 / 対象: `typing-pc/index.html`, `typing-mobile/index.html`
状態: **修正済み（2026-11-14）。** 下書きパッチ（変数を変わったときだけ書く）だけでは効果が足りず（約60ms→約58ms）、下記を追加して約20〜27msになった。
- 変数の書き込みを約80ms間隔に間引き（`beatFrame` / `lightFrame`）
- `.neon` のグローを 5段/90px → 3段/24px、`.desk` の影を 70/40px → 30/16px に縮小
- 見た目はグローがやや控えめになり、脈動が少し段階的になる。実機で確認してほしい。
- `docs/perf-fix-draft.patch` は途中経過として残してある（単独では不十分）。

## 1. 症状
プレイ中（`state==='play'`）に重くなり、ゲームにならない。

## 2. 結論（原因）
**効果音の追加（コミット 867a820）が原因ではない。** 追加前の版（76eea4f）でも同じ重さを再現した。

原因は、光の演出が **毎フレーム `:root` の CSS 変数を書き換えている** こと。
書き換えのたびに、その変数を参照する大きなぼかし付き `box-shadow` が全部再描画される。

| 場所 | 内容 |
|---|---|
| `beatFrame()` | `document.documentElement.style.setProperty('--beat', …)` を毎フレーム実行 |
| `lightFrame()` | `--ncA --coreA --ncB --coreB --brA --brB` の6変数を毎フレーム実行 |
| `.desk`（78〜79行目付近） | `inset 0 0 70px` ＋ 上下 `40px` ぼかしの外光。色と強さが `--ncA/--ncB/--brA/--brB/--beat` に依存 |
| `.crt .neon.top/.bot`（68〜70行目付近） | `0 0 90px` までの5段グロー ＋ `filter:brightness(var(--brA)+var(--beat)…)` |
| `.area .win`（63行目付近） | `box-shadow` の枠色が `--beat` に依存 |

JavaScript自体は軽い（各 `requestAnimationFrame` コールバックは1ms未満）。重いのは描画側。

## 3. 計測結果
ヘッドレスChrome（ソフトウェア描画）でプレイ中の1フレーム平均。絶対値は実機と違うが、比較は有効。
場所は `index.html` 内のCSS。

| 条件 | 平均フレーム時間 |
|---|---|
| そのまま | 約52〜65ms |
| アニメーション全停止 | 変わらず（約78ms） |
| ノイズcanvas非表示 | 変わらず |
| 波形・モニターcanvas非表示 | 変わらず |
| `.desk::before/::after` 非表示 | 変わらず |
| `text-shadow` 全無効 | 悪化せず（約64ms） |
| `filter` 全無効 | 約38〜52ms（効果は小さい） |
| **`box-shadow` 全無効** | **約17ms（原因）** |
| `.desk` の影だけ無効 | 約37ms |
| `.desk` と `.neon` の影を無効 | 約18ms |

つまり主犯は **`.desk` と `.neon` の `box-shadow`**。`.area .win` は寄与が小さい。

## 4. 修正案
方針: **CSS変数は「値が変わったときだけ」「粗く丸めて」書く。** 見た目はほぼ変わらず、再描画の回数が大きく減る。

下書きは `docs/perf-fix-draft.patch`（PC・モバイル両方に同じ変更）。要点:

```js
// beatFrame(): 0.05刻みに丸め、変わったときだけ書く
let beat=0, beatAvg=.2, beatQ=-1;
...
if(!RM){ const q=Math.round(beat*20)/20;
  if(q!==beatQ){ beatQ=q; document.documentElement.style.setProperty('--beat',q.toFixed(2)); } }

// lightFrame(): 前回と同じ値なら書かない。明るさは0.05刻み
let lastLight=0; const lightC={};
...
const q=(k,v)=>{ if(lightC[k]!==v){ lightC[k]=v; rs.setProperty(k,v); } };
q('--ncA',j(cA)); q('--coreA',j(lerp3(cA,[255,255,255],.82)));
q('--ncB',j(cB)); q('--coreB',j(lerp3(cB,[255,255,255],.82)));
q('--brA',(Math.round(brA*20)/20).toFixed(2)); q('--brB',(Math.round(brB*20)/20).toFixed(2));
```

### 効果が足りなかった場合の追加策
1. **更新頻度を制限する**: `lightFrame` と `beatFrame` の書き込みを15〜20Hzに間引く。
2. **影を動かさない**: `.desk` の外光と `.neon` のグローを、色固定の別レイヤー（疑似要素など）にして、`opacity` だけ変える。`opacity` はGPU合成だけで済み、再描画されない。これが最も効くが、見た目の確認が必要。
3. **ぼかし半径を下げる**: `.neon` の `90px`、`.desk` の `70px / 40px` を半分程度に。
4. **変数の書き込み先を狭める**: `:root` ではなく `.crt` に書くと、スタイル再計算の範囲が減る。ただし `body` の背景（25行目付近）も `--ncA/--ncB/--brA/--brB` を使うので、その参照を先に確認すること。

## 5. 注意点・確認してほしいこと
- **下書きは動作未検証。** 構文チェック（`node --check`）のみ通った。修正後の計測は実行前に中断された。
- 丸めると光の変化が段階的になる。見た目が気になる場合は刻みを細かくする（`20` → `40`）。
- `over/overres` 状態は `brA=1.4+Math.random()*.3` などを毎フレーム乱数で変えている（意図的なちらつき）。丸めても変化は残るが、明滅の細かさが変わる可能性がある。
- 実機（実GPU・スマホ）では差が小さい、または別の要因が混じる可能性がある。可能なら実機でも確認する。
- iOS Safariの低電力モードなどでは、元々 `requestAnimationFrame` が間引かれる。

## 6. 検証手順（再現用）
1. `typing-pc` を HTTP で配信し、Playwright（Chrome）で開く。
2. 電源 → メニュー → 開始 → 警報 → `state==='play'` まで進める。
3. `requestAnimationFrame` で1フレームの間隔を3秒以上記録し、平均を比較する。
4. 切り分けは、`<style>` を差し込んで `box-shadow:none!important` などを当てて再測定する。
5. 修正後は、平均が 20〜30ms 以下になることを目標にする（今回の環境で、影を全部消した場合は約17ms）。

## 7. 関連する状態
- 直近のコミット 867a820 は効果音の改修で、この問題とは無関係。
- 効果音は PC・モバイルとも10音の読み込みと再生を確認済み。耳での音量確認は未実施。
- モバイルの `index.html` も同じ構造（`--beat` は13行目、`beatFrame` は1592行目付近、`lightFrame` は1617行目付近）。同じ修正が必要。
