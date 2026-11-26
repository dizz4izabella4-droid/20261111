import './style.css';
import { GROUPS, PRESETS, BODY_PRESETS, clampParams, presetParams, type BodyParams, type BodyPresetName, type PresetName } from './model/params';
import { buildBody, type BodyMesh } from './model/body';
import { exportBodyGlb } from './export/exportBody';
import { Viewer, type ViewName } from './viewer';
import { heading, paramTree, type ParamControl } from './ui/panel';
import { parseClip, sampleJoints, type MotionClip } from './motion/clip';
import { computePose } from './motion/retarget';
import { demoClip } from './motion/demo';

export interface ProjectJson {
  formatVersion: number;
  preset?: PresetName;
  bodyPreset?: BodyPresetName;
  params?: Record<string, number>;
}

function defaultPreset(): PresetName {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) < 900;
  return coarse && small ? 'light' : 'standard';
}

if (new URLSearchParams(location.search).has('shots')) document.body.classList.add('shots');

const state: { preset: PresetName; bodyPreset: BodyPresetName; params: BodyParams } = { preset: defaultPreset(), bodyPreset: 'male', params: presetParams('male') };
const viewer = new Viewer(document.getElementById('c') as HTMLCanvasElement);
let current: BodyMesh | null = null;

const warningsEl = document.getElementById('warnings') as HTMLDivElement;
function rebuild(): void {
  current = buildBody(state.params, state.preset);
  viewer.setBody(current);
  warningsEl.hidden = current.warnings.length === 0;
  warningsEl.textContent = current.warnings.join(' ');
  heightInfo.textContent = `身長（頭のてっぺんまで）：${(current.height * 100).toFixed(1)} cm`;
  stats.textContent = `頂点 ${(current.positions.length / 3).toLocaleString()}・三角形 ${(current.indices.length / 3).toLocaleString()}・骨 ${current.bones.length}`;
  if (player.clip) showFrame(); // the new skeleton starts in the rest pose
}

// ---------------- motion playback ----------------
const player = { clip: null as MotionClip | null, t: 0, playing: false, speed: 1, loop: true };
function showFrame(): void {
  const c = player.clip;
  if (!c || !current) return;
  const s = sampleJoints(c, player.t, player.loop);
  viewer.applyPose(computePose(current, s.joints, s.root, c.root ? c.root[0] : null));
  timeRange.value = String(s.frame);
  timeInfo.textContent = `${player.t.toFixed(2)} / ${c.duration.toFixed(2)} 秒（${s.frame + 1} / ${c.frames.length} コマ）`;
}
viewer.onFrame = (dt) => {
  const c = player.clip;
  if (!c || !player.playing) return false;
  player.t += dt * player.speed;
  if (player.loop) player.t = ((player.t % c.duration) + c.duration) % c.duration;
  else if (player.t >= c.duration - 1 / c.fps) {
    player.t = c.duration - 1 / c.fps;
    setPlaying(false);
  }
  showFrame();
  return true;
};
let pending = false;
function scheduleRebuild(): void {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    rebuild();
  });
}

// ---------------- panel ----------------
const panel = document.getElementById('panel') as HTMLElement;
heading(panel, '動く素体', 'h1');
const heightInfo = document.createElement('div');
heightInfo.id = 'heightInfo';
panel.appendChild(heightInfo);

heading(panel, '表示');
const line = (html: string) => {
  const d = document.createElement('div');
  d.className = 'line';
  d.innerHTML = html;
  panel.appendChild(d);
  return d;
};
const presetLine = line('<label for="preset">性能プリセット</label>');
const presetSel = document.createElement('select');
presetSel.id = 'preset';
for (const [k, v] of Object.entries(PRESETS)) presetSel.add(new Option(v.label, k));
presetSel.value = state.preset;
presetSel.addEventListener('change', () => {
  state.preset = presetSel.value as PresetName;
  scheduleRebuild();
});
presetLine.appendChild(presetSel);
const showLine = line('<label><input type="checkbox" id="skel"> 骨格を表示</label> <label><input type="checkbox" id="wire"> ワイヤーフレーム</label>');
(showLine.querySelector('#skel') as HTMLInputElement).addEventListener('change', (e) => viewer.setSkeletonVisible((e.target as HTMLInputElement).checked));
(showLine.querySelector('#wire') as HTMLInputElement).addEventListener('change', (e) => viewer.setWireframe((e.target as HTMLInputElement).checked));
const stats = document.createElement('div');
stats.className = 'note';
panel.appendChild(stats);

