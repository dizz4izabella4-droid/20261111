// Full body: torso (with breasts) from the photo-tex model, limb tubes, neck, and placeholder boxes
// for the head, hands and feet. Rest pose: standing, arms opened by `armAngle`.
// World coordinates: meters, +Y up, +Z front, +X = the body's left; floor at y = 0, centered between the feet.
//
// Skeleton (names follow the "モーション" capture: upperarm / forearm / thigh / shin / foot, spine, shoulders):
//   hips ─ spine ─ chest ─ neck ─ head
//                   ├ upperarm_l ─ forearm_l ─ hand_l   (and _r)
//   hips ─ thigh_l ─ shin_l ─ foot_l                     (and _r)
// Each part is bound rigidly to one bone, except the torso, which blends hips → spine → chest.
import type { BodyParams, PresetName } from './params';
import { PRESETS } from './params';
import { buildBaseMesh, BodyModel } from './mesh';
import { box, norm, tube, type PartMesh, type V3 } from './parts';

/** hip joint (femoral head) height above the crotch */
export const HIP_JOINT_ABOVE_CROTCH = 0.07;

export const BONE_NAMES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'upperarm_l', 'forearm_l', 'hand_l', 'upperarm_r', 'forearm_r', 'hand_r',
  'thigh_l', 'shin_l', 'foot_l', 'thigh_r', 'shin_r', 'foot_r',
] as const;
export type BoneName = (typeof BONE_NAMES)[number];

const PARENT: Record<BoneName, BoneName | null> = {
  hips: null, spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  upperarm_l: 'chest', forearm_l: 'upperarm_l', hand_l: 'forearm_l',
  upperarm_r: 'chest', forearm_r: 'upperarm_r', hand_r: 'forearm_r',
  thigh_l: 'hips', shin_l: 'thigh_l', foot_l: 'shin_l',
  thigh_r: 'hips', shin_r: 'thigh_r', foot_r: 'shin_r',
};

export interface BoneInfo {
  name: BoneName;
  parent: number; // index, -1 for the root
  /** joint position in the rest pose (world) */
  head: V3;
}

export interface BodyPart {
  name: string;
  /** first index and index count in the merged index buffer */
  start: number;
  count: number;
}

export interface BodyMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  skinIndex: Uint16Array; // 4 per vertex
  skinWeight: Float32Array; // 4 per vertex
  parts: BodyPart[];
  bones: BoneInfo[];
  /** top of the head */
  height: number;
  /** torso key heights in world coordinates (for tests and display) */
  keyY: Record<string, number>;
  crotchY: number;
  warnings: string[];
}

const idx = (n: BoneName) => BONE_NAMES.indexOf(n);

