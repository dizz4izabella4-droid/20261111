import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Rig } from './rig';

export const HAND_JOINTS = ['wrist', 'thumb_cmc', 'thumb_mcp', 'thumb_ip', 'thumb_tip', 'index_mcp', 'index_pip', 'index_dip', 'index_tip', 'middle_mcp', 'middle_pip', 'middle_dip', 'middle_tip', 'ring_mcp', 'ring_pip', 'ring_dip', 'ring_tip', 'pinky_mcp', 'pinky_pip', 'pinky_dip', 'pinky_tip'] as const;
export const HAND_PARENTS = [-1, 0, 1, 2, 3, 0, 5, 6, 7, 0, 9, 10, 11, 0, 13, 14, 15, 0, 17, 18, 19];
export type HandSide = 'l' | 'r';
export interface HandClip {
  side: HandSide; fps: number; duration: number; frames: Float32Array[];
  restOffsets: [number, number, number][]; name: string;
}
export interface HandTrack { clip: HandClip; offset: number; wrist: boolean; }
export type HandTracks = Partial<Record<HandSide, HandTrack>>;

export function parseHandClip(value: unknown, name = '指モーション'): HandClip {
  const j = value as Record<string, any>;
  const vector = (x: unknown, size: number): x is number[] => Array.isArray(x) && x.length === size && x.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 10);
  if (!j || j.format !== 'hand-mocap-v1' || !['Left', 'Right'].includes(j.handedness)) throw new Error('「指モーション」のJSON（hand-mocap-v1）ではありません。');
  const side = j.handedness === 'Left' ? 'l' : 'r';
  if (!Number.isFinite(j.fps) || j.fps < 1 || j.fps > 120 || !Array.isArray(j.frames) || j.frames.length < 2 || j.frames.length > 300000 || !j.frames.every((f: unknown) => vector(f, 63))) throw new Error('指モーションのfpsまたはフレームが正しくありません。');
  if (!Array.isArray(j.joints) || j.joints.length !== 21 || j.joints.some((n: string, i: number) => n !== `${HAND_JOINTS[i]}_${side}`)
    || !Array.isArray(j.parents) || j.parents.length !== 21 || j.parents.some((p: number, i: number) => p !== HAND_PARENTS[i])) throw new Error('指モーションの関節名または親子関係が一致しません。');
  if (j.coord?.up !== 'Y' || j.coord?.unit !== 'meter' || j.coord?.origin !== 'wrist'
    || !Array.isArray(j.restOffsets) || j.restOffsets.length !== 21 || !j.restOffsets.every((v: unknown) => vector(v, 3))
    || j.restOffsets.slice(1).some((v: number[]) => Math.hypot(...v) < .001 || Math.hypot(...v) > .35)
    || j.frames.some((f: number[]) => Math.hypot(f[0], f[1], f[2]) > 1e-5)) throw new Error('指モーションの座標系・手首原点・骨の長さが正しくありません。');
  return { side, fps: j.fps, frames: j.frames.map((f: number[]) => Float32Array.from(f)), duration: (j.frames.length - 1) / j.fps, restOffsets: j.restOffsets.map((p: number[]) => [p[0], p[1], p[2]] as [number, number, number]), name };
}

export function sampleHand(clip: HandClip, seconds: number, loop: boolean): Float32Array {
  const t = seconds < 0 ? 0 : loop ? seconds % clip.duration : Math.min(seconds, clip.duration);
  const frame = Math.min(t * clip.fps, clip.frames.length - 1);
  const a = Math.floor(frame), b = Math.min(a + 1, clip.frames.length - 1), weight = frame - a;
  return Float32Array.from(clip.frames[a], (v, i) => v + (clip.frames[b][i] - v) * weight);
}

