import { describe, expect, it, afterAll } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Bone, Quaternion, Skeleton, Vector3 } from 'three';
import { presetParams } from '../src/model/params';
import { buildBody, BONE_NAMES, type BodyMesh } from '../src/model/body';
import { parseClip, sampleJoints, J, JOINT_NAMES } from '../src/motion/clip';
import { computePose, type Pose } from '../src/motion/retarget';
import { demoClip } from '../src/motion/demo';

const results: Record<string, unknown> = {};
afterAll(() => {
  mkdirSync('test-output', { recursive: true });
  writeFileSync('test-output/motion-metrics.json', JSON.stringify(results, null, 2));
});

/** the same bone hierarchy as the viewer, posed */
function posedSkeleton(b: BodyMesh, pose: Pose) {
  const bones = b.bones.map((bi) => Object.assign(new Bone(), { name: bi.name }));
  b.bones.forEach((bi, i) => {
    const ph = bi.parent >= 0 ? b.bones[bi.parent].head : [0, 0, 0];
    bones[i].position.set(bi.head[0] - ph[0], bi.head[1] - ph[1], bi.head[2] - ph[2]);
    if (bi.parent >= 0) bones[bi.parent].add(bones[i]);
  });
  new Skeleton(bones);
  bones.forEach((bn, i) => bn.quaternion.copy(pose.local[i]));
  bones[0].position.copy(pose.hips);
  bones[0].updateMatrixWorld(true);
  const pos = (n: string) => new Vector3().setFromMatrixPosition(bones[BONE_NAMES.indexOf(n as never)].matrixWorld);
  const quat = (n: string) => new Quaternion().setFromRotationMatrix(bones[BONE_NAMES.indexOf(n as never)].matrixWorld);
  return { pos, quat };
}

const jv = (p: ArrayLike<number>, i: number) => new Vector3(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
const deg = (a: Vector3, b: Vector3) => (a.clone().normalize().angleTo(b.clone().normalize()) * 180) / Math.PI;

/** joints placed exactly on the body's rest pose */
function restJoints(b: BodyMesh): Float32Array {
  const head = (n: string) => new Vector3(...b.bones.find((x) => x.name === n)!.head);
  const out = new Float32Array(99);
  const set = (i: number, v: Vector3) => out.set([v.x, v.y, v.z], i * 3);
  for (const s of ['l', 'r'] as const) {
    set(J[`${s}_shoulder`], head(`upperarm_${s}`));
    set(J[`${s}_elbow`], head(`forearm_${s}`));
    const wr = head(`hand_${s}`);
    set(J[`${s}_wrist`], wr);
    const dir = wr.clone().sub(head(`forearm_${s}`)).normalize();
    set(J[`${s}_index`], wr.clone().addScaledVector(dir, 0.08).add(new Vector3(0, 0, 0.02)));
    set(J[`${s}_pinky`], wr.clone().addScaledVector(dir, 0.08).add(new Vector3(0, 0, -0.02)));
    set(J[`${s}_hip`], head(`thigh_${s}`));
    set(J[`${s}_knee`], head(`shin_${s}`));
    const an = head(`foot_${s}`);
    set(J[`${s}_ankle`], an);
    set(J[`${s}_foot`], an.clone().add(new Vector3(0, -an.y, 0.75 * b.footLength)));
    set(J[`${s}_ear`], head('head').add(new Vector3(s === 'l' ? 0.07 : -0.07, 0.05, 0)));
  }
  return out;
}

const bodies: [string, BodyMesh][] = [['male', buildBody(presetParams('male'), 'light')], ['female', buildBody(presetParams('female'), 'light')]];

describe('reading motion JSON', () => {
  it('accepts the sample clip and rejects broken files', () => {
    const c = parseClip(demoClip());
    expect(c.frames.length).toBe(180);
    expect(c.fps).toBe(30);
    expect(() => parseClip({ format: 'other' })).toThrow();
    expect(() => parseClip({ format: 'dizz-mocap-v1', fps: 30, frames: [[1, 2, 3]] })).toThrow();
    expect(() => parseClip({ format: 'dizz-mocap-v1', fps: 0, frames: [new Array(99).fill(0)] })).toThrow();
    expect(() => parseClip({ format: 'dizz-mocap-v1', fps: 30, frames: [new Array(99).fill(0)], joints: ['x'] })).toThrow();
    expect(JOINT_NAMES.length).toBe(33);
  });
});

describe('retargeting', () => {
  for (const [name, b] of bodies) {
    it(`${name}: joints on the rest pose give no rotation`, () => {
      const pose = computePose(b, restJoints(b), null, null);
      let max = 0;
      for (const q of pose.local) max = Math.max(max, (2 * Math.acos(Math.min(1, Math.abs(q.w))) * 180) / Math.PI);
      results[`restIdentity/${name}_maxDeg`] = max;
      expect(max).toBeLessThan(0.1);
    });
    it(`${name}: every frame of the sample points the bones like the capture`, () => {
      const c = parseClip(demoClip());
      let maxLimb = 0, maxTorso = 0;
      const t0 = performance.now();
      for (let f = 0; f < c.frames.length; f++) {
        const s = sampleJoints(c, f / c.fps, false);
        const pose = computePose(b, s.joints, s.root, c.root ? c.root[0] : null);
        const sk = posedSkeleton(b, pose);
        const p = s.joints;
        for (const sd of ['l', 'r'] as const) {
          const pairs: [string, string, number, number][] = [
            [`upperarm_${sd}`, `forearm_${sd}`, J[`${sd}_shoulder`], J[`${sd}_elbow`]],
            [`forearm_${sd}`, `hand_${sd}`, J[`${sd}_elbow`], J[`${sd}_wrist`]],
            [`thigh_${sd}`, `shin_${sd}`, J[`${sd}_hip`], J[`${sd}_knee`]],
            [`shin_${sd}`, `foot_${sd}`, J[`${sd}_knee`], J[`${sd}_ankle`]],
          ];
          for (const [a, bb, ja, jb] of pairs) maxLimb = Math.max(maxLimb, deg(sk.pos(bb).sub(sk.pos(a)), jv(p, jb).sub(jv(p, ja))));
        }
        // hips / chest: the body's hip / shoulder line follows the captured one
        const xh = sk.pos('thigh_l').sub(sk.pos('thigh_r'));
        const xc = sk.pos('upperarm_l').sub(sk.pos('upperarm_r'));
        maxTorso = Math.max(maxTorso, deg(xh, jv(p, J.l_hip).sub(jv(p, J.r_hip))), deg(xc, jv(p, J.l_shoulder).sub(jv(p, J.r_shoulder))));
      }
      const ms = (performance.now() - t0) / c.frames.length;
      results[`sample/${name}`] = { maxLimbErrorDeg: maxLimb, maxTorsoErrorDeg: maxTorso, msPerFrame: ms };
      expect(maxLimb).toBeLessThan(0.5);
      expect(maxTorso).toBeLessThan(0.5);
    });
  }
});
