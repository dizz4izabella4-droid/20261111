import { AnimationClip, Matrix4, Mesh, MeshStandardMaterial, NumberKeyframeTrack, QuaternionKeyframeTrack, Scene, VectorKeyframeTrack } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { sampleJoints, type MotionClip } from './clip';
import { rigFromScene, resetRig, type Rig } from './rig';
import { applyPose, computePose } from './retarget';
import { createSoftness, removeSoftness } from '../../../integration/softness.js';
import { compactMorphTargets } from './sparse-glb';
import { applyHandTracks, handCompatibility, type HandSide, type HandTracks } from './hand';
import { getTimeline } from './timeline';

export interface ExportOptions {
  name: string;
  speed: number;
  loop: boolean;
  includeRoot: boolean;
  includeSoftness?: boolean;
  hands?: HandTracks;
}

/** Bake onto a separate skeleton, leaving the displayed pose and playback untouched. */
export function bakeMotion(source: Rig, motion: MotionClip | null, options: ExportOptions) {
  if (!Number.isFinite(options.speed) || options.speed <= 0) throw new Error('書き出しの速さが正しくありません。');
  const timeline = getTimeline(motion, options.hands);
  if (!timeline) throw new Error('体または指のモーションを読み込んでください。');
  for (const side of Object.keys(options.hands ?? {}) as HandSide[]) {
    const compatible = handCompatibility(source, side);
    if (!compatible.wrist || compatible.missing.length) throw new Error(`${side === 'l' ? '左手' : '右手'}の指の骨が不足しています。対応する体を読み込むか、その手の指データを外してください。`);
  }
  const body = clone(source.scene);
  const rig = rigFromScene(body);
  const scene = new Scene();
  scene.name = 'kugutsu';
  scene.add(body);
  scene.userData = { ...body.userData };
  body.updateMatrix();
  if (body.matrix.equals(new Matrix4())) {
    // GLTFLoader's identity scene container is unnecessary around a skinned mesh.
    for (const child of [...body.children]) scene.add(child);
    scene.remove(body);
  }
  rig.scene = scene;
  scene.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    if (options.includeSoftness === false && 'skeleton' in mesh) removeSoftness(mesh as Rig['mesh']);
    const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((original) => {
      const material = original.clone();
      // Reflections belong to the game's lighting; retain the actual silver PBR material.
      if (material instanceof MeshStandardMaterial) material.envMap = null;
      return material;
    });
    mesh.material = Array.isArray(mesh.material) ? materials : materials[0];
  });
  const count = timeline.keyCount;
  const times = Float32Array.from({ length: count }, (_, i) => Math.min(i / timeline.fps, timeline.duration) / options.speed);
  const bones = [...rig.rest.values()].map(({ bone }) => ({
    bone, rotations: new Float32Array(count * 4), positions: new Float32Array(count * 3),
  }));
  const softness = options.includeSoftness === false ? null : createSoftness(scene);
  const morphs = softness?.enabled ? softness.meshes.map((mesh) => ({
    mesh, size: mesh.morphTargetInfluences!.length,
    values: new Float32Array(count * mesh.morphTargetInfluences!.length),
  })) : [];
  const dt = 1 / timeline.fps / options.speed;
  const pose = (i: number) => {
    const time = options.loop ? (i === count - 1 ? 0 : (i / timeline.fps) % timeline.duration) : Math.min(i / timeline.fps, timeline.lastTime);
    if (motion) {
      const sample = sampleJoints(motion, time, options.loop);
      applyPose(rig, computePose(rig, sample.joints, options.includeRoot ? sample.root : null, motion.root?.[0] ?? null));
    } else resetRig(rig);
    applyHandTracks(rig, options.hands ?? {}, time, options.loop);
  };
  if (softness?.enabled && options.loop) {
    // Warm up to a repeating response rather than starting every loop with still tissue.
    pose(0); softness.reset();
    for (let i = 1; i <= (count - 1) * 2; i++) { pose(i % (count - 1)); softness.update(dt); }
  }
  for (let i = 0; i < count; i++) {
    pose(i);
    if (softness?.enabled) {
      if (!options.loop && i === 0) softness.reset();
      else softness.update(dt);
    }
    for (const { bone, rotations, positions } of bones) {
      bone.quaternion.toArray(rotations, i * 4);
      if (i > 0) {
        let dot = 0;
        for (let k = 0; k < 4; k++) dot += rotations[(i - 1) * 4 + k] * rotations[i * 4 + k];
        if (dot < 0) for (let k = 0; k < 4; k++) rotations[i * 4 + k] *= -1;
      }
      bone.position.toArray(positions, i * 3);
    }
    for (const { mesh, size, values } of morphs) {
      values.set(options.loop && i === count - 1 ? values.subarray(0, size) : mesh.morphTargetInfluences!, i * size);
    }
  }
  const tracks = bones.flatMap(({ bone, rotations, positions }) => [
    new QuaternionKeyframeTrack(`${bone.uuid}.quaternion`, times, rotations),
    new VectorKeyframeTrack(`${bone.uuid}.position`, times, positions),
  ]);
  const animation = new AnimationClip(options.name.trim() || 'motion', timeline.duration / options.speed, [
    ...tracks, ...morphs.map(({ mesh, values }) => new NumberKeyframeTrack(`${mesh.uuid}.morphTargetInfluences`, times, values)),
  ]);
  resetRig(rig);
  softness?.reset();
  scene.userData.kugutsu = {
    format: 'kugutsu-animation-v1', sourceFps: timeline.fps, speed: options.speed,
    loop: options.loop, rootMotion: options.includeRoot && motion?.root != null,
    durationSeconds: animation.duration, units: 'meters',
    softnessBaked: morphs.length > 0,
    hands: Object.entries(options.hands ?? {}).map(([side, track]) => ({ side, name: track.clip.name, offset: track.offset, wrist: track.wrist })),
  };
  return { scene, animation };
}

export async function exportAnimatedGlb(source: Rig, motion: MotionClip | null, options: ExportOptions): Promise<ArrayBuffer> {
  const { scene, animation } = bakeMotion(source, motion, options);
  const result = await new GLTFExporter().parseAsync(scene, {
    binary: true, animations: [animation], onlyVisible: false,
  });
  if (!(result instanceof ArrayBuffer)) throw new Error('GLBの生成に失敗しました。');
  return compactMorphTargets(result);
}
