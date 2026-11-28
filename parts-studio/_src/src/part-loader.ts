// part-loader: read GLB / GLTF / OBJ(+MTL, textures) files into three.js objects.
// Reading never modifies the files; failures are reported with a reason and nothing else is touched.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import type { AnchorName, PartMeta, PartType, SourceFile } from './types';
import { ANCHOR_NAMES } from './types';
import { bonesOf, meshesOf } from './util';

export class LoadError extends Error {
  constructor(
    readonly fileName: string,
    readonly reason: string,
  ) {
    super(`${fileName}: ${reason}`);
  }
}

export interface LoadedModel {
  object: THREE.Object3D;
  format: 'glb' | 'gltf' | 'obj';
  fileName: string;
  meta: PartMeta;
  files: SourceFile[];
  warnings: string[];
  /** object / node names, used by the detector */
  names: string[];
}

const PRIMARY = /\.(glb|gltf|obj)$/i;
const RESOURCE = /\.(mtl|bin|png|jpe?g|webp|bmp|gif|tga)$/i;
const baseName = (n: string): string => n.replace(/^.*[\\/]/, '').toLowerCase();
const stem = (n: string): string => n.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');

export const ACCEPT = '.glb,.gltf,.obj,.mtl,.bin,.png,.jpg,.jpeg,.webp,.bmp,.gif,.tga';

export function describeSupport(): string {
  return '対応形式：GLB / GLTF（.bin・画像を一緒に選択）/ OBJ（.mtl・テクスチャを一緒に選択）';
}

/** Files that make up one or more models. Resource files (bin, mtl, images) are shared. */
export async function loadModelsFromFiles(files: File[]): Promise<{ models: LoadedModel[]; errors: LoadError[] }> {
  const primaries = files.filter((f) => PRIMARY.test(f.name));
  const models: LoadedModel[] = [];
  const errors: LoadError[] = [];
  // files that are neither a model nor a known resource are reported even when other files load fine
  for (const f of files) {
    if (PRIMARY.test(f.name) || RESOURCE.test(f.name)) continue;
    const ext = /\.([^.]+)$/.exec(f.name)?.[1] ?? '';
    errors.push(new LoadError(f.name, ext ? `「.${ext}」は未対応の形式です。GLB / GLTF / OBJ に変換してください。` : '拡張子がないため形式を判定できません。'));
  }
  if (!primaries.length) {
    if (!errors.length) errors.push(new LoadError(files.map((f) => f.name).join('、') || '(なし)', 'GLB / GLTF / OBJ のファイルが見つかりません（MTL・画像・BIN だけが選ばれています）。'));
    return { models, errors };
  }
  const resources = new Map<string, File>();
  for (const f of files) resources.set(baseName(f.name), f);
  for (const f of primaries) {
    try {
      models.push(await loadOne(f, resources));
    } catch (e) {
      errors.push(e instanceof LoadError ? e : new LoadError(f.name, e instanceof Error ? e.message : String(e)));
    }
  }
  return { models, errors };
}

async function loadOne(file: File, resources: Map<string, File>): Promise<LoadedModel> {
  const ext = /\.([^.]+)$/.exec(file.name)![1].toLowerCase();
  if (file.size === 0) throw new LoadError(file.name, 'ファイルが空です（0バイト）。');
  if (ext === 'glb') return loadGlb(file);
  if (ext === 'gltf') return loadGltf(file, resources);
  return loadObj(file, resources);
}

function sourceFiles(...fs: File[]): SourceFile[] {
  return fs.map((f) => ({ name: f.name, type: f.type || 'application/octet-stream', size: f.size, blob: f }));
}

/** cheap structural validation of a GLB container before handing it to the loader */
export function validateGlb(buf: ArrayBuffer, name: string): void {
  if (buf.byteLength < 20) throw new LoadError(name, 'GLBとして読み込めません（ファイルが短すぎます）。');
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new LoadError(name, 'GLBではありません（先頭が "glTF" ではありません）。拡張子だけが .glb の別形式の可能性があります。');
  const version = dv.getUint32(4, true);
  if (version !== 2) throw new LoadError(name, `GLBのバージョン ${version} には対応していません（glTF 2.0 のみ）。`);
  const length = dv.getUint32(8, true);
  if (length > buf.byteLength) throw new LoadError(name, `GLBが途中で切れています（ヘッダ ${length} バイト／実際 ${buf.byteLength} バイト）。ファイルが破損している可能性があります。`);
  const chunkLen = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== 0x4e4f534a || 20 + chunkLen > buf.byteLength) throw new LoadError(name, 'GLBのJSONチャンクが壊れています。');
}

