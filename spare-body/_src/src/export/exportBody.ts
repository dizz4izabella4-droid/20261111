// スペアボディ → GLB: the body as one skinned mesh with its skeleton in the bind (standing) pose.
// This is the file 傀儡 (kugutsu) reads. Format notes are in HANDOFF.md ("体の GLB").
import type { BodyMesh } from '../model/body';
import type { BodyParams } from '../model/params';
import { BODY_COLOR } from '../viewer';
import { writeSkinnedGlb, type FaceDecal } from './glb';
import { bakeSoftness, defaultSoftness, normalizeSoftness, type SoftnessSettings } from '../model/softness';
import { handMapping, HAND_JOINTS, HAND_PARENTS } from '../model/handRig';

export const BODY_GLB_FORMAT = 'spare-body-glb-v1';

export function exportBodyGlb(b: BodyMesh, params: BodyParams, name = 'spare_body', input: SoftnessSettings = defaultSoftness(), faceDecal?: FaceDecal): ArrayBuffer {
  const settings = normalizeSoftness(input);
  const field = bakeSoftness(b, settings);
  return writeSkinnedGlb(
    { name, faceDecal, positions: b.positions, normals: b.normals, indices: b.indices, joints: b.skinIndex, weights: b.skinWeight, color: BODY_COLOR, materialName: 'body_blue',
      scalars: { _SOFTNESS: field.softness, _MAX_OFFSET: field.maxOffset, _DAMPING: field.damping } },
    b.bones.map((x) => ({ name: x.name, parent: x.parent, head: x.head })),
    { format: BODY_GLB_FORMAT, units: 'meters', up: '+Y', front: '+Z', left: '+X', heightMeters: b.height, params,
      handRig: { format: 'spare-body-hand-v1', motionFormat: 'hand-mocap-v1', joints: [...HAND_JOINTS], parents: [...HAND_PARENTS],
        maps: { Left: handMapping('l'), Right: handMapping('r') } },
      ...(b.seams ? { seams: { format: b.seams.format, components: b.seams.components, boundaryEdges: b.seams.boundaryEdges, joints: b.seams.joints.map((j) => j.name) } } : {}),
      softness: { format: 'spare-body-softness-v1', settings, attributes: {
        _SOFTNESS: { unit: 'ratio', min: 0, max: 1 },
        _MAX_OFFSET: { unit: 'meters', description: 'Maximum secondary displacement; already scaled by softness.' },
        _DAMPING: { unit: 'ratio', min: 0, max: 1, description: 'Larger values settle faster.' },
      } } },
    'spare-body',
  );
}
