import './style.css';
import { GROUPS, PRESETS, BODY_PRESETS, clampParams, presetParams, type BodyParams, type BodyPresetName, type PresetName } from './model/params';
import { buildBody, type BodyMesh } from './model/body';
import { exportBodyGlb } from './export/exportBody';
import { Viewer, type ViewName } from './viewer';
import { heading, paramTree, type ParamControl } from './ui/panel';

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

const state: { preset: PresetName; bodyPreset: BodyPresetName; params: BodyParams } = { preset: defaultPreset(), bodyPreset: 'female', params: presetParams('female') };
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
}
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
unitNote.textContent = '単位はメートル、+Y が上、+Z が体の前、床が y = 0 です。動きの取り込みは次の段階で追加します。';
panel.appendChild(unitNote);

document.querySelectorAll<HTMLButtonElement>('#viewButtons button').forEach((b) => b.addEventListener('click', () => viewer.setView(b.dataset.view as ViewName)));

function applyProject(j: ProjectJson): void {
  state.preset = j.preset && j.preset in PRESETS ? j.preset : state.preset;
  state.bodyPreset = j.bodyPreset && j.bodyPreset in BODY_PRESETS ? j.bodyPreset : 'female';
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
};
