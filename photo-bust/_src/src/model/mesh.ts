// Base template mesh: cylindrical grid (segments around × rings along Y) + flat caps.
// UV is a fixed uniform grid per preset: u_j = j/segments (u=0.5 = front midline), v_i = i/(rings-1).
// The physical position of each grid line comes from monotone density mappings that concentrate
// vertices in the breast region and, more strongly, around the nipples.

import type { ModelParams, PresetName } from './params';
import { PRESETS } from './params';
import { ArcTable, Torso } from './torso';
import { BreastFrame, breastComponents, makeBreastFrames, radialCenter } from './breast';
import { smoothstep } from './interp';

export interface BandSpec {
  mu: number;
  sigma: number;
  weight: number;
}

/**
 * Positions of count+1 grid lines on [x0, x1] whose density is
 * (1 - Σw)/(x1-x0) + Σ w·N(mu, sigma).
 * `anchors`: values that must fall exactly on a grid line (e.g. key heights). Each anchor is
 * assigned the nearest free grid index and the lines between anchors are re-spread with the
 * same density, so the mapping stays monotone.
 */
export function densityMapping(x0: number, x1: number, bands: BandSpec[], count: number, anchors: number[] = [], fine = 8192): Float64Array {
  const wsum = bands.reduce((a, b) => a + b.weight, 0);
  const base = (1 - wsum) / (x1 - x0);
  const xsF = new Float64Array(fine + 1);
  const F = new Float64Array(fine + 1);
  const rho = (x: number) => {
    let r = base;
    for (const b of bands) {
      const z = (x - b.mu) / b.sigma;
      r += (b.weight / (b.sigma * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * z * z);
    }
    return r;
  };
  let prev = rho(x0);
  xsF[0] = x0;
  for (let i = 1; i <= fine; i++) {
    const x = x0 + ((x1 - x0) * i) / fine;
    const r = rho(x);
    xsF[i] = x;
    F[i] = F[i - 1] + 0.5 * (prev + r) * ((x1 - x0) / fine);
    prev = r;
  }
  const total = F[fine];
  const cdf = (x: number): number => {
    const f = ((x - x0) / (x1 - x0)) * fine;
    const i = Math.min(fine - 1, Math.max(0, Math.floor(f)));
    return F[i] + (F[i + 1] - F[i]) * (f - i);
  };
  const inv = (target: number): number => {
    let lo = 0;
    let hi = fine;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (F[mid] <= target) lo = mid;
      else hi = mid;
    }
    const t = (target - F[lo]) / (F[hi] - F[lo] || 1);
    return xsF[lo] + (xsF[hi] - xsF[lo]) * Math.min(1, Math.max(0, t));
  };
  // anchor list: (index, value, cdf) including both ends
  const pts: { i: number; x: number; f: number }[] = [{ i: 0, x: x0, f: 0 }, { i: count, x: x1, f: total }];
  for (const a of [...anchors].filter((a) => a > x0 && a < x1).sort((p, q) => p - q)) {
    const fa = cdf(a);
    let idx = Math.round((fa / total) * count);
    const used = new Set(pts.map((p) => p.i));
    // nearest free index that keeps the anchors ordered
    const lower = Math.max(...pts.filter((p) => p.x < a).map((p) => p.i));
    const upper = Math.min(...pts.filter((p) => p.x > a).map((p) => p.i));
    idx = Math.min(upper - 1, Math.max(lower + 1, idx));
    if (idx <= lower || idx >= upper || used.has(idx)) continue; // no room: skip this anchor
    pts.push({ i: idx, x: a, f: fa });
    pts.sort((p, q) => p.i - q.i);
  }
  const out = new Float64Array(count + 1);
  for (let k = 0; k < pts.length - 1; k++) {
    const A = pts[k];
    const B = pts[k + 1];
    for (let j = A.i; j <= B.i; j++) {
      out[j] = j === A.i ? A.x : j === B.i ? B.x : inv(A.f + ((B.f - A.f) * (j - A.i)) / (B.i - A.i));
    }
  }
  return out;
}

/** Torso + breasts evaluator, independent of the mesh resolution (used by tests and the mesh). */
export class BodyModel {
  readonly torso: Torso;
  readonly frames: BreastFrame[];
  readonly center: [number, number, number];

  constructor(readonly params: ModelParams) {
    this.torso = new Torso(params.body, params.breast);
    this.frames = makeBreastFrames(this.torso, params.breast);
    this.center = radialCenter(this.torso, params.breast);
  }

