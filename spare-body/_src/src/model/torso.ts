// Base torso (without breasts): smooth superellipse cross-sections interpolated (C1) along Y.
// Coordinates: meters, +Y up, +Z front, +X = model's left. Origin = center of bottom cut.
// Angle θ around the body: θ=0 back midline, θ=π/2 model's left side (+X), θ=π front midline.

import type { BodyParams } from './params';
import { Pchip, clamp } from './interp';

export interface Section {
  a: number; // half width (X)
  bf: number; // front depth from center (Z+)
  bb: number; // back depth from center (Z-)
  cz: number; // Z of the section center
  p: number; // superellipse exponent (2 = ellipse)
  /** extra half width at the sides only (toward the shoulder joints), weighted by |sin θ|^LATERAL_POWER */
  ext?: number;
}

/** how narrowly the side-only widening is concentrated around the sides (θ = ±π/2) */
export const LATERAL_POWER = 6;

/** neck stub above the neck base, up to the neck cut */
export const NECK_STUB = 0.03;

function spow(t: number, e: number): number {
  return t >= 0 ? Math.pow(t, e) : -Math.pow(-t, e);
}

/** unclamped section point at angle θ */
export function sectionXZ(s: Section, theta: number): [number, number] {
  const e = 2 / s.p;
  const sn = Math.sin(theta);
  let x = s.a * spow(sn, e);
  // widen only the sides (shoulder region): the front and back of the chest keep their shape,
  // so the shoulder flare does not leave a fold across the chest (user feedback 2026-11-26)
  if (s.ext) x += Math.sign(sn) * s.ext * Math.pow(Math.abs(sn), LATERAL_POWER);
  const zz = spow(-Math.cos(theta), e);
  const z = s.cz + (zz >= 0 ? s.bf : s.bb) * zz;
  return [x, z];
}

export function sectionPerimeter(s: Section, n = 4096): number {
  let len = 0;
  let [px, pz] = sectionXZ(s, 0);
  for (let i = 1; i <= n; i++) {
    const [x, z] = sectionXZ(s, (i / n) * 2 * Math.PI);
    len += Math.hypot(x - px, z - pz);
    px = x;
    pz = z;
  }
  return len;
}

/** half width that gives the requested perimeter, depths fixed */
export function solveHalfWidth(target: number, s: Omit<Section, 'a'>): number {
  let lo = 0.005;
  let hi = 0.6;
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (sectionPerimeter({ ...s, a: mid }, 2048) < target) lo = mid;
    else hi = mid;
  }
  const a = 0.5 * (lo + hi);
  return a;
}

export interface KeyHeights {
  crotch: number;
  hip: number;
  navel: number;
  waist: number;
  underbust: number;
  bust: number;
  armpit: number;
  shoulderJoint: number;
  shoulderTop: number;
  neckBase: number;
  neckCut: number;
}

export interface TorsoWarnings {
  messages: string[];
}

export class Torso {
  readonly H: number;
  readonly Ytop: number;
  /** X of the planar shoulder cut faces (shoulder joint centers) */
  readonly xs: number;
  readonly keys: KeyHeights;
  readonly keySections: Section[];
  readonly warnings: string[] = [];
  private ia: Pchip;
  private ibf: Pchip;
  private ibb: Pchip;
  private icz: Pchip;
  private ip: Pchip;
  private iext: Pchip;

