import { describe, expect, it } from 'vitest';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Vector3 } from 'three';
import { buildBody } from '../src/model/body';
import { presetParams } from '../src/model/params';
import { FINGERS, HAND_JOINTS, HAND_PARENTS } from '../src/model/handRig';
import { applyPreviewPose, restPose } from '../src/model/pose';
import { parseHandClip, applyHandFrame } from '../src/model/handMotion';
import { exportHandGlb } from '../src/export/exportHand';
import { exportBodyGlb } from '../src/export/exportBody';
import { watertight } from './geom';

const read = (glb: ArrayBuffer): Promise<any> => new Promise((resolve, reject) => new GLTFLoader().parse(glb, '', resolve, reject));

describe('detailed female hands', () => {
  for (const side of ['l', 'r'] as const) it(`${side}: closed standalone hand, 21 capture joints, no softness`, async () => {
    const body = buildBody(presetParams('female'), 'standard');
    const gltf = await read(exportHandGlb(body, side)), mesh = gltf.scene.getObjectByProperty('isSkinnedMesh', true);
    expect(mesh.skeleton.bones.map((b: any) => b.name)).toEqual(HAND_JOINTS.map((name) => `${name}_${side}`));
    const g = mesh.geometry;
    expect(g.getAttribute('position').count).toBeGreaterThan(4000);
    expect(g.getAttribute('_softness')).toBeUndefined(); expect(g.getAttribute('_damping')).toBeUndefined();
    const quality = watertight({ positions: g.getAttribute('position').array, indices: g.index.array });
    expect(quality.badEdges).toBe(0); expect(quality.inconsistentEdges).toBe(0); expect(quality.degenerate).toBe(0); expect(quality.signedVolume).toBeGreaterThan(0);
    expect(gltf.parser.json.scenes[0].extras.parents).toEqual([...HAND_PARENTS]);
    gltf.scene.updateMatrixWorld(true);
    const wrist = mesh.skeleton.bones[0].getWorldPosition(new Vector3()); expect(wrist.length()).toBeLessThan(1e-7);
    const tip = mesh.skeleton.bones[12].getWorldPosition(new Vector3()); expect(tip.y).toBeCloseTo(0.16, 5);
  });

  it('each finger has weights on its three moving joints, including distal fingertips', () => {
    const body = buildBody(presetParams('female'), 'standard');
    for (const side of ['l', 'r']) for (const name of HAND_JOINTS.slice(1).filter((n) => !n.endsWith('_tip'))) {
      const index = body.bones.findIndex((b) => b.name === `${name}_${side}`);
      let affected = 0; for (let i = 0; i < body.skinIndex.length; i++) if (body.skinIndex[i] === index && body.skinWeight[i] > 0.01) affected++;
      expect(affected, `${name}_${side}`).toBeGreaterThan(20);
    }
  });

  it('captured directions reproduce a flexed hand after rest-axis and size conversion', async () => {
    const params = presetParams('female'), body = buildBody(params, 'light');
    const gltf = await read(exportBodyGlb(body, params)), mesh = gltf.scene.getObjectByProperty('isSkinnedMesh', true);
    const bones = mesh.skeleton.bones;
    for (const side of ['l', 'r'] as const) {
      const get = (name: string) => bones.find((b: any) => b.name === `${name === 'wrist' ? 'hand' : name}_${side}`);
      const sample = () => {
        gltf.scene.updateMatrixWorld(true); const origin = get('wrist').getWorldPosition(new Vector3());
        return HAND_JOINTS.flatMap((name) => get(name).getWorldPosition(new Vector3()).sub(origin).toArray());
      };
      applyPreviewPose(body, bones, restPose()); const neutral = sample();
      applyPreviewPose(body, bones, { ...restPose(), thumb: 45, index: 65, middle: 55, ring: 60, pinky: 70 }); const curled = sample();
      const clip = parseHandClip({ format: 'hand-mocap-v1', handedness: side === 'l' ? 'Left' : 'Right', fps: 30, frames: [neutral.map((v) => v * 1.4), curled.map((v) => v * 1.4)],
        coord: { up: 'Y', unit: 'meter', origin: 'wrist' }, joints: HAND_JOINTS.map((n) => `${n}_${side}`), parents: [...HAND_PARENTS] });
      applyPreviewPose(body, bones, restPose()); applyHandFrame(body, bones, clip, 1 / 30); const reproduced = sample();
      let error = 0; for (let i = 0; i < curled.length; i++) error = Math.max(error, Math.abs(curled[i] - reproduced[i]));
      expect(error).toBeLessThan(1e-5);
      expect(new Vector3().fromArray(curled, 8 * 3).distanceTo(new Vector3().fromArray(neutral, 8 * 3))).toBeGreaterThan(0.02);
    }
  });

  it('rejects a body settings file and a hand clip with a mismatched joint chain', () => {
    expect(() => parseHandClip({ format: 'spare-body-settings-v1' })).toThrow();
    expect(() => parseHandClip({ format: 'hand-mocap-v1', handedness: 'Left', fps: 30, frames: [new Array(63).fill(0), new Array(63).fill(0)],
      coord: { up: 'Y', unit: 'meter', origin: 'wrist' }, joints: [], parents: [] })).toThrow();
  });
  it('shapes each finger while keeping the palm root and other fingertips fixed', () => {
    const params = presetParams('female'), base = buildBody(params, 'light');
    for (const [f, finger] of FINGERS.entries()) {
      const start = 1 + f * 4;
      const point = (body: typeof base, n: number) => new Vector3(...body.bones.find((b) => b.name === `${HAND_JOINTS[n]}_l`)!.head);
      const root = point(base, start), original = point(base, start + 3).distanceTo(root);
      const longer = buildBody({ ...params, [`${finger}Length`]: 125 }, 'light');
      expect(point(longer, start).distanceTo(root)).toBeLessThan(1e-8);
      expect(point(longer, start + 3).distanceTo(root) / original).toBeCloseTo(1.25, 5);
      const other = 1 + ((f + 1) % 5) * 4 + 3;
      expect(point(longer, other).distanceTo(point(base, other))).toBeLessThan(1e-8);
      const wider = buildBody({ ...params, [`${finger}Width`]: 110 }, 'light');
      expect(wider.positions.some((x, i) => Math.abs(x - base.positions[i]) > 1e-5)).toBe(true);
      expect(watertight(wider).badEdges).toBe(0);
    }
  });
  it('exports a closed full body with shaped fingers and the capture mapping', async () => {
    const params = { ...presetParams('female'), thumbLength: 70, pinkyLength: 130, indexWidth: 115, fingerTaper: 55, knuckleProminence: 18 };
    const body = buildBody(params, 'standard'), quality = watertight(body);
    expect(quality.badEdges).toBe(0); expect(quality.inconsistentEdges).toBe(0); expect(quality.degenerate).toBe(0);
    const gltf = await read(exportBodyGlb(body, params));
    const rig = gltf.parser.json.scenes[0].extras.handRig;
    expect(rig.motionFormat).toBe('hand-mocap-v1');
    expect(rig.maps.Left.wrist_l).toBe('hand_l');
    expect(rig.parents).toEqual([...HAND_PARENTS]);
  });

});
