// Weak-perspective (scaled orthographic) camera and robust landmark fit (SPEC 6.4).
//   Xc = R·X,  R = Rz(roll)·Rx(pitch)·Ry(yaw)
//   u = s·Xc.x + tx,  v = −s·Xc.y + ty      (image pixels, v downward)
//   depth = Xc.z (larger = closer to the camera); direction toward the camera (world) = Rᵀ·(0,0,1)

export type ViewId = 'front' | 'back' | 'left' | 'right' | 'obliqueLeft' | 'obliqueRight';

export const VIEW_LABELS: Record<ViewId, string> = {
  front: '正面',
  back: '背面',
  left: '左側面',
  right: '右側面',
  obliqueLeft: '斜め（左前）',
  obliqueRight: '斜め（右前）',
};

/** nominal yaw so that the named side of the model faces the camera */
export const NOMINAL_YAW: Record<ViewId, number> = {
  front: 0,
  back: Math.PI,
  left: -Math.PI / 2, // model's left (+X) toward the camera
  right: Math.PI / 2,
  obliqueLeft: -Math.PI / 4,
  obliqueRight: Math.PI / 4,
};

export interface Camera {
  yaw: number;
  pitch: number;
  roll: number;
  /** pixels per meter */
  s: number;
  tx: number;
  ty: number;
}

export type Mat3 = [number, number, number, number, number, number, number, number, number];

export function rotation(c: Pick<Camera, 'yaw' | 'pitch' | 'roll'>): Mat3 {
  const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
  const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
  const cr = Math.cos(c.roll), sr = Math.sin(c.roll);
  // Ry
  const Ry: Mat3 = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const Rx: Mat3 = [1, 0, 0, 0, cp, -sp, 0, sp, cp];
  const Rz: Mat3 = [cr, -sr, 0, sr, cr, 0, 0, 0, 1];
  return mul(Rz, mul(Rx, Ry));
}

function mul(a: Mat3, b: Mat3): Mat3 {
  const o = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return o;
}

export class Projector {
  readonly R: Mat3;
  constructor(readonly cam: Camera) {
    this.R = rotation(cam);
  }
  /** [u, v, depth] */
  project(x: number, y: number, z: number): [number, number, number] {
    const R = this.R;
    const cx = R[0] * x + R[1] * y + R[2] * z;
    const cy = R[3] * x + R[4] * y + R[5] * z;
    const cz = R[6] * x + R[7] * y + R[8] * z;
    return [this.cam.s * cx + this.cam.tx, -this.cam.s * cy + this.cam.ty, cz];
  }
  /** unit vector from the model toward the camera (world coordinates) */
  viewDir(): [number, number, number] {
    const R = this.R;
    return [R[6], R[7], R[8]];
  }
}

export interface LandmarkPair {
  id: string;
  X: [number, number, number];
  x: [number, number];
}

export interface CameraFit {
  camera: Camera;
  residuals: Record<string, number>; // pixels
  rms: number;
  maxResidual: number;
}

function residualVector(c: Camera, pairs: LandmarkPair[]): number[] {
  const P = new Projector(c);
  const r: number[] = [];
  for (const p of pairs) {
    const [u, v] = P.project(p.X[0], p.X[1], p.X[2]);
    r.push(u - p.x[0], v - p.x[1]);
  }
  return r;
}

/** best scale/translation for a fixed rotation (closed-form least squares) */
function fitScaleTranslation(rot: Pick<Camera, 'yaw' | 'pitch' | 'roll'>, pairs: LandmarkPair[]): Camera {
  const R = rotation(rot);
  const a = pairs.map((p) => R[0] * p.X[0] + R[1] * p.X[1] + R[2] * p.X[2]);
  const b = pairs.map((p) => R[3] * p.X[0] + R[4] * p.X[1] + R[5] * p.X[2]);
  const n = pairs.length;
  const am = a.reduce((s, v) => s + v, 0) / n;
  const bm = b.reduce((s, v) => s + v, 0) / n;
  const um = pairs.reduce((s, p) => s + p.x[0], 0) / n;
  const vm = pairs.reduce((s, p) => s + p.x[1], 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - am) * (pairs[i].x[0] - um) - (b[i] - bm) * (pairs[i].x[1] - vm);
    den += (a[i] - am) ** 2 + (b[i] - bm) ** 2;
  }
  const s = den > 0 ? num / den : 1;
  return { ...rot, s, tx: um - s * am, ty: vm + s * bm };
}

