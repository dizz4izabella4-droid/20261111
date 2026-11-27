import { afterAll, describe, expect, it, vi } from 'vitest';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { AnimationMixer, Bone, LoopOnce, Matrix4, Quaternion, Skeleton, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { applyHandTracks, handCompatibility, HAND_JOINTS, HAND_PARENTS, parseHandClip, sampleHand, type HandClip, type HandTracks } from '../src/motion/hand';
import { getTimeline } from '../src/motion/timeline';
import { rigFromScene, resetRig, type Rig } from '../src/motion/rig';
import { parseClip, sampleJoints } from '../src/motion/clip';
import { applyPose, computePose } from '../src/motion/retarget';
import { sampleClips } from '../src/motion/demo';
import { exportAnimatedGlb } from '../src/motion/export';

vi.stubGlobal('FileReader', class {
  result: ArrayBuffer | null = null; onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob) { void blob.arrayBuffer().then((b) => { this.result = b; this.onloadend?.(); }); }
});
afterAll(() => vi.unstubAllGlobals());
const handJson = (side: 'l' | 'r') => JSON.parse(readFileSync(`public/samples/sample_hand_${side === 'l' ? 'left' : 'right'}.json`, 'utf8'));
const hand = (side: 'l' | 'r') => parseHandClip(handJson(side), `hand_${side}.json`);
function restPositions(clip: HandClip) {
  const positions = [new Vector3()];
  for (let i = 1; i < 21; i++) positions.push(positions[HAND_PARENTS[i]].clone().add(new Vector3(...clip.restOffsets[i])));
  return positions;
}
async function plainRig() {
  const bytes = readFileSync('public/samples/spare_body_male.glb');
  return rigFromScene((await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene);
}

/** Contract fixture: real body + hand-mocap joint names, varied bind axes, no source-app edits. */
async function fingerRig(): Promise<Rig> {
  const rig = await plainRig(), bones = [...rig.mesh.skeleton.bones];
  for (const side of ['l', 'r'] as const) {
    const root = rig.rest.get(`hand_${side}`)!;
    const positions = restPositions(hand(side));
    const along = new Vector3(side === 'l' ? 1 : -1, -3, 0).normalize();
    const across = new Vector3(0, 0, side === 'l' ? 1 : -1);
    const rotation = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(across, along, new Vector3().crossVectors(across, along)));
    const joints = [root.bone];
    for (let i = 1; i < 21; i++) {
      const bone = new Bone(); bone.name = `${HAND_JOINTS[i]}_${side}`;
      const parent = joints[HAND_PARENTS[i]];
      parent.add(bone);
      const world = positions[i].clone().multiplyScalar(.85).applyQuaternion(rotation).add(root.pos);
      rig.scene.updateMatrixWorld(true);
      bone.position.copy(parent.worldToLocal(world));
      bone.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), .18 * (i % 3));
      bone.updateMatrixWorld(true); joints.push(bone); bones.push(bone);
    }
  }
  rig.scene.updateMatrixWorld(true);
  const skeleton = new Skeleton(bones); skeleton.calculateInverses();
  rig.mesh.bind(skeleton, rig.mesh.bindMatrix);
  return rigFromScene(rig.scene);
}

