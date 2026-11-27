// 傀儡: load a body made with スペアボディ (skinned GLB) and move it with a motion JSON from 「モーション」.
import './style.css';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Viewer, type ViewName, type BackgroundName } from './viewer';
import { parseClip, sampleJoints, type MotionClip } from './motion/clip';
import { rigFromScene, resetRig, type Rig } from './motion/rig';
import { applyPose, computePose } from './motion/retarget';
import { sampleClips, randomSample, type SampleFamily } from './motion/demo';
import { exportAnimatedGlb } from './motion/export';
import { createSoftness, type SoftnessController } from '../../integration/softness.js';
import { applyHandTracks, handCompatibility, parseHandClip, type HandSide, type HandTracks } from './motion/hand';
import { getTimeline } from './motion/timeline';

if (new URLSearchParams(location.search).has('shots')) document.body.classList.add('shots');

const viewer = new Viewer(document.getElementById('c') as HTMLCanvasElement);
let rig: Rig | null = null;
let softness: SoftnessController | null = null;
const player = { clip: null as MotionClip | null, t: 0, playing: false, speed: 1, loop: true };
const hands: HandTracks = {};

// ---------------- panel helpers ----------------
const panel = document.getElementById('panel') as HTMLElement;
const heading = (text: string, level: 'h1' | 'h2' = 'h2') => {
  const h = document.createElement(level);
  h.textContent = text;
  panel.appendChild(h);
};
const line = (html = '') => {
  const d = document.createElement('div');
  d.className = 'line';
  d.innerHTML = html;
  panel.appendChild(d);
  return d;
};
const note = (text = '') => {
  const p = document.createElement('div');
  p.className = 'note';
  p.textContent = text;
  panel.appendChild(p);
  return p;
};
const button = (text: string, fn: () => void, primary = false) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = primary ? 'btn primary' : 'btn';
  b.textContent = text;
  b.addEventListener('click', fn);
  return b;
};
const filePicker = (text: string, accept: string, fn: (f: File) => void) => {
  const l = document.createElement('label');
  l.className = 'btn';
  l.textContent = text;
  const i = document.createElement('input');
  i.type = 'file';
  i.accept = accept;
  i.style.display = 'none';
  i.addEventListener('change', () => {
    const f = i.files?.[0];
    if (f) fn(f);
    i.value = '';
  });
  l.appendChild(i);
  return l;
};

heading('傀儡', 'h1');
note('スペアボディで作った体（GLB）に、「モーション」で撮った動き（JSON）を付けて動かします。ファイルは画面にドラッグしても開けます。');

// ---------------- body ----------------
heading('体（スペアボディの GLB）');
const bodyLine = line();
bodyLine.append(
  button('サンプル：男性', () => loadBodyUrl('samples/spare_body_male.glb', 'サンプル（男性）')),
  button('サンプル：女性', () => loadBodyUrl('samples/spare_body_female.glb', 'サンプル（女性）')),
  filePicker('体（GLB）を開く', '.glb,model/gltf-binary', (f) => loadBodyFile(f)),
);
const bodyInfo = note();
const showLine = line('<label><input type="checkbox" id="skel"> 骨格を表示</label>');
(showLine.querySelector('#skel') as HTMLInputElement).addEventListener('change', (e) => viewer.setSkeletonVisible((e.target as HTMLInputElement).checked));
const backgroundLine = line('<label for="background">背景</label>');
const backgroundSel = document.createElement('select');
backgroundSel.id = 'background';
backgroundSel.add(new Option('白', 'white'));
backgroundSel.add(new Option('黒', 'black'));
backgroundSel.addEventListener('change', () => viewer.setBackground(backgroundSel.value as BackgroundName));
backgroundLine.append(backgroundSel);
const softLine = line('<label><input type="checkbox" id="softness" checked> やわらかさを反映</label>');
const softToggle = softLine.querySelector('input') as HTMLInputElement;
const softInfo = note();
softToggle.addEventListener('change', () => {
  softness?.setEnabled(softToggle.checked);
  viewer.requestRender();
});

