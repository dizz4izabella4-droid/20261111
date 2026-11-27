import { Vector3 } from 'three';
import type { BodyParams } from './params';
import { REFERENCE_ROOTS, REFERENCE_THUMB_JOINTS, referenceFinger, referenceX, referenceY } from './handReference';

// The names/order match the attached hand_mocap_tool.html (hand-mocap-v1).
export const HAND_JOINTS = ['wrist', 'thumb_cmc', 'thumb_mcp', 'thumb_ip', 'thumb_tip',
  'index_mcp', 'index_pip', 'index_dip', 'index_tip', 'middle_mcp', 'middle_pip', 'middle_dip', 'middle_tip',
  'ring_mcp', 'ring_pip', 'ring_dip', 'ring_tip', 'pinky_mcp', 'pinky_pip', 'pinky_dip', 'pinky_tip'] as const;
export const HAND_PARENTS = [-1, 0, 1, 2, 3, 0, 5, 6, 7, 0, 9, 10, 11, 0, 13, 14, 15, 0, 17, 18, 19] as const;
export const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;
export type FingerName = typeof FINGERS[number];
export type HandJoint = typeof HAND_JOINTS[number];
export const FINGER_BONES = HAND_JOINTS.filter((n): n is Exclude<HandJoint, 'wrist'> => n !== 'wrist');

export interface HandLayout {
  wrist: Vector3;
  along: Vector3;
  across: Vector3;
  palm: Vector3;
  points: Vector3[];
  local: Vector3[];
  palmLength: number;
}

/** Hand proportions with a curved knuckle line. Dimensions are art defaults,
 * not population measurements. The middle fingertip defines handLength. */
export function handLayout(wrist: Vector3, along: Vector3, p: BodyParams): HandLayout {
  const across = new Vector3(0, 0, 1), palm = along.clone().cross(across).normalize();
  const L = p.handLength, W = p.handWidth;
  const local = [new Vector3()];
  const thumb = REFERENCE_THUMB_JOINTS.map(([x, y]) => new Vector3(referenceX(x) * W, referenceY(y) * L, 0.001));
  const thumbApex = referenceFinger(0, 1);
  thumb[3].set(thumbApex.x * W, thumbApex.y * L, 0.001);
  const thumbScale = (p.thumbLength ?? 100) / 100;
  for (const point of thumb) local.push(thumb[0].clone().lerp(point, thumbScale));
  // MCP pivots sit inside the palm, below the visible finger webs. The second,
  // open-hand reference informs this placement; a silhouette cannot fix joint depth.
  const spreads = [0.045, 0, -0.035, -0.09];
  for (let f = 0; f < 4; f++) {
    const [x, y] = REFERENCE_ROOTS[f];
    const root = new Vector3(referenceX(x) * W, referenceY(y) * L, 0);
    const apex = referenceFinger(f + 1, 1);
    const tip = new Vector3(apex.x * W, apex.y * L, 0);
    tip.x += spreads[f] * (p.fingerSpread ?? 0) / 100 * (tip.y - root.y);
    const scale = (p[`${FINGERS[f + 1]}Length`] ?? 100) / 100;
    for (const fraction of [0, 0.46, 0.75, 1]) local.push(root.clone().lerp(tip, fraction * scale));
  }
  const points = local.map((v) => wrist.clone().addScaledVector(across, v.x).addScaledVector(along, v.y).addScaledVector(palm, v.z));
  return { wrist, along, across, palm, local, points, palmLength: L * 0.54 };
}

export function handMapping(side: 'l' | 'r'): Record<string, string> {
  return Object.fromEntries(HAND_JOINTS.map((name) => [`${name}_${side}`, name === 'wrist' ? `hand_${side}` : `${name}_${side}`]));
}