  /** evaluate the deformed surface at (θ, y); `tab` may be supplied for speed */
  evalAt(theta: number, y: number, tab?: ArcTable) {
    const torso = this.torso;
    const sec = torso.section(y);
    const pu = torso.pointU(theta, y, sec);
    const n = torso.normalU(theta, y);
    const t = tab ?? new ArcTable(sec);
    const sMid = t.sAt(theta);
    // radial displacement direction from the center behind the chest
    const O = this.center;
    let dx = pu[0] - O[0], dy = pu[1] - O[1], dz = pu[2] - O[2];
    const dl = Math.hypot(dx, dy, dz);
    dx /= dl; dy /= dl; dz /= dl;
    // keep the breast region a radial graph: fade out where the surface turns away from the center
    const facing = smoothstep(0.05, 0.25, dx * n[0] + dy * n[1] + dz * n[2]);
    let h = 0;
    const comps = this.frames.map((f) => breastComponents(f, sMid, y, pu[0], torso.xs));
    for (const c of comps) {
      c.mask *= facing;
      h += c.mask * (c.dome + c.areola + c.nipple);
    }
    const x = torso.clampX(pu[0]);
    const pos: [number, number, number] = [x + h * dx, y + h * dy, pu[2] + h * dz];
    return { pos, h, comps, normal: n, dir: [dx, dy, dz] as [number, number, number], sMid, xU: pu[0] };
  }
}

export interface BaseMesh {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  segments: number;
  rings: number;
  /** grid vertices are (segments+1) * rings, row-major by ring; caps follow */
  gridVertexCount: number;
  /** breast height per grid vertex (meters) */
  height: Float32Array;
  thetas: Float64Array;
  heights: Float64Array;
  landmarks: Record<string, [number, number, number]>;
  warnings: string[];
}

export const GRID_FRACTIONS = {
  theta: { breast: 0.38, nipple: 0.32 },
  y: { breast: 0.4, nipple: 0.2 },
};