// ---------------- motion ----------------
heading('動き（「モーション」の JSON）');
let sampleFamily: SampleFamily = 'male';
function loadRandomSample(): void {
  player.loop = sampleFamily !== 'female';
  (loopLabel.querySelector('input') as HTMLInputElement).checked = player.loop;
  loadMotion(randomSample(sampleFamily), 'サンプル');
}
const mLine1 = line();
mLine1.append(
  button('サンプル', loadRandomSample),
  filePicker('動き（JSON）を開く', '.json,application/json', (f) => loadMotionFile(f)),
);
const motionInfo = note('動きを開くと再生が始まります。');
heading('指の動き（「指モーション」のJSON）');
line().append(filePicker('指の動き（JSON）を開く', '.json,application/json', (f) => loadMotionFile(f)));
const handInfo = note('左右別の指データを読み込めます。体の動きと同じ時間で再生します。');
const handRows = {} as Record<HandSide, { info: HTMLElement; offset: HTMLInputElement; wrist: HTMLInputElement }>;
for (const side of ['l', 'r'] as const) {
  const title = side === 'l' ? '左手' : '右手';
  const row = line(`<label for="handOffset_${side}">${title}の開始（秒）</label>`);
  const offset = document.createElement('input');
  offset.id = `handOffset_${side}`; offset.type = 'number'; offset.step = '0.1'; offset.min = '-600'; offset.max = '600'; offset.value = '0'; offset.style.width = '70px';
  const wristLabel = document.createElement('label');
  wristLabel.innerHTML = `<input type="checkbox"> ${title}の手首の向きも反映`;
  const wrist = wristLabel.querySelector('input') as HTMLInputElement;
  const changed = () => {
    if (hands[side]) { hands[side]!.offset = Number(offset.value) || 0; hands[side]!.wrist = wrist.checked; }
    syncTimeline(); showFrame();
  };
  offset.addEventListener('change', changed); wrist.addEventListener('change', changed);
  row.append(offset, wristLabel, button(`${title}を外す`, () => { delete hands[side]; updateHandInfo(); syncTimeline(); showFrame(); }));
  handRows[side] = { info: note(`${title}：未読込`), offset, wrist };
}
note('開始を正にすると指の動きが遅れて始まります。指の骨がない体でもデータを保持し、対応する体への交換後に反映します。');
heading('再生');
const playBtn = button('▶ 再生', () => setPlaying(!player.playing), true);
const prevBtn = button('◀ 1コマ', () => step(-1));
const nextBtn = button('1コマ ▶', () => step(1));
const restBtn = button('立ち姿に戻す', () => {
  setPlaying(false);
  if (rig) resetRig(rig);
  softness?.reset();
  viewer.requestRender();
});
line().append(playBtn, prevBtn, nextBtn, restBtn);
const timeRange = document.createElement('input');
timeRange.type = 'range';
timeRange.min = '0';
timeRange.max = '0';
timeRange.step = '1';
timeRange.style.width = '100%';
timeRange.setAttribute('aria-label', '再生位置');
panel.appendChild(timeRange);
const timeInfo = note();
const speedLine = line('<label for="speed">速さ</label>');
const speedSel = document.createElement('select');
speedSel.id = 'speed';
for (const s of [0.25, 0.5, 1, 1.5, 2]) speedSel.add(new Option(`${s}倍`, String(s)));
speedSel.value = '1';
speedSel.addEventListener('change', () => (player.speed = Number(speedSel.value)));
const loopLabel = document.createElement('label');
loopLabel.innerHTML = '<input type="checkbox" checked> くり返す';
(loopLabel.querySelector('input') as HTMLInputElement).addEventListener('change', (e) => (player.loop = (e.target as HTMLInputElement).checked));
speedLine.append(speedSel, loopLabel);
note('単位はメートル、+Y が上、+Z が体の前です。腕・脚のねじれと、うなずきはまだ反映しません。');

const setControlsEnabled = (on: boolean) => [playBtn, prevBtn, nextBtn, restBtn, timeRange].forEach((b) => ((b as HTMLButtonElement).disabled = !on));
setControlsEnabled(false);

