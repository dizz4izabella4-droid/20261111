// スペアボディ: shape a full body with sliders, save / open the settings, export the skinned GLB that
// 傀儡 (kugutsu) animates.
import './style.css';
import { GROUPS, PRESETS, BODY_PRESETS, clampParams, presetParams, type BodyParams, type BodyPresetName, type PresetName } from './model/params';
import { buildBody, type BodyMesh } from './model/body';
import { exportBodyGlb } from './export/exportBody';
import { Viewer, type ViewName } from './viewer';
import { heading, paramTree, type ParamControl } from './ui/panel';

/** body settings file (保存 / 開く). Also used by `npm run shots --project`. */
export const SETTINGS_FORMAT = 'spare-body-settings-v1';
export interface SettingsJson {
  format?: string;
  formatVersion?: number; // older project files
  name?: string;
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

const state: { name: string; preset: PresetName; bodyPreset: BodyPresetName; params: BodyParams } = {
  name: 'spare_body',
  preset: defaultPreset(),
  bodyPreset: 'male',
  params: presetParams('male'),
};
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

function download(data: BlobPart, name: string, type: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const safeName = (s: string) => s.trim().replace(/[\\/:*?"<>|]/g, '_') || 'spare_body';

// ---------------- panel ----------------
const panel = document.getElementById('panel') as HTMLElement;
heading(panel, 'スペアボディ', 'h1');
const heightInfo = document.createElement('div');
heightInfo.id = 'heightInfo';
panel.appendChild(heightInfo);
const line = (html: string) => {
  const d = document.createElement('div');
  d.className = 'line';
  d.innerHTML = html;
  panel.appendChild(d);
  return d;
};

heading(panel, 'ファイル');
const nameLine = line('<label for="bodyName">名前</label>');
const nameIn = document.createElement('input');
nameIn.id = 'bodyName';
nameIn.type = 'text';
nameIn.value = state.name;
nameIn.addEventListener('change', () => (state.name = safeName(nameIn.value)));
nameLine.appendChild(nameIn);
const fileLine = line('');
const saveBtn = document.createElement('button');
saveBtn.className = 'btn';
saveBtn.textContent = '体の設定を保存';
saveBtn.title = 'スライダーの値を JSON で保存します。あとで「体の設定を開く」で続きを調整できます。';
saveBtn.addEventListener('click', () => download(JSON.stringify(settings(), null, 2), `${safeName(state.name)}.spare.json`, 'application/json'));
const openLabel = document.createElement('label');
openLabel.className = 'btn';
openLabel.textContent = '体の設定を開く';
const openIn = document.createElement('input');
openIn.type = 'file';
openIn.accept = '.json,application/json';
openIn.style.display = 'none';
openLabel.appendChild(openIn);
openIn.addEventListener('change', async () => {
  const f = openIn.files?.[0];
  if (f) await openSettingsFile(f);
  openIn.value = '';
});
const glbBtn = document.createElement('button');
glbBtn.className = 'btn primary';
glbBtn.textContent = '傀儡用に書き出す（GLB）';
glbBtn.title = '骨格つきの体を GLB で書き出します。アプリ「傀儡」で読み込んで動かせます。';
glbBtn.addEventListener('click', () => {
  if (current) download(exportBodyGlb(current, state.params, safeName(state.name)), `${safeName(state.name)}.glb`, 'model/gltf-binary');
});
fileLine.append(saveBtn, openLabel, glbBtn);
const fileMsg = document.createElement('div');
fileMsg.className = 'note';
fileMsg.textContent = '体の設定（.spare.json）はファイルを画面にドラッグしても開けます。';
panel.appendChild(fileMsg);

heading(panel, '表示');
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
bodySel.addEventListener('change', () => applySettings({ bodyPreset: bodySel.value as BodyPresetName, preset: state.preset, name: state.name }));
bodyLine.appendChild(bodySel);
const note = document.createElement('p');
note.className = 'note';
note.textContent = '大項目 → 中項目 → 小項目の順に開いて調整します。顔・手・足は仮の箱です。';
panel.appendChild(note);
const treeHost = document.createElement('div');
panel.appendChild(treeHost);
const controls: Record<string, ParamControl> = paramTree(
  treeHost,
  GROUPS,
  state.params,
  (key, v) => {
    state.params[key] = v;
    scheduleRebuild();
  },
  ['torso'],
);
const unitNote = document.createElement('p');
unitNote.className = 'note';
unitNote.textContent = '単位はメートル、+Y が上、+Z が体の前、床が y = 0 です。';
panel.appendChild(unitNote);

document.querySelectorAll<HTMLButtonElement>('#viewButtons button').forEach((b) => b.addEventListener('click', () => viewer.setView(b.dataset.view as ViewName)));

function settings(): SettingsJson {
  return { format: SETTINGS_FORMAT, name: state.name, preset: state.preset, bodyPreset: state.bodyPreset, params: { ...state.params } };
}

function applySettings(j: SettingsJson): void {
  if (j.format && j.format !== SETTINGS_FORMAT) throw new Error('スペアボディの体の設定ファイルではありません。');
  state.name = j.name ? safeName(j.name) : state.name;
  state.preset = j.preset && j.preset in PRESETS ? j.preset : state.preset;
  state.bodyPreset = j.bodyPreset && j.bodyPreset in BODY_PRESETS ? j.bodyPreset : 'male';
  state.params = clampParams({ ...presetParams(state.bodyPreset), ...(j.params ?? {}) });
  nameIn.value = state.name;
  presetSel.value = state.preset;
  bodySel.value = state.bodyPreset;
  for (const [k, c] of Object.entries(controls)) c.set(state.params[k]);
  rebuild();
}

async function openSettingsFile(f: File): Promise<void> {
  try {
    applySettings(JSON.parse(await f.text()));
    fileMsg.textContent = `${f.name} を開きました。`;
  } catch (e) {
    fileMsg.textContent = `開けませんでした：${e instanceof Error ? e.message : String(e)}`;
  }
}

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
  const f = [...(e.dataTransfer?.files ?? [])].find((x) => /\.json$/i.test(x.name));
  if (f) await openSettingsFile(f);
  else fileMsg.textContent = '体の設定ファイル（.spare.json）をドラッグしてください。';
});

rebuild();

// automation hook used by `npm run shots`
declare global {
  interface Window {
    __bust?: {
      loadProject(json: SettingsJson): Promise<void>;
      setView(v: ViewName): Promise<void>;
      getProject(): SettingsJson;
      info(): { vertices: number; triangles: number; warnings: string[]; height: number };
      setSkeleton(on: boolean): void;
    };
  }
}
window.__bust = {
  loadProject: async (json) => applySettings(json),
  setView: async (v) => {
    viewer.setView(v);
    await viewer.renderNow();
  },
  getProject: () => settings(),
  info: () => ({ vertices: current ? current.positions.length / 3 : 0, triangles: current ? current.indices.length / 3 : 0, warnings: current?.warnings ?? [], height: current?.height ?? 0 }),
  setSkeleton: (on) => viewer.setSkeletonVisible(on),
};