heading(panel, '体の形');
const bodyLine = line('<label for="bodyPreset">体型プリセット</label>');
const bodySel = document.createElement('select');
bodySel.id = 'bodyPreset';
for (const [k, v] of Object.entries(BODY_PRESETS)) bodySel.add(new Option(v.label, k));
bodySel.value = state.bodyPreset;
bodySel.addEventListener('change', () => applyProject({ formatVersion: 1, preset: state.preset, bodyPreset: bodySel.value as BodyPresetName }));
bodyLine.appendChild(bodySel);
const note = document.createElement('p');
note.className = 'note';
note.textContent = '大項目 → 中項目 → 小項目の順に開いて調整します。顔・手・足は仮の箱です。初期値は仮の値です（胴と胸は「写真分析成形」で調整した値）。';
panel.appendChild(note);
const treeHost = document.createElement('div');
panel.appendChild(treeHost);
let controls: Record<string, ParamControl> = paramTree(
  treeHost,
  GROUPS,
  state.params,
  (key, v) => {
    state.params[key] = v;
    scheduleRebuild();
  },
  ['torso'],
);

heading(panel, '動き（「モーション」の JSON）');
const motionNote = document.createElement('p');
motionNote.className = 'note';
motionNote.textContent = '作品「モーション」で保存した JSON（motion.json）を開くと、体が同じように動きます。手元に JSON がなければ「サンプルの動き」で試せます（歩いてから右手を振る）。';
panel.appendChild(motionNote);
const mLine1 = line('');
const demoBtn = document.createElement('button');
demoBtn.className = 'btn';
demoBtn.textContent = 'サンプルの動き';
demoBtn.addEventListener('click', () => loadMotion(demoClip(), 'サンプル（歩く・手を振る）'));
const fileLabel = document.createElement('label');
fileLabel.className = 'btn';
fileLabel.textContent = 'JSON を開く';
const fileIn = document.createElement('input');
fileIn.type = 'file';
fileIn.accept = '.json,application/json';
fileIn.style.display = 'none';
fileLabel.appendChild(fileIn);
fileIn.addEventListener('change', async () => {
  const f = fileIn.files?.[0];
  if (!f) return;
  try {
    loadMotion(JSON.parse(await f.text()), f.name);
  } catch (e) {
    motionInfo.textContent = `読み込めませんでした：${e instanceof Error ? e.message : String(e)}`;
  }
  fileIn.value = '';
});
mLine1.append(demoBtn, fileLabel);
const motionInfo = document.createElement('div');
motionInfo.className = 'note';
panel.appendChild(motionInfo);
const mLine2 = line('');
const playBtn = document.createElement('button');
playBtn.className = 'btn primary';
playBtn.textContent = '▶ 再生';
const prevBtn = document.createElement('button');
prevBtn.className = 'btn';
prevBtn.textContent = '◀ 1コマ';
const nextBtn = document.createElement('button');
nextBtn.className = 'btn';
nextBtn.textContent = '1コマ ▶';
const restBtn = document.createElement('button');
restBtn.className = 'btn';
restBtn.textContent = '立ち姿に戻す';
mLine2.append(playBtn, prevBtn, nextBtn, restBtn);
const timeRange = document.createElement('input');
timeRange.type = 'range';
timeRange.min = '0';
timeRange.max = '0';
timeRange.step = '1';
timeRange.style.width = '100%';
timeRange.setAttribute('aria-label', '再生位置');
panel.appendChild(timeRange);
const timeInfo = document.createElement('div');
timeInfo.className = 'note';
panel.appendChild(timeInfo);
const mLine3 = line('<label for="speed">速さ</label>');
const speedSel = document.createElement('select');
speedSel.id = 'speed';
for (const v of [0.25, 0.5, 1, 1.5, 2]) speedSel.add(new Option(`${v}倍`, String(v)));
speedSel.value = '1';
speedSel.addEventListener('change', () => (player.speed = Number(speedSel.value)));
const loopLabel = document.createElement('label');
loopLabel.innerHTML = '<input type="checkbox" id="loop" checked> くり返す';
mLine3.append(speedSel, loopLabel);
(loopLabel.querySelector('input') as HTMLInputElement).addEventListener('change', (e) => (player.loop = (e.target as HTMLInputElement).checked));
const setControlsEnabled = (on: boolean) => [playBtn, prevBtn, nextBtn, restBtn, timeRange].forEach((b) => ((b as HTMLButtonElement).disabled = !on));
setControlsEnabled(false);
function setPlaying(on: boolean): void {
  player.playing = on;
  playBtn.textContent = on ? '⏸ 一時停止' : '▶ 再生';
}
playBtn.addEventListener('click', () => setPlaying(!player.playing));
const step = (k: number) => {
  const c = player.clip;
  if (!c) return;
  setPlaying(false);
  const f = Math.min(c.frames.length - 1, Math.max(0, Math.round(player.t * c.fps) + k));
  player.t = f / c.fps;
  showFrame();
};
prevBtn.addEventListener('click', () => step(-1));
nextBtn.addEventListener('click', () => step(1));
timeRange.addEventListener('input', () => {
  const c = player.clip;
  if (!c) return;
  setPlaying(false);
  player.t = Number(timeRange.value) / c.fps;
  showFrame();
});
restBtn.addEventListener('click', () => {
  setPlaying(false);
  viewer.resetPose();
});
function loadMotion(json: unknown, name: string): void {
  try {
    const c = parseClip(json, name);
    player.clip = c;
    player.t = 0;
    timeRange.max = String(c.frames.length - 1);
    motionInfo.textContent = `${name}：${c.frames.length} コマ・${c.fps} fps・${c.duration.toFixed(1)} 秒${c.root ? '・移動あり' : ''}`;
    setControlsEnabled(true);
    showFrame();
    setPlaying(true);
  } catch (e) {
    motionInfo.textContent = `読み込めませんでした：${e instanceof Error ? e.message : String(e)}`;
  }
}

