import * as THREE from 'three';
import type { Vec3, TRS } from './types';

export const v3 = (v: THREE.Vector3): Vec3 => [v.x, v.y, v.z];
export const fromV3 = (a: Vec3 | number[]): THREE.Vector3 => new THREE.Vector3(a[0], a[1], a[2]);
export const round = (n: number, d = 4): number => {
  const k = Math.pow(10, d);
  return Math.round(n * k) / k;
};
export const rad = (d: number): number => (d * Math.PI) / 180;
export const deg = (r: number): number => (r * 180) / Math.PI;

export function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry && m.geometry.attributes.position) out.push(m);
  });
  return out;
}

export function skinnedMeshesOf(root: THREE.Object3D): THREE.SkinnedMesh[] {
  return meshesOf(root).filter((m) => (m as THREE.SkinnedMesh).isSkinnedMesh) as THREE.SkinnedMesh[];
}

export function bonesOf(root: THREE.Object3D): THREE.Bone[] {
  const out: THREE.Bone[] = [];
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) out.push(o as THREE.Bone);
  });
  return out;
}

const _va = new THREE.Vector3();
const _m = new THREE.Matrix4();

/**
 * Sample vertex positions (skinning applied) in the space of `space`'s world matrix.
 * `stride` > 1 thins the points; `max` bounds the total per call.
 * Returns xyz triples; also (optionally) the index of the mesh each point came from.
 */
export function sampleVertices(
  root: THREE.Object3D,
  space: THREE.Object3D | null,
  max = 30000,
  filter?: (m: THREE.Mesh) => boolean,
): Float32Array {
  root.updateWorldMatrix(true, true);
  space?.updateWorldMatrix(true, false);
  const inv = new THREE.Matrix4();
  if (space) inv.copy(space.matrixWorld).invert();
  const meshes = meshesOf(root).filter((m) => (filter ? filter(m) : true) && m.visible);
  let total = 0;
  for (const m of meshes) total += m.geometry.attributes.position.count;
  const stride = Math.max(1, Math.ceil(total / max));
  const out: number[] = [];
  for (const m of meshes) {
    const pos = m.geometry.attributes.position;
    _m.copy(m.matrixWorld);
    if (space) _m.premultiply(inv);
    const sk = m as THREE.SkinnedMesh;
    for (let i = 0; i < pos.count; i += stride) {
      if (sk.isSkinnedMesh) sk.getVertexPosition(i, _va);
      else _va.fromBufferAttribute(pos, i);
      _va.applyMatrix4(_m);
      out.push(_va.x, _va.y, _va.z);
    }
  }
  return new Float32Array(out);
}

export function boxOfPoints(pts: Float32Array): THREE.Box3 {
  const b = new THREE.Box3();
  for (let i = 0; i < pts.length; i += 3) b.expandByPoint(_va.set(pts[i], pts[i + 1], pts[i + 2]));
  return b;
}

/** Bounding box of an object in the space of `space` (vertex exact, skinning applied). */
export function boxIn(root: THREE.Object3D, space: THREE.Object3D | null, filter?: (m: THREE.Mesh) => boolean): THREE.Box3 {
  return boxOfPoints(sampleVertices(root, space, 200000, filter));
}

export function trsOf(o: THREE.Object3D): TRS {
  return {
    p: [o.position.x, o.position.y, o.position.z],
    r: [o.rotation.x, o.rotation.y, o.rotation.z],
    s: [o.scale.x, o.scale.y, o.scale.z],
  };
}

export function applyTRS(o: THREE.Object3D, t: TRS): void {
  o.position.set(t.p[0], t.p[1], t.p[2]);
  o.rotation.set(t.r[0], t.r[1], t.r[2], 'XYZ');
  o.scale.set(t.s[0], t.s[1], t.s[2]);
  o.updateMatrix();
}

export function trsFromMatrix(m: THREE.Matrix4): TRS {
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  m.decompose(p, q, s);
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  return { p: [p.x, p.y, p.z], r: [e.x, e.y, e.z], s: [s.x, s.y, s.z] };
}

export function matrixFromTRS(t: TRS): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(t.r[0], t.r[1], t.r[2], 'XYZ'));
  return new THREE.Matrix4().compose(new THREE.Vector3(...t.p), q, new THREE.Vector3(...t.s));
}

export function trsEqual(a: TRS, b: TRS, eps = 1e-6): boolean {
  for (let i = 0; i < 3; i++) {
    if (Math.abs(a.p[i] - b.p[i]) > eps || Math.abs(a.r[i] - b.r[i]) > eps || Math.abs(a.s[i] - b.s[i]) > eps) return false;
  }
  return true;
}

export const IDENTITY_TRS = (): TRS => ({ p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] });

export function median(a: number[]): number {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}
export function percentile(a: number[], q: number): number {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))];
}

/** Spatial hash over points, for nearest-neighbour queries (detailed checks only). */
export class PointGrid {
  private cells = new Map<string, number[]>();
  constructor(
    readonly pts: Float32Array,
    readonly cell: number,
  ) {
    for (let i = 0; i < pts.length; i += 3) {
      const k = this.key(pts[i], pts[i + 1], pts[i + 2]);
      let c = this.cells.get(k);
      if (!c) this.cells.set(k, (c = []));
      c.push(i);
    }
  }
  private key(x: number, y: number, z: number): string {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)},${Math.floor(z / this.cell)}`;
  }
  /** nearest point within `radius`; returns index into pts (multiple of 3) or -1, and the distance */
  nearest(x: number, y: number, z: number, radius: number): { i: number; d: number } {
    const r = Math.ceil(radius / this.cell);
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    const cz = Math.floor(z / this.cell);
    let best = -1;
    let bd = radius * radius;
    for (let ix = cx - r; ix <= cx + r; ix++)
      for (let iy = cy - r; iy <= cy + r; iy++)
        for (let iz = cz - r; iz <= cz + r; iz++) {
          const c = this.cells.get(`${ix},${iy},${iz}`);
          if (!c) continue;
          for (const i of c) {
            const dx = this.pts[i] - x;
            const dy = this.pts[i + 1] - y;
            const dz = this.pts[i + 2] - z;
            const d = dx * dx + dy * dy + dz * dz;
            if (d < bd) {
              bd = d;
              best = i;
            }
          }
        }
    return { i: best, d: best < 0 ? Infinity : Math.sqrt(bd) };
  }
}

export function disposeObject(root: THREE.Object3D): void {
  const geos = new Set<THREE.BufferGeometry>();
  const mats = new Set<THREE.Material>();
  const texs = new Set<THREE.Texture>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) geos.add(m.geometry);
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (mat) for (const x of Array.isArray(mat) ? mat : [mat]) mats.add(x);
    const sk = o as THREE.SkinnedMesh;
    if (sk.isSkinnedMesh && sk.skeleton) sk.skeleton.dispose();
  });
  for (const mat of mats) {
    for (const v of Object.values(mat)) {
      if (v && (v as THREE.Texture).isTexture) texs.add(v as THREE.Texture);
    }
  }
  geos.forEach((g) => g.dispose());
  mats.forEach((m) => m.dispose());
  texs.forEach((t) => t.dispose());
}
