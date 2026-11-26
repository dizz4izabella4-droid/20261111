// Breast deformation: a smooth height field added along the torso normal.
// Displacing along the (smooth) normal of a convex surface by a smooth non-negative height
// cannot fold the surface, which is how self-intersection is avoided (tested in tests/).
//
// Footprint coordinates on the torso surface, per breast (side sigma = +1 model's left, -1 right):
//   s = lateral arc length along the cross-section, measured from the breast base center B,
//       positive toward the outside of the body;
//   t = y - centerHeight.
// The base is the ellipse (s/W2)^2 + (t/H2)^2 <= 1. Inside it, a dome with its apex at c
// (shifted outward by the outward angle and downward by ptosis) uses a star-shaped radial
// coordinate r (0 at the apex, 1 on the base ellipse) and the profile (1 - r^k)^m (m > 1 => C1 edge).

import type { BodyParams } from './params';
type BreastParams = BodyParams;
import { ArcTable, Torso } from './torso';
import { clamp, smoothstep } from './interp';

export interface BreastFrame {
  sigma: 1 | -1;
  yc: number;
  sB: number; // s_mid of the base center B
  thetaB: number;
  W2: number; // half base width
  H2: number; // half base height
  cS: number; // apex offset (meters, footprint coords)
  cT: number;
  nS: number; // nipple center (meters, footprint coords)
  nT: number;
  thetaN: number; // torso angle of the nipple preimage
  yN: number; // height of the nipple preimage
  P: number; // projection
  kUp: number; mUp: number; kLow: number; mLow: number;
  Ra: number; aProj: number;
  Rn: number; nProj: number;
  /** sigma of the dense-grid band around the nipple, meters */
  nippleBand: number;
  /** angle of the displacement direction at B from +Z, outward positive (radians) */
  gammaB: number;
  /** inframammary fold: no breast deformation below this height (= underbust height) */
  yFold: number;
}

/**
 * Center of the radial displacement field: a point on the midline far behind the chest.
 * Every point of the breast region moves away from it along its own ray, so the deformed
 * surface stays a radial graph over the directions from this point (no folds, no
 * self-intersection, even after discretization).
 */
export function radialCenter(torso: Torso, br: BreastParams): [number, number, number] {
  const sec = torso.section(br.centerHeight);
  return [0, br.centerHeight, sec.cz + sec.bf - RADIAL_DEPTH];
}
export const RADIAL_DEPTH = 0.32;

/**
 * Fullness index (0..100) → profile shape. The index spans a wider effect than the first version
 * (2026-11-26, user asked for more slider travel): f = −0.3 .. 1.3, where the old 0 and 100 are now
 * about 19 and 81.
 */
export function fullnessShape(index: number, size01: number): { k: number; m: number } {
  const f = -0.3 + 1.6 * (index / 100);
  const k0 = 2 + 3 * f; // 1.1 (pointed bell) .. 5.9 (very round)
  const m = Math.max(1.15, 2.6 - 1.0 * f); // 2.9 .. 1.3, always > 1 => smooth at the base edge
  const k = Math.max(1.2, 1.5 + (k0 - 1.5) * (0.4 + 1.2 * size01)); // size = volume at fixed projection
  return { k, m };
}

/** maximum downward shift of the apex at ptosis 100, as a fraction of the half base height (was 0.3) */
export const PTOSIS_MAX_SHIFT = 0.5;

