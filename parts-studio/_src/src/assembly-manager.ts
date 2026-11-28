// assembly-manager: owns every part, the scene graph, and the order in which things happen.
//   load -> detect -> normalize -> fit -> check, each step only touching what changed.
//
// Scene graph (this is also what the exported GLB looks like):
//   PartsStudio_Character
//     Body_xxx         (part.root : the user-adjustable transform)
//       normalize      (unit / axis conversion, non-destructive)
//         <the model exactly as loaded>
//     Face_xxx
//       Hair_xxx       (hair rides on the face it was fitted to)
//     Garment_xxx
import * as THREE from 'three';
import type { AnchorName, Connection, FitMessage, GarmentRegion, Part, PartMeta, PartType, RigMode, SourceFile, TRS, Vec3 } from './types';
import { PART_TYPE_JA } from './types';
import { loadModelsFromFiles, modelStats, type LoadedModel, LoadError } from './part-loader';
import { detectPartType, embeddedGarmentMeshes, type Detection } from './part-detector';
import { applyOrientation, estimateOrientation, isIdentityOrientation } from './coordinate-normalizer';
import { analyzeBody, analyzeFace, analyzeGarment, analyzeHair, boneGroup } from './features';
import type { BodyFeatures, FaceFeatures, GarmentFeatures, HairFeatures } from './features';
import { computeAnchors, type AnchorResult } from './anchor-manager';
import { fitFace, fitGarment, fitHair, type FitContext, type FitOutcome } from './auto-fitter';
import { checkAll } from './collision-checker';
import { bindToBody, isBound, unbindFromBody } from './rig-retargeter';
import * as manual from './manual-adjuster';
import { applyTRS, bonesOf, boxIn, disposeObject, IDENTITY_TRS, skinnedMeshesOf, trsOf } from './util';
import type { SavedPart } from './project-manager';

type Listener = (...a: unknown[]) => void;

interface NeckZone {
  ax: number;
  az: number;
  yTop: number;
  yLow: number;
  rx: number;
  rz: number;
}

const TYPE_PREFIX: Record<PartType, string> = { face: 'Face', hair: 'Hair', body: 'Body', garment: 'Garment' };

export class Assembly {
  readonly root = new THREE.Group();
  parts: Part[] = [];
  connections: Connection[] = [];
  selectedId: string | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private seq = 1;
  private featVer = new Map<string, number>();
  private featCache = new Map<string, { ver: number; v: unknown }>();
  /** parts whose model was replaced by the user (so exports can say so) */
  keepManual = true;
  /** how many times a feature analysis really ran (cache misses); the tests use it to prove edits do not recompute the model */
  featureComputes = 0;

  constructor() {
    this.root.name = 'PartsStudio_Character';
  }

  // ---- events ------------------------------------------------------------------------------
  on(type: 'parts' | 'select' | 'transform' | 'connections' | 'toast' | 'busy', cb: Listener): () => void {
    let s = this.listeners.get(type);
    if (!s) this.listeners.set(type, (s = new Set()));
    s.add(cb);
    return () => s!.delete(cb);
  }
  private emit(type: string, ...a: unknown[]): void {
    this.listeners.get(type)?.forEach((cb) => cb(...a));
  }
  toast(text: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    this.emit('toast', text, level);
  }

  // ---- lookups -----------------------------------------------------------------------------
  get(id: string | null): Part | null {
    return this.parts.find((p) => p.id === id) ?? null;
  }
  get body(): Part | null {
    return this.parts.find((p) => p.type === 'body') ?? null;
  }
  get face(): Part | null {
    return this.parts.find((p) => p.type === 'face') ?? null;
  }
  of(type: PartType): Part[] {
    return this.parts.filter((p) => p.type === type);
  }
  children(p: Part): Part[] {
    return this.parts.filter((x) => x.parentId === p.id);
  }

  // ---- features (cached per part, dropped when the model itself changes) ---------------------------
  invalidate(id: string): void {
    this.featVer.set(id, (this.featVer.get(id) ?? 0) + 1);
  }
  private cached<T>(p: Part, key: string, f: () => T): T {
    const k = `${p.id}:${key}`;
    const ver = this.featVer.get(p.id) ?? 0;
    const c = this.featCache.get(k);
    if (c && c.ver === ver) return c.v as T;
    p.root.updateWorldMatrix(true, true);
    this.featureComputes++;
    const v = f();
    this.featCache.set(k, { ver, v });
    return v;
  }
  bodyFeatures(p: Part): BodyFeatures {
    return this.cached(p, 'body', () => analyzeBody(p));
  }
  faceFeatures(p: Part): FaceFeatures {
    return this.cached(p, 'face', () => analyzeFace(p));
  }
  hairFeatures(p: Part): HairFeatures {
    return this.cached(p, 'hair', () => analyzeHair(p));
  }
  garmentFeatures(p: Part): GarmentFeatures {
    return this.cached(p, 'garment', () => analyzeGarment(p));
  }
  anchors(p: Part): AnchorResult {
    const f: Parameters<typeof computeAnchors>[1] = {};
    if (p.type === 'body') f.body = this.bodyFeatures(p);
    if (p.type === 'face') f.face = this.faceFeatures(p);
    if (p.type === 'hair') f.hair = this.hairFeatures(p);
    if (p.type === 'garment') f.garment = this.garmentFeatures(p);
    return computeAnchors(p, f);
  }

