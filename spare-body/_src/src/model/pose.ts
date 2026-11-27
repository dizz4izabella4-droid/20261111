import { Bone, MathUtils, Quaternion, Vector3 } from 'three';
import type { BodyMesh } from './body';
import { FINGERS, HAND_JOINTS } from './handRig';

export interface PreviewPose {
  armElevation: number | null;
  elbow: number;
  knee: number;
  hip: number;
  torso: number;
  twist: number;
  thumb?: number;
  index?: number;
  middle?: number;
  ring?: number;
  pinky?: number;
}
export const restPose = (): PreviewPose => ({ armElevation: null, elbow: 0, knee: 0, hip: 0, torso: 0, twist: 0 });

/** Accepted relaxed finger angles on startup and after preset resets. */
export const defaultPreviewPose = (): PreviewPose => ({ ...restPose(), thumb: 21, index: 18, middle: 17, ring: 17, pinky: 17 });
export const looseGripPose = (): PreviewPose => ({ ...restPose(), thumb: 55, index: 75, middle: 80, ring: 85, pinky: 85 });

/** Standard bone rotations, also used by the export round-trip deformation tests. */
export function applyPreviewPose(body: BodyMesh, bones: Bone[], pose: PreviewPose): void {
  const lookup = new Map(bones.map((b) => [b.name, b]));
  for (const b of bones) b.quaternion.identity();
  const rotate = (name: string, axis: Vector3, angle: number) => lookup.get(name)?.quaternion.setFromAxisAngle(axis, MathUtils.degToRad(angle));
  rotate('spine', new Vector3(1, 0, 0), pose.torso * 0.5);
  rotate('chest', new Vector3(1, 0, 0), pose.torso * 0.5);
  for (const side of ['l', 'r']) {
    const sign = side === 'l' ? 1 : -1;
    const a = body.bones.find((b) => b.name === `upperarm_${side}`)!, b = body.bones.find((b) => b.name === `forearm_${side}`)!;
    const dir = new Vector3(...b.head).sub(new Vector3(...a.head)).normalize();
    const restAngle = MathUtils.radToDeg(Math.atan2(Math.abs(dir.x), -dir.y));
    const upper = lookup.get(`upperarm_${side}`)!;
    upper.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), sign * MathUtils.degToRad((pose.armElevation ?? restAngle) - restAngle));
    upper.quaternion.multiply(new Quaternion().setFromAxisAngle(dir, MathUtils.degToRad(sign * pose.twist * 0.5)));
    const fore = lookup.get(`forearm_${side}`)!;
    fore.quaternion.setFromAxisAngle(dir.clone().cross(new Vector3(0, 0, 1)).normalize(), MathUtils.degToRad(pose.elbow));
    fore.quaternion.multiply(new Quaternion().setFromAxisAngle(dir, MathUtils.degToRad(sign * pose.twist * 0.5)));
    rotate(`thigh_${side}`, new Vector3(-1, 0, 0), pose.hip);
    rotate(`shin_${side}`, new Vector3(1, 0, 0), pose.knee);
    const palm = dir.clone().cross(new Vector3(0, 0, 1)).multiplyScalar(sign);
    FINGERS.forEach((finger, f) => {
      const amount = (pose[finger] ?? 0) / 100;
      for (let segment = 0; segment < 3; segment++) {
        const i = 1 + f * 4 + segment, name = `${HAND_JOINTS[i]}_${side}`;
        const from = body.bones.find((b) => b.name === name)!, to = body.bones.find((b) => b.name === `${HAND_JOINTS[i + 1]}_${side}`)!;
        const axis = new Vector3(...to.head).sub(new Vector3(...from.head)).normalize().cross(palm).normalize();
        rotate(name, axis, amount * (f === 0 ? [30, 65, 75][segment] : [75, 100, 65][segment]));
      }
    });
  }
  bones[0]?.updateMatrixWorld(true);
}
