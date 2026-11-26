// Project state (M1: parameters + preset). Full *.bust.zip format is milestone M5.
import type { Patch } from './patch/patch';
import type { PatchGrid } from './analysis/grid';
import type { ViewId } from './analysis/camera';
import { BODY_DEFS, BREAST_DEFS, BODY_PRESETS, clampToRange, presetParams, PRESETS, type BodyPresetName, type ModelParams, type PresetName } from './model/params';

export const FORMAT_VERSION = 1;

export interface ProjectJson {
  formatVersion: number;
  preset?: PresetName;
  /** body-type preset the params start from (女性 / 男性); default female */
  bodyPreset?: BodyPresetName;
  params?: { body?: Record<string, number>; breast?: Record<string, number> };
  /** M2 (temporary until the *.bust.zip format of M5): patches with base64 little-endian arrays */
  patches?: PatchJson[];
  /** M2: photos referenced by same-origin URL or data URL, with landmarks (image pixels) */
  photos?: { view: ViewId; src: string; name?: string; landmarks: Record<string, [number, number]> }[];
}

export interface PatchJson {
  id: string;
  name?: string;
  view: string;
  grid: PatchGrid;
  gain?: number;
  visible?: boolean;
  region: string; // base64 Uint8
  d: string; // base64 Float32 (meters)
  dRaw?: string;
  conf: string; // base64 Float32
}

function b64ToBytes(b: string): Uint8Array {
  const bin = atob(b);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(a: Uint8Array): string {
  let s = '';
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000));
  return btoa(s);
}
const f32 = (b: string) => new Float32Array(b64ToBytes(b).slice().buffer);

export function parsePatch(j: PatchJson): Patch {
  return {
    id: j.id,
    name: j.name ?? j.id,
    sourcePhotoIds: [],
    mode: 'single',
    view: j.view,
    grid: j.grid,
    region: b64ToBytes(j.region),
    d: f32(j.d),
    dRaw: j.dRaw ? f32(j.dRaw) : undefined,
    conf: f32(j.conf),
    gain: j.gain ?? 1,
    visible: j.visible ?? true,
  };
}

export function serializePatch(p: Patch): PatchJson {
  const u8 = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  return {
    id: p.id, name: p.name, view: p.view, grid: p.grid, gain: p.gain, visible: p.visible,
    region: bytesToB64(p.region), d: bytesToB64(u8(p.d)), dRaw: p.dRaw ? bytesToB64(u8(p.dRaw)) : undefined, conf: bytesToB64(u8(p.conf)),
  };
}

export interface Project {
  preset: PresetName;
  bodyPreset: BodyPresetName;
  params: ModelParams;
  patches: Patch[];
}

export function parseProject(json: ProjectJson, fallbackPreset: PresetName): Project {
  if (typeof json !== 'object' || json === null) throw new Error('プロジェクトの形式が正しくありません');
  if (typeof json.formatVersion !== 'number' || json.formatVersion > FORMAT_VERSION)
    throw new Error(`対応していない formatVersion です: ${json.formatVersion}`);
  const bodyPreset: BodyPresetName = json.bodyPreset && json.bodyPreset in BODY_PRESETS ? json.bodyPreset : 'female';
  const params = presetParams(bodyPreset);
  Object.assign(params.body, json.params?.body ?? {});
  Object.assign(params.breast, json.params?.breast ?? {});
  clampToRange(BODY_DEFS, params.body as unknown as Record<string, number>);
  clampToRange(BREAST_DEFS, params.breast as unknown as Record<string, number>);
  const preset = json.preset && json.preset in PRESETS ? json.preset : fallbackPreset;
  return { preset, bodyPreset, params, patches: (json.patches ?? []).map(parsePatch) };
}

export function serializeProject(p: Project): ProjectJson {
  return { formatVersion: FORMAT_VERSION, preset: p.preset, bodyPreset: p.bodyPreset, params: { body: { ...p.params.body }, breast: { ...p.params.breast } }, patches: p.patches.map(serializePatch) };
}
