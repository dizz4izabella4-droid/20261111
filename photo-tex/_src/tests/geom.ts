// Geometry helpers for tests.
import type { BaseMesh } from '../src/model/mesh';

/** weld vertices with bit-identical positions; returns remap index -> welded id */
export function weld(positions: Float32Array): Int32Array {
  const map = new Map<string, number>();
  const n = positions.length / 3;
  const out = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const key = `${positions[i * 3]},${positions[i * 3 + 1]},${positions[i * 3 + 2]}`;
    let id = map.get(key);
    if (id === undefined) {
      id = map.size;
      map.set(key, id);
    }
    out[i] = id;
  }
  return out;
}

export interface WatertightReport {
  triangles: number;
  edges: number;
  badEdges: number; // edges not shared by exactly 2 faces
  inconsistentEdges: number; // directed edge used twice (orientation flip)
  degenerate: number;
  signedVolume: number;
}

export function watertight(mesh: { positions: Float32Array; indices: Uint32Array }): WatertightReport {
  const w = weld(mesh.positions);
  const und = new Map<string, number>();
  const dir = new Map<string, number>();
  let degenerate = 0;
  let vol = 0;
  const P = mesh.positions;
  const I = mesh.indices;
  for (let t = 0; t < I.length; t += 3) {
    const v = [w[I[t]], w[I[t + 1]], w[I[t + 2]]];
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) {
      degenerate++;
      continue;
    }
    for (let e = 0; e < 3; e++) {
      const a = v[e];
      const b = v[(e + 1) % 3];
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      und.set(k, (und.get(k) ?? 0) + 1);
      const d = `${a}>${b}`;
      dir.set(d, (dir.get(d) ?? 0) + 1);
    }
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    vol +=
      (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) -
        P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) +
        P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) /
      6;
  }
  let bad = 0;
  for (const c of und.values()) if (c !== 2) bad++;
  let inc = 0;
  for (const c of dir.values()) if (c !== 1) inc++;
  return { triangles: I.length / 3, edges: und.size, badEdges: bad, inconsistentEdges: inc, degenerate, signedVolume: vol };
}

/** perimeter of the mesh cross-section at height y, using the grid columns */
export function sliceGridPerimeter(mesh: BaseMesh, y: number): number {
  const cols = mesh.segments + 1;
  const P = mesh.positions;
  const pts: [number, number][] = [];
  for (let j = 0; j < mesh.segments; j++) {
    let found = false;
    for (let i = 0; i < mesh.rings - 1; i++) {
      const a = i * cols + j;
      const b = (i + 1) * cols + j;
      const ya = P[a * 3 + 1];
      const yb = P[b * 3 + 1];
      if ((ya - y) * (yb - y) <= 0 && ya !== yb) {
        const t = (y - ya) / (yb - ya);
        pts.push([P[a * 3] + (P[b * 3] - P[a * 3]) * t, P[a * 3 + 2] + (P[b * 3 + 2] - P[a * 3 + 2]) * t]);
        found = true;
        break;
      }
    }
    if (!found) throw new Error('slice missed a column');
  }
  let len = 0;
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k];
    const q = pts[(k + 1) % pts.length];
    len += Math.hypot(p[0] - q[0], p[1] - q[1]);
  }
  return len;
}

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** segment p0-p1 crosses triangle (a,b,c) strictly inside (Möller–Trumbore) */
function segTri(p0: V3, p1: V3, a: V3, b: V3, c: V3): boolean {
  const eps = 1e-12;
  const d = sub(p1, p0);
  const e1 = sub(b, a);
  const e2 = sub(c, a);
  const h = cross(d, e2);
  const det = dot(e1, h);
  if (Math.abs(det) < eps) return false;
  const f = 1 / det;
  const s = sub(p0, a);
  const u = f * dot(s, h);
  if (u <= 1e-9 || u >= 1 - 1e-9) return false;
  const q = cross(s, e1);
  const v = f * dot(d, q);
  if (v <= 1e-9 || u + v >= 1 - 1e-9) return false;
  const t = f * dot(e2, q);
  return t > 1e-9 && t < 1 - 1e-9;
}

export function trianglesIntersect(A: V3[], B: V3[]): boolean {
  for (let i = 0; i < 3; i++) {
    if (segTri(A[i], A[(i + 1) % 3], B[0], B[1], B[2])) return true;
    if (segTri(B[i], B[(i + 1) % 3], A[0], A[1], A[2])) return true;
  }
  return false;
}

