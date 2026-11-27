// Joint positions (33 MediaPipe points from 「モーション」) → rotations of the rig's bones.
// Rotations are computed as changes from the rest pose ("delta"):
//   hips  : basis from the hip line (left − right) and the spine (shoulder center − hip center)
//   chest : basis from the shoulder line and the spine; spine = halfway between hips and chest
//   head  : basis from the ear line and the chest's up direction; neck = halfway between chest and head
//   limbs : shortest rotation (relative to the parent) that points the bone like the capture
// Torso bases are taken relative to the rig's own rest lines, so standing like the rest pose = no rotation.
// The final world rotation of a bone is delta · restWorldRotation (works for any bind rotations).
import { Matrix4, Quaternion, Vector3 } from 'three';
import { J } from './clip';
import type { Rig, RigBone } from './rig';

const v = (a: ArrayLike<number>, i: number) => new Vector3(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);
const mid = (a: Vector3, b: Vector3) => a.clone().add(b).multiplyScalar(0.5);

/** rotation whose x axis follows `x` and whose y axis is as close to `up` as possible */
function basis(x: Vector3, up: Vector3): Quaternion {
  const xa = x.clone().normalize();
  const ya = up.clone().sub(xa.clone().multiplyScalar(up.dot(xa))).normalize();
  const za = new Vector3().crossVectors(xa, ya);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(xa, ya, za));
}

interface Limb {
  bone: RigBone;
  parent: RigBone;
  /** captured direction */
  from: number | ((p: ArrayLike<number>) => Vector3);
  to: number | ((p: ArrayLike<number>) => Vector3);
  /** rest direction of the bone (world) */
  rest: (rig: Rig) => Vector3 | null;
}

const head = (rig: Rig, n: string) => rig.rest.get(n)?.pos.clone() ?? null;
const dirBetween = (rig: Rig, a: string, b: string) => {
  const pa = head(rig, a), pb = head(rig, b);
  return pa && pb ? pb.sub(pa) : null;
};

const LIMBS: Limb[] = (['l', 'r'] as const).flatMap((s) => {
  const ix = J[`${s}_index`], pk = J[`${s}_pinky`];
  return [
    { bone: `upperarm_${s}`, parent: 'chest', from: J[`${s}_shoulder`], to: J[`${s}_elbow`], rest: (r) => dirBetween(r, `upperarm_${s}`, `forearm_${s}`) },
    { bone: `forearm_${s}`, parent: `upperarm_${s}`, from: J[`${s}_elbow`], to: J[`${s}_wrist`], rest: (r) => dirBetween(r, `forearm_${s}`, `hand_${s}`) },
    // hand: wrist → middle of the index and pinky knuckles; rest = along the forearm
    { bone: `hand_${s}`, parent: `forearm_${s}`, from: J[`${s}_wrist`], to: (p) => mid(v(p, ix), v(p, pk)), rest: (r) => dirBetween(r, `forearm_${s}`, `hand_${s}`) },
    { bone: `thigh_${s}`, parent: 'hips', from: J[`${s}_hip`], to: J[`${s}_knee`], rest: (r) => dirBetween(r, `thigh_${s}`, `shin_${s}`) },
    { bone: `shin_${s}`, parent: `thigh_${s}`, from: J[`${s}_knee`], to: J[`${s}_ankle`], rest: (r) => dirBetween(r, `shin_${s}`, `foot_${s}`) },
    // foot: ankle → toes; rest = foot joint → toe end joint (or straight forward-down if the rig has no toe)
    {
      bone: `foot_${s}`, parent: `shin_${s}`, from: J[`${s}_ankle`], to: J[`${s}_foot`],
      rest: (r) => dirBetween(r, `foot_${s}`, `toe_${s}`) ?? (head(r, `foot_${s}`) ? new Vector3(0, -head(r, `foot_${s}`)!.y, 0.18) : null),
    },
  ] as Limb[];
});

const restCache = new WeakMap<Rig, { hipsInv: Quaternion; chestInv: Quaternion } | null>();
function restTorso(rig: Rig) {
  if (!restCache.has(rig)) {
    const lh = head(rig, 'thigh_l'), rh = head(rig, 'thigh_r'), ls = head(rig, 'upperarm_l'), rs = head(rig, 'upperarm_r');
    if (!lh || !rh || !ls || !rs) restCache.set(rig, null);
    else {
      const up = mid(ls, rs).sub(mid(lh, rh));
      restCache.set(rig, { hipsInv: basis(lh.clone().sub(rh), up).invert(), chestInv: basis(ls.clone().sub(rs), up).invert() });
    }
  }
  return restCache.get(rig)!;
}