const point = (p: ArrayLike<number>, i: number) => new Vector3(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
function palm(points: ArrayLike<number>, side: HandSide): Quaternion | null {
  const y = point(points, 9).sub(point(points, 0));
  const x = point(points, 5).sub(point(points, 17)).multiplyScalar(side === 'r' ? -1 : 1);
  if (y.lengthSq() < 1e-12) return null;
  y.normalize(); x.addScaledVector(y, -x.dot(y));
  if (x.lengthSq() < 1e-12) return null;
  x.normalize(); const z = new Vector3().crossVectors(x, y).normalize();
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
}
function restPoints(clip: HandClip): Float32Array {
  const out = new Float32Array(63);
  for (let i = 1; i < 21; i++) point(out, HAND_PARENTS[i]).add(new Vector3(...clip.restOffsets[i])).toArray(out, i * 3);
  return out;
}
export function handCompatibility(rig: Rig, side: HandSide) {
  const missing = HAND_JOINTS.slice(1).map((n) => `${n}_${side}`).filter((n) => !rig.rest.has(n));
  return { missing, available: 20 - missing.length, wrist: rig.rest.has(`hand_${side}`) || rig.rest.has(`wrist_${side}`) };
}

/** Map landmark directions through palm space; never copy foreign bind-axis quaternions. */
export function applyHandTracks(rig: Rig, tracks: HandTracks, seconds: number, loop: boolean): void {
  for (const side of ['l', 'r'] as const) {
    const track = tracks[side];
    if (!track) continue;
    const wrist = rig.rest.get(`hand_${side}`) ?? rig.rest.get(`wrist_${side}`);
    if (!wrist) continue;
    const target = new Float32Array(63);
    wrist.pos.toArray(target, 0);
    for (let i = 1; i < 21; i++) (rig.rest.get(`${HAND_JOINTS[i]}_${side}`)?.pos ?? wrist.pos).toArray(target, i * 3);
    const targetPalm = palm(target, side);
    if (!targetPalm) continue; // Old bodies can still load and retain the hand clip.
    const points = sampleHand(track.clip, seconds - track.offset, loop);
    const capturedPalm = palm(points, side);
    if (!capturedPalm) continue;
    if (track.wrist) {
      const sourceRest = palm(restPoints(track.clip), side) ?? new Quaternion();
      const delta = targetPalm.clone().multiply(sourceRest.invert()).multiply(capturedPalm).multiply(targetPalm.clone().invert());
      const current = wrist.bone.getWorldQuaternion(new Quaternion()).multiply(wrist.quat.clone().invert());
      const desired = current.multiply(delta).multiply(wrist.quat);
      const parent = wrist.bone.parent?.getWorldQuaternion(new Quaternion()) ?? new Quaternion();
      wrist.bone.quaternion.copy(parent.invert().multiply(desired));
      wrist.bone.updateMatrixWorld(true);
    }
    const handDelta = wrist.bone.getWorldQuaternion(new Quaternion()).multiply(wrist.quat.clone().invert());
    const toBody = handDelta.multiply(targetPalm).multiply(capturedPalm.clone().invert());
    for (let i = 1; i < 21; i++) {
      if (i % 4 === 0) continue; // Tips inherit their parent; no measured direction follows a tip.
      const bone = rig.rest.get(`${HAND_JOINTS[i]}_${side}`), child = rig.rest.get(`${HAND_JOINTS[i + 1]}_${side}`);
      if (!bone || !child) continue;
      const desiredDir = point(points, i + 1).sub(point(points, i)).applyQuaternion(toBody);
      const restDir = child.pos.clone().sub(bone.pos);
      if (desiredDir.lengthSq() < 1e-12 || restDir.lengthSq() < 1e-12) continue;
      const parent = bone.bone.parent;
      const parentWorld = parent?.getWorldQuaternion(new Quaternion()) ?? new Quaternion();
      const parentRest = parent ? rig.rest.get(parent.name)?.quat ?? parentWorld : parentWorld;
      const inherited = parentWorld.clone().multiply(parentRest.clone().invert());
      const from = restDir.normalize().applyQuaternion(inherited);
      const world = new Quaternion().setFromUnitVectors(from, desiredDir.normalize()).multiply(inherited).multiply(bone.quat);
      bone.bone.quaternion.copy(parentWorld.invert().multiply(world));
      bone.bone.updateMatrixWorld(true);
    }
  }
  rig.scene.updateMatrixWorld(true);
}
