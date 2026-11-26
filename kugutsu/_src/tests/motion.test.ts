// 傀儡: read the sample body GLBs (written by スペアボディ) and check that motion is applied correctly.
import { describe, expect, it, afterAll } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { parseClip, sampleJoints, J, JOINT_NAMES } from '../src/motion/clip';
import { rigFromScene, resetRig, type Rig } from '../src/motion/rig';
import { applyPose, computePose } from '../src/motion/retarget';
import { demoClip } from '../src/motion/demo';

const results: Record<string, unknown> = {};
afterAll(() => {
  mkdirSync('test-output', { recursive: true });
  writeFileSync('test-output/motion-metrics.json', JSON.stringify(results, null, 2));
});

async function loadRig(file: string): Promise<Rig> {
  const buf = readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const gltf: any = await new Promise((res, rej) => new GLTFLoader().parse(ab, '', res, rej));
  return rigFromScene(gltf.scene);
}

const jv = (p: ArrayLike<number>, i: number) => new Vector3(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
const deg = (a: Vector3, b: Vector3) => (a.clone().normalize().angleTo(b.clone().normalize()) * 180) / Math.PI;
const wpos = (rig: Rig, n: string) => new Vector3().setFromMatrixPosition(rig.rest.get(n)!.bone.matrixWorld);

/** joints placed exactly on the rig's rest pose */
function restJoints(rig: Rig): Float32Array {
  const head = (n: string) => rig.rest.get(n)!.pos.clone();
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
    set(J[`${s}_ankle`], head(`foot_${s}`));
    set(J[`${s}_foot`], head(`toe_${s}`));
    set(J[`${s}_ear`], head('head').add(new Vector3(s === 'l' ? 0.07 : -0.07, 0.05, 0)));
  }
  return out;
}

const SAMPLES = ['male', 'female'].map((n) => [n, `public/samples/spare_body_${n}.glb`] as const);

describe('reading files', () => {
  it('motion JSON: accepts the sample and rejects broken files', () => {
    const c = parseClip(JSON.parse(readFileSync('public/samples/sample_motion_walk_wave.json', 'utf8')));
    expect(c.frames.length).toBe(180);
    expect(() => parseClip({ format: 'other' })).toThrow();
    expect(() => parseClip({ format: 'dizz-mocap-v1', fps: 30, frames: [[1, 2, 3]] })).toThrow();
    expect(() => parseClip({ format: 'dizz-mocap-v1', fps: 0, frames: [new Array(99).fill(0)] })).toThrow();
    expect(JOINT_NAMES.length).toBe(33);
  });
  for (const [name, file] of SAMPLES)
    it(`body GLB (${name}): skinned mesh with all bones`, async () => {
      const rig = await loadRig(file);
      expect(rig.missing).toEqual([]);
      expect(rig.toe.l && rig.toe.r).toBeTruthy();
      results[`rig/${name}`] = { bones: rig.rest.size, height_cm: rig.height * 100 };
    });
});

describe('retargeting onto the loaded GLB', () => {
  for (const [name, file] of SAMPLES) {
    it(`${name}: joints on the rest pose give no change`, async () => {
      const rig = await loadRig(file);
      applyPose(rig, computePose(rig, restJoints(rig), null, null));
      let max = 0;
      for (const r of rig.rest.values()) {
        max = Math.max(max, wpos(rig, r.bone.name).distanceTo(r.pos));
      }
      results[`restIdentity/${name}_maxMoveMm`] = max * 1000;
      expect(max).toBeLessThan(1e-5);
    });
    it(`${name}: every frame of the sample points the bones like the capture`, async () => {
      const rig = await loadRig(file);
      const c = parseClip(demoClip());
      let maxLimb = 0, maxTorso = 0;
      const t0 = performance.now();
      for (let f = 0; f < c.frames.length; f++) {
        const s = sampleJoints(c, f / c.fps, false);
        applyPose(rig, computePose(rig, s.joints, s.root, c.root ? c.root[0] : null));
        const p = s.joints;
        for (const sd of ['l', 'r'] as const) {
          const pairs: [string, string, number, number][] = [
            [`upperarm_${sd}`, `forearm_${sd}`, J[`${sd}_shoulder`], J[`${sd}_elbow`]],
            [`forearm_${sd}`, `hand_${sd}`, J[`${sd}_elbow`], J[`${sd}_wrist`]],
            [`thigh_${sd}`, `shin_${sd}`, J[`${sd}_hip`], J[`${sd}_knee`]],
            [`shin_${sd}`, `foot_${sd}`, J[`${sd}_knee`], J[`${sd}_ankle`]],
            [`foot_${sd}`, `toe_${sd}`, J[`${sd}_ankle`], J[`${sd}_foot`]],
          ];
          for (const [a, b, ja, jb] of pairs) maxLimb = Math.max(maxLimb, deg(wpos(rig, b).sub(wpos(rig, a)), jv(p, jb).sub(jv(p, ja))));
        }
        maxTorso = Math.max(
          maxTorso,
          deg(wpos(rig, 'thigh_l').sub(wpos(rig, 'thigh_r')), jv(p, J.l_hip).sub(jv(p, J.r_hip))),
          deg(wpos(rig, 'upperarm_l').sub(wpos(rig, 'upperarm_r')), jv(p, J.l_shoulder).sub(jv(p, J.r_shoulder))),
        );
      }
      const ms = (performance.now() - t0) / c.frames.length;
      results[`sample/${name}`] = { maxLimbErrorDeg: maxLimb, maxTorsoErrorDeg: maxTorso, msPerFrame: ms };
      expect(maxLimb).toBeLessThan(0.5);
      expect(maxTorso).toBeLessThan(0.5);
      resetRig(rig);
      let back = 0;
      for (const r of rig.rest.values()) back = Math.max(back, wpos(rig, r.bone.name).distanceTo(r.pos));
      expect(back).toBeLessThan(1e-9); // 立ち姿に戻す
    });
  }
});
