// Joint positions (33 MediaPipe points) → rotations of the body's 17 bones.
// Rest pose: every bone has the identity rotation (see viewer / body.ts), so the world rotation of a
// bone equals the rotation from its rest direction.
//   hips  : basis from the hip line (left − right) and the spine (shoulder center − hip center)
//   chest : basis from the shoulder line and the spine; spine = halfway between hips and chest
//   head  : basis from the ear line and the chest's up direction; neck = halfway between chest and head
//   limbs : shortest rotation (relative to the parent) that points the bone at the captured direction
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { BodyMesh, BoneName } from '../model/body';
import { BONE_NAMES } from '../model/body';
import { J } from './clip';

export interface Pose {
  /** local rotation per bone, in BONE_NAMES order */
  local: Quaternion[];
  /** world rotation per bone */
  world: Quaternion[];
  /** world position of the hips joint */
  hips: Vector3;
}

const v = (a: ArrayLike<number>, i: number) => new Vector3(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);
const mid = (a: Vector3, b: Vector3) => a.clone().add(b).multiplyScalar(0.5);

/** rotation whose x axis follows `x` and whose y axis is as close to `up` as possible */
function basis(x: Vector3, up: Vector3): Quaternion {
  const xa = x.clone().normalize();
  const ya = up.clone().sub(xa.clone().multiplyScalar(up.dot(xa))).normalize();
  const za = new Vector3().crossVectors(xa, ya);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(xa, ya, za));
}

/** target direction for each limb bone from the joints, and its rest direction from the body */
interface LimbDef {
  bone: BoneName;
  from: (p: ArrayLike<number>) => Vector3;
  to: (p: ArrayLike<number>) => Vector3;
  rest: (b: BodyMesh) => Vector3;
}

function boneHead(b: BodyMesh, n: BoneName): Vector3 {
  const h = b.bones.find((x) => x.name === n)!.head;
  return new Vector3(h[0], h[1], h[2]);
}

function limbDefs(): LimbDef[] {
  const out: LimbDef[] = [];
  for (const s of ['l', 'r'] as const) {
    const sh = J[`${s}_shoulder`], el = J[`${s}_elbow`], wr = J[`${s}_wrist`];
    const ix = J[`${s}_index`], pk = J[`${s}_pinky`];
    const hp = J[`${s}_hip`], kn = J[`${s}_knee`], an = J[`${s}_ankle`], ft = J[`${s}_foot`];
    out.push(
      { bone: `upperarm_${s}`, from: (p) => v(p, sh), to: (p) => v(p, el), rest: (b) => boneHead(b, `forearm_${s}`).sub(boneHead(b, `upperarm_${s}`)) },
      { bone: `forearm_${s}`, from: (p) => v(p, el), to: (p) => v(p, wr), rest: (b) => boneHead(b, `hand_${s}`).sub(boneHead(b, `forearm_${s}`)) },
      // hand: wrist → middle of index and pinky knuckles; rest = along the forearm
      { bone: `hand_${s}`, from: (p) => v(p, wr), to: (p) => mid(v(p, ix), v(p, pk)), rest: (b) => boneHead(b, `hand_${s}`).sub(boneHead(b, `forearm_${s}`)) },
      { bone: `thigh_${s}`, from: (p) => v(p, hp), to: (p) => v(p, kn), rest: (b) => boneHead(b, `shin_${s}`).sub(boneHead(b, `thigh_${s}`)) },
      { bone: `shin_${s}`, from: (p) => v(p, kn), to: (p) => v(p, an), rest: (b) => boneHead(b, `foot_${s}`).sub(boneHead(b, `shin_${s}`)) },
      // foot: ankle → toes; rest = from the ankle down to the front of the foot box
      { bone: `foot_${s}`, from: (p) => v(p, an), to: (p) => v(p, ft), rest: (b) => new Vector3(0, -b.bones.find((x) => x.name === `foot_${s}`)!.head[1], 0.75 * footLength(b)) },
    );
  }
  return out;
}

function footLength(b: BodyMesh): number {
  return b.footLength;
}

const LIMBS = limbDefs();

const restCache = new WeakMap<BodyMesh, { hipsInv: Quaternion; chestInv: Quaternion }>();
function restTorso(body: BodyMesh) {
  let r = restCache.get(body);
  if (!r) {
    const lh = boneHead(body, 'thigh_l'), rh = boneHead(body, 'thigh_r');
    const ls = boneHead(body, 'upperarm_l'), rs = boneHead(body, 'upperarm_r');
    const up = mid(ls, rs).sub(mid(lh, rh));
    r = { hipsInv: basis(lh.clone().sub(rh), up).invert(), chestInv: basis(ls.clone().sub(rs), up).invert() };
    restCache.set(body, r);
  }
  return r;
}

export function computePose(body: BodyMesh, joints: ArrayLike<number>, root: [number, number, number] | null, root0: [number, number, number] | null): Pose {
  const n = BONE_NAMES.length;
  const world: Quaternion[] = new Array(n);
  const idx = (b: BoneName) => BONE_NAMES.indexOf(b);
  const lh = v(joints, J.l_hip), rh = v(joints, J.r_hip), ls = v(joints, J.l_shoulder), rs = v(joints, J.r_shoulder);
  const hipC = mid(lh, rh), shC = mid(ls, rs);
  const up = shC.clone().sub(hipC);
  // relative to the body's own rest-pose lines (its spine is not exactly vertical), so that
  // standing like the rest pose gives no rotation
  const rest = restTorso(body);
  world[idx('hips')] = basis(lh.clone().sub(rh), up).multiply(rest.hipsInv);
  world[idx('chest')] = basis(ls.clone().sub(rs), up).multiply(rest.chestInv);
  world[idx('spine')] = world[idx('hips')].clone().slerp(world[idx('chest')], 0.5);
  const le = v(joints, J.l_ear), re = v(joints, J.r_ear);
  const chestUp = new Vector3(0, 1, 0).applyQuaternion(world[idx('chest')]);
  world[idx('head')] = basis(le.clone().sub(re), chestUp);
  world[idx('neck')] = world[idx('chest')].clone().slerp(world[idx('head')], 0.5);
  for (const L of LIMBS) {
    const b = idx(L.bone);
    const parent = body.bones[b].parent;
    const Qp = world[parent];
    const restDir = L.rest(body).normalize();
    const cur = restDir.clone().applyQuaternion(Qp);
    const target = L.to(joints).sub(L.from(joints));
    if (target.lengthSq() < 1e-12) {
      world[b] = Qp.clone();
      continue;
    }
    const q = new Quaternion().setFromUnitVectors(cur, target.normalize());
    world[b] = q.multiply(Qp);
  }
  const local = world.map((q, i) => {
    const p = body.bones[i].parent;
    return p < 0 ? q.clone() : world[p].clone().invert().multiply(q);
  });
  const h = body.bones[idx('hips')].head;
  const hips = new Vector3(h[0], h[1], h[2]);
  if (root && root0) hips.add(new Vector3(root[0] - root0[0], root[1] - root0[1], root[2] - root0[2]));
  return { local, world, hips };
}
