import type * as THREE from 'three';

export type PartType = 'face' | 'hair' | 'body' | 'garment';
export const PART_TYPES: PartType[] = ['face', 'hair', 'body', 'garment'];
export const PART_TYPE_JA: Record<PartType, string> = {
  face: '顔',
  hair: '髪型',
  body: '身体',
  garment: '衣服・装飾品',
};

export type Vec3 = [number, number, number];

/** position (m), Euler XYZ rotation (rad), scale — in the parent's local space */
export interface TRS {
  p: Vec3;
  r: Vec3;
  s: Vec3;
}

export type FitStatus = 'ok' | 'adjust' | 'unknown' | 'unsupported';
export const STATUS_JA: Record<FitStatus, string> = {
  ok: '正常',
  adjust: '要調整',
  unknown: '未判定',
  unsupported: '非対応',
};

export type AnchorName = 'headRoot' | 'neckBase' | 'neckTop' | 'hairRoot' | 'garmentRoot';
export const ANCHOR_NAMES: AnchorName[] = ['headRoot', 'neckBase', 'neckTop', 'hairRoot', 'garmentRoot'];
export const ANCHOR_JA: Record<AnchorName, string> = {
  headRoot: '頭の付け根',
  neckBase: '首の下端',
  neckTop: '首の上端',
  hairRoot: '髪の装着基準',
  garmentRoot: '衣服の基準',
};
export type AnchorSource = 'metadata' | 'node' | 'bone' | 'estimated' | 'manual';
export const ANCHOR_SOURCE_JA: Record<AnchorSource, string> = {
  metadata: 'メタデータ',
  node: 'ノード',
  bone: '骨',
  estimated: '推定',
  manual: '手動',
};
export interface AnchorInfo {
  p: Vec3;
  source: AnchorSource;
}
export type AnchorSet = Partial<Record<AnchorName, AnchorInfo>>;

export type GarmentRegion =
  | 'whole'
  | 'torso'
  | 'chest'
  | 'waist'
  | 'pelvis'
  | 'arm'
  | 'leg'
  | 'foot'
  | 'hand'
  | 'neck'
  | 'head';
export const GARMENT_REGIONS: GarmentRegion[] = ['whole', 'torso', 'chest', 'waist', 'pelvis', 'arm', 'leg', 'foot', 'hand', 'neck', 'head'];
export const REGION_JA: Record<GarmentRegion, string> = {
  whole: '全身',
  torso: '胴体',
  chest: '胸部',
  waist: '腰',
  pelvis: '骨盤',
  arm: '腕',
  leg: '脚',
  foot: '足',
  hand: '手',
  neck: '首',
  head: '頭部',
};

/** axis spec such as '+Y' or '-Z' */
export type AxisSpec = '+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z';
export interface Orientation {
  /** multiplier from file units to meters */
  unit: number;
  up: AxisSpec;
  forward: AxisSpec;
  /** extra yaw (degrees, about +Y) the user applied on top */
  yaw: number;
  /** where the values came from */
  source: 'metadata' | 'estimated' | 'user';
}

export type RigMode = 'follow' | 'independent' | 'none';

export interface PartMeta {
  schemaVersion?: number;
  partType?: PartType;
  coordinateSystem?: { up?: string; forward?: string; unit?: string };
  anchors?: Partial<Record<AnchorName, number[] | null>>;
  rig?: { skeletonType?: string | null; boneMapping?: Record<string, string> };
  source?: { application?: string; version?: string };
  /** raw scene extras (e.g. spare-body-glb-v1) */
  raw?: Record<string, unknown>;
  /** found in which place */
  from?: 'scene' | 'node' | 'asset' | 'none';
}

export interface FitMessage {
  level: 'info' | 'warn' | 'error';
  text: string;
}

export interface FitResult {
  status: FitStatus;
  confidence: 'high' | 'medium' | 'low' | 'none';
  messages: FitMessage[];
  /** short note about what the auto fit did */
  note: string;
}

export interface SourceFile {
  name: string;
  type: string;
  size: number;
  /** the actual bytes while the part lives in memory */
  blob: Blob;
}

export interface Part {
  id: string;
  name: string;
  type: PartType;
  typeSource: 'metadata' | 'filename' | 'structure' | 'user';
  typeConfidence: 'high' | 'medium' | 'low';
  typeReason: string;
  format: 'glb' | 'gltf' | 'obj';
  fileName: string;
  files: SourceFile[];
  /** transform carrier: this is what the user adjusts (parent-local) */
  root: THREE.Group;
  /** non-destructive unit / axis conversion */
  norm: THREE.Group;
  /** the loaded model, untouched */
  model: THREE.Object3D;
  visible: boolean;
  orient: Orientation;
  meta: PartMeta;
  anchorOverrides: Partial<Record<AnchorName, Vec3>>;
  initial: TRS;
  auto: TRS | null;
  /** current minus auto, so a re-fit can keep what the user did by hand */
  manual: { dp: Vec3; dq: [number, number, number, number]; ds: Vec3 } | null;
  parentId: string | null;
  fit: FitResult;
  // body only
  bodyOpts?: { hideHead: 'auto' | 'on' | 'off'; neckLength: number; neckThickness: number; hasPlaceholderHead: boolean; neckSupported: boolean; neckNote: string };
  // garment only
  garment?: {
    region: GarmentRegion;
    regionSource: 'name' | 'rig' | 'position' | 'user' | 'default';
    rigMode: RigMode;
    rigInfo: string;
    rigCompatible: boolean;
    /** the user chose the rig mode by hand, so a re-fit must not switch it */
    rigLocked: boolean;
  };
  /** a body file that carried its own clothes was split in two: which half this part is */
  variant?: 'no-cloth' | 'cloth-only';
  /** vertex / triangle statistics, for the list */
  stats: { vertices: number; triangles: number; meshes: number; skinned: boolean; bones: number };
}

export type ConnectionKind = 'head-body' | 'hair-head' | 'garment-body' | 'garment-garment' | 'whole';
export interface Connection {
  id: string;
  kind: ConnectionKind;
  a: string; // part id
  b: string | null; // part id (null for whole)
  label: string;
  status: FitStatus;
  messages: FitMessage[];
  metrics: Record<string, number>;
  detailed: boolean;
}
