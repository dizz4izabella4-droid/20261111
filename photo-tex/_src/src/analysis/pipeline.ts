// Single-photo analysis pipeline (SPEC 7). Pure TypedArray code: runs in a Web Worker and in Node tests.
// Input: photo, landmarks (or an already fitted / overridden camera), template parameters, settings.
// It never receives the true light, camera or displacement.
import type { ModelParams, PresetName } from '../model/params';
import { BodyModel, buildBaseMesh } from '../model/mesh';
import { fitCamera, Projector, type Camera, type CameraFit, type ViewId } from './camera';
import { landmark3D } from './landmarks';
import { cropResizeLinear, pyramid, samplePyramid, median, type FImage, type RGBAImage } from './image';
import { rasterize } from './raster';
import { texelGeometry, coarser, resampleField, type PatchGrid, type TexelGeom } from './grid';
import { fitLight, shadeGrad, type Light, type LightModelName } from './light';
import { energy, lbfgs, type SolveTerms } from './solve';
import { boxBlur3, cleanRegion, finalizeDisplacement } from './postprocess';
import { edgeDistance } from '../patch/patch';
import { smoothstep } from '../model/interp';

export interface AnalysisSettings {
  analysisRes: number; // px, long side of the torso crop
  patchRes: number; // texels, long side of the patch grid
  levels: number;
  itersPerLevel: number;
  smoothMm: number;
  maxDispMm: number;
  priorWeight: number;
  lightModel: LightModelName;
  albedoK: number; // chromaticity outlier threshold (k·MAD)
  /** solver weights (advanced; defaults below) */
  lambdaS?: number;
  lambdaPScale?: number;
  /** re-estimate the light from the current shape on every solver round */
  refitLight?: boolean;
  /** robust data weights: Huber (default), Huber then Tukey, or none */
  robust?: 'tukey' | 'huber' | 'none';
  /** prior anchor at the edge of the observed region: boost factor and decay length (m) */
  edgeAnchor?: number;
  edgeAnchorLength?: number;
  /** IRLS / light-refit rounds per level */
  rounds?: number;
  /** lower bound of the robust residual scale (normalized shading units) */
  robustFloor?: number;
  /** template creases: texels whose normal turns more than this (degrees) to a neighbor get no data term */
  creaseDeg?: number;
}

/** SPEC 7.1 / 11.1 defaults per preset */
export function defaultSettings(preset: PresetName): AnalysisSettings {
  const t = {
    light: { analysisRes: 256, patchRes: 128, levels: 3, itersPerLevel: 30 },
    standard: { analysisRes: 512, patchRes: 256, levels: 4, itersPerLevel: 50 },
    high: { analysisRes: 1024, patchRes: 512, levels: 5, itersPerLevel: 80 },
  }[preset];
  return { ...t, smoothMm: 8, maxDispMm: 25, priorWeight: 0.3, lightModel: 'directional', albedoK: 3 };
}

export interface AnalysisInput {
  image: RGBAImage;
  view: ViewId;
  /** image pixel coordinates of the placed landmarks */
  landmarks: Record<string, [number, number]>;
  /** if given, used instead of fitting (manual override) */
  camera?: Camera;
  params: ModelParams;
  settings: AnalysisSettings;
  /** return extra diagnostic fields (tests only; never changes the result) */
  debug?: boolean;
}

export interface PatchResult {
  view: ViewId;
  grid: PatchGrid;
  region: Uint8Array;
  dRaw: Float32Array;
  dSmooth: Float32Array;
  conf: Float32Array;
  camera: Camera;
  cameraFit?: CameraFit;
  light: Light;
  stats: Record<string, number>;
  timings: Record<string, number>;
  debug?: { r0: Float64Array; valid: Uint8Array; vis: Uint8Array; energyAt?: (d: Float64Array) => { total: number; data: number }; residualAt?: (d: Float64Array) => Float64Array; shadeAt?: (d: Float64Array) => Float64Array };
}

