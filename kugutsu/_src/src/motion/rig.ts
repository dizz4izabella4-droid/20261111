// Rig = the skeleton of a loaded body GLB (from スペアボディ, or any GLB whose bones use the same names).
// The bind pose read from the file is the rest pose; motion is applied as rotations relative to it.
import { Bone, Object3D, Quaternion, SkinnedMesh, Vector3 } from 'three';

/** bone names used by 傀儡 (スペアボディ's skeleton). toe_l / toe_r are optional end joints. */
export const RIG_BONES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'upperarm_l', 'forearm_l', 'hand_l', 'upperarm_r', 'forearm_r', 'hand_r',
  'thigh_l', 'shin_l', 'foot_l', 'thigh_r', 'shin_r', 'foot_r',
] as const;
export type RigBone = (typeof RIG_BONES)[number];

export interface RestBone {
  bone: Bone;
  /** rest (bind) pose in world space */
  pos: Vector3;
  quat: Quaternion;
  /** rest local transform (to return to the rest pose) */
  localPos: Vector3;
  localQuat: Quaternion;
}

export interface Rig {
  scene: Object3D;
  mesh: SkinnedMesh;
  rest: Map<string, RestBone>;
  /** required bones that the file does not have */
  missing: string[];
  /** world position of the toe end joints if present */
  toe: { l: Vector3 | null; r: Vector3 | null };
  height: number;
}

export function rigFromScene(scene: Object3D): Rig {
  let mesh: SkinnedMesh | null = null;
  scene.traverse((o) => {
    if (!mesh && (o as SkinnedMesh).isSkinnedMesh) mesh = o as SkinnedMesh;
  });
  if (!mesh) throw new Error('骨格つきのメッシュ（スキンメッシュ）がありません。スペアボディの「傀儡用に書き出す（GLB）」で作った体を開いてください。');
  const m = mesh as SkinnedMesh;
  // bind pose: put every bone back to its bind transform before reading the rest pose
  m.skeleton.pose();
  scene.updateMatrixWorld(true);
  const rest = new Map<string, RestBone>();
  for (const b of m.skeleton.bones) {
    rest.set(b.name, {
      bone: b,
      pos: new Vector3().setFromMatrixPosition(b.matrixWorld),
      quat: b.getWorldQuaternion(new Quaternion()),
      localPos: b.position.clone(),
      localQuat: b.quaternion.clone(),
    });
  }
  const missing = RIG_BONES.filter((n) => !rest.has(n));
  m.geometry.computeBoundingBox();
  const bb = m.geometry.boundingBox!;
  return {
    scene,
    mesh: m,
    rest,
    missing,
    toe: { l: rest.get('toe_l')?.pos.clone() ?? null, r: rest.get('toe_r')?.pos.clone() ?? null },
    height: bb.max.y - Math.min(0, bb.min.y),
  };
}

/** back to the rest (bind) pose */
export function resetRig(rig: Rig): void {
  for (const r of rig.rest.values()) {
    r.bone.position.copy(r.localPos);
    r.bone.quaternion.copy(r.localQuat);
  }
  rig.scene.updateMatrixWorld(true);
}