  // ---- adding parts -------------------------------------------------------------------------------
  /** read files only (nothing is added yet): the UI may ask for the type before calling addModel */
  async readFiles(files: File[]): Promise<{ models: LoadedModel[]; errors: LoadError[] }> {
    return loadModelsFromFiles(files);
  }

  detect(model: LoadedModel): Detection {
    return detectPartType({ fileName: model.fileName, names: model.names, meta: model.meta, model: model.object });
  }

  /** Put a loaded model into the assembly. `choice` overrides the detected type. */
  async addModel(model: LoadedModel, choice?: PartType, restore?: Partial<Part> & { id?: string }): Promise<Part[]> {
    const det = this.detect(model);
    let type = choice ?? restore?.type ?? det.type;
    const added: Part[] = [];
    const msgs: string[] = [];
    let onlyClothes = false;

    // a body file that carries its own clothes (cloth_* meshes) is split into body + garment
    let garmentModel: LoadedModel | null = null;
    if (restore?.variant === 'no-cloth') for (const m of embeddedGarmentMeshes(model.object)) strip(m);
    if (restore?.variant === 'cloth-only') for (const m of meshesWhere(model.object, (x) => !isCloth(x.name))) strip(m);
    if (type === 'body' && !restore) {
      const cloth = embeddedGarmentMeshes(model.object);
      const all = skinnedMeshesOfSafe(model.object);
      const hasBodyMesh = all.length > cloth.length;
      if (cloth.length && hasBodyMesh && this.body) {
        // the studio has one body: this file (made by 仕立て屋) contributes its clothes only
        for (const m of meshesWhere(model.object, (x) => !isCloth(x.name))) strip(m);
        type = 'garment';
        onlyClothes = true;
        msgs.push(`「${model.fileName}」は身体＋衣服のファイルです。身体はすでにあるため、衣服メッシュ（cloth_* ${cloth.length}点）だけを取り込みました。`);
      } else if (cloth.length && hasBodyMesh) {
        const again = await loadModelsFromFiles(model.files.map((f) => new File([f.blob], f.name, { type: f.type })));
        if (again.models[0]) {
          garmentModel = again.models[0];
          for (const m of meshesWhere(garmentModel.object, (x) => !isCloth(x.name))) strip(m);
          for (const m of embeddedGarmentMeshes(model.object)) strip(m);
          msgs.push(`「${model.fileName}」には衣服メッシュ（cloth_*）${cloth.length}点が含まれていたため、身体と衣服に分けて読み込みました。`);
        }
      } else if (this.body) {
        msgs.push(`身体は1体だけ扱います。既存の身体「${this.body.name}」を「${model.fileName}」に置き換えました（他の部品は新しい身体に合わせ直します）。`);
        this.dropPart(this.body);
      }
    }

    const part = this.makePart(
      model,
      type,
      onlyClothes ? { type: 'garment', source: 'structure', confidence: 'high', reason: '身体ファイル内の衣服メッシュ（cloth_*）' } : det,
      onlyClothes ? 'structure' : choice ? 'user' : det.source,
      restore,
      onlyClothes ? `${stemOf(model.fileName)}（衣服）` : undefined,
    );
    if (garmentModel) part.variant = 'no-cloth';
    if (onlyClothes) part.variant = 'cloth-only';
    if (restore?.variant) part.variant = restore.variant;
    if (part.type === 'garment' && !part.garment) {
      part.garment = { region: 'torso', regionSource: 'default', rigMode: 'none', rigInfo: '', rigCompatible: false, rigLocked: false };
    }
    this.attach(part, null);
    this.parts.push(part);
    added.push(part);
    if (garmentModel) {
      const g = this.makePart(garmentModel, 'garment', { type: 'garment', source: 'structure', confidence: 'high', reason: '身体ファイル内の衣服メッシュ' }, 'structure', undefined, `${stemOf(model.fileName)}（衣服）`);
      g.garment = { region: 'whole', regionSource: 'default', rigMode: 'none', rigInfo: '', rigCompatible: false, rigLocked: false };
      g.variant = 'cloth-only';
      this.attach(g, null);
      this.parts.push(g);
      added.push(g);
    }
    for (const p of added) this.afterAdd(p);
    if (!restore) {
      this.refit({ keepManual: true });
      this.selectedId = added[added.length - 1].id;
      for (const m of msgs) this.toast(m, 'info');
    }
    this.emit('parts');
    this.emit('select', this.selectedId);
    if (!restore) this.runChecks(false);
    return added;
  }

