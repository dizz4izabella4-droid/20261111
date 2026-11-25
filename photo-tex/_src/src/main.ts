import './style.css';
import { BODY_DEFS, BREAST_DEFS, BODY_PRESETS, PRESETS, presetParams, type BodyPresetName, type PresetName } from './model/params';
import { buildBaseMesh, type BaseMesh } from './model/mesh';
import { exportBaseGlb } from './export/exportBase';
import { Viewer, type ViewName } from './viewer';
import { heading, paramRow, type ParamControl } from './ui/panel';
import { parseProject, serializeProject, type Project, type ProjectJson } from './project';

function defaultPreset(): PresetName {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) < 900;
  return coarse && small ? 'light' : 'standard';
}

const shotsMode = new URLSearchParams(location.search).has('shots');
if (shotsMode) document.body.classList.add('shots');

const state: Project = { preset: defaultPreset(), bodyPreset: 'female', params: presetParams('female') };
const viewer = new Viewer(document.getElementById('c') as HTMLCanvasElement);
let current: BaseMesh | null = null;

const warningsEl = document.getElementById('warnings') as HTMLDivElement;
function rebuild(): void {
  current = buildBaseMesh(state.params, state.preset);
  viewer.setBase(current);
  const w = current.warnings;
  warningsEl.hidden = w.length === 0;
  warningsEl.textContent = w.join(' ');
  updateStats();
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
heading(panel, '写真分析成形 — 素体', 'h1');

heading(panel, '表示');
const presetLine = document.createElement('div');
presetLine.className = 'line';
presetLine.innerHTML = '<label for="preset">性能プリセット</label>';
const presetSel = document.createElement('select');
presetSel.id = 'preset';
for (const [k, v] of Object.entries(PRESETS)) {
  const o = document.createElement('option');
  o.value = k;
  o.textContent = `${v.label}（${v.segments}×${v.rings}）`;
  presetSel.appendChild(o);
}
presetSel.value = state.preset;
presetSel.addEventListener('change', () => {
  state.preset = presetSel.value as PresetName;
  scheduleRebuild();
});
presetLine.appendChild(presetSel);
panel.appendChild(presetLine);
const wireLine = document.createElement('div');
wireLine.className = 'line';
wireLine.innerHTML = '<label><input type="checkbox" id="wire"> ワイヤーフレームを重ねる</label>';
panel.appendChild(wireLine);
(wireLine.querySelector('#wire') as HTMLInputElement).addEventListener('change', (e) => viewer.setWireframe((e.target as HTMLInputElement).checked));
const stats = document.createElement('div');
stats.className = 'note';
panel.appendChild(stats);
function updateStats(): void {
  if (!current) return;
  stats.textContent = `頂点 ${(current.positions.length / 3).toLocaleString()}・三角形 ${(current.indices.length / 3).toLocaleString()}`;
}

const controls: Record<string, ParamControl> = {};
heading(panel, '体型（胴）');
const bodyLine = document.createElement('div');
bodyLine.className = 'line';
bodyLine.innerHTML = '<label for="bodyPreset">体型プリセット</label>';
const bodySel = document.createElement('select');
bodySel.id = 'bodyPreset';
for (const [k, v] of Object.entries(BODY_PRESETS)) {
  const o = document.createElement('option');
  o.value = k;
  o.textContent = v.label;
  bodySel.appendChild(o);
}
bodySel.value = state.bodyPreset;
bodySel.addEventListener('change', () => {
  const name = bodySel.value as BodyPresetName;
  applyProject({ preset: state.preset, bodyPreset: name, params: presetParams(name) });
});
bodyLine.appendChild(bodySel);
panel.appendChild(bodyLine);
const bodyNote = document.createElement('p');
bodyNote.className = 'note';
bodyNote.textContent = '初期値は仮の値です（統計データにもとづくものではありません）。';
panel.appendChild(bodyNote);
for (const d of BODY_DEFS)
  controls['body.' + d.key] = paramRow(panel, d, (state.params.body as any)[d.key], (v) => {
    (state.params.body as any)[d.key] = v;
    scheduleRebuild();
  });
heading(panel, '胸（左右対称）');
for (const d of BREAST_DEFS)
  controls['breast.' + d.key] = paramRow(panel, d, (state.params.breast as any)[d.key], (v) => {
    (state.params.breast as any)[d.key] = v;
    scheduleRebuild();
  });

heading(panel, '書き出し');
const exportLine = document.createElement('div');
exportLine.className = 'line';
const glbBtn = document.createElement('button');
glbBtn.className = 'btn primary';
glbBtn.textContent = 'GLB を書き出す（素体のみ）';
glbBtn.addEventListener('click', () => {
  if (!current) return;
  const blob = new Blob([exportBaseGlb(current)], { type: 'model/gltf-binary' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'bust_base.glb';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});
exportLine.appendChild(glbBtn);
panel.appendChild(exportLine);
const unitNote = document.createElement('p');
unitNote.className = 'note';
unitNote.textContent = '単位はメートル、+Y が上、+Z が体の前です。';
panel.appendChild(unitNote);

document.querySelectorAll<HTMLButtonElement>('#viewButtons button').forEach((b) =>
  b.addEventListener('click', () => viewer.setView(b.dataset.view as ViewName)),
);

function applyProject(p: Project): void {
  state.preset = p.preset;
  state.bodyPreset = p.bodyPreset;
  bodySel.value = p.bodyPreset;
  state.params = p.params;
  presetSel.value = p.preset;
  for (const d of BODY_DEFS) controls['body.' + d.key].set((p.params.body as any)[d.key]);
  for (const d of BREAST_DEFS) controls['breast.' + d.key].set((p.params.breast as any)[d.key]);
  rebuild();
}

rebuild();

// automation hook used by `npm run shots` (scripts/shots.mjs)
declare global {
  interface Window {
    __bust?: {
      loadProject(json: ProjectJson): void;
      setView(v: ViewName): Promise<void>;
      getProject(): ProjectJson;
      info(): { vertices: number; triangles: number; warnings: string[] };
      closeup(landmark: string, distance: number, wire: boolean, nippleDiameter?: number): Promise<void>;
    };
  }
}
window.__bust = {
  loadProject: (json) => applyProject(parseProject(json, state.preset)),
  setView: async (v) => {
    viewer.setView(v);
    await viewer.renderNow();
  },
  getProject: () => serializeProject(state),
  closeup: async (lm, distance, wire, nippleDiameter) => {
    if (nippleDiameter !== undefined) {
      state.params.breast.nippleDiameter = nippleDiameter;
      controls['breast.nippleDiameter'].set(nippleDiameter);
      rebuild();
    }
    const p = current!.landmarks[lm];
    viewer.lookAtPoint(p, distance);
    viewer.setWireframe(wire);
    await viewer.renderNow();
  },
  info: () => ({ vertices: current ? current.positions.length / 3 : 0, triangles: current ? current.indices.length / 3 : 0, warnings: current?.warnings ?? [] }),
};
