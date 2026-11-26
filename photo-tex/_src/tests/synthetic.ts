// Synthetic ground truth (SPEC 13.1): template (default parameters) + Gaussian bumps/dents,
// rendered with a known Lambertian model, uniform albedo, directional light + ambient and a
// weak-perspective camera. Only the image and the (possibly perturbed) landmarks go to the pipeline.
import { defaultParams, type ModelParams } from '../src/model/params';
import { BodyModel } from '../src/model/mesh';
import { ArcTable } from '../src/model/torso';
import { Projector, type Camera } from '../src/analysis/camera';
import { FRONT_LANDMARKS, landmark3D } from '../src/analysis/landmarks';
import { rasterize } from '../src/analysis/raster';
import { linearToSrgb8, type RGBAImage } from '../src/analysis/image';

export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface CaseDef {
  name: string;
  seed: number;
  noise: boolean;
  spots: boolean;
  perturbLandmarks: boolean;
  zeroDisplacement: boolean;
  /** partial photo: camera zoomed onto the chest (only the breasts and their surroundings are visible) */
  partial?: boolean;
}

export const CASES: CaseDef[] = [
  { name: 'A', seed: 11, noise: false, spots: false, perturbLandmarks: false, zeroDisplacement: false },
  { name: 'B', seed: 22, noise: true, spots: false, perturbLandmarks: false, zeroDisplacement: false },
  { name: 'C', seed: 33, noise: true, spots: true, perturbLandmarks: false, zeroDisplacement: false },
  { name: 'D', seed: 44, noise: true, spots: false, perturbLandmarks: true, zeroDisplacement: false },
  { name: 'E', seed: 55, noise: true, spots: false, perturbLandmarks: false, zeroDisplacement: true },
  // not in SPEC 13.1: partial photo (chest only), added with the finer landmarks on 2026-11-26
  { name: 'F', seed: 66, noise: true, spots: false, perturbLandmarks: false, zeroDisplacement: false, partial: true },
];

interface Bump { s: number; y: number; amp: number; sigma: number }
interface Spot { s: number; y: number; r: number }

export interface Synthetic {
  image: RGBAImage;
  landmarks: Record<string, [number, number]>;
  params: ModelParams;
  camera: Camera;
  bumps: Bump[];
  spots: Spot[];
  /** true displacement at torso coordinates (θ, y), meters */
  dTrue: (theta: number, y: number) => number;
}

export const SYNTH_LIGHT = (() => {
  const l = [-0.45, 0.55, 0.7];
  const n = Math.hypot(l[0], l[1], l[2]);
  return { dir: l.map((v) => v / n), k: 0.8, ambient: 0.1, albedo: [0.78, 0.58, 0.48] };
})();

