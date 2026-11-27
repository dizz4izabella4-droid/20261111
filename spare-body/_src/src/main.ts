// スペアボディ: shape a full body with sliders, save / open the settings, export the skinned GLB that
// 傀儡 (kugutsu) animates.
import './style.css';
import { defaultSkinTexture, normalizeSkinTexture, type SkinTextureSettings } from './model/skinTexture';
import { skinTexturePanel } from './ui/skinTexturePanel';
import { normalizeFacePhoto, facePhotoGeometry, facePngBytes, type FacePhoto } from './model/facePhoto';
import { facePhotoPanel } from './ui/facePhotoPanel';
import { GROUPS, PRESETS, BODY_PRESETS, clampParams, presetParams, type BodyParams, type BodyPresetName, type PresetName } from './model/params';
import { buildBody, type BodyMesh } from './model/body';
import { exportBodyGlb } from './export/exportBody';
import { Viewer, type ViewName } from './viewer';
import { heading, paramRow, paramTree, type ParamControl } from './ui/panel';
import { bakeSoftness, defaultSoftness, normalizeSoftness, type SoftnessField, type SoftnessSettings } from './model/softness';
import { softnessPanel } from './ui/softnessPanel';
import { defaultPreviewPose, type PreviewPose } from './model/pose';
import { FINGERS } from './model/handRig';
import { exportHandGlb } from './export/exportHand';
import { parseHandClip } from './model/handMotion';

/** body settings file (保存 / 開く). Also used by `npm run shots --project`. */
export const SETTINGS_FORMAT = 'spare-body-settings-v1';
export interface SettingsJson {
  format?: string;
  formatVersion?: number; // older project files
  name?: string;
  preset?: PresetName;
  bodyPreset?: BodyPresetName;
  params?: Record<string, number>;
  softness?: SoftnessSettings;
  facePhoto?: FacePhoto | null;
  skinTexture?: SkinTextureSettings;
}

function defaultPreset(): PresetName {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) < 900;
  return coarse && small ? 'light' : 'standard';
}

if (new URLSearchParams(location.search).has('shots')) document.body.classList.add('shots');

const state: { name: string; preset: PresetName; bodyPreset: BodyPresetName; params: BodyParams; softness: SoftnessSettings; facePhoto: FacePhoto | null; skinTexture: SkinTextureSettings } = {
  facePhoto: null,
  skinTexture: defaultSkinTexture(),
  name: 'spare_body',
  preset: defaultPreset(),
  bodyPreset: 'female',
  params: presetParams('female'),
  softness: defaultSoftness(),
};
const viewer = new Viewer(document.getElementById('c') as HTMLCanvasElement);
let current: BodyMesh | null = null;
let currentSoftness: SoftnessField | null = null;

