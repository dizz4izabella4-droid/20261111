// Light models and robust (Huber IRLS) light estimation from template normals (SPEC 7.2-4).
//   directional+ambient:  L = b·n + c            (b = albedo·intensity·direction)
//   spherical harmonics (order 2): L = Σ c_k Y_k(n), 9 coefficients
// Albedo is assumed uniform and absorbed in the coefficients.

export type LightModelName = 'directional' | 'sh2';

export interface Light {
  model: LightModelName;
  coef: number[];
  /** magnitude of the first-order (linear) part: shading change per unit normal change */
  amp: number;
}

export function basis(model: LightModelName, x: number, y: number, z: number): number[] {
  if (model === 'directional') return [x, y, z, 1];
  return [1, x, y, z, x * y, x * z, y * z, x * x - y * y, 3 * z * z - 1];
}

/**
 * shading and its gradient with respect to the (unit) normal components.
 * `scale` (<= 1) multiplies the normal-dependent part: on coarse levels a texel stands for the
 * average of several fine normals, whose mean vector is shorter than 1.
 */
export function shadeGrad(l: Light, x: number, y: number, z: number, scale = 1): [number, number, number, number] {
  const c = l.coef;
  if (l.model === 'directional') {
    const dot = c[0] * x + c[1] * y + c[2] * z;
    // Lambert: no negative light (gradient 0 in attached shadow)
    return dot > 0 ? [c[3] + scale * dot, scale * c[0], scale * c[1], scale * c[2]] : [c[3], 0, 0, 0];
  }
  const v = c[1] * x + c[2] * y + c[3] * z + c[4] * x * y + c[5] * x * z + c[6] * y * z + c[7] * (x * x - y * y) + c[8] * (3 * z * z - 1);
  const gx = c[1] + c[4] * y + c[5] * z + 2 * c[7] * x;
  const gy = c[2] + c[4] * x + c[6] * z - 2 * c[7] * y;
  const gz = c[3] + c[5] * x + c[6] * y + 6 * c[8] * z;
  return [c[0] + scale * v, scale * gx, scale * gy, scale * gz];
}

function solveSym(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / (r[i] || 1e-12));
}

export interface LightFit {
  light: Light;
  /** final robust weights per sample (0 = rejected) */
  weights: Float64Array;
  residualScale: number;
}

/**
 * Robust fit. normals: 3 per sample, L: luminance per sample, use: 0/1 mask.
 * Samples in attached shadow (predicted directional shading <= 0) are dropped.
 */
export function fitLight(model: LightModelName, normals: Float64Array, L: Float64Array, use: Uint8Array): LightFit {
  const n = L.length;
  const nb = model === 'directional' ? 4 : 9;
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = use[i] ? 1 : 0;
  let coef = new Array(nb).fill(0);
  let scale = 1;
  for (let it = 0; it < 12; it++) {
    const A = Array.from({ length: nb }, () => new Array(nb).fill(0));
    const b = new Array(nb).fill(0);
    for (let i = 0; i < n; i++) {
      if (!w[i]) continue;
      const B = basis(model, normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]);
      for (let p = 0; p < nb; p++) {
        b[p] += w[i] * B[p] * L[i];
        for (let q = 0; q < nb; q++) A[p][q] += w[i] * B[p] * B[q];
      }
    }
    for (let p = 0; p < nb; p++) A[p][p] += 1e-9;
    coef = solveSym(A, b);
    // residuals and robust scale (MAD)
    const res: number[] = [];
    const r = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      if (!use[i]) continue;
      const B = basis(model, normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]);
      let pred = 0;
      for (let p = 0; p < nb; p++) pred += coef[p] * B[p];
      r[i] = L[i] - pred;
      res.push(Math.abs(r[i]));
    }
    res.sort((a, c) => a - c);
    scale = Math.max(1e-4, 1.4826 * (res[res.length >> 1] ?? 0));
    const delta = 1.345 * scale;
    // attached shadow test uses the linear (first-order) part
    const lin = model === 'directional' ? [coef[0], coef[1], coef[2]] : [coef[1], coef[2], coef[3]];
    const amp = Math.hypot(lin[0], lin[1], lin[2]) || 1;
    for (let i = 0; i < n; i++) {
      if (!use[i]) continue;
      const nd = (lin[0] * normals[i * 3] + lin[1] * normals[i * 3 + 1] + lin[2] * normals[i * 3 + 2]) / amp;
      if (model === 'directional' && nd < 0.03) {
        w[i] = 0;
        continue;
      }
      const a = Math.abs(r[i]);
      w[i] = a <= delta ? 1 : delta / a;
    }
  }
  const lin = model === 'directional' ? [coef[0], coef[1], coef[2]] : [coef[1], coef[2], coef[3]];
  return { light: { model, coef, amp: Math.hypot(lin[0], lin[1], lin[2]) || 1e-6 }, weights: w, residualScale: scale };
}