  /** torso from the crotch (y = 0) to the neck base (y = torsoHeight) plus a short neck stub */
  constructor(body: BodyParams) {
    const H = body.torsoHeight;
    this.H = H;
    this.Ytop = H + NECK_STUB;
    this.xs = body.shoulderWidth / 2;

    // --- key heights, forced into a strictly increasing order ---
    const shoulderTop = H - 0.03;
    const shoulderJoint = H - 0.065;
    const armpit = H - 0.11;
    const hip = clamp(body.hipHeight, 0.02, body.navelHeight - 0.01);
    if (hip !== body.hipHeight) this.warnings.push('ヒップの高さがへそに近すぎるため、へそ−1cmとして扱っています。');
    const navel = body.navelHeight;
    let waist = body.waistHeight;
    if (waist < navel + 0.01) {
      waist = navel + 0.01;
      this.warnings.push('ウエストの高さがへそに近すぎるため、へそ＋1cmとして扱っています。');
    }
    let underbust = body.underbustHeight;
    if (underbust < waist + 0.02) {
      underbust = waist + 0.02;
      this.warnings.push('アンダーバストの高さがウエストに近すぎるため、ウエスト＋2cmとして扱っています。');
    }
    if (underbust > armpit - 0.03) {
      underbust = armpit - 0.03;
      this.warnings.push('アンダーバストの高さが脇に近すぎるため、脇−3cmとして扱っています（胴の高さが小さすぎる可能性）。');
    }
    // ribcage ("bust") section halfway between the underbust and the armpit. It used to follow the
    // breast height, which could put it 1.5 cm below the armpit section and leave a fold across the
    // chest (seen once the body moved, 2026-11-26).
    const bust = 0.5 * (underbust + armpit);
    this.keys = {
      crotch: 0, hip, navel, waist, underbust, bust, armpit, shoulderJoint, shoulderTop, neckBase: H, neckCut: H + NECK_STUB,
    };

    // --- sections at key heights ---
    // back-side depth factors (user requests 2026-11-26): the waist back is pulled in and the
    // upper back (shoulder blades) kept full, which gives the back its arch.
    const BACK_WAIST = 0.82;
    const BACK_UB = 0.88;
    const BACK_CHEST = 1.0;
    const dW = 0.27 * body.waistCirc; // waist depth before thinning the back
    const waistSec: Omit<Section, 'a'> = { bf: dW * 0.5, bb: dW * 0.5 * BACK_WAIST, cz: 0, p: 2.3 };
    const aW = solveHalfWidth(body.waistCirc, waistSec);
    const dU = 0.92 * body.chestDepth;
    const ubSec: Omit<Section, 'a'> = { bf: dU * 0.5, bb: dU * 0.5 * BACK_UB, cz: 0, p: 2.4 };
    const aU = solveHalfWidth(body.underbustCirc, ubSec);
    const cd = body.chestDepth;
    const nbw = body.neckBaseWidth;
    const dH = 0.25 * body.hipCirc; // hip depth (front 45%, back 55%: buttocks)
    const hipSec: Omit<Section, 'a'> = { bf: dH * 0.45, bb: dH * 0.55, cz: 0, p: 2.4 };
    const aH = solveHalfWidth(body.hipCirc, hipSec);
    const xs = this.xs;
    /** section whose body half-width is `body` and whose sides reach `total` */
    const side = (body: number, total: number, rest: Omit<Section, 'a' | 'ext'>): Section => {
      const a = Math.min(body, total);
      return { a, ext: Math.max(0, total - a), ...rest };
    };
    const secs: Section[] = [
      // pelvis: crotch (where the legs attach) and the widest part of the hips
      // the torso closes in between the thighs (rounded bottom) instead of ending in a wide flat cut
      { a: aH * 0.5, bf: dH * 0.45 * 0.5, bb: dH * 0.55 * 0.55, cz: 0, p: 2.2 }, // crotch
      { a: aH * 0.86, bf: dH * 0.45 * 0.85, bb: dH * 0.55 * 0.92, cz: 0, p: 2.3 }, // lower pelvis
      { a: aH, ...hipSec }, // hip (circumference = hipCirc)
      // navel: between the hips and the waist
      { a: 0.5 * (aH + aW), bf: 0.5 * (hipSec.bf + waistSec.bf) * 1.02, bb: 0.5 * (hipSec.bb + waistSec.bb), cz: 0, p: 2.35 }, // navel
      { a: aW, ...waistSec }, // waist
      { a: aU, ...ubSec }, // underbust
      { a: aU * 1.1, bf: cd * 0.5, bb: cd * 0.5 * BACK_CHEST, cz: 0, p: 2.5, ext: 0 }, // bust (ribcage + lateral chest)
      // armpit / shoulder: the body itself stays about chest-wide; only the sides reach out to the cut plane
      side(aU * 1.13, xs - 0.03, { bf: cd * 0.95 * 0.5, bb: cd * 0.95 * 0.5 * BACK_CHEST, cz: 0, p: 2.7 }), // armpit (just inside the cut plane)
      side(aU * 1.1, xs + 0.02, { bf: cd * 0.72 * 0.47, bb: cd * 0.72 * 0.53, cz: -0.005, p: 2.8 }), // shoulder joint (cut face widest here)
      side(Math.max(nbw / 2 + 0.02, aU * 0.95), xs + 0.004, { bf: cd * 0.55 * 0.45, bb: cd * 0.55 * 0.55, cz: -0.01, p: 2.5 }), // shoulder top
      { a: nbw / 2, bf: nbw * 1.05 * 0.5, bb: nbw * 1.05 * 0.5, cz: -0.01, p: 2.1 }, // neck base
      { a: (nbw / 2) * 0.95, bf: nbw * 0.98 * 0.5, bb: nbw * 0.98 * 0.5, cz: -0.01, p: 2.0 }, // neck cut
    ];
    this.keySections = secs;
    const pelvisLow = Math.min(0.035, 0.6 * hip);
    const ys = [0, pelvisLow, hip, navel, waist, underbust, bust, armpit, shoulderJoint, shoulderTop, H, H + NECK_STUB];
    this.ia = new Pchip(ys, secs.map((s) => s.a));
    this.ibf = new Pchip(ys, secs.map((s) => s.bf));
    this.ibb = new Pchip(ys, secs.map((s) => s.bb));
    this.icz = new Pchip(ys, secs.map((s) => s.cz));
    this.ip = new Pchip(ys, secs.map((s) => s.p));
    this.iext = new Pchip(ys, secs.map((s) => s.ext ?? 0));
  }