  private makePart(model: LoadedModel, type: PartType, det: Detection, source: Part['typeSource'], restore?: Partial<Part>, nameOverride?: string): Part {
    const id = restore?.id ?? `p${this.seq++}`;
    if (restore?.id) {
      const n = Number(/^p(\d+)$/.exec(restore.id)?.[1]);
      if (n >= this.seq) this.seq = n + 1;
    }
    const stem = nameOverride ?? stemOf(model.fileName);
    const root = new THREE.Group();
    const norm = new THREE.Group();
    norm.name = 'normalize';
    root.name = `${TYPE_PREFIX[type]}_${stem}`;
    norm.add(model.object);
    root.add(norm);
    const bodyH = type === 'garment' && this.body ? this.bodyFeatures(this.body).height : undefined;
    const orient = restore?.orient ?? estimateOrientation(model.object, model.meta, type, bodyH);
    applyOrientation(norm, orient);
    const stats = modelStats(model.object);
    const part: Part = {
      id,
      name: this.uniqueName(stem),
      type,
      typeSource: source,
      typeConfidence: det.confidence,
      typeReason: det.reason,
      format: model.format,
      fileName: model.fileName,
      files: model.files as SourceFile[],
      root,
      norm,
      model: model.object,
      visible: restore?.visible ?? true,
      orient,
      meta: model.meta as PartMeta,
      anchorOverrides: restore?.anchorOverrides ?? {},
      initial: IDENTITY_TRS(),
      auto: null,
      manual: null,
      parentId: null,
      fit: { status: 'unknown', confidence: 'none', messages: [], note: '未調整' },
      stats,
    };
    root.visible = part.visible;
    if (type === 'body') {
      part.bodyOpts = { hideHead: 'auto', neckLength: 1, neckThickness: 1, hasPlaceholderHead: false, neckSupported: false, neckNote: '' };
    }
    return part;
  }

  private uniqueName(stem: string): string {
    let n = stem;
    let i = 2;
    while (this.parts.some((p) => p.name === n)) n = `${stem} (${i++})`;
    return n;
  }

  private afterAdd(p: Part): void {
    if (p.type === 'body') this.initBody(p);
  }

  private attach(p: Part, parent: Part | null): void {
    p.root.parent?.remove(p.root);
    (parent ? parent.root : this.root).add(p.root);
    p.parentId = parent?.id ?? null;
  }

  /** change the parent while keeping the part where it is on screen */
  private reparentKeepWorld(p: Part, parent: Part | null): void {
    this.root.updateMatrixWorld(true);
    const w = p.root.matrixWorld.clone();
    this.attach(p, parent);
    const pm = (parent ? parent.root : this.root).matrixWorld.clone();
    pm.invert();
    const local = new THREE.Matrix4().multiplyMatrices(pm, w);
    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    local.decompose(pos, q, s);
    const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
    applyTRS(p.root, { p: [pos.x, pos.y, pos.z], r: [e.x, e.y, e.z], s: [s.x, s.y, s.z] });
  }

  // ---- body specifics -----------------------------------------------------------------------------
  private neckZones = new Map<string, NeckZone>();

  private initBody(p: Part): void {
    // measure on the pristine mesh: any earlier neck deformation is undone first
    this.restoreNeckGeometry(p);
    this.invalidate(p.id);
    const f = this.bodyFeatures(p);
    const o = p.bodyOpts!;
    o.hasPlaceholderHead = f.headHasGeometry;
    const H = f.height;
    const zone: NeckZone = {
      ax: f.neckBase[0],
      az: f.neckBase[2],
      yTop: f.neckBase[1],
      yLow: f.neckBase[1] - 0.05 * (H / 1.5),
      rx: Math.max(0.01, f.neckW / 2),
      rz: Math.max(0.01, f.neckD / 2),
    };
    const slender = f.neckW < 0.5 * (2 * f.shoulderHalfWidth);
    this.neckZones.set(p.id, zone);
    const n = slender ? this.deformNeck(p, 1, 1, true) : 0;
    if (!slender || n < 40) {
      o.neckSupported = false;
      o.neckNote = slender
        ? `首の部分の頂点が ${n} 点しか見つからず、変形できません（頭の位置・大きさで調整してください）。`
        : '首が肩幅に対して太く、首の位置を特定できないため非対応です（頭の位置・大きさで調整してください）。';
    } else {
      o.neckSupported = true;
      o.neckNote = `首の頂点 ${n} 点を、骨ではなく頂点の位置で変形します（スキンの重み・UV・頂点数は変わりません）。変形後の形が出力GLBにも入ります。`;
      if (o.neckLength !== 1 || o.neckThickness !== 1) {
        this.deformNeck(p, o.neckLength, o.neckThickness);
        this.invalidate(p.id);
      }
    }
    this.applyHeadVisibility(p);
  }

