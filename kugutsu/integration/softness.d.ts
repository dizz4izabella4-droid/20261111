import type { Object3D, SkinnedMesh } from 'three';
export interface SoftnessController {
  meshes: SkinnedMesh[];
  activeVertices: number;
  readonly enabled: boolean;
  setEnabled(enabled: boolean): void;
  reset(): void;
  update(deltaSeconds: number): boolean;
  dispose(): void;
}
export function createSoftness(root: Object3D): SoftnessController | null;
export function removeSoftness(mesh: SkinnedMesh): void;