export function buildBaseMesh(params: ModelParams, preset: PresetName): BaseMesh {
  const { segments: M, rings: N } = PRESETS[preset];
  const model = new BodyModel(params);
  const torso = model.torso;
  const left = model.frames.find((f) => f.sigma > 0)!;

  // --- θ grid: density on [0, π] (left half, back -> front), mirrored for the right half ---
  const tabB = new ArcTable(torso.section(left.yc));
  const tabN = new ArcTable(torso.section(left.yN));
  const sigThB = left.W2 / 2 / tabB.dsdTheta(left.thetaB);
  const sigThN = left.nippleBand / tabN.dsdTheta(left.thetaN);
  const half = densityMapping(
    0,
    Math.PI,
    [
      { mu: left.thetaB, sigma: sigThB, weight: GRID_FRACTIONS.theta.breast },
      { mu: left.thetaN, sigma: sigThN, weight: GRID_FRACTIONS.theta.nipple },
    ],
    M / 2,
  );
  const thetas = new Float64Array(M + 1);
  for (let j = 0; j <= M / 2; j++) thetas[j] = half[j];
  for (let j = M / 2 + 1; j <= M; j++) thetas[j] = 2 * Math.PI - half[M - j];

  // --- y grid ---
  const heights = densityMapping(
    0,
    torso.Ytop,
    [
      { mu: left.yc, sigma: left.H2 / 2, weight: GRID_FRACTIONS.y.breast },
      { mu: left.yN, sigma: left.nippleBand, weight: GRID_FRACTIONS.y.nipple },
    ],
    N - 1,
    [torso.keys.waist, torso.keys.underbust],
  );

  const cols = M + 1;
  const gridCount = cols * N;
  const capCount = 2 * (M + 1); // ring copies (M each) + centers
  const total = gridCount + capCount;
  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const hgt = new Float32Array(gridCount);

  // positions in float64 first (for stable normals)
  const P = new Float64Array(gridCount * 3);
  for (let i = 0; i < N; i++) {
    const y = heights[i];
    const tab = new ArcTable(torso.section(y));
    for (let j = 0; j < M; j++) {
      const r = model.evalAt(thetas[j], y, tab);
      const k = i * cols + j;
      P[k * 3] = r.pos[0];
      P[k * 3 + 1] = r.pos[1];
      P[k * 3 + 2] = r.pos[2];
      hgt[k] = r.h;
    }
    // seam column duplicates column 0 exactly
    const k0 = i * cols;
    const kM = i * cols + M;
    P[kM * 3] = P[k0 * 3];
    P[kM * 3 + 1] = P[k0 * 3 + 1];
    P[kM * 3 + 2] = P[k0 * 3 + 2];
    hgt[kM] = hgt[k0];
  }
  for (let k = 0; k < gridCount * 3; k++) pos[k] = P[k];
  for (let i = 0; i < N; i++)
    for (let j = 0; j <= M; j++) {
      const k = i * cols + j;
      uv[k * 2] = j / M;
      uv[k * 2 + 1] = i / (N - 1);
    }

  // --- indices ---
  const tris: number[] = [];
  for (let i = 0; i < N - 1; i++)
    for (let j = 0; j < M; j++) {
      const a = i * cols + j;
      const b = (i + 1) * cols + j;
      const c = i * cols + j + 1;
      const d = (i + 1) * cols + j + 1;
      // split each quad along its shorter 3D diagonal (less faceting on the small nipple)
      const dad = Math.hypot(P[a * 3] - P[d * 3], P[a * 3 + 1] - P[d * 3 + 1], P[a * 3 + 2] - P[d * 3 + 2]);
      const dbc = Math.hypot(P[b * 3] - P[c * 3], P[b * 3 + 1] - P[c * 3 + 1], P[b * 3 + 2] - P[c * 3 + 2]);
      if (dad < dbc) tris.push(a, b, d, a, d, c);
      else tris.push(a, b, c, c, b, d);
    }

  // --- smooth normals on the wrapped grid (seam column = column 0) ---
  const acc = new Float64Array(gridCount * 3);
  const wrap = (k: number) => {
    const j = k % cols;
    return j === M ? k - M : k;
  };
  for (let t = 0; t < tris.length; t += 3) {
    const ia = tris[t], ib = tris[t + 1], ic = tris[t + 2];
    const ax = P[ia * 3], ay = P[ia * 3 + 1], az = P[ia * 3 + 2];
    const e1x = P[ib * 3] - ax, e1y = P[ib * 3 + 1] - ay, e1z = P[ib * 3 + 2] - az;
    const e2x = P[ic * 3] - ax, e2y = P[ic * 3 + 1] - ay, e2z = P[ic * 3 + 2] - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    for (const v of [ia, ib, ic]) {
      const w = wrap(v);
      acc[w * 3] += nx;
      acc[w * 3 + 1] += ny;
      acc[w * 3 + 2] += nz;
    }
  }
  for (let k = 0; k < gridCount; k++) {
    const w = wrap(k);
    const x = acc[w * 3], y = acc[w * 3 + 1], z = acc[w * 3 + 2];
    const l = Math.hypot(x, y, z) || 1;
    nrm[k * 3] = x / l;
    nrm[k * 3 + 1] = y / l;
    nrm[k * 3 + 2] = z / l;
  }

  // --- caps (flat, separate vertices) ---
  const addCap = (ring: number, start: number, ny: number) => {
    const y = heights[ring];
    for (let j = 0; j < M; j++) {
      const src = ring * cols + j;
      const dst = start + j;
      pos[dst * 3] = P[src * 3];
      pos[dst * 3 + 1] = P[src * 3 + 1];
      pos[dst * 3 + 2] = P[src * 3 + 2];
      nrm[dst * 3 + 1] = ny;
      uv[dst * 2] = j / M;
      uv[dst * 2 + 1] = ring === 0 ? 0 : 1;
    }
    const c = start + M;
    const sec = torso.section(y);
    pos[c * 3] = 0;
    pos[c * 3 + 1] = y;
    pos[c * 3 + 2] = sec.cz + (sec.bf - sec.bb) / 2;
    nrm[c * 3 + 1] = ny;
    uv[c * 2] = 0.5;
    uv[c * 2 + 1] = ring === 0 ? 0 : 1;
    for (let j = 0; j < M; j++) {
      const p0 = start + j;
      const p1 = start + ((j + 1) % M);
      if (ny < 0) tris.push(c, p0, p1);
      else tris.push(c, p1, p0);
    }
  };
  addCap(0, gridCount, -1);
  addCap(N - 1, gridCount + M + 1, 1);

  // --- landmarks ---
  const k = torso.keys;
  const secCenter = (y: number): number => {
    const s = torso.section(y);
    return s.cz + (s.bf - s.bb) / 2;
  };
  const yShoulder = k.shoulderJoint;
  const secNavel = torso.section(k.navel);
  const secWaist = torso.section(k.waist);
  const landmarks: Record<string, [number, number, number]> = {
    LM_shoulderJoint_L: [torso.xs, yShoulder, secCenter(yShoulder)],
    LM_shoulderJoint_R: [-torso.xs, yShoulder, secCenter(yShoulder)],
    LM_neckBase: [0, k.neckBase, secCenter(k.neckBase)],
    LM_navel: [0, k.navel, secNavel.cz + secNavel.bf],
    LM_waist_L: [secWaist.a, k.waist, secWaist.cz],
    LM_waist_R: [-secWaist.a, k.waist, secWaist.cz],
  };
  for (const f of model.frames) {
    const r = model.evalAt(f.thetaN, f.yN);
    landmarks[f.sigma > 0 ? 'LM_nipple_L' : 'LM_nipple_R'] = r.pos;
  }

  return {
    positions: pos,
    normals: nrm,
    uvs: uv,
    indices: new Uint32Array(tris),
    segments: M,
    rings: N,
    gridVertexCount: gridCount,
    height: hgt,
    thetas,
    heights,
    landmarks,
    warnings: torso.warnings.slice(),
  };
}
