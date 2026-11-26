// Shape solve on the patch grid (SPEC 7.2-5).
// Unknown: displacement d (meters) along the template normal at every texel.
// E(d) = Σ a·w·((shade(n(d)) − L)/amp)²  +  λs Σ a·(∇²d)²  +  λp Σ a·(d/d0)²     (a = texel area / total area)
// n(d) = normalize(n0·|Ty×Tθ| + ∂θd·(Ty×n0) + ∂yd·(n0×Tθ)) — normal of the displaced surface
// (= (Ty + ∂yd·n0) × (Tθ + ∂θd·n0) with the base term replaced by n0, so that on coarse levels
// n(0) is exactly the restricted (averaged fine) normal; curvature term of n0 dropped).
// Minimized with L-BFGS; the caller runs it coarse-to-fine and re-weights robustly between runs.
import type { TexelGeom } from './grid';
import { shadeGrad, type Light } from './light';

export interface SolveTerms {
  lambdaS: number; // m², weight of the squared Laplacian (1/m)²
  lambdaP: number; // weight of (d/d0)²
  d0: number; // m
  /** per-texel multiplier of the prior (anchor near the edge of the observed region), default 1 */
  priorW?: Float64Array;
}

export interface DataTerm {
  L: Float64Array; // observed luminance per texel
  w: Float64Array; // robust data weight per texel (0 = no data)
  light: Light;
  /** per-texel length of the averaged normal (coarse levels), default 1 */
  nScale?: Float64Array;
}

/** energy and gradient; returns E and fills grad */
export function energy(geo: TexelGeom, data: DataTerm, terms: SolveTerms, d: Float64Array, grad: Float64Array): number {
  const { nx, ny } = geo.grid;
  const { S: _S, N: N0, Tt, Ty, ht, hy, area } = geo;
  void _S;
  grad.fill(0);
  let Atot = 0;
  for (let k = 0; k < area.length; k++) Atot += area[k];
  const inv = 1 / Atot;
  const amp = data.light.amp;
  let E = 0;
  for (let j = 0; j < ny; j++) {
    const jd = j > 0 ? j - 1 : j;
    const ju = j < ny - 1 ? j + 1 : j;
    const sy = ju - jd;
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const a = area[k] * inv;
      const dk = d[k];
      // ---- data ----
      const wk = data.w[k];
      if (wk > 0 && sy > 0) {
        const il = i > 0 ? i - 1 : i;
        const ir = i < nx - 1 ? i + 1 : i;
        const st = ir - il;
        if (st > 0) {
          const kl = j * nx + il, kr = j * nx + ir, kd = jd * nx + i, ku = ju * nx + i;
          const gt = (d[kr] - d[kl]) / st;
          const gy = (d[ku] - d[kd]) / sy;
          const k3 = k * 3;
          const n0x = N0[k3], n0y = N0[k3 + 1], n0z = N0[k3 + 2];
          const ar = area[k];
          // C = Ty × n0 ; D = n0 × Tt ; N = n0·area + gt·C + gy·D
          const Cx = Ty[k3 + 1] * n0z - Ty[k3 + 2] * n0y, Cy = Ty[k3 + 2] * n0x - Ty[k3] * n0z, Cz = Ty[k3] * n0y - Ty[k3 + 1] * n0x;
          const Dx = n0y * Tt[k3 + 2] - n0z * Tt[k3 + 1], Dy = n0z * Tt[k3] - n0x * Tt[k3 + 2], Dz = n0x * Tt[k3 + 1] - n0y * Tt[k3];
          const Nx = n0x * ar + gt * Cx + gy * Dx, Ny = n0y * ar + gt * Cy + gy * Dy, Nz = n0z * ar + gt * Cz + gy * Dz;
          const len = Math.hypot(Nx, Ny, Nz) || 1e-30;
          const ux = Nx / len, uy = Ny / len, uz = Nz / len;
          const [sh, gx, gyy, gz] = shadeGrad(data.light, ux, uy, uz, data.nScale ? data.nScale[k] : 1);
          const r = (sh - data.L[k]) / amp;
          E += a * wk * r * r;
          const dEdsh = (2 * a * wk * r) / amp;
          // d sh / d N = (G − (G·u)u)/|N|
          const Gu = gx * ux + gyy * uy + gz * uz;
          const px = ((gx - Gu * ux) / len) * dEdsh;
          const py = ((gyy - Gu * uy) / len) * dEdsh;
          const pz = ((gz - Gu * uz) / len) * dEdsh;
          const ct = px * Cx + py * Cy + pz * Cz;
          const cy = px * Dx + py * Dy + pz * Dz;
          grad[kr] += ct / st;
          grad[kl] -= ct / st;
          grad[ku] += cy / sy;
          grad[kd] -= cy / sy;
        }
      }
      // ---- smoothness: squared Laplacian (interior directions only) ----
      if (terms.lambdaS > 0) {
        let lap = 0;
        const it = i > 0 && i < nx - 1;
        const iy = j > 0 && j < ny - 1;
        const h2t = ht[k] * ht[k], h2y = hy[k] * hy[k];
        if (it) lap += (d[k - 1] - 2 * dk + d[k + 1]) / h2t;
        if (iy) lap += (d[k - nx] - 2 * dk + d[k + nx]) / h2y;
        if (it || iy) {
          E += a * terms.lambdaS * lap * lap;
          const c = 2 * a * terms.lambdaS * lap;
          if (it) {
            grad[k - 1] += c / h2t;
            grad[k + 1] += c / h2t;
            grad[k] -= (2 * c) / h2t;
          }
          if (iy) {
            grad[k - nx] += c / h2y;
            grad[k + nx] += c / h2y;
            grad[k] -= (2 * c) / h2y;
          }
        }
      }
      // ---- prior toward the template ----
      const q = dk / terms.d0;
      const lp = terms.lambdaP * (terms.priorW ? terms.priorW[k] : 1);
      E += a * lp * q * q;
      grad[k] += (2 * a * lp * q) / terms.d0;
    }
  }
  return E;
}

