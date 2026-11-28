// anchor-manager: where each part connects. Sources, weakest to strongest:
//   estimated (bounding box / skeleton / profile)  <  named node in the file  <  metadata  <  manual override.
// Every anchor remembers its source so the UI can show "推定" and the exporter only writes what is real.
import * as THREE from 'three';
import type { AnchorName, AnchorSet, Part, Vec3 } from './types';
import { ANCHOR_NAMES } from './types';
import type { BodyFeatures, FaceFeatures, GarmentFeatures, HairFeatures } from './features';
import { v3 } from './util';

export interface PartFeatures {
  body?: BodyFeatures;
  face?: FaceFeatures;
  hair?: HairFeatures;
  garment?: GarmentFeatures;
}

export interface AnchorResult {
  anchors: AnchorSet;
  warnings: string[];
}

const nodeNameToAnchor = (name: string): AnchorName | null => {
  const n = name.toLowerCase().replace(/^anchor[_.\- :]*/, '').replace(/[_.\- ]/g, '');
  for (const a of ANCHOR_NAMES) if (a.toLowerCase() === n) return a;
  return null;
};

export function computeAnchors(part: Part, f: PartFeatures): AnchorResult {
  const anchors: AnchorSet = {};
  const warnings: string[] = [];
  // 1. estimates
  if (part.type === 'body' && f.body) {
    const hasBone = f.body.hasSkeleton;
    anchors.neckBase = { p: f.body.neckBase, source: hasBone ? 'bone' : 'estimated' };
    anchors.neckTop = { p: f.body.neckTop, source: hasBone ? 'bone' : 'estimated' };
  } else if (part.type === 'face' && f.face) {
    anchors.headRoot = { p: f.face.headRoot, source: 'estimated' };
    anchors.hairRoot = { p: f.face.crown, source: 'estimated' };
    if (f.face.neckBase) anchors.neckBase = { p: f.face.neckBase, source: 'estimated' };
  } else if (part.type === 'hair' && f.hair) {
    anchors.hairRoot = { p: [f.hair.capCx, f.hair.top, f.hair.capCz], source: 'estimated' };
  } else if (part.type === 'garment' && f.garment) {
    const c = f.garment.box.getCenter(new THREE.Vector3());
    anchors.garmentRoot = { p: v3(c), source: 'estimated' };
  }
  // 2. named nodes inside the file
  part.root.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(part.root.matrixWorld).invert();
  const tmp = new THREE.Vector3();
  part.model.traverse((o) => {
    const a = nodeNameToAnchor(o.name);
    if (a && !(o as THREE.Mesh).isMesh) {
      o.getWorldPosition(tmp).applyMatrix4(inv);
      anchors[a] = { p: v3(tmp), source: 'node' };
    }
  });
  // 3. metadata (given in the file's own coordinates -> studio frame)
  const bounds = new THREE.Box3();
  const ext = featureBox(f);
  if (ext) bounds.copy(ext).expandByScalar(Math.max(0.05, ext.getSize(new THREE.Vector3()).length() * 0.25));
  for (const a of ANCHOR_NAMES) {
    const v = part.meta.anchors?.[a];
    if (!v) continue;
    const p = new THREE.Vector3(v[0], v[1], v[2]).applyMatrix4(part.norm.matrix);
    if (!bounds.isEmpty() && !bounds.containsPoint(p)) {
      warnings.push(`メタデータのアンカー「${a}」がモデルの範囲外のため無視しました（名前だけ登録されて位置が合っていない可能性）。`);
      continue;
    }
    anchors[a] = { p: v3(p), source: 'metadata' };
  }
  // 4. manual
  for (const a of ANCHOR_NAMES) {
    const m = part.anchorOverrides[a];
    if (m) anchors[a] = { p: [m[0], m[1], m[2]], source: 'manual' };
  }
  return { anchors, warnings };
}

function featureBox(f: PartFeatures): THREE.Box3 | null {
  return f.body?.box ?? f.face?.box ?? f.hair?.box ?? f.garment?.box ?? null;
}

export function anchorPoint(set: AnchorSet, name: AnchorName): THREE.Vector3 | null {
  const a = set[name];
  return a ? new THREE.Vector3(a.p[0], a.p[1], a.p[2]) : null;
}

/** metadata block for export (spec 3-C), anchors in the carrier node's own frame, only those that are real */
export function metaForExport(part: Part, set: AnchorSet): Record<string, unknown> {
  const anchors: Record<string, Vec3 | null> = {};
  for (const a of ANCHOR_NAMES) {
    const info = set[a];
    anchors[a] = info && info.source !== 'estimated' ? (info.p.map((x) => Math.round(x * 1e6) / 1e6) as Vec3) : null;
  }
  // estimated anchors are measured from the actual geometry, so they match the model too; they are labelled
  const estimated: Record<string, Vec3> = {};
  for (const a of ANCHOR_NAMES) {
    const info = set[a];
    if (info && info.source === 'estimated') estimated[a] = info.p.map((x) => Math.round(x * 1e6) / 1e6) as Vec3;
  }
  return {
    schemaVersion: 1,
    partType: part.type,
    coordinateSystem: { up: 'Y', forward: 'Z', unit: 'meter' },
    anchors,
    estimatedAnchors: estimated,
    rig: { skeletonType: part.stats.bones ? (part.meta.rig?.skeletonType ?? 'generic') : null, boneMapping: part.meta.rig?.boneMapping ?? {} },
    source: { application: 'parts-studio', version: '1', originalFile: part.fileName, originalSource: part.meta.source ?? null },
  };
}