  /** put the original (file) vertex positions back */
  private restoreNeckGeometry(p: Part): void {
    for (const m of meshesWhere(p.model, () => true)) {
      const orig = meshState.get(m)?.origPos;
      if (!orig) continue;
      const pos = m.geometry.attributes.position as THREE.BufferAttribute;
      (pos.array as Float32Array).set(orig);
      pos.needsUpdate = true;
      m.geometry.computeBoundingSphere();
      m.geometry.computeBoundingBox();
    }
  }

  /**
   * Limited mesh deformation of the neck (priority 4 of the fitting order, only for bodies whose neck
   * can be located): the vertices of the neck tube are scaled sideways (thickness) and the neck top and
   * everything above it is moved up / down (length). Weights, UVs and topology are untouched.
   * `dry` only counts the vertices that would move.
   */
  private deformNeck(p: Part, length: number, thickness: number, dry = false): number {
    const z = this.neckZones.get(p.id);
    if (!z) return 0;
    p.root.updateWorldMatrix(true, true);
    const inv = new THREE.Matrix4().copy(p.root.matrixWorld).invert();
    const v = new THREE.Vector3();
    const smooth = (a: number, b: number, x: number) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    const dL = (length - 1) * (z.yTop - z.yLow);
    let count = 0;
    for (const m of meshesWhere(p.model, () => true)) {
      const pos = m.geometry.attributes.position as THREE.BufferAttribute;
      const ud = stateOf(m);
      if (!ud.origPos && !dry) ud.origPos = (pos.array as Float32Array).slice();
      const src = ud.origPos ?? (pos.array as Float32Array);
      const toPart = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
      const toGeo = new THREE.Matrix4().copy(toPart).invert();
      for (let i = 0; i < pos.count; i++) {
        v.set(src[i * 3], src[i * 3 + 1], src[i * 3 + 2]).applyMatrix4(toPart);
        const dx = v.x - z.ax;
        const dz = v.z - z.az;
        const r = Math.max(Math.abs(dx) / z.rx, Math.abs(dz) / z.rz);
        let moved = false;
        if (v.y >= z.yTop) {
          // the neck top and the head: carried up/down as a whole
          if (dL !== 0) {
            v.y += dL;
            moved = true;
          }
        } else if (v.y >= z.yLow && r < 1.35) {
          const wy = smooth(z.yLow, z.yTop, v.y);
          const wr = 1 - smooth(1.0, 1.35, r);
          const w = Math.max(wy, 0.0) * wr;
          if (w > 0) {
            count++;
            if (thickness !== 1) {
              v.x = z.ax + dx * (1 + (thickness - 1) * wr * Math.min(1, wy * 1.6 + 0.2));
              v.z = z.az + dz * (1 + (thickness - 1) * wr * Math.min(1, wy * 1.6 + 0.2));
              moved = true;
            }
            if (dL !== 0) {
              v.y += dL * wy * wr;
              moved = true;
            }
          }
        }
        if (dry) continue;
        if (moved) v.applyMatrix4(toGeo);
        else v.set(src[i * 3], src[i * 3 + 1], src[i * 3 + 2]);
        pos.setXYZ(i, v.x, v.y, v.z);
      }
      if (!dry) {
        pos.needsUpdate = true;
        m.geometry.computeBoundingSphere();
        m.geometry.computeBoundingBox();
      }
    }
    return count;
  }

  /** hide the body's stand-in head (spare-body's box head) when a face has been attached; reversible */
  applyHeadVisibility(p: Part): void {
    const o = p.bodyOpts;
    if (!o) return;
    const f = this.bodyFeatures(p);
    const hide = f.headHasGeometry && (o.hideHead === 'on' || (o.hideHead === 'auto' && !!this.face));
    for (const m of skinnedMeshesOf(p.model)) setHeadTriangles(m, hide);
    this.invalidate(p.id);
  }

  setHeadHide(id: string, mode: 'auto' | 'on' | 'off'): void {
    const p = this.get(id);
    if (!p?.bodyOpts) return;
    p.bodyOpts.hideHead = mode;
    this.applyHeadVisibility(p);
    this.emit('parts');
  }

