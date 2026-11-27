import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { AnimationMixer, LoopOnce, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { createSoftness, removeSoftness } from '../../integration/softness.js';
import { parseClip, sampleJoints } from '../src/motion/clip';
import { sampleClips } from '../src/motion/demo';
import { rigFromScene } from '../src/motion/rig';
import { applyPose, computePose } from '../src/motion/retarget';
import { exportAnimatedGlb } from '../src/motion/export';

vi.stubGlobal('FileReader', class {
  result: ArrayBuffer | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob) { void blob.arrayBuffer().then((x) => { this.result = x; this.onloadend?.(); }); }
});
afterAll(() => vi.unstubAllGlobals());
async function body(sex = 'female') {
  const bytes = readFileSync(`public/samples/spare_body_${sex}.glb`);
  return rigFromScene((await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene);
}
const peak = (mesh: ReturnType<typeof rigFromScene>['mesh']) => Math.max(0, ...(mesh.morphTargetInfluences ?? []).map(Math.abs));

describe('spare-body softness', () => {
  it('reads the real exported fields, stays still without motion, and restores the geometry', async () => {
    const rig = await body();
    expect(rig.scene.userData.softness.format).toBe('spare-body-softness-v1');
    const original = rig.mesh.geometry;
    const soft = createSoftness(rig.scene)!;
    expect(soft.activeVertices).toBeGreaterThan(1000);
    for (let i = 0; i < 60; i++) soft.update(1 / 60);
    expect(peak(rig.mesh)).toBe(0);
    soft.dispose();
    expect(rig.mesh.geometry).toBe(original);
    expect(rig.mesh.userData.kugutsuSoftness).toBeUndefined();
  });

  it('reacts to rotation, respects each vertex limit, keeps rigid regions fixed, and settles', async () => {
    const rig = await body('male');
    const soft = createSoftness(rig.scene)!;
    const bone = rig.rest.get('upperarm_l')!.bone;
    for (let i = 0; i < 24; i++) { bone.rotation.z = Math.sin(i * 0.3); rig.scene.updateMatrixWorld(true); soft.update(1 / 60); }
    expect(peak(rig.mesh)).toBeGreaterThan(0.01);
    const geometry = rig.mesh.geometry;
    const maximum = geometry.getAttribute('_max_offset');
    const limits = new Vector3();
    let hard = 0, moved = 0;
    for (let vertex = 0; vertex < maximum.count; vertex++) {
      limits.set(0, 0, 0);
      geometry.morphAttributes.position!.forEach((target, index) => {
        limits.addScaledVector(new Vector3().fromBufferAttribute(target, vertex), rig.mesh.morphTargetInfluences![index]);
      });
      expect(limits.length()).toBeLessThanOrEqual(maximum.getX(vertex) + 1e-7);
      if (maximum.getX(vertex) === 0) { expect(limits.length()).toBe(0); hard++; }
      else if (limits.length() > 1e-5) moved++;
    }
    expect(hard).toBeGreaterThan(100);
    expect(moved).toBeGreaterThan(100);
    for (let i = 0; i < 480; i++) soft.update(1 / 60);
    expect(peak(rig.mesh)).toBe(0);
    soft.setEnabled(false); bone.rotation.z += 1; soft.update(1 / 60);
    expect(peak(rig.mesh)).toBe(0);
  });

  it('honors damping, reset/seek, and the old format without attributes', async () => {
    const energies: number[] = [];
    for (const damping of [0, 1]) {
      const rig = await body();
      const attribute = rig.mesh.geometry.getAttribute('_damping');
      for (let i = 0; i < attribute.count; i++) attribute.setX(i, damping);
      const soft = createSoftness(rig.scene)!;
      rig.scene.position.x = 0.02;
      soft.update(1 / 60);
      let energy = 0;
      for (let i = 0; i < 240; i++) { soft.update(1 / 60); if (i > 120) energy += peak(rig.mesh) ** 2; }
      energies.push(energy);
      soft.reset(); expect(peak(rig.mesh)).toBe(0);
    }
    expect(energies[1]).toBeLessThan(energies[0] * 0.1);
    const old = await body();
    for (const name of ['_softness', '_max_offset', '_damping']) old.mesh.geometry.deleteAttribute(name);
    expect(createSoftness(old.scene)).toBeNull();
    old.mesh.geometry.setAttribute('_softness', old.mesh.geometry.getAttribute('position'));
    expect(() => createSoftness(old.scene)).toThrow('柔らかさ');
  });

  it('does not duplicate targets when a live or baked body is cloned', async () => {
    const rig = await body();
    createSoftness(rig.scene);
    const count = rig.mesh.morphTargetInfluences!.length;
    const copy = rigFromScene(clone(rig.scene));
    createSoftness(copy.scene);
    expect(copy.mesh.morphTargetInfluences).toHaveLength(count);
    removeSoftness(copy.mesh);
    expect(copy.mesh.geometry.morphAttributes.position).toHaveLength(0);
    expect(rig.mesh.morphTargetInfluences).toHaveLength(count);
  });

  for (const loop of [false, true]) it(`bakes and reloads standard morph animation (loop=${loop})`, async () => {
    const rig = await body();
    const motion = parseClip(sampleClips.samba());
    const live = createSoftness(rig.scene)!;
    const sample = sampleJoints(motion, .4, false);
    applyPose(rig, computePose(rig, sample.joints, sample.root, motion.root![0])); live.update(1 / 30);
    const original = rig.mesh.morphTargetInfluences!.slice();
    const data = await exportAnimatedGlb(rig, motion, { name: 'soft_samba', speed: 1, loop, includeRoot: true });
    expect(rig.mesh.morphTargetInfluences).toEqual(original);
    const loaded = await new GLTFLoader().parseAsync(data, '');
    const output = rigFromScene(loaded.scene);
    expect(loaded.scene.userData.kugutsu.softnessBaked).toBe(true);
    for (const name of ['_softness', '_max_offset', '_damping']) {
      expect([...output.mesh.geometry.getAttribute(name).array]).toEqual([...rig.mesh.geometry.getAttribute(name).array]);
    }
    const track = loaded.animations[0].tracks.find((t) => t.name.endsWith('.morphTargetInfluences'))!;
    expect(track).toBeDefined();
    expect(Math.max(...track.values.map(Math.abs))).toBeGreaterThan(.01);
    if (loop) expect([...track.values.slice(0, track.getValueSize())]).toEqual([...track.values.slice(-track.getValueSize())]);
    const mixer = new AnimationMixer(loaded.scene);
    const action = mixer.clipAction(loaded.animations[0]); action.setLoop(LoopOnce, 1); action.clampWhenFinished = true; action.play();
    mixer.setTime(1.5); loaded.scene.updateMatrixWorld(true);
    expect(peak(output.mesh)).toBeGreaterThan(.001);
    const weights = output.mesh.morphTargetInfluences!.slice();
    const softVertex = output.mesh.geometry.getAttribute('_max_offset');
    let largest = 0, changed = 0;
    for (let i = 0; i < softVertex.count; i += 29) {
      const a = output.mesh.getVertexPosition(i, new Vector3());
      output.mesh.morphTargetInfluences!.fill(0);
      const b = output.mesh.getVertexPosition(i, new Vector3());
      weights.forEach((w, j) => { output.mesh.morphTargetInfluences![j] = w; });
      const distance = a.distanceTo(b); largest = Math.max(largest, distance);
      expect(distance).toBeLessThanOrEqual(softVertex.getX(i) + 1e-6);
      if (distance > 1e-5) changed++;
    }
    expect(changed).toBeGreaterThan(10);
    const targets = output.mesh.morphTargetInfluences!.length;
    createSoftness(loaded.scene);
    expect(output.mesh.morphTargetInfluences).toHaveLength(targets);
    mkdirSync('test-output', { recursive: true });
    writeFileSync(`test-output/soft_samba_${loop ? 'loop' : 'once'}.glb`, new Uint8Array(data));
    writeFileSync(`test-output/soft_samba_${loop ? 'loop' : 'once'}.json`, JSON.stringify({ bytes: data.byteLength, targets, largest }));
  });
});