const warningsEl = document.getElementById('warnings') as HTMLDivElement;
function rebuild(): void {
  // Generate the shoulder in the requested elevation instead of collapsing a
  // fixed sleeve with linear skinning. Other pose controls still use the rig.
  const params = previewPose.armElevation == null ? state.params : { ...state.params, armAngle: previewPose.armElevation };
  current = buildBody(params, state.preset);
  viewer.setBody(current);
  viewer.setPose({ ...previewPose, armElevation: null });
  viewer.setFacePhoto(state.facePhoto, state.params);
  updateSoftness();
  warningsEl.hidden = current.warnings.length === 0;
  warningsEl.textContent = current.warnings.join(' ');
  heightInfo.textContent = `身長（頭のてっぺんまで）：${(current.height * 100).toFixed(1)} cm`;
  stats.textContent = `頂点 ${(current.positions.length / 3).toLocaleString()}・三角形 ${(current.indices.length / 3).toLocaleString()}・骨 ${current.bones.length}`;
  if (current.seams) stats.textContent += `・接合 ${current.seams.joints.length}か所（分離なし）`;
}
function updateSoftness(): void {
  if (!current) return;
  currentSoftness = bakeSoftness(current, state.softness);
  viewer.setSoftness(currentSoftness);
  softPanel.update(state.softness, currentSoftness);
}
let pending = false;
function scheduleRebuild(): void {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    if (!pending) return;
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
const line = (html: string, parent = panel) => {
  const d = document.createElement('div');
  d.className = 'line';
  d.innerHTML = html;
  parent.appendChild(d);
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
saveBtn.title = '体の形と柔らかさを JSON で保存します。あとで「体の設定を開く」で続きを調整できます。';
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
glbBtn.title = '骨格と柔らかさのデータを GLB で書き出します。揺れを使うには読み込み先の対応が必要です。';
glbBtn.addEventListener('click', () => {
  // A shape slider may have queued a rebuild in the same frame as the click.
  if (pending) { pending = false; rebuild(); }
  const bindBody = previewPose.armElevation == null ? current : buildBody(state.params, state.preset);
  if (bindBody) download(exportBodyGlb(bindBody, state.params, safeName(state.name), state.softness, state.facePhoto ? { ...facePhotoGeometry(bindBody, state.params), png: facePngBytes(state.facePhoto) } : undefined), `${safeName(state.name)}.glb`, 'model/gltf-binary');
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
const mapLine = line('<label><input type="checkbox" id="softnessMap"> 柔らかさを色で表示</label>');
const mapInput = mapLine.querySelector('input')!;
const legend = document.createElement('div');
legend.id = 'softnessLegend'; legend.className = 'overlay'; legend.hidden = true;
legend.innerHTML = '<strong>柔らかさ</strong><div class="soft-scale"></div><div class="soft-scale-labels"><span>0　硬い</span><span>柔らかい　1</span></div>';
document.getElementById('viewport')!.appendChild(legend);
function showSoftness(on: boolean): void {
  mapInput.checked = on; legend.hidden = !on; viewer.setSoftnessVisible(on);
}
mapInput.addEventListener('change', () => showSoftness(mapInput.checked));
const skinPanel = skinTexturePanel(panel, state.skinTexture, async next => {
  state.skinTexture = next; await viewer.setSkinTexture(next);
});
void viewer.setSkinTexture(state.skinTexture).catch(() => { fileMsg.textContent = '肌テクスチャを開けませんでした。別の画像を選んでください。'; });
const stats = document.createElement('div');
stats.className = 'note';
panel.appendChild(stats);

const handTools = document.createElement('details'); handTools.className = 'g1'; handTools.id = 'handTools'; handTools.open = false;
handTools.innerHTML = '<summary>手・指の確認</summary><p class="note">体につながる5本指です。手・指の大きさと形は確定済みです。基本は調整済みの指の角度です。「手を開く」で伸ばした形を確認できます。GLBは連携用の開いた基準姿勢で出力します。</p>';
panel.appendChild(handTools);
const handActions = document.createElement('div'); handActions.className = 'line'; handTools.appendChild(handActions);
for (const [text, side] of [['左手を拡大', 'l'], ['右手を拡大', 'r']] as const) {
  const button = document.createElement('button'); button.className = 'btn'; button.textContent = text;
  button.addEventListener('click', () => viewer.focusHand(side)); handActions.appendChild(button);
}
const fullView = document.createElement('button'); fullView.className = 'btn'; fullView.textContent = '全身に戻す';
fullView.addEventListener('click', () => viewer.setView('front')); handActions.appendChild(fullView);
const handInterop = document.createElement('details');
handInterop.innerHTML = '<summary>連携の補助機能（JSON再生・手だけ出力）</summary>';
handTools.appendChild(handInterop);
const handExportActions = document.createElement('div'); handExportActions.className = 'line'; handInterop.appendChild(handExportActions);
for (const [text, side] of [['左手だけGLB', 'l'], ['右手だけGLB', 'r']] as const) {
  const button = document.createElement('button'); button.className = 'btn'; button.textContent = text;
  button.addEventListener('click', () => { if (pending) { pending = false; rebuild(); } if (current) download(exportHandGlb(current, side), `${safeName(state.name)}_hand_${side}.glb`, 'model/gltf-binary'); });
  handExportActions.appendChild(button);
}
const handMotionLine = document.createElement('div'); handMotionLine.className = 'line'; handInterop.appendChild(handMotionLine);
const handMotionLabel = document.createElement('label'); handMotionLabel.className = 'btn'; handMotionLabel.textContent = '指モーションJSONを開く';
const handMotionInput = document.createElement('input'); handMotionInput.type = 'file'; handMotionInput.accept = '.json,application/json'; handMotionInput.hidden = true; handMotionLabel.appendChild(handMotionInput);
const handMotionStop = document.createElement('button'); handMotionStop.className = 'btn'; handMotionStop.textContent = '指モーションを止める';
handMotionStop.addEventListener('click', () => viewer.stopHandMotion()); handMotionLine.append(handMotionLabel, handMotionStop);
const handMotionStatus = document.createElement('p'); handMotionStatus.className = 'note'; handMotionStatus.setAttribute('role', 'status');
handMotionStatus.textContent = '既存の指モーションのJSONを使う連携確認です。カメラ収録機能は指モーション側で使います。実収録データとの動作は未確認です。手だけGLBには柔らかさのデータを含めません。'; handInterop.appendChild(handMotionStatus);
handMotionInput.addEventListener('change', async () => {
  const file = handMotionInput.files?.[0]; if (!file) return;
  try {
    if (file.size > 100 * 1024 * 1024) throw new Error('100MB以下のJSONを選んでください。');
    const clip = parseHandClip(JSON.parse(await file.text())); viewer.playHandMotion(clip);
    handMotionStatus.textContent = `${file.name}：${clip.handedness === 'Left' ? '左手' : '右手'}・${clip.frames.length}フレームを再生中。`;
  } catch (error) { handMotionStatus.textContent = `開けませんでした：${error instanceof Error ? error.message : String(error)}`; }
  handMotionInput.value = '';
});

const facePanel = facePhotoPanel(panel, (photo) => {
  state.facePhoto = photo; viewer.setFacePhoto(photo, state.params);
}, () => viewer.focusFace());

const poseHost = document.createElement('details'); poseHost.className = 'g1'; poseHost.id = 'posePreview';
const poseSummary = document.createElement('summary'); poseSummary.textContent = '曲げてつながりを確認'; poseHost.appendChild(poseSummary);
panel.appendChild(poseHost);
let previewPose = defaultPreviewPose();
const poseControls: Record<string, ParamControl> = {};
const updatePose = (next: PreviewPose) => {
  const elevationChanged = previewPose.armElevation !== next.armElevation;
  previewPose = next;
  if (elevationChanged) scheduleRebuild();
  else viewer.setPose({ ...next, armElevation: null });
  for (const [key, control] of Object.entries(poseControls)) control.set(next[key as keyof PreviewPose] ?? (key === 'armElevation' ? state.params.armAngle : 0));
};
const poseButtons = document.createElement('div'); poseButtons.className = 'line'; poseHost.appendChild(poseButtons);
for (const [label, pose] of [
  ['立ち姿に戻す', defaultPreviewPose()],
  ['肩を上げる', { ...defaultPreviewPose(), armElevation: 135 }],
  ['ひじ・ひざ', { ...defaultPreviewPose(), elbow: 100, knee: 100, hip: 55 }],
  ['ひねり', { ...defaultPreviewPose(), armElevation: 90, twist: 90 }],
] as [string, PreviewPose][]) {
  const button = document.createElement('button'); button.className = 'btn'; button.textContent = label;
  button.addEventListener('click', () => updatePose(pose)); poseButtons.appendChild(button);
}
for (const [key, label, min, max, value] of [
  ['armElevation', '腕の挙上', 0, 180, state.params.armAngle], ['elbow', 'ひじを曲げる', 0, 140, 0],
  ['knee', 'ひざを曲げる', 0, 140, 0], ['hip', '脚を前に上げる', 0, 110, 0],
  ['torso', '胴を曲げる', -35, 45, 0], ['twist', '腕のひねり', -90, 90, 0],
] as [keyof PreviewPose, string, number, number, number][]) {
  poseControls[key] = paramRow(poseHost, { key: `pose_${key}`, label, unit: 'deg', def: value, min, max }, value, (v) => updatePose({ ...previewPose, [key]: v }));
}
const gripActions = document.createElement('div'); gripActions.className = 'line'; handTools.appendChild(gripActions);
for (const [label, fingers] of [['基本の握りに戻す', defaultPreviewPose()], ['手を開く', { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 }]] as const) {
  const button = document.createElement('button'); button.className = 'btn'; button.textContent = label;
  button.addEventListener('click', () => updatePose({ ...previewPose, ...Object.fromEntries(FINGERS.map((key) => [key, fingers[key]])) }));
  gripActions.appendChild(button);
}
const fingerNames = ['親指', '人差し指', '中指', '薬指', '小指'];
FINGERS.forEach((key, i) => {
  poseControls[key] = paramRow(handTools, { key: `pose_${key}`, label: `${fingerNames[i]}を曲げる`, unit: 'index', def: defaultPreviewPose()[key]!, min: 0, max: 100 }, previewPose[key]!,
    (value) => updatePose({ ...previewPose, [key]: value }));
});
const poseNote = document.createElement('p'); poseNote.className = 'note';
poseNote.textContent = '姿勢は確認用です。体の設定とGLBは立ち姿で保存・書き出しします。'; poseHost.appendChild(poseNote);

const tabBar = document.createElement('div'); tabBar.className = 'workflow-tabs'; tabBar.setAttribute('role', 'tablist'); tabBar.setAttribute('aria-label', '編集する性質');
panel.appendChild(tabBar);
const shapeHost = document.createElement('section'); shapeHost.id = 'shapePanel'; shapeHost.setAttribute('role', 'tabpanel');
const softHost = document.createElement('section'); softHost.id = 'softnessPanel'; softHost.setAttribute('role', 'tabpanel'); softHost.hidden = true;
panel.append(shapeHost, softHost);
for (const [id, label, host] of [['shape', '体の形', shapeHost], ['softness', '柔らかさ', softHost]] as const) {
  const button = document.createElement('button'); button.textContent = label; button.id = `${id}Tab`;
  button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', host.id); button.setAttribute('aria-selected', String(id === 'shape'));
  host.setAttribute('aria-labelledby', button.id);
  button.addEventListener('click', () => {
    shapeHost.hidden = host !== shapeHost; softHost.hidden = host !== softHost;
    for (const tab of tabBar.children) tab.setAttribute('aria-selected', String(tab === button));
    showSoftness(host === softHost);
  });
  tabBar.appendChild(button);
}
const softPanel = softnessPanel(softHost, state.softness, {
  change: (next) => { state.softness = normalizeSoftness(next); updateSoftness(); },
  impulse: () => viewer.testImpulse(), stop: () => viewer.stopImpulse(),
});
heading(shapeHost, '体の形');
const bodyLine = line('<label for="bodyPreset">体型プリセット</label>', shapeHost);
const bodySel = document.createElement('select');
bodySel.id = 'bodyPreset';
for (const [k, v] of Object.entries(BODY_PRESETS)) bodySel.add(new Option(v.label, k));
bodySel.value = state.bodyPreset;
bodySel.addEventListener('change', () => applySettings({ bodyPreset: bodySel.value as BodyPresetName, preset: state.preset, name: state.name, softness: state.softness, facePhoto: state.facePhoto, skinTexture: state.skinTexture }));
bodyLine.appendChild(bodySel);
const note = document.createElement('p');
note.className = 'note';
note.textContent = '大項目 → 中項目 → 小項目の順に開いて調整します。手・指は確定した形状です。指の曲げ具合は「手・指の確認」で調整できます。';
shapeHost.appendChild(note);
const treeHost = document.createElement('div');
shapeHost.appendChild(treeHost);
const controls: Record<string, ParamControl> = paramTree(
  treeHost,
  GROUPS.map(group => group.key === 'arm' ? {
    ...group,
    // Retain schema values for saved files, but omit the accepted hand shape
    // from editable controls, including hand dimensions that rescale fingers.
    sections: group.sections.filter(section => !['hand', 'thumb', 'index', 'middle', 'ring', 'pinky', 'fingerShape'].includes(section.key)),
  } : group.key === 'breast' ? {
    ...group,
    sections: group.sections.map(section => ({ ...section, params: section.params.map(def => ({ ...def, rangeCenter: state.params[def.key] })) })),
  } : group.key === 'torso' ? {
    ...group,
    sections: group.sections.map(section => ['hip', 'gluteFine', 'waist'].includes(section.key)
      ? { ...section, params: section.params.map(def => ({ ...def, rangeCenter: state.params[def.key] })) }
      : section),
  } : group),
  state.params,
  (key, v) => {
    state.params[key] = v;
    if (key === 'armAngle' && previewPose.armElevation == null) poseControls.armElevation?.set(v);
    scheduleRebuild();
  },
  [],
);
const unitNote = document.createElement('p');
unitNote.className = 'note';
unitNote.textContent = '単位はメートル、+Y が上、+Z が体の前、床が y = 0 です。';
shapeHost.appendChild(unitNote);

document.querySelectorAll<HTMLButtonElement>('#viewButtons button').forEach((b) => b.addEventListener('click', () => viewer.setView(b.dataset.view as ViewName)));

function settings(): SettingsJson {
  return { format: SETTINGS_FORMAT, name: state.name, preset: state.preset, bodyPreset: state.bodyPreset, params: { ...state.params }, softness: structuredClone(state.softness), facePhoto: state.facePhoto ? structuredClone(state.facePhoto) : null, skinTexture: { ...state.skinTexture } };
}

function applySettings(j: SettingsJson): void {
  if (j.format && j.format !== SETTINGS_FORMAT) throw new Error('スペアボディの体の設定ファイルではありません。');
  const facePhoto = normalizeFacePhoto(j.facePhoto);
  const skinTexture = normalizeSkinTexture(j.skinTexture);
  state.name = j.name ? safeName(j.name) : state.name;
  state.preset = j.preset && j.preset in PRESETS ? j.preset : state.preset;
  state.bodyPreset = j.bodyPreset && j.bodyPreset in BODY_PRESETS ? j.bodyPreset : 'female';
  state.params = clampParams({ ...presetParams(state.bodyPreset), ...(j.params ?? {}) });
  state.softness = normalizeSoftness(j.softness);
  state.facePhoto = facePhoto;
  state.skinTexture = skinTexture;
  skinPanel.set(skinTexture);
  void viewer.setSkinTexture(skinTexture).catch(() => { fileMsg.textContent = '肌テクスチャを開けませんでした。'; });
  void facePanel.set(facePhoto);
  nameIn.value = state.name;
  presetSel.value = state.preset;
  bodySel.value = state.bodyPreset;
  const defaults = presetParams(state.bodyPreset);
  for (const [k, c] of Object.entries(controls)) { c.setDefault?.(defaults[k]); c.set(state.params[k]); }
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
