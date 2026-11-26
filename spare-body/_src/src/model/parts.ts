// Simple closed parts: limb tubes with rounded ends, and boxes (placeholder head / hands / feet).
import { Pchip } from './interp';

export type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export interface PartMesh {
  positions: number[];
  normals: number[];
  indices: number[];
}

export interface TubeProfile {
  /** position along the tube, 0 = start joint, 1 = end joint */
  t: number;
  /** circumference at that position (meters) */
  circ: number;
}

/**
 * Tube from `a` to `b` with an elliptic cross-section (aspect = width along `side` / width across),
 * radius from the circumference profile, and rounded (half-ellipsoid) caps past both joints.
 * Closed and watertight; outward normals.
 */
export function tube(a: V3, b: V3, side: V3, profile: TubeProfile[], aspect: number, segments: number, bodyRings = 16, capRings = 6): PartMesh {
  const axis = norm(sub(b, a));
  const len = Math.hypot(...sub(b, a));
  // orthonormal frame: u (side, made perpendicular to the axis), v = axis × u
  let u = sub(side, mul(axis, dot(side, axis)));
  u = norm(u);
  const v = cross(axis, u);
  const ip = new Pchip(profile.map((p) => p.t), profile.map((p) => p.circ / (2 * Math.PI)));
  const ru = (r: number) => r * Math.sqrt(aspect);
  const rv = (r: number) => r / Math.sqrt(aspect);
  // rings: start cap (pole excluded), body, end cap (pole excluded)
  type Ring = { c: V3; r: number; k: number; dn: number }; // center, radius, cross-section scale, axial normal component
  const rings: Ring[] = [];
  const r0 = ip.eval(0);
  const r1 = ip.eval(1);
  for (let i = capRings - 1; i >= 1; i--) {
    const phi = (i / capRings) * (Math.PI / 2);
    rings.push({ c: add(a, mul(axis, -r0 * Math.sin(phi))), r: r0, k: Math.cos(phi), dn: -Math.sin(phi) });
  }
  for (let i = 0; i <= bodyRings; i++) {
    const t = i / bodyRings;
    rings.push({ c: add(a, mul(axis, t * len)), r: ip.eval(t), k: 1, dn: 0 });
  }
  for (let i = 1; i < capRings; i++) {
    const phi = (i / capRings) * (Math.PI / 2);
    rings.push({ c: add(b, mul(axis, r1 * Math.sin(phi))), r: r1, k: Math.cos(phi), dn: Math.sin(phi) });
  }
  const P: number[] = [];
  const N: number[] = [];
  for (const g of rings) {
    for (let j = 0; j < segments; j++) {
      const w = (j / segments) * Math.PI * 2;
      const cu = Math.cos(w), sv = Math.sin(w);
      const p = add(g.c, add(mul(u, ru(g.r) * g.k * cu), mul(v, rv(g.r) * g.k * sv)));
      P.push(...p);
      // ellipse normal in the cross-section plane, tilted by the cap
      const nIn = norm(add(mul(u, cu / ru(1)), mul(v, sv / rv(1))));
      N.push(...norm(add(mul(nIn, Math.sqrt(Math.max(0, 1 - g.dn * g.dn))), mul(axis, g.dn))));
    }
  }
  const poleA = P.length / 3;
  P.push(...add(a, mul(axis, -r0)));
  N.push(...mul(axis, -1));
  const poleB = P.length / 3;
  P.push(...add(b, mul(axis, r1)));
  N.push(...axis);
  const I: number[] = [];
  const R = rings.length;
  for (let i = 0; i < R - 1; i++)
    for (let j = 0; j < segments; j++) {
      const p00 = i * segments + j, p01 = i * segments + ((j + 1) % segments);
      const p10 = (i + 1) * segments + j, p11 = (i + 1) * segments + ((j + 1) % segments);
      // ring index grows along the axis; j grows from u toward v (= axis × u): outward winding
      I.push(p00, p01, p10, p01, p11, p10);
    }
  for (let j = 0; j < segments; j++) {
    I.push(poleA, (j + 1) % segments, j);
    const base = (R - 1) * segments;
    I.push(poleB, base + j, base + ((j + 1) % segments));
  }
  return { positions: P, normals: N, indices: I };
}

/** box with center `c`, half sizes along the orthonormal axes ex, ey, ez (flat faces, 24 vertices) */
export function box(c: V3, ex: V3, ey: V3, ez: V3, hx: number, hy: number, hz: number): PartMesh {
  const P: number[] = [];
  const N: number[] = [];
  const I: number[] = [];
  const faces: [V3, V3, V3, number, number, number][] = [
    // normal axis, two in-plane axes, and the half sizes (n, s, t)
    [ex, ey, ez, hx, hy, hz],
    [mul(ex, -1), ez, ey, hx, hz, hy],
    [ey, ez, ex, hy, hz, hx],
    [mul(ey, -1), ex, ez, hy, hx, hz],
    [ez, ex, ey, hz, hx, hy],
    [mul(ez, -1), ey, ex, hz, hy, hx],
  ];
  for (const [n, s, t, hn, hs, ht] of faces) {
    // make (s, t, n) right-handed so the winding is outward
    const tt = dot(cross(s, t), n) > 0 ? t : mul(t, -1);
    const base = P.length / 3;
    for (const [ks, kt] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      P.push(...add(c, add(mul(n, hn), add(mul(s, ks * hs), mul(tt, kt * ht)))));
      N.push(...n);
    }
    I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions: P, normals: N, indices: I };
}