export function makeBreastFrames(torso: Torso, br: BreastParams): BreastFrame[] {
  const out: BreastFrame[] = [];
  const yc = br.centerHeight;
  const secC = torso.section(yc);
  const tabC = new ArcTable(secC);
  const W2 = br.baseWidth / 2;
  const H2 = br.baseHeight / 2;
  const up = fullnessShape(br.upperFullness, br.size / 100);
  const low = fullnessShape(br.lowerFullness, br.size / 100);
  const alpha = (br.outwardAngle * Math.PI) / 180;
  for (const sigma of [-1, 1] as const) {
    // base center B: front surface point with |x| = spacing/2 at height yc
    const xB = Math.min(br.spacing / 2, secC.a * 0.95);
    // on side sigma, front half: theta in (pi/2, pi) for +X, (pi, 3pi/2) for -X; |x| decreases toward pi
    let lo = Math.PI / 2;
    let hi = Math.PI;
    for (let i = 0; i < 60; i++) {
      const mid = 0.5 * (lo + hi);
      const x = Math.abs(torso.pointU(mid, yc, secC)[0]);
      if (x > xB) lo = mid;
      else hi = mid;
    }
    const thetaLeft = 0.5 * (lo + hi);
    const thetaB = sigma > 0 ? thetaLeft : 2 * Math.PI - thetaLeft;
    const sB = Math.abs(tabC.sAt(thetaB));
    const O = radialCenter(torso, br);
    const pB = torso.pointU(thetaB, yc, secC);
    const gammaB = Math.atan2(sigma * (pB[0] - O[0]), pB[2] - O[2]);
    const P = br.projection;
    const cS = clamp(P * Math.tan(alpha - gammaB), -0.35 * W2, 0.35 * W2);
    const cT = -(br.ptosis / 100) * PTOSIS_MAX_SHIFT * H2;
    const nS = cS + br.nippleOffsetX;
    const nT = cT + br.nippleOffsetY;
    const yN = yc + nT;
    const tabN = new ArcTable(torso.section(yN));
    const thetaN = tabN.thetaAt(sigma * (sB + nS));
    const Rn = br.nippleDiameter / 2;
    const Ra = br.areolaDiameter / 2;
    out.push({
      sigma, yc, sB, thetaB, W2, H2, cS, cT, nS, nT, thetaN, yN, P,
      kUp: up.k, mUp: up.m, kLow: low.k, mLow: low.m,
      Ra, aProj: br.areolaProjection, Rn, nProj: br.nippleProjection,
      nippleBand: 0.0035 + 0.3 * Rn + 0.08 * Ra,
      gammaB,
      yFold: torso.keys.underbust,
    });
  }
  return out;
}

export interface BreastComponents {
  dome: number;
  areola: number;
  nipple: number;
  /** multiplier from the shoulder-cut mask */
  mask: number;
}

/** dome profile value G in [0,1] at footprint coords (s,t) in meters */
export function domeProfile(f: BreastFrame, s: number, t: number): number {
  const qx = s / f.W2;
  const qy = t / f.H2;
  const cx = f.cS / f.W2;
  const cy = f.cT / f.H2;
  if (qx * qx + qy * qy >= 1) return 0;
  const dx = qx - cx;
  const dy = qy - cy;
  const L = Math.hypot(dx, dy);
  if (L < 1e-12) return 1;
  const ux = dx / L;
  const uy = dy / L;
  const b = cx * ux + cy * uy;
  const cc = cx * cx + cy * cy - 1; // < 0 (apex inside)
  const tau = -b + Math.sqrt(b * b - cc);
  const r = Math.min(1, L / tau);
  const w = 0.5 + 0.5 * uy; // 1 = upward, 0 = downward
  const k = f.kLow + (f.kUp - f.kLow) * w;
  const m = f.mLow + (f.mUp - f.mLow) * w;
  return Math.pow(1 - Math.pow(r, k), m);
}

/**
 * Height components of one breast at a torso point.
 * sMid: signed arc length from the front midline (+X positive) at height y.
 * xU: unclamped torso x (for the shoulder-cut mask); xs: cut plane |x|.
 */
export function breastComponents(f: BreastFrame, sMid: number, y: number, xU: number, xs: number): BreastComponents {
  const s = f.sigma * sMid - f.sB;
  const t = y - f.yc;
  const mask = smoothstep(0, 0.015, xs - Math.abs(xU)) * smoothstep(f.yFold, f.yFold + 0.012, y);
  const dome = f.P * domeProfile(f, s, t);
  const rho = Math.hypot(s - f.nS, t - f.nT);
  let areola = 0;
  if (rho < f.Ra) {
    const q = 1 - (rho / f.Ra) * (rho / f.Ra);
    areola = f.aProj * q * q;
  }
  let nipple = 0;
  if (rho < f.Rn) {
    const q = rho / f.Rn;
    nipple = f.nProj * (1 - smoothstep(0.75, 1.0, q)) * (1 - 0.25 * q * q);
  }
  return { dome, areola, nipple, mask };
}

export function breastHeight(f: BreastFrame, sMid: number, y: number, xU: number, xs: number): number {
  const c = breastComponents(f, sMid, y, xU, xs);
  return c.mask * (c.dome + c.areola + c.nipple);
}