export function buildBody(p: BodyParams, preset: PresetName): BodyMesh {
  const segs = PRESETS[preset].limbSegments;
  const model = new BodyModel(p);
  const torso = model.torso;
  const k = torso.keys;

  // ---------------- heights ----------------
  const hipJointY = p.ankleHeight + p.shinLength + p.thighLength;
  const crotchY = hipJointY - HIP_JOINT_ABOVE_CROTCH;
  const Y = (yt: number) => crotchY + yt; // torso → world
  const centerZ = (yt: number) => {
    const s = torso.section(yt);
    return s.cz + (s.bf - s.bb) / 2;
  };

  // ---------------- joints (rest pose) ----------------
  const head: Record<BoneName, V3> = {} as Record<BoneName, V3>;
  head.hips = [0, hipJointY, 0];
  head.spine = [0, Y(k.waist), centerZ(k.waist)];
  head.chest = [0, Y(k.underbust), centerZ(k.underbust)];
  const neckZ = centerZ(k.neckBase);
  head.neck = [0, Y(k.neckBase), neckZ];
  head.head = [0, Y(k.neckBase) + p.neckLength, neckZ];
  const a = (p.armAngle * Math.PI) / 180;
  for (const s of [1, -1] as const) {
    const sd = s > 0 ? 'l' : 'r';
    const sh: V3 = [s * torso.xs, Y(k.shoulderJoint), centerZ(k.shoulderJoint)];
    const dir: V3 = [s * Math.sin(a), -Math.cos(a), 0];
    const el: V3 = [sh[0] + dir[0] * p.upperArmLength, sh[1] + dir[1] * p.upperArmLength, sh[2]];
    const wr: V3 = [el[0] + dir[0] * p.forearmLength, el[1] + dir[1] * p.forearmLength, el[2]];
    head[`upperarm_${sd}` as BoneName] = sh;
    head[`forearm_${sd}` as BoneName] = el;
    head[`hand_${sd}` as BoneName] = wr;
    const hj: V3 = [(s * p.hipJointSpacing) / 2, hipJointY, 0];
    head[`thigh_${sd}` as BoneName] = hj;
    head[`shin_${sd}` as BoneName] = [hj[0], hipJointY - p.thighLength, 0];
    head[`foot_${sd}` as BoneName] = [hj[0], p.ankleHeight, 0];
  }
  const bones: BoneInfo[] = BONE_NAMES.map((n) => ({ name: n, parent: PARENT[n] ? idx(PARENT[n]!) : -1, head: head[n] }));

  // ---------------- parts ----------------
  const P: number[] = [];
  const N: number[] = [];
  const I: number[] = [];
  const SI: number[] = [];
  const SW: number[] = [];
  const parts: BodyPart[] = [];
  const addPart = (name: string, m: PartMesh | { positions: ArrayLike<number>; normals: ArrayLike<number>; indices: ArrayLike<number> }, weights: (x: number, y: number, z: number) => [number, number, number, number, number, number, number, number]) => {
    const base = P.length / 3;
    const start = I.length;
    for (let i = 0; i < m.positions.length; i += 3) {
      const x = m.positions[i], y = m.positions[i + 1], z = m.positions[i + 2];
      P.push(x, y, z);
      N.push(m.normals[i], m.normals[i + 1], m.normals[i + 2]);
      const w = weights(x, y, z);
      SI.push(w[0], w[1], w[2], w[3]);
      SW.push(w[4], w[5], w[6], w[7]);
    }
    for (let i = 0; i < m.indices.length; i++) I.push(m.indices[i] + base);
    parts.push({ name, start, count: I.length - start });
  };
  const rigid = (b: BoneName) => () => [idx(b), 0, 0, 0, 1, 0, 0, 0] as [number, number, number, number, number, number, number, number];

  // torso (world = torso + crotch offset), blended hips → spine → chest along the height
  const tm = buildBaseMesh(p, preset);
  const tpos = new Float32Array(tm.positions.length);
  for (let i = 0; i < tpos.length; i += 3) {
    tpos[i] = tm.positions[i];
    tpos[i + 1] = tm.positions[i + 1] + crotchY;
    tpos[i + 2] = tm.positions[i + 2];
  }
  const smooth = (e0: number, e1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  addPart('torso', { positions: tpos, normals: tm.normals, indices: tm.indices }, (_x, y) => {
    const yt = y - crotchY;
    if (yt <= k.waist) {
      const w = smooth(k.hip, k.waist, yt);
      return [idx('hips'), idx('spine'), 0, 0, 1 - w, w, 0, 0];
    }
    const w = smooth(k.waist, k.underbust + 0.5 * (k.bust - k.underbust), yt);
    return [idx('spine'), idx('chest'), 0, 0, 1 - w, w, 0, 0];
  });

  // neck: from inside the torso up to the head
  const neckR = (p.neckBaseWidth / 2) * 0.92;
  addPart(
    'neck',
    tube([0, Y(k.neckBase) - 0.03, neckZ], [0, Y(k.neckBase) + p.neckLength, neckZ], [1, 0, 0], [{ t: 0, circ: 2 * Math.PI * neckR * 1.05 }, { t: 1, circ: 2 * Math.PI * neckR * 0.95 }], 1.0, segs),
    rigid('neck'),
  );
  // head: placeholder box sitting on the neck
  const hc: V3 = [0, head.head[1] + p.headHeight / 2, neckZ + 0.01];
  addPart('head', box(hc, [1, 0, 0], [0, 1, 0], [0, 0, 1], p.headWidth / 2, p.headHeight / 2, p.headDepth / 2), rigid('head'));

  for (const s of [1, -1] as const) {
    const sd = s > 0 ? 'l' : 'r';
    const sh = head[`upperarm_${sd}` as BoneName], el = head[`forearm_${sd}` as BoneName], wr = head[`hand_${sd}` as BoneName];
    const dir = norm([wr[0] - sh[0], wr[1] - sh[1], wr[2] - sh[2]]);
    // arms: wider front-to-back than side-to-side is not needed for a first version; slight flattening
    addPart(
      `upperarm_${sd}`,
      tube(sh, el, [0, 0, 1], [{ t: 0, circ: p.upperArmCirc * 0.98 }, { t: 0.35, circ: p.upperArmCirc }, { t: 1, circ: p.elbowCirc }], 1.08, segs),
      rigid(`upperarm_${sd}` as BoneName),
    );
    addPart(
      `forearm_${sd}`,
      tube(el, wr, [0, 0, 1], [{ t: 0, circ: p.elbowCirc }, { t: 0.25, circ: p.forearmCirc }, { t: 1, circ: p.wristCirc }], 1.15, segs),
      rigid(`forearm_${sd}` as BoneName),
    );
    // hand: box from the wrist along the arm; palm facing the thigh (thickness along the side axis)
    const side = norm([Math.cos(a) * s, Math.sin(a), 0]); // perpendicular to the arm in the frontal plane
    const hcen: V3 = [wr[0] + (dir[0] * p.handLength) / 2, wr[1] + (dir[1] * p.handLength) / 2, wr[2] + (dir[2] * p.handLength) / 2];
    addPart(`hand_${sd}`, box(hcen, side, dir, [0, 0, 1], p.handThickness / 2, p.handLength / 2, p.handWidth / 2), rigid(`hand_${sd}` as BoneName));

    const hj = head[`thigh_${sd}` as BoneName], kn = head[`shin_${sd}` as BoneName], an = head[`foot_${sd}` as BoneName];
    addPart(
      `thigh_${sd}`,
      tube(hj, kn, [1, 0, 0], [{ t: 0, circ: p.thighCirc * 0.9 }, { t: 0.15, circ: p.thighCirc }, { t: 0.75, circ: 0.5 * (p.thighCirc + p.kneeCirc) * 0.95 }, { t: 1, circ: p.kneeCirc }], 1.0, segs),
      rigid(`thigh_${sd}` as BoneName),
    );
    addPart(
      `shin_${sd}`,
      tube(kn, an, [1, 0, 0], [{ t: 0, circ: p.kneeCirc }, { t: 0.3, circ: p.calfCirc }, { t: 1, circ: p.ankleCirc }], 0.95, segs),
      rigid(`shin_${sd}` as BoneName),
    );
    // foot: box on the floor, heel a little behind the ankle
    const fc: V3 = [an[0], p.ankleHeight / 2, 0.5 * p.footLength - 0.25 * p.footLength];
    addPart(`foot_${sd}`, box(fc, [1, 0, 0], [0, 1, 0], [0, 0, 1], p.footWidth / 2, p.ankleHeight / 2, p.footLength / 2), rigid(`foot_${sd}` as BoneName));
  }

  let height = 0;
  for (let i = 1; i < P.length; i += 3) height = Math.max(height, P[i]);
  const keyY: Record<string, number> = {};
  for (const [kk, v] of Object.entries(k)) keyY[kk] = Y(v);
  return {
    positions: Float32Array.from(P),
    normals: Float32Array.from(N),
    indices: Uint32Array.from(I),
    skinIndex: Uint16Array.from(SI),
    skinWeight: Float32Array.from(SW),
    parts,
    bones,
    height,
    keyY,
    crotchY,
    warnings: torso.warnings.slice(),
  };
}