  setNeck(id: string, patch: { length?: number; thickness?: number }): boolean {
    const p = this.get(id);
    if (!p?.bodyOpts?.neckSupported) return false;
    const o = p.bodyOpts;
    if (patch.length !== undefined) o.neckLength = patch.length;
    if (patch.thickness !== undefined) o.neckThickness = patch.thickness;
    this.deformNeck(p, o.neckLength, o.neckThickness);
    p.root.updateWorldMatrix(true, true);
    this.invalidate(p.id);
    this.refit({ keepManual: true, only: this.parts.filter((x) => x.type !== 'body').map((x) => x.id) });
    this.emit('transform', p.id);
    this.scheduleChecks();
    return true;
  }

  // ---- fitting ------------------------------------------------------------------------------------
  private fitCtx(): FitContext {
    const body = this.body;
    const face = this.face;
    return {
      parts: this.parts,
      body,
      face,
      bodyF: body ? this.bodyFeatures(body) : null,
      faceF: face ? this.faceFeatures(face) : null,
      hairF: (p) => this.hairFeatures(p),
      garmentF: (p) => this.garmentFeatures(p),
    };
  }

  /**
   * (Re)run the automatic fit. keepManual (default) re-applies hand adjustments on top of the new
   * result; keepManual=false drops them. `only` limits the work to some parts.
   */
  refit(opts: { keepManual?: boolean; only?: string[] } = {}): FitOutcome[] {
    const keep = opts.keepManual ?? true;
    const sel = (p: Part) => !opts.only || opts.only.includes(p.id);
    // body first: hiding the stand-in head depends on whether a face exists
    const body = this.body;
    if (body) this.applyHeadVisibility(body);
    this.root.updateMatrixWorld(true);
    const out: FitOutcome[] = [];
    const apply = (p: Part, o: FitOutcome) => {
      const parent = o.parentId ? this.get(o.parentId) : null;
      if ((p.parentId ?? null) !== (parent?.id ?? null)) this.reparentKeepWorld(p, parent);
      manual.setAuto(p, o.trs, keep);
      p.fit = { status: o.status, confidence: o.confidence, messages: o.messages, note: o.note };
      if (o.garment && p.garment) {
        p.garment.region = o.garment.region;
        p.garment.regionSource = o.garment.regionSource;
        p.garment.rigInfo = o.garment.rigInfo;
        p.garment.rigCompatible = o.garment.rigCompatible;
        p.garment.rigMode = o.garment.rigMode;
        const b = this.body;
        if (o.garment.rigMode === 'follow' && b) bindToBody(p.model, b.model);
        else unbindFromBody(p.model);
      }
      this.invalidate(p.id);
      this.root.updateMatrixWorld(true);
      out.push(o);
    };
    // 1. face -> body
    for (const f of this.of('face')) {
      if (!sel(f)) continue;
      this.root.updateMatrixWorld(true);
      apply(f, fitFace(f, this.fitCtx()));
    }
    // 2. hair -> face
    for (const h of this.of('hair')) {
      if (!sel(h)) continue;
      this.root.updateMatrixWorld(true);
      apply(h, fitHair(h, this.fitCtx()));
    }
    // 3. garments -> body
    for (const g of this.of('garment')) {
      if (!sel(g)) continue;
      this.root.updateMatrixWorld(true);
      const regionForced = g.garment?.regionSource === 'user' ? g.garment.region : undefined;
      const forceIndependent = !!g.garment?.rigLocked && g.garment.rigMode !== 'follow';
      // unbind first so the garment is measured in its own frame
      unbindFromBody(g.model);
      this.invalidate(g.id);
      apply(g, fitGarment(g, this.fitCtx(), regionForced, forceIndependent));
    }
    // the body itself: reference, nothing to fit
    for (const b of this.of('body')) {
      if (!sel(b)) continue;
      b.auto ??= trsOf(b.root);
      const o = this.bodyOutcome(b);
      b.fit = { status: 'ok', confidence: 'high', messages: o, note: '全身の配置基準（他の部品はこの身体に合わせます）' };
    }
    this.layerGarments();
    this.emit('parts');
    return out;
  }

  private bodyOutcome(b: Part): FitMessage[] {
    const f = this.bodyFeatures(b);
    const m: FitMessage[] = [{ level: 'info', text: `身長 ${f.height.toFixed(3)}m、骨 ${b.stats.bones} 本${f.hasSkeleton ? '（スキン付き）' : '（骨なし：比率で推定）'}。` }];
    if (b.bodyOpts?.hasPlaceholderHead) m.push({ level: 'info', text: `身体に頭の仮形状があります（高さ ${f.headH.toFixed(3)}m）。顔を付けると自動で隠します。` });
    return m;
  }

