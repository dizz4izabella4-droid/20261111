import { Box3, Matrix4, Quaternion, SkinnedMesh, Triangle, Vector3 } from 'three';
import type { BodyMesh } from './body';
import type { SoftnessField } from './softness';
import { smoothstep } from './interp';

/** Quasi-static soft contact in posed space. Contact pressure is shared between
 * arm/thigh and torso tissue by the existing per-vertex softness. Bones remain
 * fixed; normal skinning and the muscle-volume solver continue to supply the pose. */
export function softContactPositions(body: BodyMesh, mesh: SkinnedMesh, input: Float32Array, field: SoftnessField | null): Float32Array {
  if (!field) return input;
  const count = input.length / 3, cell = 0.045, reach = 0.055;
  mesh.updateMatrixWorld(true); mesh.skeleton.update();
  const posed = Array.from({ length: count }, (_, i) => mesh.applyBoneTransform(i, new Vector3().fromArray(input, i * 3)));
  const original = posed.map(p => p.clone());
  const torso = new Uint8Array(count), armSide = new Int8Array(count), thigh = new Uint8Array(count), armIds = new Set<number>();
  const faceIds: [number, number, number][] = [];
  for (const part of body.parts) {
    if (part.name === 'torso') {
      for (let i = part.start; i < part.start + part.count; i += 3) {
        const ids: [number, number, number] = [body.indices[i], body.indices[i + 1], body.indices[i + 2]];
        faceIds.push(ids); for (const id of ids) torso[id] = 1;
      }
    } else if (/^(upperarm|thigh)_[lr]$/.test(part.name)) {
      const side = part.name.endsWith('_l') ? 1 : -1;
      for (let i = part.start; i < part.start + part.count; i++) { const id = body.indices[i]; armSide[id] = side; thigh[id] = part.name.startsWith('thigh_') ? 1 : 0; armIds.add(id); }
    }
  }
  // Shared attachment vertices are tissue continuity, not a colliding pair.
  const arms = [...armIds].filter(id => !torso[id]);
  const roots = ['upperarm_l','upperarm_r','thigh_l','thigh_r'].map(name => {
    const index=body.bones.findIndex(b=>b.name===name), child=name.replace('upperarm','forearm').replace('thigh','shin');
    const root=mesh.skeleton.bones[index].getWorldPosition(new Vector3());
    const end=mesh.skeleton.bones[body.bones.findIndex(b=>b.name===child)].getWorldPosition(new Vector3());
    const axis=end.sub(root),length=axis.length();axis.normalize();
    const flex=mesh.skeleton.bones[index].quaternion.angleTo(new Quaternion());
    return {root,axis,length,flex};
  });
  const grid = new Map<string, number[]>(), box = new Box3();
  faceIds.forEach((ids, index) => {
    box.setFromPoints(ids.map(id => posed[id])).expandByScalar(reach);
    for (let x = Math.floor(box.min.x / cell); x <= Math.floor(box.max.x / cell); x++)
      for (let y = Math.floor(box.min.y / cell); y <= Math.floor(box.max.y / cell); y++)
        for (let z = Math.floor(box.min.z / cell); z <= Math.floor(box.max.z / cell); z++) {
          const key = `${x}/${y}/${z}`, list = grid.get(key) ?? []; list.push(index); grid.set(key, list);
        }
  });
  const tri = new Triangle(), closest = new Vector3(), hit = new Vector3(), normal = new Vector3(), bary = new Vector3(), relative = new Vector3();
  const sums = Array.from({ length: count }, () => new Vector3()), weights = new Float32Array(count);
  let changed = false;
  for (let iteration = 0; iteration < 6; iteration++) {
    for (const sum of sums) sum.set(0, 0, 0); weights.fill(0);
    for (const id of arms) {
      const isThigh=!!thigh[id];
      const p = posed[id], root = roots[(isThigh?2:0)+(armSide[id] > 0 ? 0 : 1)];
      const along = relative.copy(p).sub(root.root).dot(root.axis);
      const flexContact=isThigh?smoothstep(Math.PI/3,Math.PI*5/9,root.flex):0;
      const attachment = smoothstep(0.025, 0.075, along) * (isThigh ? (1-smoothstep(root.length*.6,root.length*.9,along))*flexContact : 1);
      if (!attachment) continue;
      const candidates = grid.get(`${Math.floor(p.x / cell)}/${Math.floor(p.y / cell)}/${Math.floor(p.z / cell)}`) ?? [];
      let nearest = -1, distance = reach * reach;
      for (const f of candidates) {
        const ids = faceIds[f];
        if(isThigh) {
          const y=(body.positions[ids[0]*3+1]+body.positions[ids[1]*3+1]+body.positions[ids[2]*3+1])/3;
          if(y<body.keyY.hip-.025||y>body.keyY.underbust+.015)continue;
        }
        // The opposite side of the chest is not an upper-arm contact surface.
        if ((posed[ids[0]].x + posed[ids[1]].x + posed[ids[2]].x) * armSide[id] < 0) continue;
        tri.set(posed[ids[0]], posed[ids[1]], posed[ids[2]]).closestPointToPoint(p, closest);
        const d = closest.distanceToSquared(p);
        if (d < distance) { distance = d; nearest = f; hit.copy(closest); }
      }
      if (nearest < 0) continue;
      const ids = faceIds[nearest]; tri.set(posed[ids[0]], posed[ids[1]], posed[ids[2]]).getNormal(normal);
      const signed = relative.copy(p).sub(hit).dot(normal);
      const penetration = 0.00075 - signed;
      if (signed < -reach) continue;
      if (penetration <= 0) {
        // In deep flexion, retain the volume of the opposing thigh/abdomen
        // tissue until the skins meet. This is local muscle/tissue support,
        // limited to nearby opposing surfaces, never a global limb translation.
        if(!isThigh||signed>.03*flexContact||normal.z<.1)continue;
        relative.copy(p).sub(root.root).addScaledVector(root.axis,-along).normalize();
        if(relative.dot(normal)>-.15)continue;
      }
      tri.getBarycoord(hit, bary);
      const b = [Math.max(0, bary.x), Math.max(0, bary.y), Math.max(0, bary.z)];
      const armCompliance = Math.max(0, field.softness[id]);
      const torsoCompliance = ids.reduce((sum, v, k) => sum + b[k] * field.softness[v], 0);
      const compliance = armCompliance + torsoCompliance; if (compliance < 1e-6) continue;
      const pressure = Math.max(-0.02, Math.min(0.025, penetration)) * 0.8 * attachment;
      sums[id].addScaledVector(normal, pressure * armCompliance / compliance); weights[id] += 1;
      ids.forEach((v, k) => {
        if (!b[k] || !field.softness[v]) return;
        sums[v].addScaledVector(normal, -pressure * torsoCompliance / compliance * b[k]); weights[v] += b[k];
      });
      changed = true;
    }
    for (let i = 0; i < count; i++) if (weights[i]) {
      posed[i].addScaledVector(sums[i], 1 / weights[i]);
      // Limit tissue displacement; zero softness pins bone-adjacent vertices.
      const limit = Math.min(0.018, 0.03 * Math.sqrt(Math.max(0, field.softness[i])));
      relative.copy(posed[i]).sub(original[i]);
      if (relative.length() > limit) posed[i].copy(original[i]).add(relative.setLength(limit));
    }
  }
  if (!changed) return input;
  // Feather pressure into adjacent tissue to avoid sharp dents. Fingers and
  // forearms are excluded, and both sides keep the same compliance constraints.
  const neighbors = Array.from({ length: count }, () => new Set<number>());
  for (const part of body.parts) if (part.name === 'torso' || /^(upperarm|thigh)_[lr]$/.test(part.name)) {
    for (let i = part.start; i < part.start + part.count; i += 3) {
      const ids = [body.indices[i], body.indices[i + 1], body.indices[i + 2]];
      for (let k = 0; k < 3; k++) { neighbors[ids[k]].add(ids[(k + 1) % 3]); neighbors[ids[(k + 1) % 3]].add(ids[k]); }
    }
  }
  let offsets = posed.map((p, i) => p.clone().sub(original[i]));
  for (let pass = 0; pass < 2; pass++) offsets = offsets.map((offset, i) => {
    if (!field.softness[i] || !neighbors[i].size) return offset;
    const mean = new Vector3(); for (const j of neighbors[i]) mean.add(offsets[j]); mean.divideScalar(neighbors[i].size);
    return offset.clone().lerp(mean, 0.25);
  });
  const out = input.slice(), skin = new Matrix4(), bone = new Matrix4(), inverse = new Matrix4();
  const index = mesh.geometry.getAttribute('skinIndex'), weight = mesh.geometry.getAttribute('skinWeight');
  for (let i = 0; i < count; i++) {
    if (offsets[i].lengthSq() < 1e-14) continue;
    skin.elements.fill(0);
    for (let k = 0; k < 4; k++) {
      const w = weight.getComponent(i, k); if (!w) continue;
      bone.fromArray(mesh.skeleton.boneMatrices!, index.getComponent(i, k) * 16);
      for (let j = 0; j < 16; j++) skin.elements[j] += bone.elements[j] * w;
    }
    inverse.copy(mesh.bindMatrixInverse).multiply(skin).multiply(mesh.bindMatrix);
    if (Math.abs(inverse.determinant()) < 1e-8) continue;
    original[i].add(offsets[i]).applyMatrix4(inverse.invert()).toArray(out, i * 3);
  }
  return out;
}