export interface PoseResult {
  /** change from the rest pose, world space, per bone */
  delta: Map<string, Quaternion>;
  hips: Vector3 | null;
}

export function computePose(rig: Rig, joints: ArrayLike<number>, root: [number, number, number] | null, root0: [number, number, number] | null): PoseResult {
  const delta = new Map<string, Quaternion>();
  const rt = restTorso(rig);
  const lh = v(joints, J.l_hip), rh = v(joints, J.r_hip), ls = v(joints, J.l_shoulder), rs = v(joints, J.r_shoulder);
  const up = mid(ls, rs).sub(mid(lh, rh));
  const hipsQ = rt ? basis(lh.clone().sub(rh), up).multiply(rt.hipsInv) : new Quaternion();
  const chestQ = rt ? basis(ls.clone().sub(rs), up).multiply(rt.chestInv) : new Quaternion();
  delta.set('hips', hipsQ);
  delta.set('chest', chestQ);
  delta.set('spine', hipsQ.clone().slerp(chestQ, 0.5));
  const chestUp = new Vector3(0, 1, 0).applyQuaternion(chestQ);
  const headQ = basis(v(joints, J.l_ear).sub(v(joints, J.r_ear)), chestUp);
  delta.set('head', headQ);
  delta.set('neck', chestQ.clone().slerp(headQ, 0.5));
  const P = (s: number | ((p: ArrayLike<number>) => Vector3)) => (typeof s === 'number' ? v(joints, s) : s(joints));
  for (const L of LIMBS) {
    const restDir = L.rest(rig);
    const parentQ = delta.get(L.parent) ?? new Quaternion();
    if (!restDir || !rig.rest.has(L.bone)) continue;
    const cur = restDir.normalize().applyQuaternion(parentQ);
    const target = P(L.to).sub(P(L.from));
    if (target.lengthSq() < 1e-12) {
      delta.set(L.bone, parentQ.clone());
      continue;
    }
    delta.set(L.bone, new Quaternion().setFromUnitVectors(cur, target.normalize()).multiply(parentQ));
  }
  const h0 = head(rig, 'hips');
  const hips = h0 && root && root0 ? h0.add(new Vector3(root[0] - root0[0], root[1] - root0[1], root[2] - root0[2])) : null;
  return { delta, hips };
}

/** apply a pose to the rig's bones (parents before children) */
export function applyPose(rig: Rig, pose: PoseResult): void {
  const worldFinal = new Map<string, Quaternion>();
  // parents first (visit() walks up the hierarchy before setting a bone)
  const order = [...rig.rest.keys()];
  const done = new Set<string>();
  const visit = (name: string) => {
    if (done.has(name)) return;
    const r = rig.rest.get(name)!;
    const parent = r.bone.parent;
    if (parent && rig.rest.has(parent.name)) visit(parent.name);
    // bones without a captured rotation (e.g. toes) follow their nearest captured ancestor
    const d = pose.delta.get(name) ?? inherited(name) ?? new Quaternion();
    const q = d.clone().multiply(r.quat);
    worldFinal.set(name, q);
    const parentWorld = parent && rig.rest.has(parent.name) ? worldFinal.get(parent.name)! : parent ? parent.getWorldQuaternion(new Quaternion()) : new Quaternion();
    r.bone.quaternion.copy(parentWorld.clone().invert().multiply(q));
    done.add(name);
  };
  const inherited = (name: string): Quaternion | undefined => {
    let p = rig.rest.get(name)!.bone.parent;
    while (p && rig.rest.has(p.name)) {
      const d = pose.delta.get(p.name);
      if (d) return d;
      p = p.parent;
    }
    return undefined;
  };
  for (const n of order) visit(n);
  const hipsBone = rig.rest.get('hips')?.bone;
  if (hipsBone && pose.hips) {
    hipsBone.parent?.updateMatrixWorld(true);
    hipsBone.position.copy(hipsBone.parent ? hipsBone.parent.worldToLocal(pose.hips.clone()) : pose.hips);
  } else if (hipsBone) hipsBone.position.copy(rig.rest.get('hips')!.localPos);
  rig.scene.updateMatrixWorld(true);
}
