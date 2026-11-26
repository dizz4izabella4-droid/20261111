// "写真の分析" panel: photo import (1枚 mode), view, landmarks with undo/redo, camera fit with
// residuals and manual override (SPEC 6.4), analysis settings (7.1), run in a Web Worker with
// progress and cancel (11.2), and the patch list (show/hide, 破棄).
import type { ModelParams, PresetName } from '../model/params';
import { BodyModel, buildBaseMesh } from '../model/mesh';
import { VIEW_LABELS, Projector, type Camera, type CameraFit, type ViewId } from '../analysis/camera';
import { landmarkDefs, minLandmarks } from '../analysis/landmarks';
import { fitCameraFromLandmarks, defaultSettings, type AnalysisSettings } from '../analysis/pipeline';
import type { WorkerMessage, WorkerRequest } from '../analysis/worker';
import type { Patch } from '../patch/patch';
import { PhotoEditor } from './photoEditor';
import { heading } from './panel';

export interface PhotoState {
  id: string;
  name: string;
  view: ViewId;
  bitmap: CanvasImageSource;
  width: number;
  height: number;
  landmarks: Record<string, [number, number]>;
  /** manual override on top of the fitted camera */
  override: { yaw: number; pitch: number; roll: number; scale: number; dx: number; dy: number };
  analyzedWith?: string; // landmark snapshot used for the last analysis (stale detection)
}

export interface AnalysisHost {
  params(): ModelParams;
  preset(): PresetName;
  patches(): Patch[];
  setPatches(p: Patch[]): void;
  setMode(mode: '3d' | 'photo'): void;
}

/** long side limit for imported photos (memory on phones) */
export const MAX_PHOTO_SIDE = 3000;
const DEG = Math.PI / 180;

export class AnalysisPanel {
  photo: PhotoState | null = null;
  private selected: string | null = null;
  private undo: Record<string, [number, number]>[] = [];
  private redo: Record<string, [number, number]>[] = [];
  private fit: CameraFit | null = null;
  private wire: Float32Array | null = null;
  private settings: AnalysisSettings;
  private worker: Worker | null = null;
  private runId = 0;
  readonly editor: PhotoEditor;
  private el: Record<string, HTMLElement> = {};
  private patchSeq = 1;

  constructor(private panel: HTMLElement, photoCanvas: HTMLCanvasElement, private host: AnalysisHost) {
    this.settings = defaultSettings(host.preset());
    this.editor = new PhotoEditor(photoCanvas, {
      onLandmark: (id, pos, commit) => this.placeLandmark(id, pos, commit),
      selected: () => this.selected,
      landmarks: () => this.photo?.landmarks ?? {},
      labels: () => Object.fromEntries((this.photo ? landmarkDefs(this.photo.view) : []).map((d) => [d.id, d.label])),
      wireframe: () => this.wire,
      residuals: () => this.fit?.residuals ?? {},
    });
    this.build();
  }