// ---------------- game export ----------------
heading('ゲーム用に書き出す');
const exportNameLine = line('<label for="exportName">動きの名前</label>');
const exportName = document.createElement('input');
exportName.id = 'exportName';
exportName.type = 'text';
exportName.value = 'motion';
exportName.maxLength = 100;
exportName.style.width = '180px';
exportNameLine.append(exportName);
const rootLine = line('<label><input type="checkbox" id="exportRoot" checked> 移動を含める</label>');
const exportRoot = rootLine.querySelector('input') as HTMLInputElement;
const exportBtn = button('体＋モーションを保存（GLB）', () => { void saveAnimatedBody(); }, true);
exportBtn.disabled = true;
line().append(exportBtn);
note('体・骨格・材質・現在の動きを1ファイルに保存します。画面の速さで書き出し、移動を外すとその場の動きになります。');
note('繰り返し再生はゲーム側でも設定してください。環境反射はゲーム側の照明で再現します。');
const exportInfo = note('体と動きを読み込むと保存できます。');
let exporting = false;
let handExportBlocked = false;
function updateExportButton(): void {
  const blocked = !!rig && (Object.keys(hands) as HandSide[]).some((side) => {
    const compatible = handCompatibility(rig!, side);
    return !compatible.wrist || compatible.missing.length > 0;
  });
  exportBtn.disabled = exporting || !rig || !getTimeline(player.clip, hands) || blocked;
  if (blocked) exportInfo.textContent = '指の骨が不足しています。対応する体を読み込むか、未対応の手の指データを外すと保存できます。';
  else if (handExportBlocked) exportInfo.textContent = '体と動きを保存できます。';
  handExportBlocked = blocked;
}
async function saveAnimatedBody(): Promise<void> {
  if (!rig || !getTimeline(player.clip, hands) || exporting) return;
  const body = rig;
  const motion = player.clip;
  const name = exportName.value.trim() || 'motion';
  const options = { name, speed: player.speed, loop: player.loop, includeRoot: exportRoot.checked, includeSoftness: softToggle.checked,
    hands: Object.fromEntries(Object.entries(hands).map(([side, track]) => [side, { ...track }])) as HandTracks };
  exporting = true;
  updateExportButton();
  exportInfo.textContent = 'モーションを焼き込んでいます…';
  try {
    // Allow the status to paint before baking the animation on the Mac.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const data = await exportAnimatedGlb(body, motion, options);
    const url = URL.createObjectURL(new Blob([data], { type: 'model/gltf-binary' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')}.glb`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    exportInfo.textContent = `保存しました：${a.download}（${(data.byteLength / 1024 / 1024).toFixed(2)} MB）`;
  } catch (e) {
    exportInfo.textContent = `保存できませんでした：${e instanceof Error ? e.message : String(e)}`;
  } finally {
    exporting = false;
    updateExportButton();
  }
}

document.querySelectorAll<HTMLButtonElement>('#viewButtons button').forEach((b) => b.addEventListener('click', () => viewer.setView(b.dataset.view as ViewName)));

// ---------------- logic ----------------
function setPlaying(on: boolean): void {
  const timeline = getTimeline(player.clip, hands);
  if (on && timeline && player.t >= timeline.lastTime) { player.t = 0; showFrame(); }
  player.playing = on;
  playBtn.textContent = on ? '⏸ 一時停止' : '▶ 再生';
}

function showFrame(resetSoftness = true): void {
  const c = player.clip, timeline = getTimeline(c, hands);
  if (rig) {
    if (c) {
      const s = sampleJoints(c, player.t, player.loop);
      applyPose(rig, computePose(rig, s.joints, s.root, c.root ? c.root[0] : null));
    } else resetRig(rig);
    applyHandTracks(rig, hands, player.t, player.loop);
  }
  if (resetSoftness) softness?.reset();
  const frame = timeline ? Math.min(timeline.frameCount - 1, Math.floor(player.t * timeline.fps)) : 0;
  timeRange.value = String(frame);
  timeInfo.textContent = timeline ? `${player.t.toFixed(2)} / ${timeline.duration.toFixed(2)} 秒（${frame + 1} / ${timeline.frameCount} コマ）` : '';
  viewer.requestRender();
}

function step(k: number): void {
  const c = getTimeline(player.clip, hands);
  if (!c) return;
  setPlaying(false);
  const f = Math.min(c.frameCount - 1, Math.max(0, Math.round(player.t * c.fps) + k));
  player.t = f / c.fps;
  showFrame();
}

timeRange.addEventListener('input', () => {
  const c = getTimeline(player.clip, hands);
  if (!c) return;
  setPlaying(false);
  player.t = Number(timeRange.value) / c.fps;
  showFrame();
});

viewer.onFrame = (dt) => {
  const c = getTimeline(player.clip, hands);
  if (!c || !player.playing) return softness?.update(dt) ?? false;
  player.t += dt * player.speed;
  if (player.loop) player.t = ((player.t % c.duration) + c.duration) % c.duration;
  else if (player.t >= c.lastTime) {
    player.t = c.lastTime;
    setPlaying(false);
  }
  showFrame(false);
  softness?.update(dt);
  return true;
};

async function loadBody(data: ArrayBuffer, name: string, background?: BackgroundName, family?: SampleFamily): Promise<void> {
  try {
    const gltf = await new GLTFLoader().parseAsync(data, '');
    const r = rigFromScene(gltf.scene);
    const nextSoftness = createSoftness(gltf.scene);
    nextSoftness?.setEnabled(softToggle.checked);
    softness?.dispose();
    softness = nextSoftness;
    rig = r;
    updateHandInfo();
    softToggle.disabled = !softness;
    const hasSoftnessData = r.mesh.geometry.hasAttribute('_softness') || r.mesh.geometry.hasAttribute('_SOFTNESS');
    softInfo.textContent = softness ? `やわらかさ対応：${softness.activeVertices.toLocaleString()} 頂点。動きに合わせて揺れます。`
      : hasSoftnessData ? 'やわらかさ：すべて固定（揺れる頂点はありません）。' : 'この体にはやわらかさのデータがありません。';
    updateExportButton();
    viewer.setBody(gltf.scene);
    if (background) {
      viewer.setBackground(background);
      backgroundSel.value = background;
    }
    const fmt = (gltf.parser.json.scenes?.[0]?.extras as { format?: string } | undefined)?.format;
    bodyInfo.textContent =
      `${name}：骨 ${r.rest.size} 本・高さ ${(r.height * 100).toFixed(1)} cm` +
      (fmt === 'spare-body-glb-v1' ? '' : '（スペアボディ以外の GLB）') +
      (r.missing.length ? `。足りない骨：${r.missing.join('・')}（その部分は動きません）` : '');
    if (family) {
      const previous = sampleFamily;
      sampleFamily = family;
      if (family === 'female' || previous !== family) loadRandomSample();
      else if (getTimeline(player.clip, hands)) showFrame();
    } else if (getTimeline(player.clip, hands)) showFrame();
  } catch (e) {
    bodyInfo.textContent = `体を開けませんでした：${e instanceof Error ? e.message : String(e)}`;
  }
}
async function loadBodyUrl(url: string, name: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    bodyInfo.textContent = `サンプルの体が見つかりません（${url}）`;
    return;
  }
  const family = url === 'samples/spare_body_male.glb' ? 'male' : url === 'samples/spare_body_female.glb' ? 'female' : undefined;
  await loadBody(await res.arrayBuffer(), name, family === 'male' ? 'black' : undefined, family);
}
async function loadBodyFile(f: File): Promise<void> {
  await loadBody(await f.arrayBuffer(), f.name);
}

function loadMotion(json: unknown, name: string): void {
  try {
    const c = parseClip(json, name);
    player.clip = c;
    player.t = 0;
    syncTimeline();
    motionInfo.textContent = `${name}：${c.frames.length} コマ・${c.fps} fps・${c.duration.toFixed(1)} 秒${c.root ? '・移動あり' : ''}`;
    setControlsEnabled(true);
    showFrame();
    setPlaying(true);
  } catch (e) {
    motionInfo.textContent = `動きを開けませんでした：${e instanceof Error ? e.message : String(e)}`;
  }
}
async function loadMotionFile(f: File): Promise<void> {
  try {
    const json = JSON.parse(await f.text());
    if (json?.format === 'hand-mocap-v1') {
      const clip = parseHandClip(json, f.name), row = handRows[clip.side];
      hands[clip.side] = { clip, offset: Number(row.offset.value) || 0, wrist: row.wrist.checked };
      updateHandInfo(); syncTimeline(); showFrame(); setPlaying(true);
    } else loadMotion(json, f.name);
  } catch (e) {
    handInfo.textContent = `動きを開けませんでした：${e instanceof Error ? e.message : String(e)}`;
  }
}

function syncTimeline(): void {
  const timeline = getTimeline(player.clip, hands);
  timeRange.max = String(Math.max(0, (timeline?.frameCount ?? 1) - 1));
  player.t = Math.min(player.t, timeline?.lastTime ?? 0);
  setControlsEnabled(!!timeline); updateExportButton();
  if (!timeline) setPlaying(false);
}
function updateHandInfo(): void {
  for (const side of ['l', 'r'] as const) {
    const clip = hands[side]?.clip, title = side === 'l' ? '左手' : '右手';
    const compatible = rig ? handCompatibility(rig, side) : null;
    handRows[side].info.textContent = !clip ? `${title}：未読込` : `${title}：${clip.name}・${clip.duration.toFixed(2)}秒` +
      (!compatible ? '' : compatible.available === 0 ? '。この体には指の骨がありません（データは保持しています）。' : compatible.missing.length ? `。未対応の骨：${compatible.missing.join('・')}` : '。指の骨に対応。');
  }
  handInfo.textContent = '全身がある場合は全身の長さで、指だけの場合は指の長さで再生・保存します。';
}

// drag & drop: .glb → body, .json → motion
window.addEventListener('dragover', (e) => {
  if (e.dataTransfer?.types.includes('Files')) {
    e.preventDefault();
    document.body.classList.add('dropping');
  }
});
window.addEventListener('dragleave', (e) => {
  if (e.relatedTarget === null) document.body.classList.remove('dropping');
});
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  document.body.classList.remove('dropping');
  for (const f of [...(e.dataTransfer?.files ?? [])]) {
    if (/\.glb$/i.test(f.name)) await loadBodyFile(f);
    else if (/\.json$/i.test(f.name)) await loadMotionFile(f);
    else motionInfo.textContent = `${f.name}：体は .glb、動きは .json をドラッグしてください。`;
  }
});

