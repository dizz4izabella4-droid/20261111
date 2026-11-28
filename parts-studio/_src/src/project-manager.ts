// project-manager: save and restore a working state.
//   * file     : a .parts-studio.json (state only, or with the model data embedded as base64)
//   * browser  : IndexedDB (state + the original model files). Never localStorage for model data.
// A failed save (e.g. storage full) reports the reason and leaves the previous save untouched.
import type { Assembly } from './assembly-manager';
import { loadModelsFromFiles } from './part-loader';
import type { Part, TRS, SourceFile } from './types';
import { trsOf } from './util';

export const PROJECT_FORMAT = 'parts-studio-project';

export interface SavedFile {
  name: string;
  type: string;
  size: number;
  /** base64 when embedded in the project file */
  data?: string;
}

export interface SavedPart {
  id: string;
  name: string;
  type: Part['type'];
  typeSource: Part['typeSource'];
  typeConfidence: Part['typeConfidence'];
  typeReason: string;
  format: Part['format'];
  fileName: string;
  files: SavedFile[];
  visible: boolean;
  orient: Part['orient'];
  anchorOverrides: Part['anchorOverrides'];
  initial: TRS;
  auto: TRS | null;
  current: TRS;
  manual: Part['manual'];
  parentId: string | null;
  fit: Part['fit'];
  garment?: Part['garment'];
  bodyOpts?: Part['bodyOpts'];
  variant?: Part['variant'];
  stats: Part['stats'];
}

export interface ProjectState {
  format: typeof PROJECT_FORMAT;
  version: 1;
  name: string;
  savedAt: string;
  selected: string | null;
  parts: SavedPart[];
  /** the last connection check, for reference (it is recomputed on restore) */
  connections: { kind: string; a: string; b: string | null; status: string; messages: string[] }[];
}

export class ProjectError extends Error {}

export function snapshot(asm: Assembly, name = 'project'): ProjectState {
  return {
    format: PROJECT_FORMAT,
    version: 1,
    name,
    savedAt: new Date().toISOString(),
    selected: asm.selectedId,
    parts: asm.parts.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      typeSource: p.typeSource,
      typeConfidence: p.typeConfidence,
      typeReason: p.typeReason,
      format: p.format,
      fileName: p.fileName,
      files: p.files.map((f) => ({ name: f.name, type: f.type, size: f.size })),
      visible: p.visible,
      orient: p.orient,
      anchorOverrides: p.anchorOverrides,
      initial: p.initial,
      auto: p.auto,
      current: trsOf(p.root),
      manual: p.manual,
      parentId: p.parentId,
      fit: p.fit,
      garment: p.garment,
      bodyOpts: p.bodyOpts,
      variant: p.variant,
      stats: p.stats,
    })),
    connections: asm.connections.map((c) => ({ kind: c.kind, a: c.a, b: c.b, status: c.status, messages: c.messages.map((m) => m.text) })),
  };
}

// ---- file -----------------------------------------------------------------------------------------------

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}
function fromBase64(b: string): Uint8Array {
  const s = atob(b);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function projectToJson(asm: Assembly, name: string, embed: boolean): Promise<string> {
  const st = snapshot(asm, name);
  if (embed) {
    for (const sp of st.parts) {
      const part = asm.get(sp.id)!;
      for (let i = 0; i < sp.files.length; i++) sp.files[i].data = toBase64(await part.files[i].blob.arrayBuffer());
    }
  }
  return JSON.stringify(st, null, 1);
}

export function parseProject(text: string): ProjectState {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    throw new ProjectError('プロジェクトファイルのJSONが壊れています（解析できません）。');
  }
  const o = j as Partial<ProjectState>;
  if (!o || o.format !== PROJECT_FORMAT) throw new ProjectError('3Dパーツ統合スタジオのプロジェクトファイルではありません。');
  if (o.version !== 1) throw new ProjectError(`プロジェクトのバージョン ${String(o.version)} には対応していません。`);
  if (!Array.isArray(o.parts)) throw new ProjectError('プロジェクトに部品の一覧がありません。');
  return o as ProjectState;
}

export interface RestoreReport {
  restored: string[];
  missing: { part: string; files: string[] }[];
  errors: string[];
}

/**
 * Rebuild the assembly from a saved state. `find` returns the bytes of a model file by name
 * (from embedded data, IndexedDB, or files the user picked). Parts whose files cannot be found are
 * skipped and listed; everything else is restored.
 */