  /** same-region rigid garments that coincide get a tiny outward scale each, so they do not z-fight */
  private layerGarments(): void {
    const gs = this.of('garment').filter((g) => g.garment && g.garment.rigMode !== 'follow');
    const byRegion = new Map<GarmentRegion, Part[]>();
    for (const g of gs) {
      const r = g.garment!.region;
      if (!byRegion.has(r)) byRegion.set(r, []);
      byRegion.get(r)!.push(g);
    }
    for (const [, list] of byRegion) {
      if (list.length < 2) continue;
      list.forEach((g, i) => {
        if (!i || g.manual) return;
        const a = g.auto;
        if (!a) return;
        const k = 1 + 0.012 * i;
        const adj: TRS = { p: a.p, r: a.r, s: [a.s[0] * k, a.s[1] * k, a.s[2] * k] };
        manual.setAuto(g, adj, true);
        g.fit.messages.push({ level: 'info', text: `同じ部位の衣服と重なるため、${(0.012 * i * 100).toFixed(1)}% 大きくして重ね着にしました。` });
      });
    }
  }

  // ---- manual operations ------------------------------------------------------------------------------
  /** the user changed the transform of `id` (sliders, numbers, or the gizmo) */
  setTransform(id: string, patch: Parameters<typeof manual.setCurrent>[1]): void {
    const p = this.get(id);
    if (!p || this.isLocked(p)) return;
    manual.setCurrent(p, patch);
    this.root.updateMatrixWorld(true);
    this.emit('transform', id);
    this.scheduleChecks();
  }
  /** after the gizmo moved part.root directly */
  gizmoChanged(id: string): void {
    const p = this.get(id);
    if (!p) return;
    manual.captureManual(p);
    this.root.updateMatrixWorld(true);
    this.emit('transform', id);
    this.scheduleChecks();
  }
  /** transforms have no visible effect while a garment follows the body's bones */
  isLocked(p: Part): boolean {
    return p.type === 'garment' && p.garment?.rigMode === 'follow' && isBound(p.model);
  }
  resetInitial(id: string): void {
    const p = this.get(id);
    if (!p) return;
    manual.resetToInitial(p);
    this.root.updateMatrixWorld(true);
    this.emit('transform', id);
    this.scheduleChecks();
  }
  resetAuto(id: string): void {
    const p = this.get(id);
    if (!p) return;
    if (!manual.resetToAuto(p)) this.toast('この部品にはまだ自動調整の結果がありません。', 'warn');
    this.root.updateMatrixWorld(true);
    this.emit('transform', id);
    this.scheduleChecks();
  }
  private checkTimer = 0;
  scheduleChecks(): void {
    clearTimeout(this.checkTimer);
    this.checkTimer = window.setTimeout(() => this.runChecks(false), 180);
  }
  runChecks(detailed: boolean, detailedFor?: string[]): Connection[] {
    this.root.updateMatrixWorld(true);
    const body = this.body;
    const face = this.face;
    const prevDetail = new Map(this.connections.filter((c) => c.detailed).map((c) => [c.id, c]));
    this.connections = checkAll({
      parts: this.parts,
      body,
      face,
      bodyF: body ? this.bodyFeatures(body) : null,
      faceF: face ? this.faceFeatures(face) : null,
      hairF: (p) => this.hairFeatures(p),
      garmentF: (p) => this.garmentFeatures(p),
      detailed,
      detailedFor: detailedFor ? new Set(detailedFor) : undefined,
    });
    void prevDetail;
    this.emit('connections', this.connections);
    return this.connections;
  }

  // ---- part operations ---------------------------------------------------------------------------------
  select(id: string | null): void {
    this.selectedId = id;
    this.emit('select', id);
  }
  setVisible(id: string, v: boolean): void {
    const p = this.get(id);
    if (!p) return;
    p.visible = v;
    p.root.visible = v;
    this.emit('parts');
    this.scheduleChecks();
  }
  /** take a part out of the scene and free its resources (no refit, no events) */
  private dropPart(p: Part): void {
    for (const c of this.children(p)) this.reparentKeepWorld(c, null);
    if (p.type === 'garment') unbindFromBody(p.model);
    p.root.parent?.remove(p.root);
    disposeObject(p.root);
    this.parts = this.parts.filter((x) => x !== p);
    for (const k of [...this.featCache.keys()]) if (k.startsWith(p.id + ':')) this.featCache.delete(k);
    if (this.selectedId === p.id) this.selectedId = null;
  }

  remove(id: string): void {
    const p = this.get(id);
    if (!p) return;
    this.dropPart(p);
    this.refit({ keepManual: true });
    this.emit('parts');
    this.emit('select', this.selectedId);
    this.runChecks(false);
  }
  clear(): void {
    for (const p of [...this.parts]) {
      p.root.parent?.remove(p.root);
      disposeObject(p.root);
    }
    this.parts = [];
    this.connections = [];
    this.featCache.clear();
    this.selectedId = null;
    this.emit('parts');
    this.emit('select', null);
    this.emit('connections', this.connections);
  }

