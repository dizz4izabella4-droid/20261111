import { afterAll, describe, expect, it, vi } from 'vitest';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { AnimationMixer, LoopOnce, MeshStandardMaterial, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { exportAnimatedGlb, type ExportOptions } from '../src/motion/export';
import { parseClip, sampleJoints } from '../src/motion/clip';
import { sampleClips } from '../src/motion/demo';
import { rigFromScene } from '../src/motion/rig';
import { applyPose, computePose } from '../src/motion/retarget';

// GLTFExporter uses this browser API to assemble GLB blobs. No images in these fixtures.
vi.stubGlobal('FileReader', class {
  result: ArrayBuffer | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob) {
    void blob.arrayBuffer().then((result) => { this.result = result; this.onloadend?.(); });
  }
});
afterAll(() => vi.unstubAllGlobals());

async function body(sex: string) {
  const buffer = readFileSync(`public/samples/spare_body_${sex}.glb`);
  return rigFromScene((await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '')).scene);
}
const settings: ExportOptions = { name: 'game_motion', speed: 1, loop: false, includeRoot: true, includeSoftness: false };

describe('game-ready GLB round trip', () => {
  for (const [sex, kinds] of [['male', ['dash', 'pry', 'thrust']], ['female', ['flamenco', 'samba', 'hiphop']]] as const) {
    for (const kind of kinds) it(`${sex}/${kind}: GLTFLoader + AnimationMixer reproduce the baked pose`, async () => {
      const source = await body(sex);
      const motion = parseClip(sampleClips[kind]());
      const preview = sampleJoints(motion, 0.7, false);
      applyPose(source, computePose(source, preview.joints, preview.root, motion.root?.[0] ?? null));
      const before = [...source.rest.values()].map(({ bone }) => [...bone.position.toArray(), ...bone.quaternion.toArray()]);
      const options = { ...settings, speed: 1.5 };
      const data = await exportAnimatedGlb(source, motion, options);
      expect([...source.rest.values()].map(({ bone }) => [...bone.position.toArray(), ...bone.quaternion.toArray()])).toEqual(before);
      const loaded = await new GLTFLoader().parseAsync(data, '');
      expect(loaded.scene.userData.kugutsu).toMatchObject({ loop: false, speed: 1.5, sourceFps: motion.fps });
      const output = rigFromScene(loaded.scene);
      expect(output.missing).toEqual([]);
      expect(output.mesh.geometry.getAttribute('position').count).toBe(source.mesh.geometry.getAttribute('position').count);
      expect(loaded.animations).toHaveLength(1);
      expect(loaded.animations[0].name).toBe('game_motion');
      expect(loaded.animations[0].duration).toBeCloseTo(motion.duration / options.speed, 5);
      const material = output.mesh.material as MeshStandardMaterial;
      const originalMaterial = source.mesh.material as MeshStandardMaterial;
      expect(material.color.equals(originalMaterial.color)).toBe(true);
      expect(material.metalness).toBeCloseTo(originalMaterial.metalness);
      const mixer = new AnimationMixer(loaded.scene);
      const action = mixer.clipAction(loaded.animations[0]);
      action.setLoop(LoopOnce, 1); action.clampWhenFinished = true; action.play();
      let maxPosition = 0, maxAngle = 0, maxVertex = 0;
      for (let f = 0; f <= motion.frames.length; f++) {
        const t = f / motion.fps;
        const sample = sampleJoints(motion, t, false);
        applyPose(source, computePose(source, sample.joints, sample.root, motion.root?.[0] ?? null));
        mixer.setTime(t / options.speed);
        loaded.scene.updateMatrixWorld(true);
        for (const [name, expected] of source.rest) {
          const actual = output.rest.get(name)!;
          maxPosition = Math.max(maxPosition, expected.bone.getWorldPosition(new Vector3()).distanceTo(actual.bone.getWorldPosition(new Vector3())));
          maxAngle = Math.max(maxAngle, expected.bone.quaternion.angleTo(actual.bone.quaternion));
        }
        for (const vertex of [0, 100, source.mesh.geometry.getAttribute('position').count - 1]) {
          const expected = source.mesh.getVertexPosition(vertex, new Vector3()).applyMatrix4(source.mesh.matrixWorld);
          const actual = output.mesh.getVertexPosition(vertex, new Vector3()).applyMatrix4(output.mesh.matrixWorld);
          maxVertex = Math.max(maxVertex, expected.distanceTo(actual));
        }
      }
      expect(maxPosition).toBeLessThan(1e-5);
      expect(maxAngle).toBeLessThan(0.001);
      expect(maxVertex).toBeLessThan(1e-5);
      mkdirSync('test-output', { recursive: true });
      writeFileSync(`test-output/${sex}_${kind}.glb`, new Uint8Array(data));
      writeFileSync(`test-output/${sex}_${kind}_export.json`, JSON.stringify({ maxPosition, maxAngle, maxVertex, bytes: data.byteLength }));
      mixer.uncacheRoot(loaded.scene);
    });
  }

  for (const includeRoot of [true, false]) it(`keeps loop seam, speed, and root motion (${includeRoot})`, async () => {
    const source = await body('male');
    const motion = parseClip(sampleClips.dash());
    motion.root = motion.frames.map((_, i) => [i * 0.01, 0, i * 0.02]);
    const loaded = await new GLTFLoader().parseAsync(await exportAnimatedGlb(source, motion, { ...settings, speed: 2, loop: true, includeRoot }), '');
    const rig = rigFromScene(loaded.scene);
    const mixer = new AnimationMixer(loaded.scene);
    const action = mixer.clipAction(loaded.animations[0]);
    action.setLoop(LoopOnce, 1); action.clampWhenFinished = true; action.play();
    mixer.setTime(0.5); loaded.scene.updateMatrixWorld(true);
    const hips = rig.rest.get('hips')!.bone.getWorldPosition(new Vector3());
    const rest = source.rest.get('hips')!.pos;
    expect(hips.x - rest.x).toBeCloseTo(includeRoot ? 0.3 : 0, 5);
    expect(hips.z - rest.z).toBeCloseTo(includeRoot ? 0.6 : 0, 5);
    mixer.setTime(motion.duration / 2); loaded.scene.updateMatrixWorld(true);
    expect(rig.rest.get('hips')!.bone.getWorldPosition(new Vector3()).distanceTo(rest)).toBeLessThan(1e-5);
    for (const track of loaded.animations[0].tracks) {
      expect([...track.values.slice(0, track.getValueSize())]).toEqual([...track.values.slice(-track.getValueSize())]);
      for (let i = 1; i < track.times.length; i++) expect(track.times[i]).toBeGreaterThan(track.times[i - 1]);
    }
  });

  it('supports a single-frame motion and rejects invalid export speed', async () => {
    const rig = await body('female');
    const json = sampleClips.flamenco();
    json.frames = json.frames.slice(0, 1); json.root = json.root?.slice(0, 1);
    const motion = parseClip(json);
    const loaded = await new GLTFLoader().parseAsync(await exportAnimatedGlb(rig, motion, settings), '');
    expect(loaded.animations[0].duration).toBeCloseTo(1 / motion.fps, 6);
    await expect(exportAnimatedGlb(rig, motion, { ...settings, speed: 0 })).rejects.toThrow();
  });
});
