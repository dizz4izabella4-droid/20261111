import { Bone, Matrix4, Quaternion, Vector3 } from 'three';
import type { BodyMesh } from './body';
import { HAND_JOINTS, HAND_PARENTS } from './handRig';

export interface HandClip {
  format: 'hand-mocap-v1';
  handedness: 'Left' | 'Right';
  fps: number;
  frames: number[][];
  loop?: boolean;
}
export function parseHandClip(input: unknown): HandClip {
  const j = input as Record<string, any>;
  if (!j || j.format !== 'hand-mocap-v1' || !['Left', 'Right'].includes(j.handedness) || !Number.isFinite(j.fps) || j.fps < 1 || j.fps > 120
    || !Array.isArray(j.frames) || j.frames.length < 2 || j.frames.length > 300000
    || !j.frames.every((f: unknown) => Array.isArray(f) && f.length === 63 && f.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 10))
    || j.coord?.up !== 'Y' || j.coord?.unit !== 'meter' || j.coord?.origin !== 'wrist'
    || !Array.isArray(j.joints) || j.joints.length !== 21 || !Array.isArray(j.parents) || j.parents.length !== 21) throw new Error('指モーションの手用JSON（hand-mocap-v1）ではありません。');
  const side = j.handedness === 'Left' ? 'l' : 'r';
  if (HAND_JOINTS.some((name, i) => j.joints[i] !== `${name}_${side}` || j.parents[i] !== HAND_PARENTS[i])) throw new Error('手の関節名・親子関係が一致しません。');
  return j as unknown as HandClip;
}

/** Retarget wrist-relative captured directions; never copy positions or local
 * quaternions onto a differently sized/bound hand. The body's wrist pose is retained. */
export function applyHandFrame(body: BodyMesh, bones: Bone[], clip: HandClip, seconds: number): void {
  const side = clip.handedness === 'Left' ? 'l' : 'r';
  const lookup = new Map(bones.map((b) => [b.name, b]));
  const last = clip.frames.length - 1;
  let k = Math.max(0, seconds * clip.fps); k = clip.loop && last > 0 ? k % last : Math.min(last, k);
  const a = Math.floor(k), b = Math.min(last, a + 1), t = k - a;
  const frame = HAND_JOINTS.map((_, i) => new Vector3().fromArray(clip.frames[a], i * 3).lerp(new Vector3().fromArray(clip.frames[b], i * 3), t));
  const y = frame[9].clone().sub(frame[0]).normalize();
  const x = frame[5].clone().sub(frame[17]).multiplyScalar(side === 'l' ? 1 : -1); x.addScaledVector(y, -x.dot(y)).normalize();
  const z = x.clone().cross(y).normalize();
  if (x.lengthSq() < 0.5 || y.lengthSq() < 0.5 || z.lengthSq() < 0.5) return;
  const captureBasis = new Matrix4().makeBasis(x, z.clone().cross(x).normalize(), z).invert();
  const restPoint = (name: string) => new Vector3(...body.bones.find((bn) => bn.name === `${name}_${side}`)!.head);
  const along = restPoint('middle_mcp').sub(restPoint('hand')).normalize();
  const across = restPoint('index_mcp').sub(restPoint('pinky_mcp')).multiplyScalar(side === 'l' ? 1 : -1);
  across.addScaledVector(along, -across.dot(along)).normalize();
  const dorsal = across.clone().cross(along).normalize();
  const wristRotation = lookup.get(`hand_${side}`)!.getWorldQuaternion(new Quaternion());
  for (let i = 1; i < HAND_JOINTS.length; i++) {
    const joint = lookup.get(`${HAND_JOINTS[i]}_${side}`)!; joint.quaternion.identity();
    if (i % 4 === 0) continue;
    const from = body.bones.find((bn) => bn.name === joint.name)!, to = body.bones.find((bn) => bn.name === `${HAND_JOINTS[i + 1]}_${side}`)!;
    const direction = frame[i + 1].clone().sub(frame[i]).transformDirection(captureBasis);
    if (direction.lengthSq() < 1e-12) continue;
    const target = across.clone().multiplyScalar(direction.x).addScaledVector(along, direction.y).addScaledVector(dorsal, direction.z).applyQuaternion(wristRotation).normalize();
    const parent = joint.parent!.getWorldQuaternion(new Quaternion());
    const rest = new Vector3(...to.head).sub(new Vector3(...from.head)).normalize().applyQuaternion(parent);
    const correction = new Quaternion().setFromUnitVectors(rest, target);
    joint.quaternion.copy(parent.clone().invert().multiply(correction).multiply(parent)); joint.updateMatrixWorld(true);
  }
}