export type Progress = (step: string, fraction: number) => void;

export class Cancelled extends Error {
  constructor() {
    super('cancelled');
  }
}

export function fitCameraFromLandmarks(model: BodyModel, view: ViewId, landmarks: Record<string, [number, number]>, longSide: number): CameraFit {
  const pairs = Object.entries(landmarks).map(([id, x]) => ({ id, X: landmark3D(model, id), x }));
  return fitCamera(pairs, view, longSide);
}

export function runSinglePhoto(input: AnalysisInput, progress: Progress = () => {}, cancelled: () => boolean = () => false): PatchResult {
  const t0 = performance.now();
  const timings: Record<string, number> = {};
  let tPrev = t0;
  const mark = (name: string) => {
    const now = performance.now();
    timings[name] = now - tPrev;
    tPrev = now;
    if (cancelled()) throw new Cancelled();
  };
  const S = input.settings;
  const model = new BodyModel(input.params);
  const img = input.image;
  const longSide = Math.max(img.width, img.height);

  // ---------- camera ----------
  progress('カメラの位置合わせ', 0);
  let cameraFit: CameraFit | undefined;
  let cam: Camera;
  if (input.camera) cam = input.camera;
  else {
    cameraFit = fitCameraFromLandmarks(model, input.view, input.landmarks, longSide);
    cam = cameraFit.camera;
  }
  mark('camera');

  // ---------- 1. preprocess: crop to the projected template + 5% margin, resize, linearize ----------
  progress('前処理', 0.05);
  const mesh = buildBaseMesh(input.params, 'standard');
  const P0 = new Projector(cam);
  let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const [u, v] = P0.project(mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]);
    minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
  }
  const mU = 0.05 * (maxU - minU), mV = 0.05 * (maxV - minV);
  const x0 = Math.max(0, minU - mU), x1 = Math.min(img.width, maxU + mU);
  const y0 = Math.max(0, minV - mV), y1 = Math.min(img.height, maxV + mV);
  if (!(x1 - x0 > 8 && y1 - y0 > 8)) throw new Error('素体が写真の外にあります。目印を確認してください。');
  const k = S.analysisRes / Math.max(x1 - x0, y1 - y0);
  const W = Math.max(8, Math.round((x1 - x0) * k));
  const H = Math.max(8, Math.round((y1 - y0) * k));
  const kx = W / (x1 - x0), ky = H / (y1 - y0);
  const crop = cropResizeLinear(img, x0, y0, x1, y1, W, H);
  const camA: Camera = { ...cam, s: cam.s * kx, tx: (cam.tx - x0) * kx, ty: (cam.ty - y0) * ky };
  const P = new Projector(camA);
  const view = P.viewDir();
  const Limg: FImage = { w: W, h: H, d: new Float32Array(W * H) };
  for (let i = 0; i < W * H; i++) Limg.d[i] = 0.2126 * crop.R[i] + 0.7152 * crop.G[i] + 0.0722 * crop.B[i];
  mark('preprocess');

  // ---------- 2. template buffers (CPU depth buffer) ----------
  progress('素体の描画', 0.1);
  // depth buffer from a dense grid of the template surface (the coarse base mesh bridges concave
  // areas such as the side of the breast and would hide visible surface)
  const zgrid: PatchGrid = { nx: 360, ny: 240, th0: 0, th1: 2 * Math.PI, y0: 0, y1: model.torso.Ytop };
  const zgeo = texelGeometry(model, zgrid);
  const zidx: number[] = [];
  for (let j = 0; j < zgrid.ny - 1; j++)
    for (let i = 0; i < zgrid.nx; i++) {
      const a = j * zgrid.nx + i, b = j * zgrid.nx + ((i + 1) % zgrid.nx);
      zidx.push(a, a + zgrid.nx, b, b, a + zgrid.nx, b + zgrid.nx);
    }
  const zb = rasterize(zgeo.S, zidx, P, W, H);
  mark('raster');

  // ---------- 3. invalid-pixel mask ----------
  progress('除外マスク', 0.15);
  const pixValid = new Uint8Array(W * H);
  const rc: number[] = [];
  const gc: number[] = [];
  for (let i = 0; i < W * H; i++) {
    if (zb.z[i] === -Infinity) continue;
    const L = Limg.d[i];
    if (L > 0.95 || L < 0.02) continue; // saturated / crushed
    pixValid[i] = 1;
    const sum = crop.R[i] + crop.G[i] + crop.B[i];
    rc.push(crop.R[i] / sum);
    gc.push(crop.G[i] / sum);
  }
  // chromaticity noise grows as the pixel gets darker (additive sensor noise / 8-bit steps), so the
  // deviation is scaled by brightness relative to the median before the robust MAD test
  const sums: number[] = [];
  for (let i = 0; i < W * H; i++) if (pixValid[i]) sums.push(crop.R[i] + crop.G[i] + crop.B[i]);
  const mSum = median(sums) || 1;
  const mr = median(rc), mg = median(gc);
  const scaled = (v: number[], m: number) => v.map((x, q) => Math.abs(x - m) * (sums[q] / mSum));
  const sr = Math.max(0.004, 1.4826 * median(scaled(rc, mr)));
  const sg = Math.max(0.004, 1.4826 * median(scaled(gc, mg)));
  let chromaRejected = 0;
  for (let i = 0; i < W * H; i++) {
    if (!pixValid[i]) continue;
    const sum = crop.R[i] + crop.G[i] + crop.B[i];
    const f = sum / mSum;
    const dr = ((crop.R[i] / sum - mr) * f) / sr;
    const dg = ((crop.G[i] / sum - mg) * f) / sg;
    if (Math.hypot(dr, dg) > S.albedoK) {
      pixValid[i] = 0;
      chromaRejected++;
    }
  }
  mark('mask');

  // ---------- patch grid domain: visible part of the template in (θ, y) ----------
  progress('パーツの範囲', 0.2);
  // visible center: front (yaw 0) → θ = π; left side (yaw −π/2) → π/2; back (yaw π) → 2π ≡ 0
  const thc = Math.PI + cam.yaw;
  const probe: PatchGrid = { nx: 144, ny: 96, th0: thc - Math.PI, th1: thc + Math.PI, y0: 0, y1: model.torso.Ytop };
  const pg = texelGeometry(model, probe);
  const visible = (geo: TexelGeom, idx: number, tol = 0.006): boolean => {
    const q = idx * 3;
    const ndv = geo.N[q] * view[0] + geo.N[q + 1] * view[1] + geo.N[q + 2] * view[2];
    if (ndv <= 0.02) return false;
    const [u, v, depth] = P.project(geo.S[q], geo.S[q + 1], geo.S[q + 2]);
    const px = Math.floor(u), py = Math.floor(v);
    if (px < 0 || py < 0 || px >= W || py >= H) return false;
    return depth >= zb.z[py * W + px] - tol;
  };
  let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
  for (let j = 0; j < probe.ny; j++)
    for (let i = 0; i < probe.nx; i++)
      if (visible(pg, j * probe.nx + i)) {
        i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j);
      }
  if (!(i1 >= i0 && j1 >= j0)) throw new Error('写真の中に素体の見える部分がありません。');
  const dth = (probe.th1 - probe.th0) / probe.nx, dy = (probe.y1 - probe.y0) / probe.ny;
  const th0 = probe.th0 + Math.max(0, i0 - 1) * dth, th1 = probe.th0 + Math.min(probe.nx, i1 + 2) * dth;
  const gy0 = Math.max(0, probe.y0 + (j0 - 1) * dy), gy1 = Math.min(model.torso.Ytop, probe.y0 + (j1 + 2) * dy);
  // physical aspect → texel counts (long side = patchRes)
  let meanHt = 0, nHt = 0;
  for (let k2 = 0; k2 < pg.ht.length; k2++) if (visible(pg, k2)) { meanHt += pg.ht[k2]; nHt++; }
  const physW = (meanHt / Math.max(1, nHt) / dth) * (th1 - th0);
  const physH = gy1 - gy0;
  const nxF = physW >= physH ? S.patchRes : Math.max(8, Math.round((S.patchRes * physW) / physH));
  const nyF = physH > physW ? S.patchRes : Math.max(8, Math.round((S.patchRes * physH) / physW));
  const fine: PatchGrid = { nx: nxF, ny: nyF, th0, th1, y0: gy0, y1: gy1 };
  const grids: PatchGrid[] = [fine];
  for (let l = 1; l < S.levels; l++) grids.unshift(coarser(grids[0]));
  mark('domain');

  // ---------- finest level geometry and observation masks ----------
  progress('素体の形の準備', 0.25);
  const pyr = pyramid(Limg, 8);
  interface Level {
    geo: TexelGeom;
    vis: Uint8Array; // visible
    valid: Uint8Array; // data available (visible, valid pixel, not grazing, not in attached shadow)
    ndv: Float64Array;
    nScale: Float64Array; // length of the averaged normal (1 on the finest level)
    priorW: Float64Array;
    /** coarse levels: coarse texel index of every finest texel */
    cellOfFine?: Int32Array;
  }
  const n = fine.nx * fine.ny;
  const geoF = texelGeometry(model, fine);
  const lf: Level = { geo: geoF, vis: new Uint8Array(n), valid: new Uint8Array(n), ndv: new Float64Array(n), nScale: new Float64Array(n).fill(1), priorW: new Float64Array(n).fill(1) };
  const pyrLevelF = new Float64Array(n);
  /** visible and valid in the photo (patch region); lf.valid additionally drops texels without a usable data term */
  const photoValid = new Uint8Array(n);
  for (let t = 0; t < n; t++) {
    const q = t * 3;
    lf.ndv[t] = geoF.N[q] * view[0] + geoF.N[q + 1] * view[1] + geoF.N[q + 2] * view[2];
    lf.vis[t] = visible(geoF, t) ? 1 : 0;
    if (!lf.vis[t]) continue;
    const [u, v] = P.project(geoF.S[q], geoF.S[q + 1], geoF.S[q + 2]);
    lf.valid[t] = pixValid[Math.floor(v) * W + Math.floor(u)] && lf.ndv[t] >= 0.15 ? 1 : 0;
    photoValid[t] = lf.valid[t];
    pyrLevelF[t] = Math.max(0, Math.log2(Math.max(1, camA.s * Math.sqrt(geoF.area[t]))));
  }
  // template creases (fold under the breasts, cleavage, shoulder cut edges...): sharper than a texel,
  // so the texel normal cannot predict the observed shading there. Uses the template only.
  const creaseCos = Math.cos(((S.creaseDeg ?? 8) * Math.PI) / 180);
  const crease = new Uint8Array(n);
  for (let j = 0; j < fine.ny; j++)
    for (let i = 0; i < fine.nx; i++) {
      const t = j * fine.nx + i;
      const nb = [i > 0 ? t - 1 : -1, i < fine.nx - 1 ? t + 1 : -1, j > 0 ? t - fine.nx : -1, j < fine.ny - 1 ? t + fine.nx : -1];
      for (const u of nb) {
        if (u < 0) continue;
        const c = geoF.N[t * 3] * geoF.N[u * 3] + geoF.N[t * 3 + 1] * geoF.N[u * 3 + 1] + geoF.N[t * 3 + 2] * geoF.N[u * 3 + 2];
        if (c < creaseCos) crease[t] = 1;
      }
    }
  let creaseTexels = 0;
  for (let j = 0; j < fine.ny; j++)
    for (let i = 0; i < fine.nx; i++) {
      const t = j * fine.nx + i;
      // dilate by one texel
      let hit = crease[t];
      for (let q = -1; q <= 1 && !hit; q++)
        for (let p = -1; p <= 1 && !hit; p++) {
          const ii = i + p, jj = j + q;
          if (ii >= 0 && jj >= 0 && ii < fine.nx && jj < fine.ny && crease[jj * fine.nx + ii]) hit = 1;
        }
      if (hit && lf.valid[t]) {
        lf.valid[t] = 0;
        creaseTexels++;
      }
    }
  mark('geometry');

  /** observed luminance at the finest texels, sampled where the displaced surface projects */
  const sampleFine = (dF: Float64Array | null): Float64Array => {
    const out = new Float64Array(n);
    for (let t = 0; t < n; t++) {
      if (!lf.vis[t]) continue;
      const q = t * 3;
      const dd = dF ? dF[t] : 0;
      const [u, v] = P.project(geoF.S[q] + dd * geoF.N[q], geoF.S[q + 1] + dd * geoF.N[q + 1], geoF.S[q + 2] + dd * geoF.N[q + 2]);
      out[t] = samplePyramid(pyr, Math.round(pyrLevelF[t]), u, v);
    }
    return out;
  };

  // ---------- 4. light estimation (robust, template normals, uniform albedo) ----------
  progress('光の推定', 0.3);
  const L0 = sampleFine(null);
  const lightFit = fitLight(S.lightModel, geoF.N, L0, lf.valid);
  let light = lightFit.light;
  const sigma0 = Math.max(0.01, lightFit.residualScale / light.amp);
  // attached shadow: where the template faces away from the light the shading carries no shape
  // information (Lambert clips at 0), so those texels get no data term
  let shadowTexels = 0;
  if (light.model === 'directional') {
    const c = light.coef;
    for (let t = 0; t < n; t++) {
      if (!lf.valid[t]) continue;
      const q = t * 3;
      if ((c[0] * geoF.N[q] + c[1] * geoF.N[q + 1] + c[2] * geoF.N[q + 2]) / light.amp < 0.08) {
        lf.valid[t] = 0;
        shadowTexels++;
      }
    }
  }
  const r0 = input.debug ? residuals(geoF, light, L0, new Float64Array(n), lf.valid, lf.nScale) : undefined;
  mark('light');

  // ---------- prior weight: anchor the patch to the template near the edge of the observed region ----------
  // With one light, shading fixes the shape along each line in the light direction but not that
  // line's starting height. A uniform pull toward d = 0 would remove each line's mean (lifting dents,
  // raising their surroundings); instead the pull is strong at the edge of the observed region (where
  // the patch must meet the base anyway, SPEC 9.2) and weak inside.
  const priorWF = new Float64Array(n).fill(1);
  {
    // outer edge of what the camera sees (internal data gaps such as creases or attached shadow do not anchor)
    const seen = new Uint8Array(n);
    for (let t = 0; t < n; t++) seen[t] = lf.vis[t] && lf.ndv[t] >= 0.15 ? 1 : 0;
    const obs = cleanRegion(seen, fine.nx, fine.ny);
    const dist = edgeDistance(obs, fine.nx, fine.ny);
    const boost = S.edgeAnchor ?? 100;
    const ell = S.edgeAnchorLength ?? 0.01;
    for (let t = 0; t < n; t++) {
      const h = 0.5 * (geoF.ht[t] + geoF.hy[t]);
      priorWF[t] = 1 + boost * Math.exp(-(dist[t] * h) / ell);
    }
  }

  // ---------- coarse levels: restriction of the finest level (averaged normals and luminance) ----------
  const levels: Level[] = grids.slice(0, -1).map((g) => {
    const geo = texelGeometry(model, g);
    const m = g.nx * g.ny;
    const cellOfFine = new Int32Array(n);
    const sumN = new Float64Array(m * 3);
    const cntValid = new Float64Array(m), cntAll = new Float64Array(m);
    const vis = new Uint8Array(m);
    for (let j = 0; j < fine.ny; j++) {
      const cj = Math.min(g.ny - 1, Math.floor(((j + 0.5) / fine.ny) * g.ny));
      for (let i = 0; i < fine.nx; i++) {
        const ci = Math.min(g.nx - 1, Math.floor(((i + 0.5) / fine.nx) * g.nx));
        const t = j * fine.nx + i, c = cj * g.nx + ci;
        cellOfFine[t] = c;
        cntAll[c]++;
        if (lf.vis[t]) vis[c] = 1;
        if (!lf.valid[t]) continue;
        cntValid[c]++;
        for (let q = 0; q < 3; q++) sumN[c * 3 + q] += geoF.N[t * 3 + q];
      }
    }
    const valid = new Uint8Array(m), nScale = new Float64Array(m).fill(1), ndv = new Float64Array(m);
    for (let c = 0; c < m; c++) {
      if (cntValid[c] >= 0.5 * cntAll[c] && cntValid[c] > 0) {
        const x = sumN[c * 3], y = sumN[c * 3 + 1], z = sumN[c * 3 + 2];
        const l = Math.hypot(x, y, z);
        geo.N[c * 3] = x / l; geo.N[c * 3 + 1] = y / l; geo.N[c * 3 + 2] = z / l;
        nScale[c] = l / cntValid[c];
        valid[c] = 1;
      }
      ndv[c] = geo.N[c * 3] * view[0] + geo.N[c * 3 + 1] * view[1] + geo.N[c * 3 + 2] * view[2];
    }
    const priorW = new Float64Array(m);
    for (let t = 0; t < n; t++) priorW[cellOfFine[t]] += priorWF[t];
    for (let c = 0; c < m; c++) priorW[c] = cntAll[c] ? priorW[c] / cntAll[c] : 1;
    return { geo, vis, valid, ndv, nScale, priorW, cellOfFine };
  });
  lf.priorW = priorWF;
  levels.push(lf);

  /** luminance for a level: fine samples (at the upsampled displacement) averaged per coarse texel */
  const sampleLevel = (lv: Level, d: Float64Array, g: PatchGrid): Float64Array => {
    if (lv === lf) return sampleFine(d);
    const Lf = sampleFine(resampleField(d, g, fine));
    const m = g.nx * g.ny;
    const sum = new Float64Array(m), cnt = new Float64Array(m);
    for (let t = 0; t < n; t++) {
      if (!lf.valid[t]) continue;
      const c = lv.cellOfFine![t];
      sum[c] += Lf[t];
      cnt[c]++;
    }
    for (let c = 0; c < m; c++) sum[c] = cnt[c] ? sum[c] / cnt[c] : 0;
    return sum;
  };

  // ---------- 5. shape solve, coarse to fine ----------
  const terms: SolveTerms = { lambdaS: S.lambdaS ?? 4e-6, lambdaP: S.priorWeight * (S.lambdaPScale ?? 1e-3), d0: 0.01 };
  const maxD = S.maxDispMm / 1000;
  let d: Float64Array<ArrayBufferLike> = new Float64Array(grids[0].nx * grids[0].ny);
  let lastW = new Float64Array(0);
  for (let l = 0; l < levels.length; l++) {
    const lv = levels[l];
    if (l > 0) d = resampleField(d, grids[l - 1], grids[l]);
    const m = lv.geo.grid.nx * lv.geo.grid.ny;
    const rounds = S.rounds ?? 2;
    let w = new Float64Array(m);
    for (let round = 0; round < rounds; round++) {
      progress(`形の推定（${l + 1}/${levels.length} 段目）`, 0.35 + (0.5 * (l + round / rounds)) / levels.length);
      const L = sampleLevel(lv, d as Float64Array, grids[l]);
      if ((S.refitLight ?? false) && !(l === 0 && round === 0)) {
        // optional: light from the current shape (absorbs a global shading bias)
        light = fitLight(S.lightModel, currentNormals(lv.geo, d), L, lv.valid).light;
      }
      // residuals of the current estimate → robust weights
      const r = residuals(lv.geo, light, L, d, lv.valid, lv.nScale);
      const absr: number[] = [];
      for (let t = 0; t < m; t++) if (lv.valid[t]) absr.push(Math.abs(r[t]));
      const first = l === 0 && round === 0;
      const sig = Math.max(S.robustFloor ?? 0.005, first ? sigma0 : Math.max(0.5 * sigma0, 1.4826 * median(absr)));
      w = new Float64Array(m);
      for (let t = 0; t < m; t++) {
        if (!lv.valid[t]) continue;
        const a = Math.abs(r[t]);
        const mode = S.robust ?? 'huber';
        if (mode === 'none') w[t] = 1;
        else if (first || mode === 'huber') {
          const delta = 1.345 * sig; // Huber
          w[t] = a <= delta ? 1 : delta / a;
        } else {
          const c = 4.685 * sig; // Tukey biweight
          w[t] = a < c ? (1 - (a / c) ** 2) ** 2 : 0;
        }
      }
      const data = { L, w, light, nScale: lv.nScale };
      const geo = lv.geo;
      const lvTerms = { ...terms, priorW: lv.priorW };
      lbfgs(d, (x, g) => energy(geo, data, lvTerms, x, g), Math.ceil(S.itersPerLevel / rounds), 7, cancelled);
      for (let t = 0; t < m; t++) d[t] = Math.max(-maxD, Math.min(maxD, d[t]));
      if (cancelled()) throw new Cancelled();
    }
    lastW = w;
  }
  mark('solve');

  // ---------- 6–8. region, confidence, smoothing ----------
  progress('仕上げ', 0.9);
  const g = fine;
  const Lf = sampleFine(d as Float64Array);
  const rFinal = residuals(lf.geo, light, Lf, d, lf.valid, lf.nScale);
  const absr: number[] = [];
  for (let t = 0; t < n; t++) if (lf.valid[t]) absr.push(Math.abs(rFinal[t]));
  const sigF = Math.max(0.5 * sigma0, 1.4826 * median(absr));
  // patch region (SPEC 7.2-8): visible and valid in the photo. Texels without a usable data term
  // (template creases, attached shadow) stay in the region, interpolated, with lower confidence.
  const region = cleanRegion(photoValid, g.nx, g.ny);
  let conf: Float32Array<ArrayBufferLike> = new Float32Array(n);
  for (let t = 0; t < n; t++) {
    if (!region[t]) continue;
    const data = lf.valid[t] ? Math.max(0.2, lastW[t] || 0) : 0.3; // filled holes: interpolated only
    const graze = smoothstep(0.15, 0.45, lf.ndv[t]);
    const res = lf.valid[t] ? Math.exp(-0.5 * (rFinal[t] / (3 * sigF)) ** 2) : 0.5;
    conf[t] = data * graze * res;
  }
  conf = boxBlur3(conf, g.nx, g.ny);
  for (let t = 0; t < n; t++) if (!region[t]) conf[t] = 0;
  const dRaw = Float32Array.from(d);
  const dSmooth = finalizeDisplacement(dRaw, conf, region, lf.geo, S.smoothMm);
  mark('post');

  let regionCount = 0;
  for (const v of region) regionCount += v;
  return {
    view: input.view,
    grid: g,
    region,
    dRaw,
    dSmooth,
    conf,
    camera: cam,
    cameraFit,
    light,
    stats: {
      cropW: W,
      cropH: H,
      texels: n,
      regionTexels: regionCount,
      chromaRejectedPixels: chromaRejected,
      lightResidual: lightFit.residualScale,
      lightAmp: light.amp,
      residualSigma: sigF,
      attachedShadowTexels: shadowTexels,
      creaseTexels,
    },
    timings: { ...timings, total: performance.now() - t0 },
    debug: r0
      ? {
          r0,
          valid: lf.valid,
          vis: lf.vis,
          energyAt: (dd: Float64Array) => {
            const Ld = sampleFine(dd);
            const w = new Float64Array(n);
            for (let t = 0; t < n; t++) w[t] = lf.valid[t];
            const gtmp = new Float64Array(n);
            const total = energy(geoF, { L: Ld, w, light }, terms, dd, gtmp);
            const data = energy(geoF, { L: Ld, w, light }, { lambdaS: 0, lambdaP: 0, d0: 1 }, dd, gtmp);
            return { total, data };
          },
          residualAt: (dd: Float64Array) => residuals(geoF, light, sampleFine(dd), dd, lf.valid),
          shadeAt: (dd: Float64Array) => {
            const z = new Float64Array(n);
            const all = new Uint8Array(n).fill(1);
            const r = residuals(geoF, light, z, dd, all);
            for (let t = 0; t < n; t++) r[t] = r[t] * light.amp;
            return r;
          },
        }
      : undefined,
  };
}

