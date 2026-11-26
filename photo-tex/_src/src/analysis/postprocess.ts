// Post-processing on the patch grid: jaggedness smoothing with the local metric (SPEC 7.2-6),
// confidence blending (7.2-7) and morphological cleanup of the patch region (7.2-8).
import type { TexelGeom } from './grid';

/**
 * Gaussian smoothing with sigma = smoothMm/2 (millimeters on the surface), separable along θ and y,
 * with a per-texel kernel width from the local texel size. Normalized convolution inside `mask`.
 */
export function smoothDisplacement(d: ArrayLike<number>, mask: Uint8Array, geo: TexelGeom, smoothMm: number): Float32Array {
  const { nx, ny } = geo.grid;
  const out = Float32Array.from(d as ArrayLike<number>);
  if (smoothMm <= 0) return out;
  const sigma = smoothMm / 2 / 1000;
  const tmp = new Float32Array(out.length);
  // along θ
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (!mask[k]) {
        tmp[k] = out[k];
        continue;
      }
      const st = Math.max(0.3, sigma / geo.ht[k]);
      const R = Math.min(80, Math.ceil(3 * st));
      let sw = 0, sv = 0;
      for (let m = -R; m <= R; m++) {
        const ii = i + m;
        if (ii < 0 || ii >= nx) continue;
        const kk = j * nx + ii;
        if (!mask[kk]) continue;
        const w = Math.exp((-m * m) / (2 * st * st));
        sw += w;
        sv += w * out[kk];
      }
      tmp[k] = sw > 0 ? sv / sw : out[k];
    }
  // along y
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (!mask[k]) {
        out[k] = tmp[k];
        continue;
      }
      const sy = Math.max(0.3, sigma / geo.hy[k]);
      const R = Math.min(80, Math.ceil(3 * sy));
      let sw = 0, sv = 0;
      for (let m = -R; m <= R; m++) {
        const jj = j + m;
        if (jj < 0 || jj >= ny) continue;
        const kk = jj * nx + i;
        if (!mask[kk]) continue;
        const w = Math.exp((-m * m) / (2 * sy * sy));
        sw += w;
        sv += w * tmp[kk];
      }
      out[k] = sw > 0 ? sv / sw : tmp[k];
    }
  return out;
}

/** layers (2)/(3) of SPEC 10.1 from the raw solver output: smooth, then blend low-confidence texels toward 0 */
export function finalizeDisplacement(dRaw: ArrayLike<number>, conf: ArrayLike<number>, region: Uint8Array, geo: TexelGeom, smoothMm: number): Float32Array {
  const s = smoothDisplacement(dRaw, region, geo, smoothMm);
  for (let k = 0; k < s.length; k++) {
    if (!region[k]) {
      s[k] = 0;
      continue;
    }
    const c = conf[k];
    if (c < 0.1) s[k] *= Math.max(0, c) / 0.1;
  }
  return s;
}

/** connected components (4-neighborhood) of value `v` in `m` */
function components(m: Uint8Array, nx: number, ny: number, v: number): Int32Array[] {
  const seen = new Uint8Array(m.length);
  const out: Int32Array[] = [];
  const stack: number[] = [];
  for (let s = 0; s < m.length; s++) {
    if (seen[s] || m[s] !== v) continue;
    const comp: number[] = [];
    stack.push(s);
    seen[s] = 1;
    while (stack.length) {
      const k = stack.pop()!;
      comp.push(k);
      const i = k % nx, j = (k / nx) | 0;
      const nb = [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, j > 0 ? k - nx : -1, j < ny - 1 ? k + nx : -1];
      for (const q of nb) if (q >= 0 && !seen[q] && m[q] === v) {
        seen[q] = 1;
        stack.push(q);
      }
    }
    out.push(Int32Array.from(comp));
  }
  return out;
}

/** remove islands smaller than 2% of the region, fill holes smaller than 1% (holes = components not touching the border) */
export function cleanRegion(region: Uint8Array, nx: number, ny: number): Uint8Array {
  const m = Uint8Array.from(region);
  let total = 0;
  for (const v of m) total += v;
  if (!total) return m;
  for (const c of components(m, nx, ny, 1)) if (c.length < 0.02 * total) for (const k of c) m[k] = 0;
  total = 0;
  for (const v of m) total += v;
  for (const c of components(m, nx, ny, 0)) {
    const touches = c.some((k) => {
      const i = k % nx, j = (k / nx) | 0;
      return i === 0 || j === 0 || i === nx - 1 || j === ny - 1;
    });
    if (!touches && c.length < 0.01 * total) for (const k of c) m[k] = 1;
  }
  return m;
}

export function boxBlur3(a: Float32Array, nx: number, ny: number): Float32Array {
  const out = new Float32Array(a.length);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      let s = 0, n = 0;
      for (let q = -1; q <= 1; q++)
        for (let p = -1; p <= 1; p++) {
          const ii = i + p, jj = j + q;
          if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
          s += a[jj * nx + ii];
          n++;
        }
      out[j * nx + i] = s / n;
    }
  return out;
}
