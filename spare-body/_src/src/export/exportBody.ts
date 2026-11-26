// スペアボディ → GLB: the body as one skinned mesh with its skeleton in the bind (standing) pose.
// This is the file 傀儡 (kugutsu) reads. Format notes are in HANDOFF.md ("体の GLB").
import type { BodyMesh } from '../model/body';
import type { BodyParams } from '../model/params';
import { BODY_COLOR } from '../viewer';
import { writeSkinnedGlb } from './glb';

export const BODY_GLB_FORMAT = 'spare-body-glb-v1';

export function exportBodyGlb(b: BodyMesh, params: BodyParams, name = 'spare_body'): ArrayBuffer {
  return writeSkinnedGlb(
    { name, positions: b.positions, normals: b.normals, indices: b.indices, joints: b.skinIndex, weights: b.skinWeight, color: BODY_COLOR, materialName: 'body_blue' },
    b.bones.map((x) => ({ name: x.name, parent: x.parent, head: x.head })),
    { format: BODY_GLB_FORMAT, units: 'meters', up: '+Y', front: '+Z', left: '+X', heightMeters: b.height, params },
    'spare-body',
  );
}