/** normal of the displaced surface, same model as the solver: n0·area + gt·(Ty×n0) + gy·(n0×Tt) */
function displacedNormal(geo: TexelGeom, d: ArrayLike<number>, i: number, j: number): [number, number, number] {
  const { nx, ny } = geo.grid;
  const k = j * nx + i;
  const il = Math.max(0, i - 1), ir = Math.min(nx - 1, i + 1);
  const jd = Math.max(0, j - 1), ju = Math.min(ny - 1, j + 1);
  const gt = (d[j * nx + ir] - d[j * nx + il]) / Math.max(1, ir - il);
  const gy = (d[ju * nx + i] - d[jd * nx + i]) / Math.max(1, ju - jd);
  const q = k * 3, N0 = geo.N, Tt = geo.Tt, Ty = geo.Ty, ar = geo.area[k];
  const n0x = N0[q], n0y = N0[q + 1], n0z = N0[q + 2];
  const Cx = Ty[q + 1] * n0z - Ty[q + 2] * n0y, Cy = Ty[q + 2] * n0x - Ty[q] * n0z, Cz = Ty[q] * n0y - Ty[q + 1] * n0x;
  const Dx = n0y * Tt[q + 2] - n0z * Tt[q + 1], Dy = n0z * Tt[q] - n0x * Tt[q + 2], Dz = n0x * Tt[q + 1] - n0y * Tt[q];
  const Nx = n0x * ar + gt * Cx + gy * Dx, Ny = n0y * ar + gt * Cy + gy * Dy, Nz = n0z * ar + gt * Cz + gy * Dz;
  const len = Math.hypot(Nx, Ny, Nz) || 1;
  return [Nx / len, Ny / len, Nz / len];
}

/** normalized shading residual (shade(n(d)) − L)/amp per texel (0 where not valid) */
export function residuals(geo: TexelGeom, light: Light, L: Float64Array, d: ArrayLike<number>, valid: Uint8Array, nScale?: Float64Array): Float64Array {
  const { nx, ny } = geo.grid;
  const out = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (!valid[k]) continue;
      const [x, y, z] = displacedNormal(geo, d, i, j);
      out[k] = (shadeGrad(light, x, y, z, nScale ? nScale[k] : 1)[0] - L[k]) / light.amp;
    }
  return out;
}

/** unit normals of the displaced surface on the grid */
export function currentNormals(geo: TexelGeom, d: ArrayLike<number>): Float64Array {
  const { nx, ny } = geo.grid;
  const out = new Float64Array(nx * ny * 3);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) out.set(displacedNormal(geo, d, i, j), (j * nx + i) * 3);
  return out;
}