function parseGltf(loader: GLTFLoader, data: ArrayBuffer | string, path: string, name: string): Promise<{ scene: THREE.Group; userData: Record<string, unknown>; parser: unknown }> {
  return new Promise((resolve, reject) => {
    loader.parse(
      data,
      path,
      (g) => resolve({ scene: g.scene, userData: (g.userData ?? {}) as Record<string, unknown>, parser: g.parser }),
      (err) => reject(new LoadError(name, `読み込みに失敗しました：${(err as { message?: string })?.message ?? String(err)}`)),
    );
  });
}

async function loadGlb(file: File): Promise<LoadedModel> {
  const buf = await file.arrayBuffer();
  validateGlb(buf, file.name);
  const loader = new GLTFLoader();
  const { scene, userData } = await parseGltf(loader, buf, '', file.name);
  return finish(scene, 'glb', file.name, sourceFiles(file), userData);
}

async function loadGltf(file: File, resources: Map<string, File>): Promise<LoadedModel> {
  const text = await file.text();
  try {
    JSON.parse(text);
  } catch {
    throw new LoadError(file.name, 'GLTFのJSONが壊れています（解析できません）。');
  }
  const urls: string[] = [];
  const used: File[] = [file];
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    const f = resources.get(baseName(decodeURIComponent(url)));
    if (f) {
      const u = URL.createObjectURL(f);
      urls.push(u);
      if (!used.includes(f)) used.push(f);
      return u;
    }
    return url;
  });
  const missing: string[] = [];
  try {
    const json = JSON.parse(text) as { buffers?: { uri?: string }[]; images?: { uri?: string }[] };
    for (const r of [...(json.buffers ?? []), ...(json.images ?? [])]) {
      if (r.uri && !r.uri.startsWith('data:') && !resources.has(baseName(decodeURIComponent(r.uri)))) missing.push(r.uri);
    }
  } catch {
    /* validated above */
  }
  if (missing.length) {
    throw new LoadError(file.name, `GLTFが参照するファイルが選択されていません：${missing.join('、')}。.gltf と同時に選択（またはドラッグ）してください。`);
  }
  try {
    const loader = new GLTFLoader(manager);
    const { scene, userData } = await parseGltf(loader, text, '', file.name);
    return finish(scene, 'gltf', file.name, sourceFiles(...used), userData);
  } finally {
    setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 10000);
  }
}

async function loadObj(file: File, resources: Map<string, File>): Promise<LoadedModel> {
  const text = await file.text();
  if (!/^\s*v\s+[-\d.eE+]+\s+[-\d.eE+]+\s+[-\d.eE+]+/m.test(text)) {
    throw new LoadError(file.name, 'OBJとして読み込めません（頂点 "v x y z" の行がありません）。');
  }
  const warnings: string[] = [];
  const used: File[] = [file];
  const urls: string[] = [];
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    const f = resources.get(baseName(decodeURIComponent(url)));
    if (f) {
      const u = URL.createObjectURL(f);
      urls.push(u);
      if (!used.includes(f)) used.push(f);
      return u;
    }
    return url;
  });
  const loader = new OBJLoader(manager);
  const mtllib = /^\s*mtllib\s+(.+)$/m.exec(text)?.[1]?.trim();
  if (mtllib) {
    const mtlFile = resources.get(baseName(mtllib)) ?? [...resources.values()].find((f) => /\.mtl$/i.test(f.name) && stem(f.name) === stem(file.name));
    if (mtlFile) {
      try {
        const mtl = new MTLLoader(manager).parse(await mtlFile.text(), '');
        mtl.preload();
        loader.setMaterials(mtl);
        used.push(mtlFile);
      } catch (e) {
        warnings.push(`MTLを読めませんでした（${e instanceof Error ? e.message : e}）。既定のマテリアルで表示します。`);
      }
    } else {
      warnings.push(`MTL「${mtllib}」が選択されていないため、既定のマテリアルで表示します。OBJ と同時に選択（またはドラッグ）してください。`);
    }
  }
  let obj: THREE.Group;
  try {
    obj = loader.parse(text);
  } catch (e) {
    throw new LoadError(file.name, `OBJの解析に失敗しました：${e instanceof Error ? e.message : e}`);
  }
  setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 10000);
  const m = finish(obj, 'obj', file.name, sourceFiles(...used), {});
  m.warnings.push(...warnings);
  return m;
}

