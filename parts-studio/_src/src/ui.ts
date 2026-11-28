import * as THREE from 'three';
import type { Assembly } from './assembly-manager';
import type { Viewer, GizmoMode, ViewName } from './viewer';
import { ACCEPT, describeSupport } from './part-loader';
import type { LoadedModel } from './part-loader';
import { exportAssemblyGlb, verifyExport } from './glb-exporter';
import * as projects from './project-manager';
import { UNIT_PRESETS } from './coordinate-normalizer';
import { ANCHOR_JA, ANCHOR_NAMES, ANCHOR_SOURCE_JA, GARMENT_REGIONS, PART_TYPES, PART_TYPE_JA, REGION_JA, STATUS_JA } from './types';
import type { AnchorName, FitStatus, Part, PartType, Vec3 } from './types';
import { current, isManuallyEdited, uniformOf } from './manual-adjuster';
import { deg, rad } from './util';

type RowDef = {
  label: string;
  unit?: string;
  get: () => number;
  set: (v: number) => void;
  /** slider range around the auto value; widened when the value is outside */
  range: () => [number, number];
  step: number;
  digits?: number;
  disabled?: boolean;
  hint?: string;
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  const { class: cls, ...rest } = props as Record<string, unknown>;
  if (cls) e.className = cls as string;
  Object.assign(e, rest);
  for (const k of kids) e.append(k);
  return e;
};

const chip = (s: FitStatus): HTMLElement => el('span', { class: `chip ${s}`, textContent: STATUS_JA[s] });

export class StudioUI {
  private left = document.getElementById('left')!;
  private right = document.getElementById('right')!;
  private fileInput = el('input', { type: 'file', multiple: true, accept: ACCEPT, hidden: true });
  private reloadInput = el('input', { type: 'file', multiple: true, accept: ACCEPT, hidden: true });
  private projInput = el('input', { type: 'file', multiple: true, accept: '.json,.glb,.gltf,.obj,.mtl,.bin,.png,.jpg,.jpeg,.webp', hidden: true });
  private reloadTarget: string | null = null;
  private gizmoMode: GizmoMode = 'translate';
  private rows: (() => void)[] = [];
  private busy = 0;
  attachToBones = true;
  keepManual = true;