export async function restoreProject(asm: Assembly, st: ProjectState, find: (partId: string, f: SavedFile) => Promise<Blob | null>): Promise<RestoreReport> {
  const report: RestoreReport = { restored: [], missing: [], errors: [] };
  // parents (faces) before children (hair)
  const order = [...st.parts].sort((a, b) => (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0));
  const loaded: { sp: SavedPart; part: Part }[] = [];
  asm.clear();
  for (const sp of order) {
    const files: File[] = [];
    const miss: string[] = [];
    for (const f of sp.files) {
      const b = await find(sp.id, f);
      if (b) files.push(new File([b], f.name, { type: f.type }));
      else miss.push(f.name);
    }
    if (miss.length && !files.some((f) => /\.(glb|gltf|obj)$/i.test(f.name))) {
      report.missing.push({ part: sp.name, files: miss });
      continue;
    }
    try {
      const { models, errors } = await loadModelsFromFiles(files);
      if (!models.length) {
        report.errors.push(`${sp.name}: ${errors[0]?.reason ?? '読み込めませんでした'}`);
        continue;
      }
      const parts = await asm.addModel(models[0], sp.type, { ...sp, files: undefined } as unknown as Partial<Part>);
      const part = parts[0];
      loaded.push({ sp, part });
      if (miss.length) report.missing.push({ part: sp.name, files: miss });
    } catch (e) {
      report.errors.push(`${sp.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // names, transforms, hierarchy
  for (const { sp, part } of loaded) asm.applySavedState(part, sp);
  asm.finishRestore();
  report.restored = loaded.map((l) => l.part.name);
  if (st.selected && asm.get(st.selected)) asm.select(st.selected);
  return report;
}

// ---- IndexedDB -----------------------------------------------------------------------------------------

const DB = 'parts-studio';
const STATE = 'projects';
const BLOBS = 'blobs';

function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined') return rej(new ProjectError('このブラウザではIndexedDBが使えないため、ブラウザ内への保存はできません（ファイル保存を使ってください）。'));
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore(STATE);
      r.result.createObjectStore(BLOBS);
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(new ProjectError(`IndexedDBを開けませんでした：${r.error?.message ?? ''}`));
  });
}

const blobKey = (proj: string, partId: string, file: string): string => `${proj}/${partId}/${file}`;

export async function saveToBrowser(asm: Assembly, name: string): Promise<{ bytes: number }> {
  const st = snapshot(asm, name);
  let bytes = 0;
  const db = await openDb();
  try {
    await new Promise<void>((res, rej) => {
      const tx = db.transaction([STATE, BLOBS], 'readwrite');
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error ?? new Error('保存が中断されました'));
      // remove the blobs of the previous save of the same name only inside this transaction:
      // if anything fails the whole transaction aborts and the old save stays intact
      const bs = tx.objectStore(BLOBS);
      const range = IDBKeyRange.bound(name + '/', name + '/￿');
      bs.delete(range);
      for (const sp of st.parts) {
        const part = asm.get(sp.id)!;
        part.files.forEach((f: SourceFile) => {
          bs.put(f.blob, blobKey(name, sp.id, f.name));
          bytes += f.size;
        });
      }
      tx.objectStore(STATE).put(st, name);
    });
  } catch (e) {
    const err = e as { name?: string; message?: string } | null;
    if (err?.name === 'QuotaExceededError' || /quota/i.test(String(err?.message))) {
      throw new ProjectError(`ブラウザの保存容量が足りません（約 ${(bytes / 1048576).toFixed(1)}MB を保存しようとしました）。以前の保存はそのまま残っています。ファイルへの保存を使うか、ブラウザの保存領域を空けてください。`);
    }
    throw new ProjectError(`ブラウザ内への保存に失敗しました：${err?.message ?? String(e)}（以前の保存はそのまま残っています）`);
  } finally {
    db.close();
  }
  return { bytes };
}

export async function listBrowserProjects(): Promise<string[]> {
  const db = await openDb();
  try {
    return await new Promise<string[]>((res, rej) => {
      const r = db.transaction(STATE).objectStore(STATE).getAllKeys();
      r.onsuccess = () => res((r.result as IDBValidKey[]).map(String));
      r.onerror = () => rej(r.error);
    });
  } finally {
    db.close();
  }
}

export async function loadFromBrowser(name: string): Promise<{ state: ProjectState; find: (partId: string, f: SavedFile) => Promise<Blob | null> }> {
  const db = await openDb();
  const state = await new Promise<ProjectState | undefined>((res, rej) => {
    const r = db.transaction(STATE).objectStore(STATE).get(name);
    r.onsuccess = () => res(r.result as ProjectState | undefined);
    r.onerror = () => rej(r.error);
  });
  if (!state) {
    db.close();
    throw new ProjectError(`ブラウザ内に「${name}」の保存がありません。`);
  }
  const find = (partId: string, f: SavedFile): Promise<Blob | null> =>
    new Promise((res) => {
      const r = db.transaction(BLOBS).objectStore(BLOBS).get(blobKey(name, partId, f.name));
      r.onsuccess = () => res((r.result as Blob | undefined) ?? null);
      r.onerror = () => res(null);
    });
  // the connection stays open until the restore is finished; closed by the caller via GC of the page
  return { state, find };
}

export function embeddedFinder(): (partId: string, f: SavedFile) => Promise<Blob | null> {
  return async (_p, f) => (f.data ? new Blob([fromBase64(f.data) as BlobPart], { type: f.type }) : null);
}

export function fileFinder(files: File[], fallback: (partId: string, f: SavedFile) => Promise<Blob | null>): (partId: string, f: SavedFile) => Promise<Blob | null> {
  const map = new Map(files.map((f) => [f.name.toLowerCase(), f]));
  return async (p, f) => map.get(f.name.toLowerCase()) ?? fallback(p, f);
}