function finish(object: THREE.Object3D, format: 'glb' | 'gltf' | 'obj', fileName: string, files: SourceFile[], assetUserData: Record<string, unknown>): LoadedModel {
  const meshes = meshesOf(object);
  if (!meshes.length) throw new LoadError(fileName, 'メッシュ（形状）が含まれていません。');
  let bad = 0;
  for (const m of meshes) {
    const p = m.geometry.attributes.position;
    for (let i = 0; i < Math.min(p.count, 2000); i++) {
      if (!Number.isFinite(p.getX(i)) || !Number.isFinite(p.getY(i)) || !Number.isFinite(p.getZ(i))) {
        bad++;
        break;
      }
    }
  }
  if (bad) throw new LoadError(fileName, `頂点座標に数値でない値（NaN など）が含まれています（${bad}メッシュ）。ファイルが破損している可能性があります。`);
  const names: string[] = [];
  object.traverse((o) => {
    if (o.name && !(o as THREE.Bone).isBone) names.push(o.name);
  });
  return { object, format, fileName, meta: readMeta(object, assetUserData), files, warnings: [], names };
}

// ---- metadata ---------------------------------------------------------------------------------

const looksLikeMeta = (u: Record<string, unknown> | undefined): boolean =>
  !!u && (u.schemaVersion !== undefined || u.partType !== undefined || u.coordinateSystem !== undefined || u.anchors !== undefined);

/** Read the common metadata block (spec 3-C) and, as a courtesy, the spare-body GLB extras. */
export function readMeta(object: THREE.Object3D, assetUserData: Record<string, unknown>): PartMeta {
  const meta: PartMeta = { from: 'none' };
  const candidates: [Record<string, unknown> | undefined, PartMeta['from']][] = [[object.userData as Record<string, unknown>, 'scene']];
  for (const c of object.children) candidates.push([c.userData as Record<string, unknown>, 'node']);
  candidates.push([assetUserData, 'asset']);
  for (const [u, from] of candidates) {
    if (!u || !Object.keys(u).length) continue;
    if (looksLikeMeta(u)) {
      Object.assign(meta, pickMeta(u));
      meta.from = from;
      break;
    }
  }
  const sceneU = object.userData as Record<string, unknown>;
  if (typeof sceneU.format === 'string') {
    meta.raw = sceneU;
    if (!meta.partType && /^spare-body/.test(String(sceneU.format))) meta.partType = 'body';
    if (meta.from === 'none') meta.from = 'scene';
  }
  return meta;
}

function pickMeta(u: Record<string, unknown>): PartMeta {
  const m: PartMeta = {};
  if (typeof u.schemaVersion === 'number') m.schemaVersion = u.schemaVersion;
  if (u.partType === 'face' || u.partType === 'hair' || u.partType === 'body' || u.partType === 'garment') m.partType = u.partType as PartType;
  if (u.coordinateSystem && typeof u.coordinateSystem === 'object') m.coordinateSystem = u.coordinateSystem as PartMeta['coordinateSystem'];
  if (u.anchors && typeof u.anchors === 'object') {
    m.anchors = {};
    for (const k of ANCHOR_NAMES) {
      const v = (u.anchors as Record<string, unknown>)[k];
      if (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x))) (m.anchors as Record<AnchorName, number[]>)[k] = v as number[];
    }
  }
  if (u.rig && typeof u.rig === 'object') m.rig = u.rig as PartMeta['rig'];
  if (u.source && typeof u.source === 'object') m.source = u.source as PartMeta['source'];
  return m;
}

export function modelStats(object: THREE.Object3D): { vertices: number; triangles: number; meshes: number; skinned: boolean; bones: number } {
  let vertices = 0;
  let triangles = 0;
  let skinned = false;
  const meshes = meshesOf(object);
  for (const m of meshes) {
    vertices += m.geometry.attributes.position.count;
    triangles += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
    if ((m as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
  }
  return { vertices, triangles: Math.round(triangles), meshes: meshes.length, skinned, bones: bonesOf(object).length };
}