/** L-BFGS with Armijo backtracking. Minimizes in place. Returns the number of iterations done. */
export function lbfgs(
  x: Float64Array,
  f: (x: Float64Array, g: Float64Array) => number,
  maxIter: number,
  m = 7,
  shouldStop?: () => boolean,
): number {
  const n = x.length;
  const g = new Float64Array(n);
  let fx = f(x, g);
  const sList: Float64Array[] = [];
  const yList: Float64Array[] = [];
  const rho: number[] = [];
  const dir = new Float64Array(n);
  const xNew = new Float64Array(n);
  const gNew = new Float64Array(n);
  const alpha = new Float64Array(m);
  const dot = (a: Float64Array, b: Float64Array) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += a[i] * b[i];
    return s;
  };
  let it = 0;
  for (; it < maxIter; it++) {
    if (shouldStop?.()) break;
    // two-loop recursion
    for (let i = 0; i < n; i++) dir[i] = -g[i];
    const k = sList.length;
    for (let i = k - 1; i >= 0; i--) {
      alpha[i] = rho[i] * dot(sList[i], dir);
      const yi = yList[i];
      for (let q = 0; q < n; q++) dir[q] -= alpha[i] * yi[q];
    }
    let gamma: number;
    if (k > 0) gamma = dot(sList[k - 1], yList[k - 1]) / dot(yList[k - 1], yList[k - 1]);
    else {
      let gmax = 0;
      for (let i = 0; i < n; i++) gmax = Math.max(gmax, Math.abs(g[i]));
      gamma = gmax > 0 ? 1e-4 / gmax : 1; // first step: about 0.1 mm at most
    }
    for (let i = 0; i < n; i++) dir[i] *= gamma;
    for (let i = 0; i < k; i++) {
      const beta = rho[i] * dot(yList[i], dir);
      const si = sList[i];
      for (let q = 0; q < n; q++) dir[q] += si[q] * (alpha[i] - beta);
    }
    let gd = dot(g, dir);
    if (gd >= 0) {
      // not a descent direction: reset to steepest descent
      sList.length = yList.length = rho.length = 0;
      for (let i = 0; i < n; i++) dir[i] = -g[i] * gamma;
      gd = dot(g, dir);
      if (gd >= 0) break;
    }
    let step = 1;
    let fNew = Infinity;
    let ok = false;
    for (let ls = 0; ls < 20; ls++) {
      for (let i = 0; i < n; i++) xNew[i] = x[i] + step * dir[i];
      fNew = f(xNew, gNew);
      if (fNew <= fx + 1e-4 * step * gd) {
        ok = true;
        break;
      }
      step *= 0.5;
    }
    if (!ok) break;
    const s = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      s[i] = xNew[i] - x[i];
      y[i] = gNew[i] - g[i];
    }
    const sy = dot(s, y);
    if (sy > 1e-30) {
      if (sList.length === m) {
        sList.shift();
        yList.shift();
        rho.shift();
      }
      sList.push(s);
      yList.push(y);
      rho.push(1 / sy);
    }
    x.set(xNew);
    g.set(gNew);
    const rel = Math.abs(fx - fNew) / Math.max(1e-30, Math.abs(fx));
    fx = fNew;
    if (rel < 1e-10) {
      it++;
      break;
    }
  }
  return it;
}