  section(y: number): Section {
    const yy = clamp(y, 0, this.Ytop);
    return { a: this.ia.eval(yy), bf: this.ibf.eval(yy), bb: this.ibb.eval(yy), cz: this.icz.eval(yy), p: this.ip.eval(yy), ext: Math.max(0, this.iext.eval(yy)) };
  }

  /** unclamped smooth surface point */
  pointU(theta: number, y: number, sec?: Section): [number, number, number] {
    const s = sec ?? this.section(y);
    const [x, z] = sectionXZ(s, theta);
    return [x, y, z];
  }

  /** surface point with the planar shoulder cut faces applied (|x| <= xs) */
  /**
   * |x| limit of the planar shoulder cut faces at height y: the cut plane (xs) in the shoulder band,
   * no limit lower down (fades out just below the armpit), so wide hips are never cut flat.
   */
  clampLimit(y: number): number {
    const e0 = this.keys.armpit - 0.06;
    const e1 = this.keys.armpit - 0.02;
    const t = Math.min(1, Math.max(0, (y - e0) / (e1 - e0)));
    const w = t * t * (3 - 2 * t);
    return this.xs + (1 - w) * 1.0;
  }

  clampX(x: number, y: number): number {
    const lim = this.clampLimit(y);
    return clamp(x, -lim, lim);
  }

  /** outward unit normal of the unclamped smooth surface (finite differences) */
  normalU(theta: number, y: number): [number, number, number] {
    const ht = 1e-4;
    const hy = 1e-4;
    const y0 = Math.max(0, y - hy);
    const y1 = Math.min(this.Ytop, y + hy);
    const s = this.section(y);
    const a = this.pointU(theta - ht, y, s);
    const b = this.pointU(theta + ht, y, s);
    const c = this.pointU(theta, y0);
    const d = this.pointU(theta, y1);
    const tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2]; // dθ
    const ux = d[0] - c[0], uy = d[1] - c[1], uz = d[2] - c[2]; // dy
    // N = Ty × Tθ
    let nx = uy * tz - uz * ty;
    let ny = uz * tx - ux * tz;
    let nz = ux * ty - uy * tx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    return [nx, ny, nz];
  }
}

/**
 * Arc length along the (unclamped) cross-section at one height.
 * sAt(θ) = signed arc length from the front midline (θ=π), positive toward +X (θ<π).
 */
export class ArcTable {
  private th: Float64Array;
  private L: Float64Array;
  private Lfront: number;
  readonly perimeter: number;

  constructor(sec: Section, n = 1024) {
    this.th = new Float64Array(n + 1);
    this.L = new Float64Array(n + 1);
    let [px, pz] = sectionXZ(sec, 0);
    for (let i = 1; i <= n; i++) {
      const t = (i / n) * 2 * Math.PI;
      const [x, z] = sectionXZ(sec, t);
      this.th[i] = t;
      this.L[i] = this.L[i - 1] + Math.hypot(x - px, z - pz);
      px = x;
      pz = z;
    }
    this.perimeter = this.L[n];
    this.Lfront = this.L[n >> 1]; // θ = π exactly when n is even
  }

  private Lat(theta: number): number {
    const n = this.th.length - 1;
    const f = (theta / (2 * Math.PI)) * n;
    const i = Math.min(n - 1, Math.max(0, Math.floor(f)));
    const t = f - i;
    return this.L[i] + (this.L[i + 1] - this.L[i]) * t;
  }

  sAt(theta: number): number {
    return this.Lfront - this.Lat(theta);
  }

  /** inverse of sAt */
  thetaAt(s: number): number {
    const target = this.Lfront - s;
    const L = this.L;
    const n = L.length - 1;
    if (target <= 0) return 0;
    if (target >= L[n]) return 2 * Math.PI;
    let lo = 0;
    let hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (L[mid] <= target) lo = mid;
      else hi = mid;
    }
    const t = (target - L[lo]) / (L[hi] - L[lo] || 1);
    return ((lo + t) / n) * 2 * Math.PI;
  }

  /** ds/dθ (absolute) at θ */
  dsdTheta(theta: number): number {
    const h = 1e-3;
    return Math.abs(this.Lat(theta + h) - this.Lat(theta - h)) / (2 * h);
  }
}