  /** replace the data of a part with a new file; the part keeps its place, type and manual adjustments */
  async reload(id: string, files: File[]): Promise<void> {
    const p = this.get(id);
    if (!p) return;
    const { models, errors } = await loadModelsFromFiles(files);
    if (!models.length) {
      throw errors[0] ?? new LoadError(files[0]?.name ?? '', '読み込めませんでした。');
    }
    const m = models[0];
    if (p.type === 'garment') unbindFromBody(p.model);
    p.norm.remove(p.model);
    disposeObject(p.model);
    p.norm.add(m.object);
    p.model = m.object;
    p.files = m.files;
    p.fileName = m.fileName;
    p.meta = m.meta as PartMeta;
    p.stats = modelStats(m.object);
    p.orient = estimateOrientation(m.object, m.meta, p.type, this.body ? this.bodyFeatures(this.body).height : undefined);
    applyOrientation(p.norm, p.orient);
    this.invalidate(p.id);
    if (p.type === 'body') this.initBody(p);
    this.refit({ keepManual: true });
    this.emit('parts');
    this.runChecks(false);
  }

  setType(id: string, type: PartType): void {
    const p = this.get(id);
    if (!p || p.type === type) return;
    if (p.type === 'garment') unbindFromBody(p.model);
    for (const c of this.children(p)) this.reparentKeepWorld(c, null);
    p.type = type;
    p.typeSource = 'user';
    p.typeConfidence = 'high';
    p.typeReason = 'ユーザー指定';
    p.root.name = `${TYPE_PREFIX[type]}_${p.name}`;
    p.auto = null;
    p.manual = null;
    delete p.bodyOpts;
    delete p.garment;
    if (type === 'garment') p.garment = { region: 'torso', regionSource: 'default', rigMode: 'none', rigInfo: '', rigCompatible: false, rigLocked: false };
    if (type === 'body') {
      p.bodyOpts = { hideHead: 'auto', neckLength: 1, neckThickness: 1, hasPlaceholderHead: false, neckSupported: false, neckNote: '' };
    }
    applyTRS(p.root, p.initial);
    this.attach(p, null);
    this.invalidate(p.id);
    if (type === 'body') this.initBody(p);
    this.refit({ keepManual: true });
    this.emit('parts');
    this.runChecks(false);
  }

  setOrientation(id: string, patch: Partial<Pick<Part['orient'], 'unit' | 'up' | 'forward' | 'yaw'>>): void {
    const p = this.get(id);
    if (!p) return;
    p.orient = { ...p.orient, ...patch, source: 'user' };
    applyOrientation(p.norm, p.orient);
    this.invalidate(p.id);
    if (p.type === 'body') this.initBody(p);
    for (const q of this.parts) this.invalidate(q.id);
    this.refit({ keepManual: true });
    this.runChecks(false);
  }

  setRegion(id: string, region: GarmentRegion): void {
    const p = this.get(id);
    if (!p?.garment) return;
    p.garment.region = region;
    p.garment.regionSource = 'user';
    this.refit({ keepManual: true, only: [id] });
    this.runChecks(false);
  }

  setRigMode(id: string, mode: RigMode): void {
    const p = this.get(id);
    if (!p?.garment) return;
    p.garment.rigLocked = true;
    if (mode === 'follow') p.garment.rigLocked = false;
    p.garment.rigMode = mode;
    unbindFromBody(p.model);
    this.invalidate(id);
    this.refit({ keepManual: true, only: [id] });
    this.runChecks(false);
  }

  setAnchor(id: string, name: AnchorName, p: Vec3 | null): void {
    const part = this.get(id);
    if (!part) return;
    if (p) part.anchorOverrides[name] = p;
    else delete part.anchorOverrides[name];
    this.emit('parts');
  }

  setAnchorMode(): void {
    /* anchors only feed exports and the anchor panel */
  }

  // ---- restoring a saved project ----------------------------------------------------------------------
  private pending = new Map<Part, SavedPart>();

  applySavedState(part: Part, sp: SavedPart): void {
    this.pending.set(part, sp);
    part.name = sp.name;
    part.root.name = `${TYPE_PREFIX[part.type]}_${sp.name}`;
    part.typeSource = sp.typeSource;
    part.typeConfidence = sp.typeConfidence;
    part.typeReason = sp.typeReason;
    part.initial = sp.initial;
    part.auto = sp.auto;
    part.manual = sp.manual;
    part.fit = sp.fit;
    if (sp.garment) part.garment = { ...sp.garment };
    if (sp.bodyOpts && part.bodyOpts) {
      part.bodyOpts.hideHead = sp.bodyOpts.hideHead;
      part.bodyOpts.neckLength = sp.bodyOpts.neckLength;
      part.bodyOpts.neckThickness = sp.bodyOpts.neckThickness;
    }
  }