/** solve n×n linear system (small, dense) */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
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
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
}

/**
 * Robust (Huber IRLS) Levenberg–Marquardt fit of yaw, pitch, roll, s, tx, ty.
 * Starts from the nominal yaw of the view. Needs >= 4 landmarks.
 */
export function fitCamera(pairs: LandmarkPair[], view: ViewId, imageLongSide: number): CameraFit {
  if (pairs.length < 4) throw new Error('目印が4点以上必要です');
  const delta = Math.max(2, 0.005 * imageLongSide);
  let cam = fitScaleTranslation({ yaw: NOMINAL_YAW[view], pitch: 0, roll: 0 }, pairs);
  const keys: (keyof Camera)[] = ['yaw', 'pitch', 'roll', 's', 'tx', 'ty'];
  let lambda = 1e-3;
  const cost = (c: Camera, w: number[]) => residualVector(c, pairs).reduce((s, r, i) => s + w[i] * r * r, 0);
  for (let it = 0; it < 60; it++) {
    const r = residualVector(cam, pairs);
    const w = r.map((_, i) => {
      const e = Math.hypot(r[i - (i % 2)], r[i - (i % 2) + 1]);
      return e <= delta ? 1 : delta / e; // Huber weight per landmark
    });
    // numeric Jacobian
    const J: number[][] = r.map(() => new Array(6).fill(0));
    for (let k = 0; k < 6; k++) {
      const key = keys[k];
      const h = key === 's' ? cam.s * 1e-5 : key === 'tx' || key === 'ty' ? 1e-3 : 1e-6;
      const c2 = { ...cam, [key]: cam[key] + h };
      const r2 = residualVector(c2, pairs);
      for (let i = 0; i < r.length; i++) J[i][k] = (r2[i] - r[i]) / h;
    }
    // scale-normalize columns for conditioning
    const colScale = keys.map((_, k) => Math.sqrt(J.reduce((s, row, i) => s + w[i] * row[k] * row[k], 0)) || 1);
    const A: number[][] = keys.map(() => new Array(6).fill(0));
    const g: number[] = new Array(6).fill(0);
    for (let i = 0; i < r.length; i++)
      for (let a = 0; a < 6; a++) {
        g[a] -= (w[i] * J[i][a] * r[i]) / colScale[a];
        for (let b = 0; b < 6; b++) A[a][b] += (w[i] * J[i][a] * J[i][b]) / (colScale[a] * colScale[b]);
      }
    const c0 = cost(cam, w);
    let improved = false;
    for (let tries = 0; tries < 8; tries++) {
      const Ad = A.map((row, a) => row.map((v, b) => (a === b ? v * (1 + lambda) + 1e-12 : v)));
      const dx = solve(Ad, g).map((v, k) => v / colScale[k]);
      const c2: Camera = { ...cam };
      keys.forEach((k, i) => (c2[k] = cam[k] + dx[i]));
      if (cost(c2, w) < c0) {
        cam = c2;
        lambda = Math.max(1e-9, lambda / 3);
        improved = true;
        break;
      }
      lambda *= 5;
    }
    if (!improved) break;
  }
  const r = residualVector(cam, pairs);
  const residuals: Record<string, number> = {};
  let sum = 0;
  let max = 0;
  pairs.forEach((p, i) => {
    const e = Math.hypot(r[2 * i], r[2 * i + 1]);
    residuals[p.id] = e;
    sum += e * e;
    max = Math.max(max, e);
  });
  return { camera: cam, residuals, rms: Math.sqrt(sum / pairs.length), maxResidual: max };
}