describe('hand-mocap-v1 import and retarget', () => {
  it('reads both outputs from the real hand-mocap exporter and validates the contract', () => {
    for (const side of ['l', 'r'] as const) {
      const clip = hand(side); expect(clip.side).toBe(side); expect(clip.duration).toBe(6); expect(clip.frames).toHaveLength(181);
      expect([...sampleHand(clip, 100, false)]).toEqual([...clip.frames.at(-1)!]);
      expect([...sampleHand(clip, -.5, true)]).toEqual([...clip.frames[0]]);
      const invalid = handJson(side); invalid.joints[5] = 'unknown'; expect(() => parseHandClip(invalid)).toThrow('関節名');
      const bad = handJson(side); bad.frames[0][0] = .1; expect(() => parseHandClip(bad)).toThrow('手首原点');
    }
  });

  it('the rest hand gives the same pose even with different bone axes', async () => {
    const rig = await fingerRig();
    const tracks: HandTracks = {};
    for (const side of ['l', 'r'] as const) {
      const clip = hand(side), frame = Float32Array.from(restPositions(clip).flatMap((p) => p.toArray()));
      tracks[side] = { clip: { ...clip, frames: [frame, frame], duration: 1 / clip.fps }, offset: 0, wrist: false };
      expect(handCompatibility(rig, side).available).toBe(20);
    }
    applyHandTracks(rig, tracks, 0, false);
    let error = 0;
    for (const r of rig.rest.values()) error = Math.max(error, r.pos.distanceTo(r.bone.getWorldPosition(new Vector3())));
    expect(error).toBeLessThan(1e-6);
  });

  it('adds independent hands without moving the arms; camera rotation is removed unless wrist is enabled', async () => {
    const rig = await fingerRig(), motion = parseClip(sampleClips.pry());
    const pose = () => { const s = sampleJoints(motion, 2, false); applyPose(rig, computePose(rig, s.joints, s.root, motion.root![0])); };
    pose();
    const wristBefore = rig.rest.get('hand_l')!.bone.getWorldQuaternion(new Quaternion());
    const armBefore = rig.rest.get('forearm_l')!.bone.quaternion.clone();
    const tracks: HandTracks = { l: { clip: hand('l'), offset: 0, wrist: false }, r: { clip: hand('r'), offset: .7, wrist: false } };
    applyHandTracks(rig, tracks, 1.5, false);
    expect(wristBefore.angleTo(rig.rest.get('hand_l')!.bone.getWorldQuaternion(new Quaternion()))).toBeLessThan(1e-6);
    expect(armBefore.angleTo(rig.rest.get('forearm_l')!.bone.quaternion)).toBeLessThan(1e-6);
    const fingers = HAND_JOINTS.slice(1).map((name) => rig.rest.get(`${name}_l`)!.bone.quaternion.clone());
    const q = new Quaternion().setFromAxisAngle(new Vector3(1, 1, 0).normalize(), .7);
    const rotated = hand('l');
    rotated.frames = rotated.frames.map((f) => Float32Array.from(Array.from({ length: 21 }, (_, j) => new Vector3(f[j * 3], f[j * 3 + 1], f[j * 3 + 2]).applyQuaternion(q).toArray()).flat()));
    pose(); applyHandTracks(rig, { l: { clip: rotated, offset: 0, wrist: false } }, 1.5, false);
    HAND_JOINTS.slice(1).forEach((name, i) => expect(fingers[i].angleTo(rig.rest.get(`${name}_l`)!.bone.quaternion)).toBeLessThan(.0001));
    pose(); applyHandTracks(rig, { l: { clip: rotated, offset: 0, wrist: true } }, 1.5, false);
    expect(wristBefore.angleTo(rig.rest.get('hand_l')!.bone.getWorldQuaternion(new Quaternion()))).toBeGreaterThan(.1);
  });

  it('old bodies retain compatibility and hand-only timelines include offsets', async () => {
    const rig = await plainRig();
    const tracks: HandTracks = { l: { clip: hand('l'), offset: .5, wrist: false } };
    expect(handCompatibility(rig, 'l').available).toBe(0);
    expect(() => applyHandTracks(rig, tracks, 2, true)).not.toThrow();
    await expect(exportAnimatedGlb(rig, null, { name: 'hands', speed: 1, loop: false, includeRoot: false, hands: tracks })).rejects.toThrow('指の骨が不足');
    expect(getTimeline(null, tracks)).toMatchObject({ fps: 30, duration: 6.5, frameCount: 196 });
    expect(getTimeline(parseClip(sampleClips.dash()), tracks)?.duration).toBe(6);
    const slowerBody = parseClip({ ...sampleClips.dash(), fps: 15 });
    expect(getTimeline(slowerBody, tracks)).toMatchObject({ fps: 30, duration: 12, frameCount: 360 });
  });

  for (const bodyMotion of [true, false]) it(`exports finger motion for standard GLB playback (body=${bodyMotion})`, async () => {
    const rig = await fingerRig(), motion = bodyMotion ? parseClip(sampleClips.pry()) : null;
    const tracks: HandTracks = { l: { clip: hand('l'), offset: .2, wrist: false }, r: { clip: hand('r'), offset: -.1, wrist: true } };
    const bytes = await exportAnimatedGlb(rig, motion, { name: 'hands', speed: 1.5, loop: false, includeRoot: true, includeSoftness: false, hands: tracks });
    const loaded = await new GLTFLoader().parseAsync(bytes, ''), output = rigFromScene(loaded.scene);
    const timeline = getTimeline(motion, tracks)!;
    expect(loaded.animations[0].duration).toBeCloseTo(timeline.duration / 1.5, 5);
    expect(loaded.scene.userData.kugutsu.hands).toHaveLength(2);
    const mixer = new AnimationMixer(loaded.scene), action = mixer.clipAction(loaded.animations[0]);
    action.setLoop(LoopOnce, 1); action.clampWhenFinished = true; action.play();
    let error = 0;
    for (const t of [0, .5, 1, 2.5, 5, timeline.lastTime]) {
      if (motion) { const sample = sampleJoints(motion, t, false); applyPose(rig, computePose(rig, sample.joints, sample.root, motion.root![0])); }
      else resetRig(rig);
      applyHandTracks(rig, tracks, t, false); mixer.setTime(t / 1.5); loaded.scene.updateMatrixWorld(true);
      for (const [name, rest] of rig.rest) error = Math.max(error, rest.bone.getWorldPosition(new Vector3()).distanceTo(output.rest.get(name)!.bone.getWorldPosition(new Vector3())));
    }
    expect(error).toBeLessThan(1e-5);
    mkdirSync('test-output', { recursive: true });
    writeFileSync(`test-output/${bodyMotion ? 'body_with_hands' : 'hands_only'}.glb`, new Uint8Array(bytes));
    const original = await exportAnimatedGlb(rig, null, { name: 'finger_fixture', speed: 1, loop: false, includeRoot: false, includeSoftness: false, hands: {} }).catch(() => null);
    expect(original).toBeNull();
  });
});
