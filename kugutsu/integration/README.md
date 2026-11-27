# Three.jsのWebゲームへの導入

「傀儡」で体（GLB）と動き（JSON）を読み込み、「ゲーム用に書き出す」で動きの名前を付け、「体＋モーションを保存（GLB）」を押します。現在のサンプルも保存できます。

出力はメッシュ・骨格・スキンの重み・材質・1本のアニメーションを含むGLBです。テクスチャがある場合もGLB内に埋め込みます。元のJSONや傀儡の動きの計算処理をゲームへ持ち込む必要はありません。

- 画面の「速さ」をキーの時刻に反映します。2倍で保存した場合、ゲーム側は通常速度で再生します。
- 「移動を含める」を外すと腰の移動を固定します。ゲームの操作や物理処理で移動させる場合はこちらを使えます。
- 「くり返す」が有効なら最後に先頭の姿勢へつなぐキーを入れます。移動ありの場合、腰の位置も先頭へ戻ります。一回再生の場合は最後の姿勢を保持します。
- ループ指定はglTF標準の再生設定ではないため、ゲーム側で指定します。同梱の補助コードはGLBの追加情報から読み取ります。
- 単位はメートル、Yが上。床・グリッド・カメラ・画面の照明は出力に入りません。金属の環境反射はゲーム側の環境光で再現します。

## 最小の読み込みコード

`three-character.js`をゲームのソースへコピーし、保存したGLBをゲームの公開フォルダへ置きます。ゲーム側にも`three`が必要です。

```js
import { loadCharacter } from './three-character.js';

const character = await loadCharacter('/models/motion.glb');
scene.add(character.root);

// 既存のゲームループから毎フレーム呼ぶ。deltaSecondsは秒。
character.update(deltaSeconds);

// 必要なら任意のタイミングで先頭から再生。
character.action.reset().play();
```

描画はゲーム側で通常どおり行います。`character.root.position`や`rotation`を操作すれば、ゲーム内の配置や向きを変更できます。

## シルバーの環境反射

ゲームのシーンに環境マップがない場合は、次のように一度だけ作成します。各キャラクターや毎フレーム作り直す必要はありません。

```js
import { PMREMGenerator } from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const room = new RoomEnvironment();
const pmrem = new PMREMGenerator(renderer);
const environment = pmrem.fromScene(room, 0.04);
scene.environment = environment.texture;
scene.environmentIntensity = 0.85;
room.dispose();
pmrem.dispose();
// シーンを終了するときに environment.dispose() を呼ぶ。
```

保存したGLBの動きはボーンアニメーションです。ゲームの当たり判定・操作・物理・足の接地はゲーム側で実装します。書き出し時に録画の欠損や足の滑りを自動修正する処理は加えません。

## スペアボディのやわらかさ

柔らかさ付きの体を読み込むと、「やわらかさを反映」で動きに伴う揺れを有効にできます。`_SOFTNESS`・`_MAX_OFFSET`・`_DAMPING`と設定の追加情報を読み取ります。最大変位には柔らかさが既に掛かっているため、二重には掛けません。データのない以前のGLBは従来どおり骨格だけで動きます。

書き出しでは、柔らかさの頂点属性・設定を保持し、現在の動きによる揺れを標準glTFのモーフアニメーションとして同じGLBへ焼き込みます。`three-character.js`を変更せず再生できます。ゼロが多い変形データは標準のsparseアクセサで保存し、ファイルを小さくします。「やわらかさを反映」を外して保存すると、揺れのアニメーションを含めません。

焼き込むのは読み込んだモーションに伴う揺れです。ゲーム内で別に加えた衝突や加速度への反応、体積保持のシミュレーションは含みません。生の柔らかさ付きメッシュへ動的な揺れを付けたい場合は、`softness.js`の`createSoftness(root)`を使い、骨格を更新した後に`update(deltaSeconds)`を呼べます。既に揺れを焼き込んだGLBへの二重適用は避けます。ワープ・シーク時は`reset()`、取り外す際は`dispose()`を呼びます。

参照：[Three.js GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html)、[AnimationMixer](https://threejs.org/docs/pages/AnimationMixer.html)、[glTF 2.0仕様](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)。

指の取り込み・骨格の対応・時間合わせは [HAND_MOTION.md](HAND_MOTION.md) を参照。指の動きも同じGLBに保存され、上の読み込みコードで再生できます。