await loadBodyUrl('samples/spare_body_male.glb', 'サンプル（男性）');

// automation hook used by `npm run shots`
declare global {
  interface Window {
    __bust?: {
      loadProject(json: unknown): Promise<void>;
      setView(v: ViewName): Promise<void>;
      info(): { vertices: number; triangles: number; warnings: string[]; softnessPeak: number; softnessVertices: number };
      setSkeleton(on: boolean): void;
      loadDemoMotion(kind?: keyof typeof sampleClips): void;
      setTime(t: number): Promise<void>;
      loadBody(url: string): Promise<void>;
    };
  }
}
window.__bust = {
  loadProject: async () => {},
  setView: async (v) => {
    viewer.setView(v);
    await viewer.renderNow();
  },
  info: () => ({ vertices: rig ? rig.mesh.geometry.getAttribute('position').count : 0, triangles: rig ? (rig.mesh.geometry.index?.count ?? 0) / 3 : 0, warnings: rig?.missing ?? [],
    softnessPeak: Math.max(0, ...(softness?.meshes.flatMap((mesh) => mesh.morphTargetInfluences?.map(Math.abs) ?? []) ?? [])), softnessVertices: softness?.activeVertices ?? 0 }),
  setSkeleton: (on) => viewer.setSkeletonVisible(on),
  loadDemoMotion: (kind = 'dash') => loadMotion(sampleClips[kind](), 'サンプル'),
  setTime: async (t) => {
    setPlaying(false);
    player.t = t;
    showFrame();
    await viewer.renderNow();
  },
  loadBody: (url) => loadBodyUrl(url, url),
};
