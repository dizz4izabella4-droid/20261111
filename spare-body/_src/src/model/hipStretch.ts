import { Matrix4, Quaternion, SkinnedMesh, Vector3 } from 'three';
import type { BodyMesh } from './body';
import { smoothstep } from './interp';

/** Pose-space hip corrective. Sweep the joint band between the fixed pelvis
 * and rotated thigh instead of leaving the buttock/crotch to linear skinning.
 * Return bind-space positions so the existing skeleton, fingers and export
 * reference stay intact. Bend angle enlarges the stretch/compression band. */
export function hipStretchPositions(body: BodyMesh, mesh: SkinnedMesh, hipDegrees: number): Float32Array {
  if (Math.abs(hipDegrees) < 0.01) return body.positions;
  const out = body.positions.slice(), count = out.length / 3;
  const eligible = new Uint8Array(count);
  for (const part of body.parts) if (part.name === 'torso' || /^thigh_[lr]$/.test(part.name)) {
    for (let i = part.start; i < part.start + part.count; i++) eligible[body.indices[i]] = 1;
  }
  mesh.updateMatrixWorld(true); mesh.skeleton.update();
  const hips = (['l', 'r'] as const).map(side => {
    const index = body.bones.findIndex(b => b.name === `thigh_${side}`);
    const knee = body.bones.find(b => b.name === `shin_${side}`)!;
    const root = new Vector3(...body.bones[index].head);
    const axis = new Vector3(...knee.head).sub(root), length = axis.length(); axis.normalize();
    const rotation = mesh.skeleton.bones[index].quaternion.clone();
    const angle = rotation.angleTo(new Quaternion());
    // Use joint geometry for the tissue radius; no dependence on global stature.
    let radius = 0;
    for (const v of body.seams?.joints.find(j => j.name === `knee_${side}`)?.vertices ?? []) {
      radius = Math.max(radius, new Vector3().fromArray(body.positions, v * 3).distanceTo(new Vector3(...knee.head)));
    }
    radius = Math.max(0.065, Math.min(0.105, radius * 1.5));
    const band = Math.min(length * 0.48, radius * (1.6 + 0.8 * Math.sin(Math.min(Math.PI / 2, angle))));
    const rotated = axis.clone().applyQuaternion(rotation);
    return { sign: side === 'l' ? 1 : -1, root, axis, rotated, rotation, radius, band };
  });
  const p = new Vector3(), posed = new Vector3(), delta = new Vector3();
  const relative = new Vector3(), radial = new Vector3(), target = new Vector3();
  const q = new Quaternion(), matrix = new Matrix4(), skin = new Matrix4(), inverse = new Matrix4();
  const skinIndex = mesh.geometry.getAttribute('skinIndex'), skinWeight = mesh.geometry.getAttribute('skinWeight');
  for (let i = 0; i < count; i++) {
    if (!eligible[i]) continue;
    p.fromArray(body.positions, i * 3); posed.copy(p); mesh.applyBoneTransform(i, posed); delta.set(0, 0, 0);
    for (const h of hips) {
      const lateral = smoothstep(-0.025, 0.025, p.x * h.sign);
      if (!lateral) continue;
      relative.copy(p).sub(h.root);
      const d = relative.dot(h.axis), t = (d + h.band) / (2 * h.band);
      if (t <= 0 || t >= 1) continue;
      radial.copy(relative).addScaledVector(h.axis, -d);
      const local = 1 - smoothstep(h.radius * 1.5, h.radius * 2.6, radial.length());
      if (!local) continue;
      const t2 = t * t, t3 = t2 * t;
      // Cubic centerline with matching proximal/distal positions and tangents.
      target.copy(h.root).addScaledVector(h.axis, -h.band * (2 * t3 - 3 * t2 + 1))
        .addScaledVector(h.axis, 2 * h.band * (t3 - 2 * t2 + t))
        .addScaledVector(h.rotated, h.band * (-2 * t3 + 3 * t2))
        .addScaledVector(h.rotated, 2 * h.band * (t3 - t2));
      q.identity().slerp(h.rotation, smoothstep(0, 1, t));
      // Rotate the cross-section without inflating its radius. The curve itself
      // provides outer-side stretch and inner-side compression.
      target.add(radial.applyQuaternion(q));
      delta.addScaledVector(target.sub(posed), lateral * local * Math.sin(Math.PI * t) ** 2);
    }
    if (delta.lengthSq() < 1e-14) continue;
    // Invert the same four-weight matrix used by Three's skinning shader.
    skin.elements.fill(0);
    for (let k = 0; k < 4; k++) {
      const weight = skinWeight.getComponent(i, k); if (!weight) continue;
      matrix.fromArray(mesh.skeleton.boneMatrices!, skinIndex.getComponent(i, k) * 16);
      for (let j = 0; j < 16; j++) skin.elements[j] += matrix.elements[j] * weight;
    }
    inverse.copy(mesh.bindMatrixInverse).multiply(skin).multiply(mesh.bindMatrix);
    if (Math.abs(inverse.determinant()) < 1e-8) continue;
    posed.add(delta).applyMatrix4(inverse.invert()).toArray(out, i * 3);
  }
  return out;
}