heading(panel, '書き出し');
const exportLine = line('');
const glbBtn = document.createElement('button');
glbBtn.className = 'btn primary';
glbBtn.textContent = 'GLB を書き出す（立ち姿・骨格の位置つき）';
glbBtn.addEventListener('click', () => {
  if (!current) return;
  const blob = new Blob([exportBodyGlb(current)], { type: 'model/gltf-binary' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'body.glb';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});
exportLine.appendChild(glbBtn);
const unitNote = document.createElement('p');
unitNote.className = 'note';
unitNote.textContent = '単位はメートル、+Y が上、+Z が体の前、床が y = 0 です。GLB は立ち姿で書き出します（動きつきの書き出しは今後）。';
panel.appendChild(unitNote);

document.querySelectorAll<HTMLButtonElement>('#viewButtons button').forEach((b) => b.addEventListener('click', () => viewer.setView(b.dataset.view as ViewName)));

function applyProject(j: ProjectJson): void {
  state.preset = j.preset && j.preset in PRESETS ? j.preset : state.preset;
  state.bodyPreset = j.bodyPreset && j.bodyPreset in BODY_PRESETS ? j.bodyPreset : 'male';
  state.params = clampParams({ ...presetParams(state.bodyPreset), ...(j.params ?? {}) });
  presetSel.value = state.preset;
  bodySel.value = state.bodyPreset;
  for (const [k, c] of Object.entries(controls)) c.set(state.params[k]);
  rebuild();
}

rebuild();

// automation hook used by `npm run shots`
declare global {
  interface Window {
    __bust?: {
      loadProject(json: ProjectJson): Promise<void>;
      setView(v: ViewName): Promise<void>;
      getProject(): ProjectJson;
      info(): { vertices: number; triangles: number; warnings: string[]; height: number };
      setSkeleton(on: boolean): void;
      loadDemoMotion(): void;
      setTime(t: number): Promise<void>;
    };
  }
}
window.__bust = {
  loadProject: async (json) => applyProject(json),
  setView: async (v) => {
    viewer.setView(v);
    await viewer.renderNow();
  },
  getProject: () => ({ formatVersion: 1, preset: state.preset, bodyPreset: state.bodyPreset, params: { ...state.params } }),
  info: () => ({ vertices: current ? current.positions.length / 3 : 0, triangles: current ? current.indices.length / 3 : 0, warnings: current?.warnings ?? [], height: current?.height ?? 0 }),
  setSkeleton: (on) => viewer.setSkeletonVisible(on),
  loadDemoMotion: () => loadMotion(demoClip(), 'サンプル（歩く・手を振る）'),
  setTime: async (t) => {
    setPlaying(false);
    player.t = t;
    showFrame();
    await viewer.renderNow();
  },
};
