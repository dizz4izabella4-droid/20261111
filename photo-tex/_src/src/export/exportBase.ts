import type { BaseMesh } from '../model/mesh';
import { writeGlb } from './glb';

export const BASE_COLOR = 0x3a6fd8;

export const LANDMARK_NODE_NAMES = [
  'LM_shoulderJoint_L',
  'LM_shoulderJoint_R',
  'LM_neckBase',
  'LM_navel',
  'LM_nipple_L',
  'LM_nipple_R',
  'LM_waist_L',
  'LM_waist_R',
] as const;

/** GLB with the base mesh (node `base`) and landmark empties. UV is written with glTF's top-left origin (v' = 1 - v). */
export function exportBaseGlb(mesh: BaseMesh): ArrayBuffer {
  const uv = new Float32Array(mesh.uvs.length);
  for (let i = 0; i < uv.length; i += 2) {
    uv[i] = mesh.uvs[i];
    uv[i + 1] = 1 - mesh.uvs[i + 1];
  }
  return writeGlb(
    [{ name: 'base', positions: mesh.positions, normals: mesh.normals, uvs: uv, indices: mesh.indices, color: BASE_COLOR, materialName: 'base_blue' }],
    LANDMARK_NODE_NAMES.map((n) => ({ name: n, translation: mesh.landmarks[n] })),
  );
}
