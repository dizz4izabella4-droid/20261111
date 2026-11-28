// rig-retargeter: attach a skinned garment to the body's skeleton when the two rigs are compatible.
// "Compatible" means every bone the garment is skinned to exists in the body under the same name.
// Nothing is re-weighted or re-targeted beyond that name mapping: weights and inverse bind matrices
// stay exactly as authored. Incompatible rigs are left alone (the garment is placed with transforms).
import * as THREE from 'three';
import { bonesOf, skinnedMeshesOf } from './util';

export interface RigCompat {
  compatible: boolean;
  skinned: boolean;
  total: number;
  mapped: number;
  missing: string[];
  /** largest distance (m) between corresponding bones' bind positions (garment skeleton vs body skeleton) */
  maxBoneOffset: number;
  reason: string;
}

const norm = (n: string): string => n.toLowerCase().replace(/^mixamorig[:_]?/, '').replace(/[^a-z0-9]/g, '');

export function boneMap(body: THREE.Object3D): Map<string, THREE.Bone> {
  const map = new Map<string, THREE.Bone>();
  for (const b of bonesOf(body)) {
    if (!map.has(b.name)) map.set(b.name, b);
    const k = norm(b.name);
    if (!map.has('~' + k)) map.set('~' + k, b);
  }
  return map;
}

function lookup(map: Map<string, THREE.Bone>, name: string): THREE.Bone | undefined {
  return map.get(name) ?? map.get('~' + norm(name));
}

/** the bones each garment mesh actually uses (weight > 0) */
function usedBoneNames(mesh: THREE.SkinnedMesh): Set<string> {
  const used = new Set<number>();
  const si = mesh.geometry.attributes.skinIndex;
  const sw = mesh.geometry.attributes.skinWeight;
  if (si && sw) {
    for (let i = 0; i < si.count; i++) for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > 1e-6) used.add(si.getComponent(i, k));
  }
  const names = new Set<string>();
  for (const i of used) if (mesh.skeleton.bones[i]) names.add(mesh.skeleton.bones[i].name);
  return names;
}

export function checkRigCompat(garment: THREE.Object3D, body: THREE.Object3D | null): RigCompat {
  const meshes = skinnedMeshesOf(garment);
  if (!meshes.length) return { compatible: false, skinned: false, total: 0, mapped: 0, missing: [], maxBoneOffset: 0, reason: '衣服にスキン（骨の重み）がないため、位置・回転・スケールで合わせます。' };
  if (!body) return { compatible: false, skinned: true, total: 0, mapped: 0, missing: [], maxBoneOffset: 0, reason: '身体が読み込まれていないため、リグの対応付けは未判定です。' };
  const bodyBones = boneMap(body);
  if (!bodyBones.size) return { compatible: false, skinned: true, total: 0, mapped: 0, missing: [], maxBoneOffset: 0, reason: '身体に骨格がないため、リグの対応付けはできません（非互換）。' };
  const names = new Set<string>();
  for (const m of meshes) for (const n of usedBoneNames(m)) names.add(n);
  const missing: string[] = [];
  let mapped = 0;
  let maxOff = 0;
  const gp = new THREE.Vector3();
  const bp = new THREE.Vector3();
  garment.updateWorldMatrix(true, true);
  body.updateWorldMatrix(true, true);
  const gbones = new Map<string, THREE.Bone>();
  for (const b of bonesOf(garment)) gbones.set(b.name, b);
  for (const n of names) {
    const bb = lookup(bodyBones, n);
    if (!bb) {
      missing.push(n);
      continue;
    }
    mapped++;
    const gb = gbones.get(n);
    if (gb) {
      gb.getWorldPosition(gp);
      bb.getWorldPosition(bp);
      maxOff = Math.max(maxOff, gp.distanceTo(bp));
    }
  }
  const compatible = missing.length === 0 && mapped > 0;
  return {
    compatible,
    skinned: true,
    total: names.size,
    mapped,
    missing,
    maxBoneOffset: maxOff,
    reason: compatible
      ? `リグ互換：使用する骨 ${mapped}/${names.size} が身体の骨と同名で対応します。`
      : `リグ非互換：身体に無い骨 ${missing.length} 本（${missing.slice(0, 4).join('、')}${missing.length > 4 ? ' ほか' : ''}）。無理な再割り当てはせず、通常の配置で合わせます。`,
  };
}

interface Saved {
  mesh: THREE.SkinnedMesh;
  skeleton: THREE.Skeleton;
}
const savedRigs = new WeakMap<THREE.Object3D, { meshes: Saved[]; detached: { bone: THREE.Bone; parent: THREE.Object3D }[] }>();

/** Re-skin the garment onto the body's bones (names mapped; inverse bind matrices kept as authored). */
export function bindToBody(garment: THREE.Object3D, body: THREE.Object3D): void {
  if (savedRigs.has(garment)) return;
  const map = boneMap(body);
  const meshes: Saved[] = [];
  const own = new Set(bonesOf(garment));
  for (const m of skinnedMeshesOf(garment)) {
    const bones = m.skeleton.bones.map((b) => lookup(map, b.name) ?? b);
    meshes.push({ mesh: m, skeleton: m.skeleton });
    const sk = new THREE.Skeleton(bones, m.skeleton.boneInverses.map((x) => x.clone()));
    m.bind(sk, m.bindMatrix.clone());
  }
  // the garment's own copy of the skeleton is no longer driving anything: take it out of the scene
  const detached: { bone: THREE.Bone; parent: THREE.Object3D }[] = [];
  for (const b of own) {
    if (b.parent && !(b.parent as THREE.Bone).isBone) {
      detached.push({ bone: b, parent: b.parent });
    }
  }
  for (const d of detached) d.parent.remove(d.bone);
  savedRigs.set(garment, { meshes, detached });
}

export function unbindFromBody(garment: THREE.Object3D): void {
  const s = savedRigs.get(garment);
  if (!s) return;
  for (const d of s.detached) d.parent.add(d.bone);
  for (const x of s.meshes) x.mesh.bind(x.skeleton, x.mesh.bindMatrix.clone());
  savedRigs.delete(garment);
}

export function isBound(garment: THREE.Object3D): boolean {
  return savedRigs.has(garment);
}
