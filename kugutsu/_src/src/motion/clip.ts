// Motion clips saved by the "モーション" tool: format "dizz-mocap-v1".
//   fps, frames: per frame 33 joints × (x, y, z) in meters (three.js y-up, the person faces +z,
//   l_ = the person's left = +x), optional root: per frame [x, y, z] translation of the body.
// The joint order is MediaPipe Pose (33 landmarks).

export const JOINT_NAMES = [
  'nose', 'l_eye_in', 'l_eye', 'l_eye_out', 'r_eye_in', 'r_eye', 'r_eye_out', 'l_ear', 'r_ear', 'mouth_l', 'mouth_r',
  'l_shoulder', 'r_shoulder', 'l_elbow', 'r_elbow', 'l_wrist', 'r_wrist', 'l_pinky', 'r_pinky', 'l_index', 'r_index',
  'l_thumb', 'r_thumb', 'l_hip', 'r_hip', 'l_knee', 'r_knee', 'l_ankle', 'r_ankle', 'l_heel', 'r_heel', 'l_foot', 'r_foot',
] as const;
export type JointName = (typeof JOINT_NAMES)[number];
export const J = Object.fromEntries(JOINT_NAMES.map((n, i) => [n, i])) as Record<JointName, number>;

export interface MotionClip {
  fps: number;
  /** per frame: 99 numbers (33 joints × xyz) */
  frames: Float32Array[];
  /** per frame body translation, or null */
  root: [number, number, number][] | null;
  duration: number;
  name?: string;
}

export interface MotionJson {
  format: 'dizz-mocap-v1';
  fps: number;
  frames: number[][];
  joints?: string[];
  root?: number[][];
  [k: string]: unknown;
}

const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

/** validate and convert; throws an Error with a Japanese message */
export function parseClip(j: unknown, name?: string): MotionClip {
  const o = j as MotionJson;
  if (!o || typeof o !== 'object' || o.format !== 'dizz-mocap-v1') throw new Error('「モーション」で保存した JSON（dizz-mocap-v1）ではありません。');
  if (!finite(o.fps) || o.fps <= 0) throw new Error('fps が正しくありません。');
  if (!Array.isArray(o.frames) || o.frames.length < 1) throw new Error('フレームがありません。');
  if (!o.frames.every((f) => Array.isArray(f) && f.length === 99 && f.every(finite))) throw new Error('フレームの形式が正しくありません（33関節×3）。');
  if (o.joints && (o.joints.length !== 33 || o.joints.some((n, i) => n !== JOINT_NAMES[i]))) throw new Error('関節の並びが想定と違います。');
  let root: [number, number, number][] | null = null;
  if (o.root != null) {
    if (!Array.isArray(o.root) || o.root.length !== o.frames.length || !o.root.every((r) => Array.isArray(r) && r.length === 3 && r.every(finite)))
      throw new Error('移動量（root）の形式が正しくありません。');
    root = o.root.map((r) => [r[0], r[1], r[2]]);
  }
  const frames = o.frames.map((f) => Float32Array.from(f));
  return { fps: o.fps, frames, root, duration: frames.length / o.fps, name };
}

/** joint positions at time t (seconds), linearly interpolated; `out` has 99 numbers */
export function sampleJoints(c: MotionClip, t: number, loop: boolean, out = new Float32Array(99)): { joints: Float32Array; root: [number, number, number] | null; frame: number } {
  const n = c.frames.length;
  let f = t * c.fps;
  if (loop) f = ((f % n) + n) % n;
  else f = Math.min(Math.max(f, 0), n - 1);
  const i0 = Math.floor(f);
  const i1 = loop ? (i0 + 1) % n : Math.min(n - 1, i0 + 1);
  const w = f - i0;
  const a = c.frames[i0], b = c.frames[i1];
  for (let k = 0; k < 99; k++) out[k] = a[k] * (1 - w) + b[k] * w;
  let root: [number, number, number] | null = null;
  if (c.root) {
    const ra = c.root[i0], rb = c.root[i1];
    root = [ra[0] * (1 - w) + rb[0] * w, ra[1] * (1 - w) + rb[1] * w, ra[2] * (1 - w) + rb[2] * w];
  }
  return { joints: out, root, frame: i0 };
}