  // ---------------------------------------------------------------- UI
  private build(): void {
    const p = this.panel;
    heading(p, '写真の分析（1枚）');
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = '写真はこの端末の中だけで処理されます（どこにも送信しません）。複数枚・精密モードは今後追加します。';
    p.appendChild(note);

    const fileLine = this.line();
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = 'image/jpeg,image/png,image/heic,image/heif,image/*';
    file.id = 'photoFile';
    const fileBtn = document.createElement('label');
    fileBtn.className = 'btn';
    fileBtn.htmlFor = 'photoFile';
    fileBtn.textContent = '写真を選ぶ';
    file.style.display = 'none';
    file.addEventListener('change', () => file.files?.[0] && this.importFile(file.files[0]));
    fileLine.append(fileBtn, file);
    const viewSel = document.createElement('select');
    viewSel.setAttribute('aria-label', '写真の向き');
    for (const [k, v] of Object.entries(VIEW_LABELS)) viewSel.add(new Option(v, k));
    viewSel.addEventListener('change', () => {
      if (!this.photo) return;
      this.photo.view = viewSel.value as ViewId;
      this.selected = null;
      this.refit();
      this.renderList();
    });
    const vl = document.createElement('label');
    vl.textContent = '向き';
    fileLine.append(vl, viewSel);
    this.el.viewSel = viewSel;
    const photoName = document.createElement('div');
    photoName.className = 'note';
    p.appendChild(photoName);
    this.el.photoName = photoName;

    const modeLine = this.line();
    const toPhoto = this.button('写真と目印を表示', () => this.host.setMode('photo'));
    const to3d = this.button('3D を表示', () => this.host.setMode('3d'));
    modeLine.append(toPhoto, to3d);

    // landmarks
    const lmHead = document.createElement('div');
    lmHead.className = 'note';
    lmHead.textContent = '一覧で目印を選び、写真をタップ（クリック）して置きます。置いた点はドラッグで直せます。拡大：ホイール／2本指。';
    p.appendChild(lmHead);
    const list = document.createElement('div');
    list.className = 'lmlist';
    p.appendChild(list);
    this.el.list = list;
    const ur = this.line();
    ur.append(
      this.button('元に戻す', () => this.undoStep()),
      this.button('やり直す', () => this.redoStep()),
      this.button('選んだ目印を消す', () => this.removeSelected()),
    );
    const op = this.line();
    const opl = document.createElement('label');
    opl.textContent = '素体の線の濃さ';
    const ops = document.createElement('input');
    ops.type = 'range';
    ops.min = '0';
    ops.max = '1';
    ops.step = '0.05';
    ops.value = String(this.editor.opacity);
    ops.addEventListener('input', () => {
      this.editor.opacity = Number(ops.value);
      this.editor.redraw();
    });
    op.append(opl, ops);

    // camera
    const fitInfo = document.createElement('div');
    fitInfo.className = 'note';
    p.appendChild(fitInfo);
    this.el.fitInfo = fitInfo;
    const det = document.createElement('details');
    const sum = document.createElement('summary');
    sum.textContent = 'カメラの手動調整';
    det.appendChild(sum);
    const ov: [keyof PhotoState['override'], string, number, number, number][] = [
      ['yaw', '左右の回転（°）', -30, 30, 0.5],
      ['pitch', '上下の回転（°）', -30, 30, 0.5],
      ['roll', '傾き（°）', -30, 30, 0.5],
      ['scale', '大きさ（%）', -30, 30, 0.5],
      ['dx', '左右の位置（px）', -300, 300, 1],
      ['dy', '上下の位置（px）', -300, 300, 1],
    ];
    this.el.ovInputs = document.createElement('div');
    for (const [key, label, min, max, step] of ov) {
      const row = document.createElement('div');
      row.className = 'line';
      const l = document.createElement('label');
      l.textContent = label;
      l.style.minWidth = '9em';
      const r = document.createElement('input');
      r.type = 'range';
      r.min = String(min);
      r.max = String(max);
      r.step = String(step);
      r.value = '0';
      r.dataset.key = key;
      const v = document.createElement('span');
      v.textContent = '0';
      r.addEventListener('input', () => {
        if (!this.photo) return;
        this.photo.override[key] = Number(r.value);
        v.textContent = r.value;
        this.updateWire();
        this.markStale();
      });
      row.append(l, r, v);
      this.el.ovInputs.appendChild(row);
    }
    det.appendChild(this.el.ovInputs);
    det.appendChild(this.button('手動調整を戻す', () => this.resetOverride()));
    p.appendChild(det);

    // settings
    const sdet = document.createElement('details');
    const ss = document.createElement('summary');
    ss.textContent = '分析の設定';
    sdet.appendChild(ss);
    const num = (label: string, key: keyof AnalysisSettings, min: number, max: number, step: number) => {
      const row = document.createElement('div');
      row.className = 'line';
      const l = document.createElement('label');
      l.textContent = label;
      l.style.minWidth = '12em';
      const i = document.createElement('input');
      i.type = 'number';
      i.min = String(min);
      i.max = String(max);
      i.step = String(step);
      i.value = String(this.settings[key]);
      i.style.width = '6em';
      i.addEventListener('change', () => {
        const v = Math.min(max, Math.max(min, Number(i.value)));
        (this.settings as unknown as Record<string, number>)[key] = v;
        i.value = String(v);
      });
      row.append(l, i);
      sdet.appendChild(row);
      return i;
    };
    const resRow = document.createElement('div');
    resRow.className = 'line';
    const resL = document.createElement('label');
    resL.textContent = '解析解像度';
    resL.style.minWidth = '12em';
    const resSel = document.createElement('select');
    for (const r of [256, 512, 1024]) resSel.add(new Option(`${r} px`, String(r)));
    resSel.value = String(this.settings.analysisRes);
    resSel.addEventListener('change', () => (this.settings.analysisRes = Number(resSel.value)));
    resRow.append(resL, resSel);
    sdet.appendChild(resRow);
    num('ギザギザ補正の強さ（mm）', 'smoothMm', 0, 40, 1);
    num('最大変位（mm）', 'maxDispMm', 5, 60, 1);
    num('素体への引き寄せ（0〜1）', 'priorWeight', 0, 1, 0.05);
    num('色ちがいの除外（k）', 'albedoK', 1, 6, 0.5);
    const lmRow = document.createElement('div');
    lmRow.className = 'line';
    const lmL = document.createElement('label');
    lmL.textContent = '光のモデル';
    lmL.style.minWidth = '12em';
    const lmSel = document.createElement('select');
    lmSel.add(new Option('1灯＋環境光', 'directional'));
    lmSel.add(new Option('球面調和（2次）', 'sh2'));
    lmSel.value = this.settings.lightModel;
    lmSel.addEventListener('change', () => (this.settings.lightModel = lmSel.value as AnalysisSettings['lightModel']));
    lmRow.append(lmL, lmSel);
    sdet.appendChild(lmRow);
    p.appendChild(sdet);

    // run
    const runLine = this.line();
    const run = this.button('分析する', () => this.run());
    run.classList.add('primary');
    const cancel = this.button('中止', () => this.cancel());
    cancel.hidden = true;
    runLine.append(run, cancel);
    this.el.run = run;
    this.el.cancel = cancel;
    const prog = document.createElement('div');
    prog.className = 'progress';
    prog.hidden = true;
    prog.innerHTML = '<div class="bar"><div class="fill"></div></div><div class="step note"></div>';
    p.appendChild(prog);
    this.el.prog = prog;
    const msg = document.createElement('div');
    msg.className = 'note';
    p.appendChild(msg);
    this.el.msg = msg;

    // patches
    heading(p, 'パーツ（肌色）');
    const pl = document.createElement('div');
    pl.className = 'patchlist';
    p.appendChild(pl);
    this.el.patchList = pl;
    this.renderList();
    this.renderPatches();
  }