  constructor(
    private asm: Assembly,
    private viewer: Viewer,
  ) {
    document.body.append(this.fileInput, this.reloadInput, this.projInput);
    this.buildTop();
    this.buildViewButtons();
    this.buildDnD();
    this.fileInput.onchange = () => {
      const f = [...(this.fileInput.files ?? [])];
      this.fileInput.value = '';
      void this.handleFiles(f);
    };
    this.reloadInput.onchange = () => {
      const f = [...(this.reloadInput.files ?? [])];
      this.reloadInput.value = '';
      if (this.reloadTarget && f.length) void this.reloadPart(this.reloadTarget, f);
    };
    this.projInput.onchange = () => {
      const f = [...(this.projInput.files ?? [])];
      this.projInput.value = '';
      void this.openProjectFiles(f);
    };
    // panels are rebuilt on the next tick, never inside the event of the control that triggered them
    // the gizmo must never stay attached to a part that has left the scene, so it is synced at once
    asm.on('parts', () => {
      this.syncGizmo();
      this.scheduleRender();
    });
    asm.on('select', () => {
      this.syncGizmo();
      this.scheduleRender();
    });
    asm.on('transform', () => {
      this.refreshRows();
      this.updateSelBox();
      this.viewer.invalidate();
      this.renderLeftStatusOnly();
    });
    asm.on('connections', () => {
      this.renderLeft();
      this.renderConnections();
    });
    asm.on('toast', (t, l) => this.toast(String(t), (l as 'info' | 'warn' | 'error') ?? 'info'));
    viewer.onGizmoChange = () => {
      if (this.asm.selectedId) this.asm.gizmoChanged(this.asm.selectedId);
    };
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.matches?.('input,select,textarea')) return;
      if (e.key === 'w') this.setGizmo('translate');
      else if (e.key === 'e') this.setGizmo('rotate');
      else if (e.key === 'r') this.setGizmo('scale');
      else if (e.key === 'q') this.setGizmo('off');
    });
    this.renderLeft();
    this.renderRight();
  }

  private renderTimer = 0;
  private scheduleRender(): void {
    if (this.renderTimer) return;
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = 0;
      this.renderLeft();
      this.renderRight();
      this.syncGizmo();
      this.viewer.invalidate();
    }, 0);
  }

  // ---- toasts / busy -------------------------------------------------------------------------------
  toast(text: string, level: 'info' | 'warn' | 'error' = 'info', sticky = level !== 'info'): void {
    const box = document.getElementById('toasts')!;
    const t = el('div', { class: `toast ${level}`, textContent: text });
    const x = el('button', { class: 'x', textContent: '×', title: '閉じる' });
    x.onclick = () => t.remove();
    t.append(x);
    box.append(t);
    while (box.children.length > 6) box.firstElementChild?.remove();
    if (!sticky) setTimeout(() => t.remove(), 7000);
  }

  private async withBusy<T>(msg: string, f: () => Promise<T>): Promise<T> {
    this.busy++;
    document.body.style.cursor = 'progress';
    const t = el('div', { class: 'toast', textContent: msg });
    document.getElementById('toasts')!.append(t);
    await new Promise((r) => setTimeout(r, 20));
    try {
      return await f();
    } finally {
      t.remove();
      if (--this.busy === 0) document.body.style.cursor = '';
    }
  }

  // ---- top bar -----------------------------------------------------------------------------------
  private buildTop(): void {
    const top = document.getElementById('topActions')!;
    const load = el('button', { class: 'btn primary', textContent: '部品を読み込む' });
    load.onclick = () => this.fileInput.click();
    const fit = el('button', { class: 'btn', textContent: '自動調整を再実行', title: '手動調整は保持したまま、自動調整をやり直します' });
    fit.onclick = () => {
      const r = this.asm.refit({ keepManual: true });
      this.asm.runChecks(false);
      this.toast(`自動調整をやり直しました（${r.length}部品。手動調整値は保持）`);
    };
    const fit2 = el('button', { class: 'btn', textContent: '手動値を捨てて再調整', title: 'すべての部品の手動調整を破棄して、自動調整の結果に戻します' });
    fit2.onclick = () => {
      if (!this.asm.parts.some(isManuallyEdited)) {
        this.asm.refit({ keepManual: false });
        this.asm.runChecks(false);
        return;
      }
      if (confirm('手動で調整した位置・回転・大きさをすべて捨てて、自動調整の結果に戻します。よろしいですか？')) {
        this.asm.refit({ keepManual: false });
        this.asm.runChecks(false);
      }
    };
    const exp = el('button', { class: 'btn primary', textContent: 'GLB出力' });
    exp.onclick = () => void this.exportGlb();
    const bones = el('label', { class: 'note' }, el('input', { type: 'checkbox', checked: true }), ' 頭・服を骨にぶら下げる');
    (bones.firstChild as HTMLInputElement).onchange = (e) => (this.attachToBones = (e.target as HTMLInputElement).checked);
    bones.title = '出力GLBで、顔・髪・通常配置の衣服を対応する骨の子にします（モーションで一緒に動く）。見た目の位置は変わりません。';
    const proj = el('details', {});
    proj.append(el('summary', { class: 'btn', textContent: 'プロジェクト' }));
    const pbox = el('div', { class: 'toast' });
    pbox.style.cssText = 'position:absolute;right:12px;top:42px;z-index:20;display:flex;flex-direction:column;gap:4px;min-width:260px;pointer-events:auto';
    const nameIn = el('input', { type: 'text', value: 'project' });
    nameIn.style.width = '100%';
    const embed = el('label', { class: 'note' }, el('input', { type: 'checkbox' }), ' ファイルにモデルデータも同梱（大きくなります）');
    const b1 = el('button', { class: 'btn small', textContent: 'ブラウザに保存（IndexedDB）' });
    b1.onclick = () => void this.saveBrowser(nameIn.value || 'project');
    const b2 = el('button', { class: 'btn small', textContent: 'ブラウザから復元' });
    b2.onclick = () => void this.restoreBrowser();
    const b3 = el('button', { class: 'btn small', textContent: 'ファイルに保存（.parts-studio.json）' });
    b3.onclick = () => void this.saveFile(nameIn.value || 'project', (embed.firstChild as HTMLInputElement).checked);
    const b4 = el('button', { class: 'btn small', textContent: 'ファイルから復元（モデルも一緒に選択）' });
    b4.onclick = () => this.projInput.click();
    const b5 = el('button', { class: 'btn small danger', textContent: 'すべての部品をクリア' });
    b5.onclick = () => {
      if (confirm('読み込み済みの部品をすべて取り除きます（元のファイルは変更されません）。よろしいですか？')) this.asm.clear();
    };
    pbox.append(el('div', { class: 'note', textContent: 'プロジェクト名' }), nameIn, b1, b2, el('hr'), embed, b3, b4, el('hr'), b5);
    proj.append(pbox);
    proj.style.position = 'relative';
    top.append(load, fit, fit2, proj, bones, exp);
  }

  private buildViewButtons(): void {
    const vb = document.getElementById('viewButtons')!;
    const views: [ViewName, string][] = [['front', '正面'], ['left', '左側面'], ['right', '右側面'], ['back', '背面'], ['threeQuarter', '斜め'], ['top', '上']];
    for (const [v, t] of views) {
      const b = el('button', { textContent: t });
      b.onclick = () => this.viewer.setView(v, this.viewer.controls.target, this.viewSize());
      vb.append(b);
    }
    const fitb = el('button', { textContent: '全体', title: '全体が入るように表示' });
    fitb.onclick = () => this.viewer.frame(this.asm.worldBox());
    const head = el('button', { textContent: '首元を拡大', title: '頭と首のつなぎ目を拡大' });
    head.onclick = () => this.closeUpNeck();
    const bg = el('button', { textContent: '背景' });
    let dark = false;
    bg.onclick = () => this.viewer.setBackground((dark = !dark) ? 'dark' : 'light');
    vb.append(fitb, head, bg);
    const gb = document.getElementById('gizmoButtons')!;
    const modes: [GizmoMode, string, string][] = [['translate', '移動', 'W'], ['rotate', '回転', 'E'], ['scale', '拡縮', 'R'], ['off', 'ギズモなし', 'Q']];
    for (const [m, t, k] of modes) {
      const b = el('button', { textContent: t, title: `キー ${k}` });
      b.dataset.mode = m;
      b.onclick = () => this.setGizmo(m);
      gb.append(b);
    }
    this.setGizmo('translate');
  }

  private viewSize(): number {
    const b = this.asm.worldBox();
    return b.isEmpty() ? 1.6 : Math.max(b.getSize(new THREE.Vector3()).y, 0.4);
  }

  closeUpNeck(): void {
    const b = this.asm.body;
    const f = this.asm.face;
    this.asm.root.updateMatrixWorld(true);
    let t: THREE.Vector3 | null = null;
    if (b) {
      const bf = this.asm.bodyFeatures(b);
      t = new THREE.Vector3(...bf.neckBase).applyMatrix4(b.root.matrixWorld);
    } else if (f) {
      const ff = this.asm.faceFeatures(f);
      t = new THREE.Vector3(...ff.headRoot).applyMatrix4(f.root.matrixWorld);
    }
    if (t) this.viewer.closeUp(t, 0.55);
  }

  private setGizmo(m: GizmoMode): void {
    this.gizmoMode = m;
    document.querySelectorAll<HTMLButtonElement>('#gizmoButtons button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
    this.syncGizmo();
  }

  private syncGizmo(): void {
    const p = this.asm.get(this.asm.selectedId);
    const ok = p && p.visible && !this.asm.isLocked(p) && !!p.root.parent;
    this.viewer.attachGizmo(ok ? p!.root : null, this.gizmoMode);
    this.updateSelBox();
  }

  private updateSelBox(): void {
    const p = this.asm.get(this.asm.selectedId);
    if (!p || !p.visible) return this.viewer.setSelectionBox(null);
    this.asm.root.updateMatrixWorld(true);
    const b = new THREE.Box3();
    // bounding box in world space from the cached local box
    const f = p.type === 'body' ? this.asm.bodyFeatures(p).box : p.type === 'face' ? this.asm.faceFeatures(p).box : p.type === 'hair' ? this.asm.hairFeatures(p).box : this.asm.garmentFeatures(p).box;
    b.copy(f).applyMatrix4(p.root.matrixWorld);
    this.viewer.setSelectionBox(b);
  }

  // ---- drag & drop ----------------------------------------------------------------------------------
  private buildDnD(): void {
    const hint = document.getElementById('dropHint')!;
    let depth = 0;
    window.addEventListener('dragenter', (e) => {
      if (e.dataTransfer?.types.includes('Files')) {
        depth++;
        hint.hidden = false;
      }
    });
    window.addEventListener('dragleave', () => {
      if (--depth <= 0) {
        depth = 0;
        hint.hidden = true;
      }
    });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      depth = 0;
      hint.hidden = true;
      const f = [...(e.dataTransfer?.files ?? [])];
      if (!f.length) return;
      if (f.some((x) => /\.json$/i.test(x.name))) void this.openProjectFiles(f);
      else void this.handleFiles(f);
    });
  }

  // ---- loading --------------------------------------------------------------------------------------------
  async handleFiles(files: File[], forceType?: PartType): Promise<void> {
    if (!files.length) return;
    let models: LoadedModel[] = [];
    await this.withBusy('読み込み中…', async () => {
      try {
        const r = await this.asm.readFiles(files);
        models = r.models;
        for (const e of r.errors) this.toast(`読み込めませんでした — ${e.fileName}：${e.reason}`, 'error');
      } catch (e) {
        this.toast(`読み込み中に予期しないエラー：${e instanceof Error ? e.message : String(e)}`, 'error');
      }
    });
    const before = this.asm.parts.length;
    for (const m of models) {
      for (const w of m.warnings) this.toast(`${m.fileName}：${w}`, 'warn');
      let type: PartType | undefined = forceType;
      try {
        const det = this.asm.detect(m);
        if (!type && det.confidence === 'low') {
          // the question is asked outside of the busy indicator: nothing is being computed meanwhile
          const chosen = await this.askType(m.fileName, det.type, det.reason);
          if (!chosen) continue;
          type = chosen;
        }
        await this.withBusy('取り込み・自動調整中…', async () => {
          const added = await this.asm.addModel(m, type);
          const p = added[0];
          this.toast(`「${p.name}」を ${PART_TYPE_JA[p.type]} として読み込みました（${p.fit.note}）`);
        });
      } catch (e) {
        this.toast(`「${m.fileName}」の取り込みに失敗しました：${e instanceof Error ? e.message : String(e)}`, 'error');
      }
    }
    if (before === 0 && this.asm.parts.length) {
      this.viewer.setView('front', undefined, 1.6);
      this.viewer.frame(this.asm.worldBox());
    }
  }

  private askType(fileName: string, guess: PartType, why: string): Promise<PartType | null> {
    return new Promise((resolve) => {
      const d = el('dialog');
      d.append(el('h3', { textContent: '部品の種類を選んでください' }));
      d.append(el('div', { class: 'note', textContent: `「${fileName}」の種類を判定できませんでした（推定：${PART_TYPE_JA[guess]} ／ 根拠：${why}）。` }));
      const btns = el('div', { class: 'btns' });
      for (const t of PART_TYPES) {
        const b = el('button', { class: 'btn' + (t === guess ? ' primary' : ''), textContent: PART_TYPE_JA[t] });
        b.onclick = () => {
          d.close();
          resolve(t);
        };
        btns.append(b);
      }
      const c = el('button', { class: 'btn', textContent: '読み込まない' });
      c.onclick = () => {
        d.close();
        resolve(null);
      };
      btns.append(c);
      d.append(btns);
      d.addEventListener('close', () => {
        d.remove();
        resolve(null);
      });
      document.body.append(d);
      d.showModal();
    });
  }

  private async reloadPart(id: string, files: File[]): Promise<void> {
    await this.withBusy('再読み込み中…', async () => {
      try {
        await this.asm.reload(id, files);
        this.toast('再読み込みしました（位置・種類・手動調整は保持）');
      } catch (e) {
        this.toast(`再読み込みに失敗しました（元の部品はそのままです）：${e instanceof Error ? ((e as { reason?: string }).reason ?? e.message) : String(e)}`, 'error');
      }
    });
  }

  // ---- left: parts list -------------------------------------------------------------------------------------------
  private renderLeft(): void {
    const L = this.left;
    L.replaceChildren();
    L.append(el('h2', { textContent: '部品一覧' }));
    const dz = el('div', { class: 'dropzone' }, 'ここにファイルをドロップ、またはクリックして選択', el('br'), el('span', { class: 'note', textContent: describeSupport() }));
    dz.onclick = () => this.fileInput.click();
    L.append(dz);
    const types = el('div', { class: 'note', textContent: 'OBJ は .mtl・テクスチャ画像、GLTF は .bin・画像も一緒に選ぶと反映されます。種別が不明なファイルは、読み込み時に選択できます。' });
    L.append(types);
    const ul = el('ul', { class: 'plist' });
    if (!this.asm.parts.length) ul.append(el('li', { class: 'note', textContent: '部品がありません。顔・髪型・身体・衣服のファイルを読み込んでください（順番は自由です）。' }));
    for (const p of this.asm.parts) ul.append(this.partRow(p));
    L.append(ul);
    L.append(el('div', { class: 'note', textContent: `${this.asm.parts.length} 部品 ／ 頂点 ${this.asm.parts.reduce((a, p) => a + p.stats.vertices, 0).toLocaleString()}` }));
    L.append(el('div', { class: 'note', textContent: this.viewer.gpu ? '' : '※ GPU描画が使えないため、ソフトウェア描画で動作しています（読み込み・調整・出力は可能です）。' }));
    this.renderConnectionsInto(L);
  }

  private renderLeftStatusOnly(): void {
    /* statuses change only after checks; nothing to do per drag */
  }

  private worstStatus(p: Part): FitStatus {
    const cs = this.asm.connections.filter((c) => c.a === p.id || c.b === p.id);
    const all: FitStatus[] = [p.fit.status, ...cs.map((c) => c.status)];
    if (all.includes('adjust')) return 'adjust';
    if (all.includes('unsupported')) return 'unsupported';
    if (all.every((s) => s === 'unknown')) return 'unknown';
    return all.includes('ok') ? 'ok' : 'unknown';
  }

  private partRow(p: Part): HTMLElement {
    const sel = this.asm.selectedId === p.id;
    const li = el('li', { class: `prow${sel ? ' sel' : ''}${p.visible ? '' : ' hidden'}` });
    li.onclick = () => this.asm.select(p.id);
    const eye = el('button', { class: 'btn small', textContent: p.visible ? '👁' : '—', title: p.visible ? '非表示にする' : '表示する' });
    eye.onclick = (e) => {
      e.stopPropagation();
      this.asm.setVisible(p.id, !p.visible);
    };
    const l1 = el('div', { class: 'l1' }, el('span', { class: `tdot ${p.type}` }), el('span', { class: 'nm', textContent: p.name, title: p.fileName }), chip(this.worstStatus(p)), eye);
    const typeSel = el('select', { title: '部品の種類' });
    for (const t of PART_TYPES) typeSel.append(el('option', { value: t, textContent: PART_TYPE_JA[t], selected: t === p.type }));
    typeSel.onclick = (e) => e.stopPropagation();
    typeSel.onchange = () => this.asm.setType(p.id, typeSel.value as PartType);
    const re = el('button', { class: 'btn small', textContent: '再読込', title: 'この部品を別のファイルで読み込み直す' });
    re.onclick = (e) => {
      e.stopPropagation();
      this.reloadTarget = p.id;
      this.reloadInput.click();
    };
    const del = el('button', { class: 'btn small danger', textContent: '削除' });
    del.onclick = (e) => {
      e.stopPropagation();
      this.asm.remove(p.id);
    };
    const l2 = el('div', { class: 'l2' }, typeSel, re, del);
    const sub = el('div', { class: 'sub', textContent: `${p.format.toUpperCase()}・頂点 ${p.stats.vertices.toLocaleString()}${p.stats.skinned ? `・骨${p.stats.bones}` : ''}${p.manual ? '・手動調整あり' : ''}${p.parentId ? `・${this.asm.get(p.parentId)?.name ?? ''}に装着` : ''}` });
    li.append(l1, l2, sub);
    return li;
  }

  // ---- connections ---------------------------------------------------------------------------------------------
  private connBox: HTMLElement | null = null;
  private renderConnectionsInto(parent: HTMLElement): void {
    parent.append(el('h2', { textContent: '接続状態' }));
    const box = el('div');
    this.connBox = box;
    parent.append(box);
    this.renderConnections();
  }
  private renderConnections(): void {
    const box = this.connBox;
    if (!box || !box.isConnected) return;
    box.replaceChildren();
    const bar = el('div', { class: 'line' });
    const b1 = el('button', { class: 'btn small', textContent: '選択部品を詳細検査', title: 'メッシュの頂点を標本化して、貫通・浮き・隙間を詳しく調べます（少し時間がかかります）' });
    b1.disabled = !this.asm.selectedId;
    b1.onclick = () => void this.detailed(this.asm.selectedId ? [this.asm.selectedId] : undefined);
    const b2 = el('button', { class: 'btn small', textContent: 'すべて詳細検査' });
    b2.onclick = () => void this.detailed(undefined);
    const b3 = el('button', { class: 'btn small', textContent: '再検査（軽量）' });
    b3.onclick = () => this.asm.runChecks(false);
    bar.append(b1, b2, b3);
    box.append(bar);
    box.append(el('div', { class: 'note', textContent: '※ アンカーやバウンディングボックス・標本頂点に基づく確認結果で、完全な接合を保証するものではありません。' }));
    if (!this.asm.connections.length) box.append(el('div', { class: 'note', textContent: '検査対象の接続がまだありません。' }));
    for (const c of this.asm.connections) {
      const hl = this.asm.selectedId && (c.a === this.asm.selectedId || c.b === this.asm.selectedId);
      const d = el('div', { class: 'conn' });
      if (hl) d.style.borderColor = '#3a6fd8';
      d.append(el('div', { class: 'h' }, el('span', { textContent: c.label }), chip(c.status)));
      if (c.detailed) d.append(el('div', { class: 'note', textContent: '（詳細検査の結果を含む）' }));
      const ul = el('ul');
      for (const m of c.messages) ul.append(el('li', { class: m.level, textContent: m.text }));
      d.append(ul);
      box.append(d);
    }
  }
  private async detailed(ids?: string[]): Promise<void> {
    await this.withBusy('詳細検査中…', async () => {
      this.asm.runChecks(true, ids);
    });
  }

  // ---- right: selected part -----------------------------------------------------------------------------------------
  private renderRight(): void {
    const R = this.right;
    R.replaceChildren();
    this.rows = [];
    const p = this.asm.get(this.asm.selectedId);
    R.append(el('h2', { textContent: '調整パネル' }));
    if (!p) {
      R.append(el('div', { class: 'note', textContent: '部品を選ぶと、位置・回転・スケールや専用の調整値を編集できます。3Dプレビュー上の操作（ギズモ）とも連動します。' }));
      return;
    }
    R.append(this.partInfo(p));
    const locked = this.asm.isLocked(p);
    if (locked) {
      R.append(el('div', { class: 'warnbox', textContent: 'この衣服は身体の骨に追従しています（既存のスケルトン・ウェイトを維持）。位置・回転・スケールを変えても見た目には反映されないため、調整するには下の「骨に追従」を外して通常配置にしてください。' }));
    }
    R.append(this.transformSection(p, locked));
    R.append(this.specificSection(p, locked));
    R.append(this.stateSection(p));
    R.append(this.orientSection(p));
    R.append(this.anchorSection(p));
    R.append(el('h2', { textContent: '出力' }));
    const ex = el('div', { class: 'line' });
    const e1 = el('button', { class: 'btn primary', textContent: '統合モデルをGLB出力' });
    e1.onclick = () => void this.exportGlb();
    ex.append(e1);
    R.append(ex);
    R.append(el('div', { class: 'note', textContent: '各部品は個別のノード／メッシュのまま1つのGLBにまとめます（結合・リメッシュはしません）。出力後に自動でGLBを読み直して、配置・メッシュ・UV・スキンが一致するか確認します。' }));
  }

  private partInfo(p: Part): HTMLElement {
    const d = el('div');
    d.append(el('div', { class: 'line' }, el('span', { class: `tdot ${p.type}` }), el('b', { textContent: p.name }), chip(this.worstStatus(p))));
    const kv = el('div', { class: 'kv' });
    const add = (k: string, v: string) => kv.append(el('b', { textContent: k }), el('span', { textContent: v }));
    add('種類', `${PART_TYPE_JA[p.type]}（${p.typeReason}）`);
    add('ファイル', `${p.fileName}（${p.format.toUpperCase()}）`);
    add('規模', `頂点 ${p.stats.vertices.toLocaleString()}／三角形 ${p.stats.triangles.toLocaleString()}／メッシュ ${p.stats.meshes}${p.stats.skinned ? `／骨 ${p.stats.bones}` : ''}`);
    add('座標系', `単位×${p.orient.unit}、上${p.orient.up}、前${p.orient.forward}${p.orient.yaw ? `、回転${p.orient.yaw}°` : ''}（${p.orient.source === 'metadata' ? 'メタデータ' : p.orient.source === 'user' ? '手動' : '推定'}）`);
    add('自動調整', p.fit.note);
    d.append(kv);
    for (const m of p.fit.messages) d.append(el('div', { class: m.level === 'warn' || m.level === 'error' ? 'warnbox' : 'note', textContent: m.text }));
    if (p.typeConfidence === 'low') d.append(el('div', { class: 'warnbox', textContent: `種類の判定は確実ではありません（${p.typeReason}）。一覧の「種類」で変更できます。` }));
    return d;
  }

  private numRow(def: RowDef): HTMLElement {
    const digits = def.digits ?? 3;
    const row = el('div', { class: `row${def.disabled ? ' off' : ''}` });
    const lab = el('label', {}, el('span', { textContent: def.label }), el('small', { textContent: def.unit ?? '' }));
    if (def.hint) lab.title = def.hint;
    const slider = el('input', { type: 'range', step: String(def.step) });
    const num = el('input', { type: 'number', step: String(def.step) });
    slider.disabled = num.disabled = !!def.disabled;
    const refresh = (force = false) => {
      const v = def.get();
      let [lo, hi] = def.range();
      if (v < lo) lo = v - (hi - lo) * 0.25;
      if (v > hi) hi = v + (hi - lo) * 0.25;
      slider.min = String(lo);
      slider.max = String(hi);
      slider.value = String(v);
      if (force || document.activeElement !== num) num.value = v.toFixed(digits);
    };
    slider.oninput = () => {
      def.set(parseFloat(slider.value));
      refresh(true);
    };
    num.onchange = () => {
      const v = parseFloat(num.value);
      if (Number.isFinite(v)) def.set(v);
      else refresh();
    };
    num.onkeydown = (e) => {
      if (e.key === 'Enter') num.blur();
    };
    row.append(lab, slider, num);
    this.rows.push(() => refresh());
    refresh();
    return row;
  }

  private refreshRows(): void {
    for (const r of this.rows) r();
  }

  private transformSection(p: Part, locked: boolean): HTMLElement {
    const d = el('div');
    d.append(el('h2', { textContent: '位置・回転・スケール' }));
    const a = p.auto;
    const spanP = p.type === 'body' ? 1.2 : p.type === 'garment' ? 0.6 : p.type === 'hair' ? 0.25 : 0.4;
    const axes = ['X', 'Y', 'Z'] as const;
    const jp = ['左右', '上下', '前後'];
    axes.forEach((ax, i) => {
      d.append(
        this.numRow({
          label: `${ax}位置（${jp[i]}）`,
          unit: 'm',
          get: () => current(p).p[i],
          set: (v) => this.asm.setTransform(p.id, { p: patchAt(i, v) }),
          range: () => [(a?.p[i] ?? 0) - spanP, (a?.p[i] ?? 0) + spanP],
          step: 0.001,
          disabled: locked,
        }),
      );
    });
    axes.forEach((ax, i) => {
      d.append(
        this.numRow({
          label: `${ax}回転`,
          unit: '°',
          get: () => deg(current(p).r[i]),
          set: (v) => this.asm.setTransform(p.id, { r: patchAt(i, rad(v)) }),
          range: () => [-180, 180],
          step: 0.1,
          digits: 1,
          disabled: locked,
        }),
      );
    });
    const base = a ? uniformOf(a) : 1;
    d.append(
      this.numRow({
        label: '均等スケール',
        unit: '倍',
        get: () => uniformOf(current(p)),
        set: (v) => this.setUniform(p, v),
        range: () => [base * 0.4, base * 2.5],
        step: 0.001,
        digits: 4,
        disabled: locked,
      }),
    );
    axes.forEach((ax, i) => {
      d.append(
        this.numRow({
          label: `${ax}スケール（軸別）`,
          unit: '倍',
          get: () => current(p).s[i],
          set: (v) => this.asm.setTransform(p.id, { s: patchAt(i, v) }),
          range: () => [(a?.s[i] ?? 1) * 0.4, (a?.s[i] ?? 1) * 2.5],
          step: 0.001,
          digits: 4,
          disabled: locked,
        }),
      );
    });
    if (p.parentId) d.append(el('div', { class: 'note', textContent: `※ この部品は「${this.asm.get(p.parentId)?.name}」に装着されており、数値は親の座標系（親の大きさを含む）での値です。` }));
    return d;
  }

  private setUniform(p: Part, v: number): void {
    const c = current(p);
    const base = uniformOf(c) || 1;
    const f = v / base;
    this.asm.setTransform(p.id, { s: [c.s[0] * f, c.s[1] * f, c.s[2] * f] });
  }

  private specificSection(p: Part, locked: boolean): HTMLElement {
    const d = el('div');
    if (p.type === 'face') {
      d.append(el('h2', { textContent: '頭部の調整' }));
      const a = p.auto;
      const base = a ? uniformOf(a) : 1;
      d.append(
        this.numRow({ label: '高さ', unit: 'm', get: () => current(p).p[1], set: (v) => this.asm.setTransform(p.id, { p: [undefined as never, v, undefined as never] }), range: () => [(a?.p[1] ?? 0) - 0.1, (a?.p[1] ?? 0) + 0.1], step: 0.0005, digits: 4 }),
        this.numRow({ label: '左右', unit: 'm', get: () => current(p).p[0], set: (v) => this.asm.setTransform(p.id, { p: [v, undefined as never, undefined as never] }), range: () => [(a?.p[0] ?? 0) - 0.1, (a?.p[0] ?? 0) + 0.1], step: 0.0005, digits: 4 }),
        this.numRow({ label: '前後', unit: 'm', get: () => current(p).p[2], set: (v) => this.asm.setTransform(p.id, { p: [undefined as never, undefined as never, v] }), range: () => [(a?.p[2] ?? 0) - 0.1, (a?.p[2] ?? 0) + 0.1], step: 0.0005, digits: 4 }),
        this.numRow({ label: '大きさ', unit: '倍', get: () => uniformOf(current(p)), set: (v) => this.setUniform(p, v), range: () => [base * 0.6, base * 1.6], step: 0.001, digits: 4 }),
        this.numRow({ label: '傾き（うなずき）', unit: '°', get: () => deg(current(p).r[0]), set: (v) => this.asm.setTransform(p.id, { r: [rad(v), undefined as never, undefined as never] }), range: () => [-40, 40], step: 0.1, digits: 1 }),
        this.numRow({ label: '傾き（首かしげ）', unit: '°', get: () => deg(current(p).r[2]), set: (v) => this.asm.setTransform(p.id, { r: [undefined as never, undefined as never, rad(v)] }), range: () => [-40, 40], step: 0.1, digits: 1 }),
      );
      const body = this.asm.body;
      if (body) d.append(this.neckSection(body));
    } else if (p.type === 'body') {
      d.append(el('h2', { textContent: '身体の調整' }));
      d.append(this.neckSection(p));
      const o = p.bodyOpts!;
      if (o.hasPlaceholderHead) {
        const sel = el('select');
        for (const [v, t] of [['auto', '自動（顔があれば隠す）'], ['on', '隠す'], ['off', '表示する']] as const) sel.append(el('option', { value: v, textContent: t, selected: o.hideHead === v }));
        sel.onchange = () => this.asm.setHeadHide(p.id, sel.value as 'auto' | 'on' | 'off');
        d.append(el('div', { class: 'line' }, el('span', { textContent: '身体の仮の頭' }), sel));
        d.append(el('div', { class: 'note', textContent: '素体には頭の仮形状（箱）があります。隠しても元ファイルは変更されず、出力GLBでも同じ状態になります。' }));
      }
    } else if (p.type === 'hair') {
      d.append(el('h2', { textContent: '髪型の調整' }));
      const a = p.auto;
      const base = a ? a.s[0] : 1;
      d.append(
        this.numRow({ label: '前後位置', unit: 'm', get: () => current(p).p[2], set: (v) => this.asm.setTransform(p.id, { p: [undefined as never, undefined as never, v] }), range: () => [(a?.p[2] ?? 0) - 0.06, (a?.p[2] ?? 0) + 0.06], step: 0.0005, digits: 4 }),
        this.numRow({ label: '高さ', unit: 'm', get: () => current(p).p[1], set: (v) => this.asm.setTransform(p.id, { p: [undefined as never, v, undefined as never] }), range: () => [(a?.p[1] ?? 0) - 0.06, (a?.p[1] ?? 0) + 0.06], step: 0.0005, digits: 4 }),
        this.numRow({ label: '横幅（X方向の大きさ）', unit: '倍', get: () => current(p).s[0], set: (v) => this.asm.setTransform(p.id, { s: [v, undefined as never, undefined as never] }), range: () => [base * 0.7, base * 1.4], step: 0.001, digits: 4 }),
        this.numRow({ label: '装着角度（前後）', unit: '°', get: () => deg(current(p).r[0]), set: (v) => this.asm.setTransform(p.id, { r: [rad(v), undefined as never, undefined as never] }), range: () => [-40, 40], step: 0.1, digits: 1 }),
      );
      d.append(el('div', { class: 'note', textContent: '髪の形状そのものは変更しません（前髪・毛束の造形はそのまま）。' }));
    } else if (p.type === 'garment') {
      d.append(el('h2', { textContent: '衣服の調整' }));
      const g = p.garment!;
      const reg = el('select');
      for (const r of GARMENT_REGIONS) reg.append(el('option', { value: r, textContent: REGION_JA[r], selected: r === g.region }));
      reg.onchange = () => this.asm.setRegion(p.id, reg.value as never);
      d.append(el('div', { class: 'line' }, el('span', { textContent: '装着部位' }), reg, el('span', { class: 'note', textContent: g.regionSource === 'user' ? '（指定）' : '（自動判定）' })));
      const rig = el('label', { class: 'line' }, el('input', { type: 'checkbox', checked: g.rigMode === 'follow' }), ' 骨に追従（既存のスケルトン・ウェイトを維持）');
      const rigIn = rig.firstChild as HTMLInputElement;
      rigIn.disabled = !g.rigCompatible && g.rigMode !== 'follow';
      rigIn.onchange = () => this.asm.setRigMode(p.id, rigIn.checked ? 'follow' : 'independent');
      d.append(rig);
      d.append(el('div', { class: 'note', textContent: g.rigInfo || 'スキン（骨の重み）がないため、位置・回転・スケールで合わせます。' }));
      const a = p.auto;
      const base = a ? uniformOf(a) : 1;
      d.append(
        this.numRow({ label: 'サイズ（均等）', unit: '倍', get: () => uniformOf(current(p)), set: (v) => this.setUniform(p, v), range: () => [base * 0.6, base * 1.6], step: 0.001, digits: 4, disabled: locked }),
        this.numRow({ label: '装着位置（上下）', unit: 'm', get: () => current(p).p[1], set: (v) => this.asm.setTransform(p.id, { p: [undefined as never, v, undefined as never] }), range: () => [(a?.p[1] ?? 0) - 0.3, (a?.p[1] ?? 0) + 0.3], step: 0.0005, digits: 4, disabled: locked }),
        this.numRow({ label: '装着位置（前後）', unit: 'm', get: () => current(p).p[2], set: (v) => this.asm.setTransform(p.id, { p: [undefined as never, undefined as never, v] }), range: () => [(a?.p[2] ?? 0) - 0.15, (a?.p[2] ?? 0) + 0.15], step: 0.0005, digits: 4, disabled: locked }),
        this.numRow({ label: 'フィット量（胴まわりの太さ）', unit: '倍', get: () => (current(p).s[0] + current(p).s[2]) / 2, set: (v) => this.asm.setTransform(p.id, { s: [v, undefined as never, v] }), range: () => [(a?.s[0] ?? 1) * 0.8, (a?.s[0] ?? 1) * 1.3], step: 0.001, digits: 4, disabled: locked, hint: 'X・Z方向の拡縮です（Transform調整）。メッシュの変形ではありません。' }),
      );
      d.append(el('div', { class: 'note', textContent: '袖・裾の長さなど、メッシュの部分変形が必要な調整は非対応です（Transform調整のみ）。フィット量は左右・前後の拡縮であり、メッシュを変形するものではありません。' }));
    }
    return d;
  }

  private neckSection(body: Part): HTMLElement {
    const d = el('div');
    d.append(el('h2', { textContent: '首（身体の骨を変形）' }));
    const o = body.bodyOpts!;
    if (!o.neckSupported) {
      d.append(el('div', { class: 'row off' }, el('label', { textContent: '首の長さ／太さ：非対応' })));
      d.append(el('div', { class: 'warnbox', textContent: o.neckNote || 'この身体は首の変形に対応していません。' }));
      return d;
    }
    d.append(
      this.numRow({ label: '首の長さ', unit: '倍', get: () => o.neckLength, set: (v) => this.asm.setNeck(body.id, { length: v }), range: () => [0.5, 2], step: 0.01, digits: 2 }),
      this.numRow({ label: '首の太さ', unit: '倍', get: () => o.neckThickness, set: (v) => this.asm.setNeck(body.id, { thickness: v }), range: () => [0.5, 1.8], step: 0.01, digits: 2 }),
    );
    d.append(el('div', { class: 'note', textContent: o.neckNote }));
    return d;
  }

  private stateSection(p: Part): HTMLElement {
    const d = el('div');
    d.append(el('h2', { textContent: '調整状態' }));
    const edited = isManuallyEdited(p);
    d.append(el('div', { class: 'note', textContent: edited ? '手動調整あり（自動調整の結果からの差分を保持しています）。自動調整を再実行しても、この差分は維持されます。' : p.auto ? '手動調整なし（自動調整の結果のままです）。' : '自動調整の結果はまだありません。' }));
    const bar = el('div', { class: 'line' });
    const r1 = el('button', { class: 'btn small', textContent: '初期状態へ戻す', title: '読み込み直後の状態（調整なし）に戻します' });
    r1.onclick = () => this.asm.resetInitial(p.id);
    const r2 = el('button', { class: 'btn small', textContent: '自動調整結果へ戻す', title: 'この部品の手動調整だけを捨てて、自動調整の結果に戻します' });
    r2.onclick = () => this.asm.resetAuto(p.id);
    r2.disabled = !p.auto;
    const r3 = el('button', { class: 'btn small', textContent: 'この部品を自動調整し直す', title: '手動調整値は保持して、この部品の自動調整だけをやり直します' });
    r3.onclick = () => {
      this.asm.refit({ keepManual: true, only: [p.id] });
      this.asm.runChecks(false);
    };
    const r4 = el('button', { class: 'btn small', textContent: '手動値を捨てて自動調整', title: 'この部品の手動調整を破棄して自動調整をやり直します' });
    r4.onclick = () => {
      this.asm.refit({ keepManual: false, only: [p.id] });
      this.asm.runChecks(false);
    };
    bar.append(r1, r2, r3, r4);
    d.append(bar);
    return d;
  }

  private orientSection(p: Part): HTMLElement {
    const d = el('details');
    d.append(el('summary', { textContent: '座標・単位・向きの変換' }));
    const o = p.orient;
    const unit = el('select');
    const known = UNIT_PRESETS.some((u) => Math.abs(u.value - o.unit) < 1e-9);
    for (const u of UNIT_PRESETS) unit.append(el('option', { value: String(u.value), textContent: u.ja, selected: Math.abs(u.value - o.unit) < 1e-9 }));
    if (!known) unit.append(el('option', { value: String(o.unit), textContent: `×${o.unit}`, selected: true }));
    unit.onchange = () => this.asm.setOrientation(p.id, { unit: parseFloat(unit.value) });
    const axes = ['+Y', '-Y', '+Z', '-Z', '+X', '-X'] as const;
    const mk = (cur: string, on: (v: string) => void) => {
      const s = el('select');
      for (const a of axes) s.append(el('option', { value: a, textContent: a, selected: a === cur }));
      s.onchange = () => on(s.value);
      return s;
    };
    const up = mk(o.up, (v) => this.asm.setOrientation(p.id, { up: v as never }));
    const fw = mk(o.forward, (v) => this.asm.setOrientation(p.id, { forward: v as never }));
    d.append(el('div', { class: 'line' }, el('span', { textContent: 'ファイルの単位' }), unit));
    d.append(el('div', { class: 'line' }, el('span', { textContent: '上方向' }), up, el('span', { textContent: '正面' }), fw));
    const yaw = el('button', { class: 'btn small', textContent: '向きを180°回す' });
    yaw.onclick = () => this.asm.setOrientation(p.id, { yaw: (o.yaw + 180) % 360 });
    d.append(el('div', { class: 'line' }, yaw, el('span', { class: 'note', textContent: `追加の回転 ${o.yaw}°` })));
    d.append(el('div', { class: 'note', textContent: 'スタジオの共通座標は メートル・+Y上・+Z正面。元のデータは変更せず、表示と出力のときだけ変換します。' }));
    return d;
  }

  private anchorSection(p: Part): HTMLElement {
    const d = el('details');
    d.append(el('summary', { textContent: 'アンカー（接続の基準位置）' }));
    const { anchors, warnings } = this.asm.anchors(p);
    for (const w of warnings) d.append(el('div', { class: 'warnbox', textContent: w }));
    const t = el('table', { class: 'anch' });
    for (const n of ANCHOR_NAMES) {
      const a = anchors[n];
      if (!a) continue;
      const tr = el('tr');
      tr.append(el('td', { textContent: `${ANCHOR_JA[n]}` }));
      for (let i = 0; i < 3; i++) {
        const inp = el('input', { type: 'number', step: '0.001', value: a.p[i].toFixed(4) });
        inp.onchange = () => {
          const v: Vec3 = [...a.p] as Vec3;
          v[i] = parseFloat(inp.value);
          if (Number.isFinite(v[i])) this.asm.setAnchor(p.id, n as AnchorName, v);
        };
        tr.append(el('td', {}, inp));
      }
      tr.append(el('td', { textContent: ANCHOR_SOURCE_JA[a.source] }));
      if (a.source === 'manual') {
        const rs = el('button', { class: 'btn small', textContent: '推定に戻す' });
        rs.onclick = () => this.asm.setAnchor(p.id, n as AnchorName, null);
        tr.append(el('td', {}, rs));
      }
      t.append(tr);
    }
    d.append(t);
    d.append(el('div', { class: 'note', textContent: '部品の座標系（メートル）での位置です。推定値は形状から計算した値で、手動で上書きすると自動調整・出力メタデータに反映されます。' }));
    if (!t.children.length) d.append(el('div', { class: 'note', textContent: 'この種類の部品に使うアンカーはありません。' }));
    return d;
  }

  // ---- export / projects ---------------------------------------------------------------------------------------------
  async exportGlb(): Promise<void> {
    if (!this.asm.parts.length) return this.toast('出力する部品がありません。', 'warn');
    await this.withBusy('GLBを書き出し中…', async () => {
      try {
        const r = await exportAssemblyGlb(this.asm, { attachToBones: this.attachToBones });
        for (const w of r.warnings) this.toast(w, 'warn');
        const v = await verifyExport(this.asm, r.blob);
        const name = `character_${new Date().toISOString().slice(0, 10)}.glb`;
        download(r.blob, name);
        this.toast(`${name} を書き出しました（${(r.bytes / 1048576).toFixed(2)}MB）。読み直し検証：${v.summary}`, v.ok ? 'info' : 'warn', !v.ok);
        if (!v.ok) for (const l of v.lines.filter((x) => !x.ok)) this.toast(`${l.part}: ${l.details.filter((x) => x.startsWith('✗')).join(' / ')}`, 'warn');
        (window as unknown as { __lastExport?: unknown }).__lastExport = { bytes: r.bytes, verify: v };
      } catch (e) {
        this.toast(`GLBの書き出しに失敗しました：${e instanceof Error ? e.message : String(e)}`, 'error');
      }
    });
  }

  private async saveBrowser(name: string): Promise<void> {
    await this.withBusy('保存中…', async () => {
      try {
        const r = await projects.saveToBrowser(this.asm, name);
        this.toast(`ブラウザ内に「${name}」を保存しました（モデルデータ ${(r.bytes / 1048576).toFixed(1)}MB）。`);
      } catch (e) {
        this.toast(e instanceof Error ? e.message : String(e), 'error');
      }
    });
  }

  private async restoreBrowser(): Promise<void> {
    try {
      const names = await projects.listBrowserProjects();
      if (!names.length) return this.toast('ブラウザ内に保存されたプロジェクトがありません。', 'warn');
      const name = names.length === 1 ? names[0] : prompt(`復元するプロジェクト名を入力してください：\n${names.join('\n')}`, names[0]);
      if (!name) return;
      await this.withBusy('復元中…', async () => {
        const { state, find } = await projects.loadFromBrowser(name);
        await this.finishRestore(state, find);
      });
    } catch (e) {
      this.toast(e instanceof Error ? e.message : String(e), 'error');
    }
  }

  private async saveFile(name: string, embed: boolean): Promise<void> {
    await this.withBusy('保存中…', async () => {
      try {
        const json = await projects.projectToJson(this.asm, name, embed);
        download(new Blob([json], { type: 'application/json' }), `${name}.parts-studio.json`);
        this.toast(`${name}.parts-studio.json を保存しました${embed ? '（モデルデータ同梱）' : '（モデルは含みません。復元時に元のファイルも一緒に選んでください）'}。`);
      } catch (e) {
        this.toast(`保存に失敗しました：${e instanceof Error ? e.message : String(e)}`, 'error');
      }
    });
  }

  async openProjectFiles(files: File[]): Promise<void> {
    const pj = files.find((f) => /\.json$/i.test(f.name));
    if (!pj) return this.toast('プロジェクトファイル（.json）が選ばれていません。', 'warn');
    await this.withBusy('復元中…', async () => {
      try {
        const state = projects.parseProject(await pj.text());
        const others = files.filter((f) => f !== pj);
        await this.finishRestore(state, projects.fileFinder(others, projects.embeddedFinder()));
      } catch (e) {
        this.toast(e instanceof Error ? e.message : String(e), 'error');
      }
    });
  }

  private async finishRestore(state: projects.ProjectState, find: Parameters<typeof projects.restoreProject>[2]): Promise<void> {
    const r = await projects.restoreProject(this.asm, state, find);
    this.toast(`${r.restored.length} 部品を復元しました。`);
    for (const m of r.missing) this.toast(`「${m.part}」のファイルが見つかりません：${m.files.join('、')}。プロジェクトと一緒にモデルファイルを選んでください。`, 'warn');
    for (const e of r.errors) this.toast(`復元に失敗：${e}`, 'error');
    this.viewer.frame(this.asm.worldBox());
  }
}

function patchAt(i: number, v: number): [number, number, number] {
  const a: (number | undefined)[] = [undefined, undefined, undefined];
  a[i] = v;
  return a as unknown as [number, number, number];
}

export function download(blob: Blob, name: string): void {
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 20000);
}
