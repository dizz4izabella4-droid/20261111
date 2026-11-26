// GLB of the body in the rest pose (one mesh `body`) plus one empty node per joint (bone name,
// rest-pose position). Skinning and animation are added with the motion step.
import type { BodyMesh } from '../model/body';
import { BODY_COLOR } from '../viewer';
import { writeGlb } from './glb';

export function exportBodyGlb(b: BodyMesh): ArrayBuffer {
  return writeGlb(
    [{ name: 'body', positions: b.positions, normals: b.normals, indices: b.indices, color: BODY_COLOR, materialName: 'body_blue' }],
    b.bones.map((bn) => ({ name: `J_${bn.name}`, translation: bn.head })),
    'body-motion',
  );
}
