// Patches (SPEC 9): skin-colored surface pieces sampled from the template inside the patch region,
// displaced along the template normal by gain·d, offset +0.5 mm, edge feathered over 3 texels.
import type { BodyModel } from '../model/mesh';
import { texelGeometry, type PatchGrid } from '../analysis/grid';

export const PATCH_COLOR = 0xe8bfa0;
export const PATCH_OFFSET = 0.0005;
export const FEATHER_TEXELS = 3;
export const MASK_MARGIN = 0.012;

export interface Patch {
  id: string;
  name: string;
  sourcePhotoIds: string[];
  mode: 'single';
  view: string;
  grid: PatchGrid;
  region: Uint8Array;
  dRaw?: Float32Array;
  /** smoothed displacement (meters) */
  d: Float32Array;
  conf: Float32Array;
  gain: number;
  visible: boolean;
  settings?: Record<string, unknown>;
}

/** chamfer distance (texels) from each region texel to the nearest non-region texel */
export function edgeDistance(region: Uint8Array, nx: number, ny: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(nx * ny);
  for (let k = 0; k < d.length; k++) d[k] = region[k] ? INF : 0;
  const D1 = 1, D2 = Math.SQRT2;
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (!d[k]) continue;
      // grid border counts as outside
      let v = Math.min(d[k], i === 0 || j === 0 ? 1 : INF);
      if (i > 0) v = Math.min(v, d[k - 1] + D1);
      if (j > 0) v = Math.min(v, d[k - nx] + D1);
      if (i > 0 && j > 0) v = Math.min(v, d[k - nx - 1] + D2);
      if (i < nx - 1 && j > 0) v = Math.min(v, d[k - nx + 1] + D2);
      d[k] = v;
    }
  for (let j = ny - 1; j >= 0; j--)
    for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i;
      if (!d[k]) continue;
      let v = Math.min(d[k], i === nx - 1 || j === ny - 1 ? 1 : INF);
      if (i < nx - 1) v = Math.min(v, d[k + 1] + D1);
      if (j < ny - 1) v = Math.min(v, d[k + nx] + D1);
      if (i < nx - 1 && j < ny - 1) v = Math.min(v, d[k + nx + 1] + D2);
      if (i > 0 && j < ny - 1) v = Math.min(v, d[k + nx - 1] + D2);
      d[k] = v;
    }
  return d;
}

export interface PatchMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export function buildPatchMesh(model: BodyModel, p: Patch): PatchMesh {
  const g = p.grid;
  const geo = texelGeometry(model, g);
  const { nx, ny } = g;
  const dist = edgeDistance(p.region, nx, ny);
  const pos = new Float32Array(nx * ny * 3);
  for (let k = 0; k < nx * ny; k++) {
    const f = Math.min(1, Math.max(0, (dist[k] - 0.5) / FEATHER_TEXELS));
    const off = p.region[k] ? f * p.gain * p.d[k] + PATCH_OFFSET : 0;
    for (let q = 0; q < 3; q++) pos[k * 3 + q] = geo.S[k * 3 + q] + off * geo.N[k * 3 + q];
  }
  const idx: number[] = [];
  for (let j = 0; j < ny - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      if (!(p.region[a] && p.region[b] && p.region[c] && p.region[d])) continue;
      // outward winding: (j+1 is up, i+1 toward larger θ); outward normal = Ty × Tθ
      idx.push(a, c, b, b, c, d);
    }
  // compact to used vertices
  const used = new Int32Array(nx * ny).fill(-1);
  let m = 0;
  for (const v of idx) if (used[v] < 0) used[v] = m++;
  const P = new Float32Array(m * 3);
  for (let k = 0; k < nx * ny; k++) if (used[k] >= 0) P.set(pos.subarray(k * 3, k * 3 + 3), used[k] * 3);
  const I = Uint32Array.from(idx, (v) => used[v]);
  // area-weighted vertex normals
  const N = new Float32Array(m * 3);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]];
    const e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (const v of [a, b, c]) for (let q = 0; q < 3; q++) N[v + q] += n[q];
  }
  for (let v = 0; v < m; v++) {
    const l = Math.hypot(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]) || 1;
    N[v * 3] /= l; N[v * 3 + 1] /= l; N[v * 3 + 2] /= l;
  }
  return { positions: P, normals: N, indices: I };
}

/**
 * Per base-mesh vertex: 1 if it lies well inside the region of a visible patch (at least MASK_MARGIN from
 * the patch edge: more than half the coarse base spacing, so no gap opens at jagged patch edges), else 0. Base grid vertices have
 * torso coordinates (θ_j, y_i); caps are never masked.
 */
export function baseMaskForPatches(base: { thetas: Float64Array; heights: Float64Array; segments: number; rings: number; positions: Float32Array }, patches: Patch[]): Float32Array {
  const nv = base.positions.length / 3;
  const mask = new Float32Array(nv);
  const cols = base.segments + 1;
  const TAU = 2 * Math.PI;
  for (const p of patches) {
    if (!p.visible) continue;
    const g = p.grid;
    const dist = edgeDistance(p.region, g.nx, g.ny);
    const texel = (g.y1 - g.y0) / g.ny; // meters per texel (approx.)
    for (let i = 0; i < base.rings; i++) {
      const y = base.heights[i];
      const fj = ((y - g.y0) / (g.y1 - g.y0)) * g.ny - 0.5;
      const j = Math.round(fj);
      if (j < 0 || j >= g.ny) continue;
      for (let c = 0; c < cols; c++) {
        let th = base.thetas[c % base.segments] + (c === base.segments ? TAU : 0);
        // bring θ into the patch domain (it may extend below 0 or above 2π)
        while (th < g.th0) th += TAU;
        while (th > g.th1 && th - TAU >= g.th0) th -= TAU;
        const fi = ((th - g.th0) / (g.th1 - g.th0)) * g.nx - 0.5;
        const ii = Math.round(fi);
        if (ii < 0 || ii >= g.nx) continue;
        if (dist[j * g.nx + ii] * texel >= MASK_MARGIN) mask[i * cols + c] = 1;
      }
    }
  }
  return mask;
}