  /** second pass of a restore: hierarchy, transforms, rig binding, body options, checks */
  finishRestore(): void {
    for (const [part, sp] of this.pending) {
      const parent = sp.parentId ? this.get(sp.parentId) : null;
      this.attach(part, parent && parent !== part ? parent : null);
    }
    for (const [part, sp] of this.pending) {
      applyTRS(part.root, sp.current);
      part.root.visible = part.visible;
    }
    this.pending.clear();
    this.root.updateMatrixWorld(true);
    const body = this.body;
    if (body?.bodyOpts) {
      const o = body.bodyOpts;
      if (o.neckSupported && (o.neckLength !== 1 || o.neckThickness !== 1)) this.deformNeck(body, o.neckLength, o.neckThickness);
      this.applyHeadVisibility(body);
    }
    this.root.updateMatrixWorld(true);
    for (const g of this.of('garment')) {
      if (g.garment?.rigMode === 'follow' && body) bindToBody(g.model, body.model);
    }
    for (const p of this.parts) this.invalidate(p.id);
    this.root.updateMatrixWorld(true);
    this.emit('parts');
    this.runChecks(false);
  }

  /** bounding box of everything visible, in world space */
  worldBox(): THREE.Box3 {
    this.root.updateMatrixWorld(true);
    const b = new THREE.Box3();
    for (const p of this.parts) {
      if (!p.visible) continue;
      b.union(boxIn(p.root, null));
    }
    return b;
  }
}

// ---- helpers --------------------------------------------------------------------------------------------

/** remove a mesh from a freshly read model and free its geometry (materials may be shared, left alone) */
function strip(m: THREE.Mesh): void {
  m.parent?.remove(m);
  m.geometry.dispose();
}
/** internal per-mesh bookkeeping (kept out of userData, which the GLB exporter writes into the file) */
interface MeshState {
  origIndex?: THREE.BufferAttribute | null;
  headHidden?: boolean;
  origPos?: Float32Array;
}
const meshState = new WeakMap<THREE.Mesh, MeshState>();
const stateOf = (m: THREE.Mesh): MeshState => {
  let s = meshState.get(m);
  if (!s) meshState.set(m, (s = {}));
  return s;
};
export const isHeadHidden = (m: THREE.Mesh): boolean => !!meshState.get(m)?.headHidden;

const stemOf = (n: string): string => n.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
const isCloth = (n: string): boolean => /^cloth_|^garment_|^dress_|衣装/i.test(n);

function skinnedMeshesOfSafe(o: THREE.Object3D): THREE.SkinnedMesh[] {
  return skinnedMeshesOf(o);
}
function meshesWhere(o: THREE.Object3D, f: (m: THREE.Mesh) => boolean): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  o.traverse((x) => {
    const m = x as THREE.Mesh;
    if (m.isMesh && f(m)) out.push(m);
  });
  return out;
}

/** triangles whose three vertices belong (by dominant bone) to the head bone group */
function setHeadTriangles(m: THREE.SkinnedMesh, hide: boolean): void {
  const g = m.geometry;
  const ud = stateOf(m);
  if (ud.origIndex === undefined) ud.origIndex = g.index ? (g.index.clone() as THREE.BufferAttribute) : null;
  if (!hide) {
    if (ud.headHidden) {
      g.setIndex(ud.origIndex ?? null);
      ud.headHidden = false;
    }
    return;
  }
  if (ud.headHidden) return;
  const si = g.attributes.skinIndex;
  const sw = g.attributes.skinWeight;
  const idx = ud.origIndex;
  if (!si || !sw || !idx) return;
  const groups = m.skeleton.bones.map((b) => boneGroup(b.name));
  const isHead = new Uint8Array(si.count);
  for (let i = 0; i < si.count; i++) {
    let head = 0;
    let other = 0;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      if (w <= 0) continue;
      if (groups[si.getComponent(i, k)] === 'head') head += w;
      else other += w;
    }
    isHead[i] = head > other ? 1 : 0;
  }
  // a triangle touching a head-owned vertex is hidden: this leaves a clean ring where the neck ends
  // instead of a flange that joins the neck to the underside of the stand-in head
  const keep: number[] = [];
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t);
    const b = idx.getX(t + 1);
    const c = idx.getX(t + 2);
    if (isHead[a] || isHead[b] || isHead[c]) continue;
    keep.push(a, b, c);
  }
  g.setIndex(keep);
  ud.headHidden = true;
}
