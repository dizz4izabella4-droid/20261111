// Parameter definitions for the base template (SPEC 5.2 / 5.3).
// Internal values are SI: lengths in meters, angles in degrees, indices 0..100.

export type Unit = 'cm' | 'mm' | 'deg' | 'index';

export interface ParamDef {
  key: string;
  label: string;
  unit: Unit;
  /** default, min, max in internal units (meters / degrees / index) */
  def: number;
  min: number;
  max: number;
  /** optional note shown under the label */
  note?: string;
}

/** factor from internal units to display units */
export const UNIT_SCALE: Record<Unit, number> = { cm: 100, mm: 1000, deg: 1, index: 1 };
export const UNIT_LABEL: Record<Unit, string> = { cm: 'cm', mm: 'mm', deg: '°', index: '' };
export const UNIT_STEP: Record<Unit, number> = { cm: 0.1, mm: 1, deg: 1, index: 1 };

export const BODY_DEFS: ParamDef[] = [
  { key: 'torsoHeight', label: '胴の高さ（首の付け根〜下端）', unit: 'cm', def: 0.45, min: 0.4, max: 0.6 },
  { key: 'shoulderWidth', label: '肩幅（肩関節中心間）', unit: 'cm', def: 0.32, min: 0.28, max: 0.42 },
  { key: 'chestDepth', label: '胸郭の厚み', unit: 'cm', def: 0.19, min: 0.15, max: 0.25 },
  { key: 'underbustCirc', label: 'アンダーバスト周径', unit: 'cm', def: 0.67, min: 0.6, max: 0.9 },
  { key: 'underbustHeight', label: 'アンダーバストの高さ', unit: 'cm', def: 0.25, min: 0.24, max: 0.36, note: '下端から' },
  { key: 'waistCirc', label: 'ウエスト周径', unit: 'cm', def: 0.59, min: 0.52, max: 0.9 },
  { key: 'waistHeight', label: 'ウエストの高さ', unit: 'cm', def: 0.14, min: 0.08, max: 0.2, note: '下端から' },
  { key: 'navelHeight', label: 'へその高さ', unit: 'cm', def: 0.05, min: 0.02, max: 0.1, note: '下端から' },
  { key: 'neckBaseWidth', label: '首の付け根の幅', unit: 'cm', def: 0.11, min: 0.09, max: 0.14 },
];

export const BREAST_DEFS: ParamDef[] = [
  { key: 'size', label: '大きさ（ボリューム）', unit: 'index', def: 50, min: 0, max: 100 },
  { key: 'projection', label: '前方への張り出し', unit: 'mm', def: 0.018, min: 0, max: 0.12 },
  { key: 'baseWidth', label: '付け根の幅', unit: 'mm', def: 0.17, min: 0.07, max: 0.18 },
  { key: 'baseHeight', label: '付け根の高さ', unit: 'mm', def: 0.16, min: 0.06, max: 0.17 },
  { key: 'centerHeight', label: '高さ位置（中心）', unit: 'cm', def: 0.335, min: 0.3, max: 0.44, note: '下端から' },
  { key: 'spacing', label: '左右の間隔（中心間）', unit: 'mm', def: 0.13, min: 0.12, max: 0.26 },
  { key: 'outwardAngle', label: '外向きの角度', unit: 'deg', def: 10, min: 0, max: 30 },
  { key: 'ptosis', label: '下垂', unit: 'index', def: 0, min: 0, max: 100 },
  { key: 'upperFullness', label: '上側の丸み', unit: 'index', def: 15, min: 0, max: 100 },
  { key: 'lowerFullness', label: '下側の丸み', unit: 'index', def: 70, min: 0, max: 100 },
  { key: 'nippleOffsetX', label: '乳頭の位置（左右）', unit: 'mm', def: 0, min: -0.02, max: 0.02, note: '＋で外側' },
  { key: 'nippleOffsetY', label: '乳頭の位置（上下）', unit: 'mm', def: 0, min: -0.025, max: 0.025, note: '＋で上' },
  { key: 'nippleDiameter', label: '乳頭の直径', unit: 'mm', def: 0.01, min: 0.004, max: 0.02 },
  { key: 'nippleProjection', label: '乳頭の高さ', unit: 'mm', def: 0, min: 0, max: 0.015 },
  { key: 'areolaDiameter', label: '乳輪の直径', unit: 'mm', def: 0.035, min: 0.015, max: 0.07 },
  { key: 'areolaProjection', label: '乳輪のふくらみ', unit: 'mm', def: 0, min: 0, max: 0.008 },
];

export interface BodyParams {
  torsoHeight: number; shoulderWidth: number; chestDepth: number;
  underbustCirc: number; underbustHeight: number; waistCirc: number;
  waistHeight: number; navelHeight: number; neckBaseWidth: number;
}

export interface BreastParams {
  size: number; projection: number; baseWidth: number; baseHeight: number;
  centerHeight: number; spacing: number; outwardAngle: number; ptosis: number;
  upperFullness: number; lowerFullness: number; nippleOffsetX: number; nippleOffsetY: number;
  nippleDiameter: number; nippleProjection: number; areolaDiameter: number; areolaProjection: number;
}

export type PresetName = 'light' | 'standard' | 'high';

export interface PresetDef {
  label: string;
  segments: number; // around the body
  rings: number; // along Y
}

/** SPEC 11.1 base grid. */
export const PRESETS: Record<PresetName, PresetDef> = {
  light: { label: '軽量（Light）', segments: 48, rings: 40 },
  standard: { label: '標準（Standard）', segments: 96, rings: 80 },
  high: { label: '高精細（High）', segments: 160, rings: 128 },
};

export interface ModelParams {
  body: BodyParams;
  breast: BreastParams;
}

function defaultsOf<T>(defs: ParamDef[]): T {
  const o: Record<string, number> = {};
  for (const d of defs) o[d.key] = d.def;
  return o as unknown as T;
}

export function defaultParams(): ModelParams {
  return {
    body: defaultsOf<BodyParams>(BODY_DEFS),
    breast: defaultsOf<BreastParams>(BREAST_DEFS),
  };
}

export function clampToRange(defs: ParamDef[], obj: Record<string, number>): void {
  for (const d of defs) {
    const v = obj[d.key];
    obj[d.key] = Number.isFinite(v) ? Math.min(d.max, Math.max(d.min, v)) : d.def;
  }
}