export function generate(c: CaseDef, size = 1024): Synthetic {
  const rnd = mulberry32(c.seed);
  const params = defaultParams();
  const model = new BodyModel(params);
  // ---- ground truth displacement: 3–6 Gaussian bumps/dents on the front torso ----
  const bumps: Bump[] = [];
  if (!c.zeroDisplacement) {
    const count = 3 + Math.floor(rnd() * 4);
    for (let i = 0; i < count; i++) {
      const sign = rnd() < 0.5 ? -1 : 1;
      bumps.push({
        s: -0.1 + 0.2 * rnd(),
        y: c.partial ? params.breast.centerHeight - 0.08 + 0.14 * rnd() : 0.08 + 0.28 * rnd(),
        amp: sign * (0.002 + 0.008 * rnd()),
        sigma: 0.015 + 0.025 * rnd(),
      });
    }
  }
  const spots: Spot[] = [];
  if (c.spots)
    for (let i = 0; i < 5; i++) spots.push({ s: -0.1 + 0.2 * rnd(), y: 0.1 + 0.28 * rnd(), r: (0.003 + 0.012 * rnd()) / 2 });
  const tabCache = new Map<number, ArcTable>();
  const tab = (y: number) => {
    const key = Math.round(y * 1e6);
    let t = tabCache.get(key);
    if (!t) tabCache.set(key, (t = new ArcTable(model.torso.section(y), 512)));
    return t;
  };
  const sOf = (theta: number, y: number) => tab(y).sAt(((theta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
  const dAt = (s: number, y: number) => {
    let d = 0;
    for (const b of bumps) d += b.amp * Math.exp(-((s - b.s) ** 2 + (y - b.y) ** 2) / (2 * b.sigma ** 2));
    return d;
  };
  const dTrue = (theta: number, y: number) => dAt(sOf(theta, y), y);

  // ---- render mesh: dense (θ, y) grid of the displaced template ----
  const NT = 720, NY = 420;
  const Ytop = model.torso.Ytop;
  const base = new Float64Array(NT * NY * 3);
  const sArr = new Float64Array(NT * NY);
  for (let j = 0; j < NY; j++) {
    const y = (Ytop * j) / (NY - 1);
    const t = tab(y);
    for (let i = 0; i < NT; i++) {
      const th = (2 * Math.PI * i) / NT;
      const p = model.evalAt(th, y, t).pos;
      base.set(p, (j * NT + i) * 3);
      sArr[j * NT + i] = t.sAt(th);
    }
  }
  const nrm = (P: Float64Array) => {
    const N = new Float64Array(P.length);
    for (let j = 0; j < NY; j++)
      for (let i = 0; i < NT; i++) {
        const k = (j * NT + i) * 3;
        const a = (j * NT + ((i + NT - 1) % NT)) * 3, b = (j * NT + ((i + 1) % NT)) * 3;
        const cc = (Math.max(0, j - 1) * NT + i) * 3, d = (Math.min(NY - 1, j + 1) * NT + i) * 3;
        const tx = P[b] - P[a], ty = P[b + 1] - P[a + 1], tz = P[b + 2] - P[a + 2];
        const ux = P[d] - P[cc], uy = P[d + 1] - P[cc + 1], uz = P[d + 2] - P[cc + 2];
        let nx = uy * tz - uz * ty, ny = uz * tx - ux * tz, nz = ux * ty - uy * tx;
        const l = Math.hypot(nx, ny, nz) || 1;
        N[k] = nx / l; N[k + 1] = ny / l; N[k + 2] = nz / l;
      }
    return N;
  };
  const N0 = nrm(base);
  const disp = new Float64Array(base.length);
  for (let k = 0; k < NT * NY; k++) {
    const y = base[k * 3 + 1];
    const dd = dAt(sArr[k], (Ytop * Math.floor(k / NT)) / (NY - 1));
    void y;
    for (let q = 0; q < 3; q++) disp[k * 3 + q] = base[k * 3 + q] + dd * N0[k * 3 + q];
  }
  const N1 = nrm(disp);
  const idx: number[] = [];
  for (let j = 0; j < NY - 1; j++)
    for (let i = 0; i < NT; i++) {
      const a = j * NT + i, b = j * NT + ((i + 1) % NT), cc = (j + 1) * NT + i, d = (j + 1) * NT + ((i + 1) % NT);
      idx.push(a, cc, b, b, cc, d);
    }

  // ---- camera (unknown to the pipeline) ----
  const yCenter = c.partial ? params.breast.centerHeight : Ytop / 2;
  const s = c.partial ? (0.95 * size) / 0.22 : (0.8 * size) / Ytop; // partial: about 22 cm across the photo
  const camera: Camera = { yaw: 0.06, pitch: -0.04, roll: 0.03, s, tx: size / 2 + 0.01 * size, ty: size / 2 + yCenter * s };
  const SS = 2; // supersampling
  const camHi: Camera = { ...camera, s: camera.s * SS, tx: camera.tx * SS, ty: camera.ty * SS };
  const W = size * SS;
  const lin = new Float32Array(W * W * 3);
  const bg = [0.05, 0.05, 0.06];
  for (let i = 0; i < W * W; i++) lin.set(bg, i * 3);
  const L = SYNTH_LIGHT;
  rasterize(disp, idx, new Projector(camHi), W, W, {
    fragment: (px, py, tri, b0, b1, b2) => {
      const a = idx[tri * 3], b = idx[tri * 3 + 1], cc = idx[tri * 3 + 2];
      let nx = b0 * N1[a * 3] + b1 * N1[b * 3] + b2 * N1[cc * 3];
      let ny = b0 * N1[a * 3 + 1] + b1 * N1[b * 3 + 1] + b2 * N1[cc * 3 + 1];
      let nz = b0 * N1[a * 3 + 2] + b1 * N1[b * 3 + 2] + b2 * N1[cc * 3 + 2];
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const sh = L.k * Math.max(0, nx * L.dir[0] + ny * L.dir[1] + nz * L.dir[2]) + L.ambient;
      let alb = 1;
      if (spots.length) {
        const sv = b0 * sArr[a] + b1 * sArr[b] + b2 * sArr[cc];
        const yv = b0 * base[a * 3 + 1] + b1 * base[b * 3 + 1] + b2 * base[cc * 3 + 1];
        for (const sp of spots) if (Math.hypot(sv - sp.s, yv - sp.y) < sp.r) alb = 0.7;
      }
      const o = (py * W + px) * 3;
      for (let q = 0; q < 3; q++) lin[o + q] = L.albedo[q] * alb * sh;
    },
  });
  // ---- downsample, noise, sRGB 8-bit ----
  const out = new Uint8ClampedArray(size * size * 4);
  const small = new Float32Array(size * size * 3);
  let maxI = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      for (let q = 0; q < 3; q++) {
        let v = 0;
        for (let b = 0; b < SS; b++) for (let a = 0; a < SS; a++) v += lin[((y * SS + b) * W + x * SS + a) * 3 + q];
        v /= SS * SS;
        small[(y * size + x) * 3 + q] = v;
        maxI = Math.max(maxI, v);
      }
  const gauss = () => {
    let u = 0, v = 0;
    while (u === 0) u = rnd();
    while (v === 0) v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  for (let i = 0; i < size * size; i++) {
    for (let q = 0; q < 3; q++) {
      let v = small[i * 3 + q];
      if (c.noise) v += 0.02 * maxI * gauss();
      out[i * 4 + q] = linearToSrgb8(v);
    }
    out[i * 4 + 3] = 255;
  }
  // ---- true 2D landmarks (template positions through the true camera) ----
  const P = new Projector(camera);
  const landmarks: Record<string, [number, number]> = {};
  for (const d of FRONT_LANDMARKS) {
    const X = landmark3D(model, d.id);
    const [u, v] = P.project(X[0], X[1], X[2]);
    // a person can only place the landmarks that are inside the photo
    if (u < 10 || v < 10 || u > size - 10 || v > size - 10) continue;
    landmarks[d.id] = c.perturbLandmarks ? [u + (rnd() * 4 - 2), v + (rnd() * 4 - 2)] : [u, v];
  }
  return { image: { width: size, height: size, data: out }, landmarks, params, camera, bumps, spots, dTrue };
}
