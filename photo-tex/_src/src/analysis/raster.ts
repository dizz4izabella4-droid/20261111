// Small CPU triangle rasterizer with a depth buffer (used in the worker and by the test renderer).
import type { Projector } from './camera';

export interface DepthBuffer {
  w: number;
  h: number;
  /** camera depth (larger = closer); -Infinity = background */
  z: Float32Array;
}

export interface RasterCallbacks {
  /** called for every covered pixel that passes the depth test: triangle index and barycentrics */
  fragment?: (px: number, py: number, tri: number, b0: number, b1: number, b2: number) => void;
}

/**
 * Rasterize indexed triangles projected with `P` into a w×h buffer (pixel centers at +0.5).
 * Both windings are drawn (depth decides).
 */
export function rasterize(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  P: Projector,
  w: number,
  h: number,
  cb: RasterCallbacks = {},
): DepthBuffer {
  const nv = positions.length / 3;
  const U = new Float64Array(nv);
  const V = new Float64Array(nv);
  const D = new Float64Array(nv);
  for (let i = 0; i < nv; i++) {
    const p = P.project(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    U[i] = p[0];
    V[i] = p[1];
    D[i] = p[2];
  }
  const z = new Float32Array(w * h).fill(-Infinity);
  // when fragments are requested we need final winners: two passes (depth, then shade)
  const passes = cb.fragment ? 2 : 1;
  for (let pass = 0; pass < passes; pass++) {
    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t], b = indices[t + 1], c = indices[t + 2];
      const ax = U[a], ay = V[a], bx = U[b], by = V[b], cx = U[c], cy = V[c];
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(area) < 1e-12) continue;
      const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
      const maxX = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
      const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
      const maxY = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
      for (let py = minY; py <= maxY; py++)
        for (let px = minX; px <= maxX; px++) {
          const x = px + 0.5;
          const y = py + 0.5;
          const w0 = ((bx - x) * (cy - y) - (by - y) * (cx - x)) / area;
          const w1 = ((cx - x) * (ay - y) - (cy - y) * (ax - x)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) continue;
          const depth = w0 * D[a] + w1 * D[b] + w2 * D[c];
          const k = py * w + px;
          if (pass === 0) {
            if (depth > z[k]) z[k] = depth;
          } else if (depth >= z[k] - 1e-7) {
            cb.fragment!(px, py, t / 3, w0, w1, w2);
          }
        }
    }
  }
  return { w, h, z };
}