/**
 * Self-intersection search among the grid triangles that touch the breast region
 * (any vertex with height > 0) against all nearby non-adjacent grid triangles.
 */
export function selfIntersections(mesh: BaseMesh, cell = 0.01): { pairsTested: number; hits: number } {
  const cols = mesh.segments + 1;
  const gridTris = (mesh.rings - 1) * mesh.segments * 2;
  const I = mesh.indices;
  const P = mesh.positions;
  const wid = (k: number) => (k % cols === mesh.segments ? k - mesh.segments : k);
  const vtx = (k: number): V3 => [P[k * 3], P[k * 3 + 1], P[k * 3 + 2]];
  const grid = new Map<string, number[]>();
  const boxes: number[][] = [];
  for (let t = 0; t < gridTris; t++) {
    const vs = [vtx(I[t * 3]), vtx(I[t * 3 + 1]), vtx(I[t * 3 + 2])];
    const lo = [0, 1, 2].map((c) => Math.min(vs[0][c], vs[1][c], vs[2][c]));
    const hi = [0, 1, 2].map((c) => Math.max(vs[0][c], vs[1][c], vs[2][c]));
    boxes.push([...lo, ...hi]);
    for (let x = Math.floor(lo[0] / cell); x <= Math.floor(hi[0] / cell); x++)
      for (let y = Math.floor(lo[1] / cell); y <= Math.floor(hi[1] / cell); y++)
        for (let z = Math.floor(lo[2] / cell); z <= Math.floor(hi[2] / cell); z++) {
          const k = `${x},${y},${z}`;
          let arr = grid.get(k);
          if (!arr) grid.set(k, (arr = []));
          arr.push(t);
        }
  }
  let pairs = 0;
  let hits = 0;
  const seen = new Set<number>();
  for (let t = 0; t < gridTris; t++) {
    const ids = [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]];
    if (!ids.some((k) => mesh.height[k] > 0)) continue;
    const b = boxes[t];
    seen.clear();
    const wt = ids.map(wid);
    const A = ids.map(vtx);
    for (let x = Math.floor(b[0] / cell); x <= Math.floor(b[3] / cell); x++)
      for (let y = Math.floor(b[1] / cell); y <= Math.floor(b[4] / cell); y++)
        for (let z = Math.floor(b[2] / cell); z <= Math.floor(b[5] / cell); z++) {
          const arr = grid.get(`${x},${y},${z}`);
          if (!arr) continue;
          for (const u of arr) {
            if (u === t || seen.has(u)) continue;
            seen.add(u);
            const ids2 = [I[u * 3], I[u * 3 + 1], I[u * 3 + 2]];
            const w2 = ids2.map(wid);
            if (w2.some((k) => wt.includes(k))) continue; // adjacent
            const c = boxes[u];
            if (c[0] > b[3] || c[3] < b[0] || c[1] > b[4] || c[4] < b[1] || c[2] > b[5] || c[5] < b[2]) continue;
            pairs++;
            if (trianglesIntersect(A, ids2.map(vtx))) hits++;
          }
        }
  }
  return { pairsTested: pairs, hits };
}

/**
 * Grid faces whose orientation, seen from the radial displacement center O, differs from the
 * undeformed torso grid (sign of det(A-O, B-O, C-O)). This is the fold criterion for a radial graph.
 */
export function flippedFaces(mesh: BaseMesh, undeformed: Float64Array, O: V3): number {
  const cols = mesh.segments + 1;
  const gridTris = (mesh.rings - 1) * mesh.segments * 2;
  const I = mesh.indices;
  const P = mesh.positions;
  let flips = 0;
  for (let t = 0; t < gridTris; t++) {
    const ids = [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]];
    if (!ids.some((k) => mesh.height[k] > 0)) continue;
    const d = ids.map((k) => [P[k * 3], P[k * 3 + 1], P[k * 3 + 2]] as V3);
    const u = ids.map((k) => [undeformed[k * 3], undeformed[k * 3 + 1], undeformed[k * 3 + 2]] as V3);
    const det = (p: V3[]) => dot(sub(p[0], O), cross(sub(p[1], O), sub(p[2], O)));
    if (det(d) * det(u) <= 0) flips++;
  }
  void cols;
  return flips;
}
