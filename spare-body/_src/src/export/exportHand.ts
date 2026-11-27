import { Vector3 } from 'three';
import type { BodyMesh } from '../model/body';
import { HAND_JOINTS, HAND_PARENTS } from '../model/handRig';
import { writeSkinnedGlb } from './glb';

/** A standalone hand: exactly the attached hand-mocap-v1 joint names/order, wrist
 * origin, +Y fingers, +X thumb on the left hand. No softness attributes. */
export function exportHandGlb(body: BodyMesh, side: 'l' | 'r'): ArrayBuffer {
  const part = body.parts.find((p) => p.name === `hand_${side}`)!;
  const bone = (name: string) => body.bones.find((b) => b.name === `${name}_${side}`)!;
  const wrist = new Vector3(...bone('hand').head), along = wrist.clone().sub(new Vector3(...bone('forearm').head)).normalize();
  const across = new Vector3(0, 0, side === 'l' ? 1 : -1), dorsal = across.clone().cross(along).normalize();
  const convert = (point: Vector3, normal = false): [number, number, number] => {
    if (!normal) point.sub(wrist);
    return [point.dot(across), point.dot(along), point.dot(dorsal)];
  };
  const indices = body.indices.subarray(part.start, part.start + part.count), ids = [...new Set(indices)];
  const mapping = new Map(ids.map((id, i) => [id, i]));
  const positions = new Float32Array((ids.length + 1) * 3), normals = new Float32Array((ids.length + 1) * 3);
  const joints = new Uint16Array((ids.length + 1) * 4), weights = new Float32Array((ids.length + 1) * 4);
  const names = HAND_JOINTS.map((name) => `${name}_${side}`);
  ids.forEach((id, i) => {
    positions.set(convert(new Vector3().fromArray(body.positions, id * 3)), i * 3);
    normals.set(convert(new Vector3().fromArray(body.normals, id * 3), true), i * 3);
    const merged = new Map<number, number>();
    for (let k = 0; k < 4; k++) {
      const n = body.bones[body.skinIndex[id * 4 + k]].name, w = body.skinWeight[id * 4 + k];
      const target = Math.max(0, names.indexOf(n)); merged.set(target, (merged.get(target) ?? 0) + w);
    }
    [...merged].filter(([, w]) => w > 0).forEach(([b, w], k) => { joints[i * 4 + k] = b; weights[i * 4 + k] = w; });
  });
  const outIndices = Array.from(indices, (id) => mapping.get(id)!);
  const edges = new Map<string, { a: number; b: number; count: number }>();
  for (let i = 0; i < outIndices.length; i += 3) for (let j = 0; j < 3; j++) {
    const a = outIndices[i + j], b = outIndices[i + (j + 1) % 3], k = a < b ? `${a}/${b}` : `${b}/${a}`;
    const edge = edges.get(k); if (edge) edge.count++; else edges.set(k, { a, b, count: 1 });
  }
  const boundary = [...edges.values()].filter((e) => e.count === 1), center = new Vector3();
  for (const edge of boundary) center.add(new Vector3().fromArray(positions, edge.a * 3));
  center.divideScalar(boundary.length).toArray(positions, ids.length * 3);
  normals.set([0, -1, 0], ids.length * 3); weights[ids.length * 4] = 1;
  for (const edge of boundary) outIndices.push(edge.b, edge.a, ids.length);
  return writeSkinnedGlb({ name: `hand_${side}`, positions, normals, indices: Uint32Array.from(outIndices), joints, weights,
    color: 0xc5aca1, materialName: 'hand' }, HAND_JOINTS.map((name, i) => ({ name: names[i], parent: HAND_PARENTS[i],
      head: i === 0 ? [0, 0, 0] : convert(new Vector3(...bone(name).head)) })), {
    format: 'spare-hand-glb-v1', motionFormat: 'hand-mocap-v1', handedness: side === 'l' ? 'Left' : 'Right', units: 'meters',
    up: '+Y', origin: 'wrist', joints: names, parents: [...HAND_PARENTS],
    retargeting: 'Use captured joint directions relative to the palm; local quaternions require rest-axis conversion.',
  }, 'spare-body');
}
