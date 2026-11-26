// Patch grid: a uniform grid over torso coordinates (θ, y) of the template surface.
// θ = angle around the body (0 back, π/2 model's left, π front), y = height in meters.
// (The base mesh UV is strongly non-uniform around the breasts, so the patch grid uses
// these surface coordinates instead; see ASSUMPTIONS.md.)
import type { BodyModel } from '../model/mesh';
import { ArcTable } from '../model/torso';

export interface PatchGrid {
  nx: number; // texels along θ
  ny: number; // texels along y
  th0: number;
  th1: number;
  y0: number;
  y1: number;
}

export function texelTheta(g: PatchGrid, i: number): number {
  return g.th0 + ((i + 0.5) * (g.th1 - g.th0)) / g.nx;
}
export function texelY(g: PatchGrid, j: number): number {
  return g.y0 + ((j + 0.5) * (g.y1 - g.y0)) / g.ny;
}

/** same domain, about half the resolution */
export function coarser(g: PatchGrid): PatchGrid {
  return { ...g, nx: Math.max(4, Math.ceil(g.nx / 2)), ny: Math.max(4, Math.ceil(g.ny / 2)) };
}

export interface TexelGeom {
  grid: PatchGrid;
  /** template surface point (with breasts), meters */
  S: Float64Array;
  /** unit outward template normal (from the grid) */
  N: Float64Array;
  /** tangent per texel step along θ and along y (meters) */
  Tt: Float64Array;
  Ty: Float64Array;
  /** texel size (m) along θ and y, and area (m²) */
  ht: Float64Array;
  hy: Float64Array;
  area: Float64Array;
}

/** template geometry at the texel centers */
export function texelGeometry(model: BodyModel, g: PatchGrid): TexelGeom {
  const n = g.nx * g.ny;
  const S = new Float64Array(n * 3);
  for (let j = 0; j < g.ny; j++) {
    const y = texelY(g, j);
    const tab = new ArcTable(model.torso.section(y), 512);
    for (let i = 0; i < g.nx; i++) {
      const p = model.evalAt(texelTheta(g, i), y, tab).pos;
      const k = (j * g.nx + i) * 3;
      S[k] = p[0];
      S[k + 1] = p[1];
      S[k + 2] = p[2];
    }
  }
  const N = new Float64Array(n * 3);
  const Tt = new Float64Array(n * 3);
  const Ty = new Float64Array(n * 3);
  const ht = new Float64Array(n);
  const hy = new Float64Array(n);
  const area = new Float64Array(n);
  for (let j = 0; j < g.ny; j++)
    for (let i = 0; i < g.nx; i++) {
      const k = j * g.nx + i;
      const il = Math.max(0, i - 1), ir = Math.min(g.nx - 1, i + 1);
      const jd = Math.max(0, j - 1), ju = Math.min(g.ny - 1, j + 1);
      const a = (j * g.nx + il) * 3, b = (j * g.nx + ir) * 3;
      const c = (jd * g.nx + i) * 3, d = (ju * g.nx + i) * 3;
      const st = ir - il, sy = ju - jd;
      for (let q = 0; q < 3; q++) {
        Tt[k * 3 + q] = (S[b + q] - S[a + q]) / st;
        Ty[k * 3 + q] = (S[d + q] - S[c + q]) / sy;
      }
      const tx = Tt[k * 3], tyy = Tt[k * 3 + 1], tz = Tt[k * 3 + 2];
      const ux = Ty[k * 3], uy = Ty[k * 3 + 1], uz = Ty[k * 3 + 2];
      // N = Ty × Tθ (outward)
      let nx = uy * tz - uz * tyy;
      let ny = uz * tx - ux * tz;
      let nz = ux * tyy - uy * tx;
      const l = Math.hypot(nx, ny, nz) || 1;
      area[k] = l;
      nx /= l; ny /= l; nz /= l;
      N[k * 3] = nx;
      N[k * 3 + 1] = ny;
      N[k * 3 + 2] = nz;
      ht[k] = Math.hypot(tx, tyy, tz);
      hy[k] = Math.hypot(ux, uy, uz);
    }
  return { grid: g, S, N, Tt, Ty, ht, hy, area };
}

/** bilinear resampling of a texel field to another grid over the same domain */
export function resampleField(src: Float64Array | Float32Array, gs: PatchGrid, gd: PatchGrid): Float64Array {
  const out = new Float64Array(gd.nx * gd.ny);
  for (let j = 0; j < gd.ny; j++) {
    const fy = ((j + 0.5) / gd.ny) * gs.ny - 0.5;
    const j0 = Math.min(gs.ny - 1, Math.max(0, Math.floor(fy)));
    const j1 = Math.min(gs.ny - 1, j0 + 1);
    const ty = Math.min(1, Math.max(0, fy - j0));
    for (let i = 0; i < gd.nx; i++) {
      const fx = ((i + 0.5) / gd.nx) * gs.nx - 0.5;
      const i0 = Math.min(gs.nx - 1, Math.max(0, Math.floor(fx)));
      const i1 = Math.min(gs.nx - 1, i0 + 1);
      const tx = Math.min(1, Math.max(0, fx - i0));
      const a = src[j0 * gs.nx + i0] * (1 - tx) + src[j0 * gs.nx + i1] * tx;
      const b = src[j1 * gs.nx + i0] * (1 - tx) + src[j1 * gs.nx + i1] * tx;
      out[j * gd.nx + i] = a * (1 - ty) + b * ty;
    }
  }
  return out;
}
