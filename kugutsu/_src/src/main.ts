// 傀儡: load a body made with スペアボディ (skinned GLB) and move it with a motion JSON from 「モーション」.
import './style.css';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Viewer, type ViewName } from './viewer';
import { parseClip, sampleJoints, type MotionClip } from './motion/clip';
import { rigFromScene, resetRig, type Rig } from './motion/rig';
import { applyPose, computePose } from './motion/retarget';
import { demoClip } from './motion/demo';

if (new URLSearchParams(location.search).has('shots')) document.body.classList.add('shots');

const viewer = new Viewer(document.getElementById('c') as HTMLCanvasElement);
let rig: Rig | null = null;
const player = { clip: null as MotionClip | null, t: 0, playing: false, speed: 1, loop: true };

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

// ---------------- motion ----------------
heading('動き（「モーション」の JSON）');
const mLine1 = line();
mLine1.append(
  button('サンプルの動き', () => loadMotion(demoClip(), 'サンプル（歩く・手を振る）')),
  filePicker('動き（JSON）を開く', '.json,application/json', (f) => loadMotionFile(f)),
);
const motionInfo = note('動きを開くと再生が始まります。');
const playBtn = button('▶ 再生', () => setPlaying(!player.playing), true);
const prevBtn = button('◀ 1コマ', () => step(-1));
const nextBtn = button('1コマ ▶', () => step(1));
const restBtn = button('立ち姿に戻す', () => {
  setPlaying(false);
  if (rig) resetRig(rig);
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

document.querySelectorAll<HTMLButtonElement>('#viewButtons button').forEach((b) => b.addEventListener('click', () => viewer.setView(b.dataset.view as ViewName)));

// ---------------- logic ----------------
function setPlaying(on: boolean): void {
  player.playing = on;
  playBtn.textContent = on ? '⏸ 一時停止' : '▶ 再生';
}

function showFrame(): void {
  const c = player.clip;
  if (!c) return;
  const s = sampleJoints(c, player.t, player.loop);
  if (rig) applyPose(rig, computePose(rig, s.joints, s.root, c.root ? c.root[0] : null));
  timeRange.value = String(s.frame);
  timeInfo.textContent = `${player.t.toFixed(2)} / ${c.duration.toFixed(2)} 秒（${s.frame + 1} / ${c.frames.length} コマ）`;
  viewer.requestRender();
}

function step(k: number): void {
  const c = player.clip;
  if (!c) return;
  setPlaying(false);
  const f = Math.min(c.frames.length - 1, Math.max(0, Math.round(player.t * c.fps) + k));
  player.t = f / c.fps;
  showFrame();
}

timeRange.addEventListener('input', () => {
  const c = player.clip;
  if (!c) return;
  setPlaying(false);
  player.t = Number(timeRange.value) / c.fps;
  showFrame();
});

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

async function loadBody(data: ArrayBuffer, name: string): Promise<void> {
  try {
    const gltf = await new GLTFLoader().parseAsync(data, '');
    const r = rigFromScene(gltf.scene);
    rig = r;
    viewer.setBody(gltf.scene);
    const fmt = (gltf.parser.json.scenes?.[0]?.extras as { format?: string } | undefined)?.format;
    bodyInfo.textContent =
      `${name}：骨 ${r.rest.size} 本・高さ ${(r.height * 100).toFixed(1)} cm` +
      (fmt === 'spare-body-glb-v1' ? '' : '（スペアボディ以外の GLB）') +
      (r.missing.length ? `。足りない骨：${r.missing.join('・')}（その部分は動きません）` : '');
    if (player.clip) showFrame();
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
  await loadBody(await res.arrayBuffer(), name);
}
async function loadBodyFile(f: File): Promise<void> {
  await loadBody(await f.arrayBuffer(), f.name);
}

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
    motionInfo.textContent = `動きを開けませんでした：${e instanceof Error ? e.message : String(e)}`;
  }
}
async function loadMotionFile(f: File): Promise<void> {
  try {
    loadMotion(JSON.parse(await f.text()), f.name);
  } catch (e) {
    motionInfo.textContent = `動きを開けませんでした：${e instanceof Error ? e.message : String(e)}`;
  }
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
      info(): { vertices: number; triangles: number; warnings: string[] };
      setSkeleton(on: boolean): void;
      loadDemoMotion(): void;
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
  info: () => ({ vertices: rig ? rig.mesh.geometry.getAttribute('position').count : 0, triangles: rig ? (rig.mesh.geometry.index?.count ?? 0) / 3 : 0, warnings: rig?.missing ?? [] }),
  setSkeleton: (on) => viewer.setSkeletonVisible(on),
  loadDemoMotion: () => loadMotion(demoClip(), 'サンプル（歩く・手を振る）'),
  setTime: async (t) => {
    setPlaying(false);
    player.t = t;
    showFrame();
    await viewer.renderNow();
  },
  loadBody: (url) => loadBodyUrl(url, url),
};