  private line(): HTMLDivElement {
    const l = document.createElement('div');
    l.className = 'line';
    this.panel.appendChild(l);
    return l;
  }
  private button(text: string, fn: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn';
    b.textContent = text;
    b.addEventListener('click', fn);
    return b;
  }

  // ---------------------------------------------------------------- photo
  async importFile(f: File): Promise<void> {
    let bmp: ImageBitmap;
    try {
      bmp = await createImageBitmap(f, { imageOrientation: 'from-image' });
    } catch {
      // fallback through <img> (e.g. HEIC in Safari)
      const url = URL.createObjectURL(f);
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        bmp = await createImageBitmap(img);
      } catch {
        this.el.msg.textContent = 'この写真の形式はこのブラウザでは読めません（JPEG か PNG にしてください）。';
        return;
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    await this.setPhoto(bmp, f.name, (this.el.viewSel as HTMLSelectElement).value as ViewId, {});
    this.host.setMode('photo');
  }

  async setPhoto(src: ImageBitmap | HTMLImageElement, name: string, view: ViewId, landmarks: Record<string, [number, number]>): Promise<void> {
    let w = 'naturalWidth' in src ? src.naturalWidth : src.width;
    let h = 'naturalHeight' in src ? src.naturalHeight : src.height;
    let bitmap: CanvasImageSource = src;
    const k = Math.min(1, MAX_PHOTO_SIDE / Math.max(w, h));
    if (k < 1) {
      w = Math.round(w * k);
      h = Math.round(h * k);
      bitmap = await createImageBitmap(src, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
    }
    this.photo = { id: `photo_${Date.now()}`, name, view, bitmap, width: w, height: h, landmarks: { ...landmarks }, override: { yaw: 0, pitch: 0, roll: 0, scale: 0, dx: 0, dy: 0 } };
    (this.el.viewSel as HTMLSelectElement).value = view;
    this.el.photoName.textContent = `${name}（${w}×${h}）`;
    this.undo = [];
    this.redo = [];
    this.selected = this.nextUnplaced();
    this.editor.setPhoto({ bitmap, width: w, height: h });
    this.refit();
    this.renderList();
  }

  // ---------------------------------------------------------------- landmarks
  private snapshot(): Record<string, [number, number]> {
    return JSON.parse(JSON.stringify(this.photo?.landmarks ?? {}));
  }
  private dragStart: Record<string, [number, number]> | null = null;
  private placeLandmark(id: string, pos: [number, number], commit: boolean): void {
    if (!this.photo) return;
    if (!this.dragStart) this.dragStart = this.snapshot();
    this.photo.landmarks[id] = pos;
    if (commit) {
      this.undo.push(this.dragStart);
      this.redo = [];
      this.dragStart = null;
      if (this.selected === id) this.selected = this.nextUnplaced() ?? id;
      this.refit();
      this.renderList();
      this.markStale();
    } else {
      this.editor.redraw();
    }
  }
  private nextUnplaced(): string | null {
    if (!this.photo) return null;
    const d = landmarkDefs(this.photo.view).find((x) => !this.photo!.landmarks[x.id]);
    return d ? d.id : null;
  }
  private undoStep(): void {
    if (!this.photo || !this.undo.length) return;
    this.redo.push(this.snapshot());
    this.photo.landmarks = this.undo.pop()!;
    this.refit();
    this.renderList();
    this.markStale();
  }
  private redoStep(): void {
    if (!this.photo || !this.redo.length) return;
    this.undo.push(this.snapshot());
    this.photo.landmarks = this.redo.pop()!;
    this.refit();
    this.renderList();
    this.markStale();
  }
  private removeSelected(): void {
    if (!this.photo || !this.selected || !this.photo.landmarks[this.selected]) return;
    this.undo.push(this.snapshot());
    this.redo = [];
    delete this.photo.landmarks[this.selected];
    this.refit();
    this.renderList();
    this.markStale();
  }

  private renderList(): void {
    const list = this.el.list;
    list.textContent = '';
    if (!this.photo) {
      list.textContent = '（写真を選ぶと目印の一覧が出ます）';
      return;
    }
    const res = this.fit?.residuals ?? {};
    const longSide = Math.max(this.photo.width, this.photo.height);
    for (const d of landmarkDefs(this.photo.view)) {
      const row = document.createElement('label');
      row.className = 'lm' + (d.id === this.selected ? ' sel' : '');
      const r = document.createElement('input');
      r.type = 'radio';
      r.name = 'lmsel';
      r.checked = d.id === this.selected;
      r.addEventListener('change', () => {
        this.selected = d.id;
        this.renderList();
        this.editor.redraw();
      });
      const placed = !!this.photo.landmarks[d.id];
      const e = res[d.id];
      const t = document.createElement('span');
      t.textContent = `${placed ? '✓' : '・'} ${d.label}${d.optional ? '（任意）' : ''}`;
      const rr = document.createElement('span');
      rr.className = 'res';
      if (e !== undefined) {
        rr.textContent = `${e.toFixed(1)}px`;
        if (e > 0.03 * longSide) rr.classList.add('bad');
      }
      row.append(r, t, rr);
      list.appendChild(row);
    }
  }

  // ---------------------------------------------------------------- camera
  refit(): void {
    this.fit = null;
    if (this.photo) {
      const n = Object.keys(this.photo.landmarks).length;
      const need = minLandmarks(this.photo.view);
      if (n >= Math.max(4, need)) {
        try {
          this.fit = fitCameraFromLandmarks(new BodyModel(this.host.params()), this.photo.view, this.photo.landmarks, Math.max(this.photo.width, this.photo.height));
        } catch {
          this.fit = null;
        }
      }
      const longSide = Math.max(this.photo.width, this.photo.height);
      if (this.fit) {
        const bad = Object.values(this.fit.residuals).filter((e) => e > 0.03 * longSide).length;
        this.el.fitInfo.textContent = `位置合わせ：平均のずれ ${this.fit.rms.toFixed(1)}px（最大 ${this.fit.maxResidual.toFixed(1)}px）` + (bad ? ` ⚠ 写真の長辺の3%を超える目印が ${bad} 点あります。置き直してください。` : '');
      } else this.el.fitInfo.textContent = `位置合わせ：目印をあと ${Math.max(0, Math.max(4, need) - n)} 点以上置いてください。`;
    } else this.el.fitInfo.textContent = '';
    this.updateWire();
  }

  /** fitted camera with the manual override applied */
  camera(): Camera | null {
    if (!this.fit || !this.photo) return null;
    const o = this.photo.override;
    const c = this.fit.camera;
    return { yaw: c.yaw + o.yaw * DEG, pitch: c.pitch + o.pitch * DEG, roll: c.roll + o.roll * DEG, s: c.s * (1 + o.scale / 100), tx: c.tx + o.dx, ty: c.ty + o.dy };
  }

  private resetOverride(): void {
    if (!this.photo) return;
    this.photo.override = { yaw: 0, pitch: 0, roll: 0, scale: 0, dx: 0, dy: 0 };
    this.el.ovInputs.querySelectorAll('input').forEach((i) => {
      (i as HTMLInputElement).value = '0';
      (i.nextElementSibling as HTMLElement).textContent = '0';
    });
    this.updateWire();
    this.markStale();
  }

  /** template wireframe (Light grid) projected with the current camera, front-facing segments only */
  updateWire(): void {
    const cam = this.camera();
    if (!cam) {
      this.wire = null;
      this.editor.redraw();
      return;
    }
    const mesh = buildBaseMesh(this.host.params(), 'light');
    const P = new Projector(cam);
    const v = P.viewDir();
    const cols = mesh.segments + 1;
    const segs: number[] = [];
    const front = (k: number) => mesh.normals[k * 3] * v[0] + mesh.normals[k * 3 + 1] * v[1] + mesh.normals[k * 3 + 2] * v[2] > 0;
    const pr = (k: number) => P.project(mesh.positions[k * 3], mesh.positions[k * 3 + 1], mesh.positions[k * 3 + 2]);
    for (let i = 0; i < mesh.rings; i++)
      for (let j = 0; j < mesh.segments; j++) {
        const a = i * cols + j;
        for (const b of [a + 1, i < mesh.rings - 1 ? a + cols : -1]) {
          if (b < 0 || !front(a) || !front(b)) continue;
          const pa = pr(a), pb = pr(b);
          segs.push(pa[0], pa[1], pb[0], pb[1]);
        }
      }
    this.wire = Float32Array.from(segs);
    this.editor.redraw();
  }

  /** template parameters changed */
  onParamsChanged(): void {
    if (this.photo) this.refit();
  }

  private markStale(): void {
    if (!this.photo?.analyzedWith) return;
    const now = JSON.stringify([this.photo.landmarks, this.photo.override]);
    this.el.msg.textContent = now !== this.photo.analyzedWith ? '目印が変わりました。「分析する」で分析し直せます。' : '';
  }

  // ---------------------------------------------------------------- analysis
  private async imageData(): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
    const p = this.photo!;
    const c = document.createElement('canvas');
    c.width = p.width;
    c.height = p.height;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(p.bitmap, 0, 0, p.width, p.height);
    const id = ctx.getImageData(0, 0, p.width, p.height);
    return { width: p.width, height: p.height, data: id.data };
  }

  async run(): Promise<void> {
    const cam = this.camera();
    if (!this.photo || !cam) {
      this.el.msg.textContent = '先に写真を選び、目印を置いてください。';
      return;
    }
    this.cancel();
    const id = ++this.runId;
    const photo = this.photo;
    const image = await this.imageData();
    const worker = new Worker(new URL('../analysis/worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    this.el.run.hidden = true;
    this.el.cancel.hidden = false;
    this.el.prog.hidden = false;
    this.el.msg.textContent = '';
    const fill = this.el.prog.querySelector('.fill') as HTMLElement;
    const step = this.el.prog.querySelector('.step') as HTMLElement;
    fill.style.width = '0%';
    step.textContent = '準備';
    const t0 = performance.now();
    const settings = { ...this.settings };
    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.type === 'progress') {
        fill.style.width = `${Math.round(m.fraction * 100)}%`;
        step.textContent = m.step;
      } else if (m.type === 'done') {
        const r = m.result;
        const patch: Patch = {
          id: `p${this.patchSeq}`,
          name: `パーツ ${this.patchSeq++}（${VIEW_LABELS[r.view]}）`,
          sourcePhotoIds: [photo.id],
          mode: 'single',
          view: r.view,
          grid: r.grid,
          region: r.region,
          dRaw: r.dRaw,
          d: r.dSmooth,
          conf: r.conf,
          gain: 1,
          visible: true,
          settings: settings as unknown as Record<string, unknown>,
        };
        this.host.setPatches([...this.host.patches(), patch]);
        photo.analyzedWith = JSON.stringify([photo.landmarks, photo.override]);
        this.el.msg.textContent = `分析が終わりました（${((performance.now() - t0) / 1000).toFixed(1)} 秒）。`;
        this.finish();
        this.host.setMode('3d');
      } else {
        this.el.msg.textContent = `分析できませんでした：${m.message}`;
        this.finish();
      }
    };
    worker.onerror = (e) => {
      this.el.msg.textContent = `分析できませんでした：${e.message}`;
      this.finish();
    };
    const req: WorkerRequest = {
      id,
      input: { image, view: photo.view, landmarks: photo.landmarks, camera: cam, params: this.host.params(), settings },
    };
    worker.postMessage(req, [image.data.buffer]);
  }

  cancel(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.el.msg.textContent = '中止しました。';
    }
    this.finish();
  }

  private finish(): void {
    if (this.worker) this.worker.terminate();
    this.worker = null;
    this.el.run.hidden = false;
    this.el.cancel.hidden = true;
    this.el.prog.hidden = true;
  }

  // ---------------------------------------------------------------- patches
  renderPatches(): void {
    const pl = this.el.patchList;
    pl.textContent = '';
    const ps = this.host.patches();
    if (!ps.length) {
      pl.textContent = '（まだありません）';
      return;
    }
    for (const p of ps) {
      const row = document.createElement('div');
      row.className = 'line';
      const vis = document.createElement('input');
      vis.type = 'checkbox';
      vis.checked = p.visible;
      vis.setAttribute('aria-label', `${p.name}を表示`);
      vis.addEventListener('change', () => {
        p.visible = vis.checked;
        this.host.setPatches([...ps]);
      });
      const name = document.createElement('span');
      name.textContent = p.name;
      const del = this.button('破棄', () => this.host.setPatches(ps.filter((q) => q !== p)));
      row.append(vis, name, del);
      pl.appendChild(row);
    }
  }
}
