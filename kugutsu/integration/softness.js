// Motion-driven, bounded secondary deformation for spare-body-softness-v1.
// Morph targets keep this compatible with ordinary GLB animation playback after baking.
import { Float32BufferAttribute, Matrix3, Matrix4, SkinnedMesh, Vector3 } from 'three';

const KEY = 'kugutsuSoftness';

export function removeSoftness(mesh) {
  const saved = mesh.userData[KEY];
  if (!saved?.groups || !mesh.morphTargetInfluences) return;
  const indices = new Set(saved.groups.flatMap((g) => [g.target, g.target + 1, g.target + 2]));
  const values = mesh.morphTargetInfluences.filter((_, i) => !indices.has(i));
  const geo = mesh.geometry.clone();
  for (const key of Object.keys(geo.morphAttributes)) geo.morphAttributes[key] = geo.morphAttributes[key].filter((_, i) => !indices.has(i));
  mesh.geometry = geo;
  mesh.updateMorphTargets();
  if (mesh.morphTargetInfluences) values.forEach((value, i) => { mesh.morphTargetInfluences[i] = value; });
  delete mesh.userData[KEY];
}

export function createSoftness(root) {
  const meshes = [];
  root.traverse((mesh) => { if (mesh instanceof SkinnedMesh) meshes.push(mesh); });
  const entries = [];
  let activeVertices = 0;
  for (const mesh of meshes) {
    const geometry = mesh.geometry;
    const attributes = ['_softness', '_max_offset', '_damping'].map((name) => geometry.getAttribute(name) || geometry.getAttribute(name.toUpperCase()));
    if (attributes.every((a) => !a)) continue;
    const position = geometry.getAttribute('position');
    if (attributes.some((a) => !a || a.count !== position.count || a.itemSize !== 1)) throw new Error('柔らかさの頂点属性がそろっていません。');
    const [softness, maximum, damping] = attributes;
    for (let i = 0; i < position.count; i++) {
      const s = softness.getX(i), m = maximum.getX(i), d = damping.getX(i);
      if (![s, m, d].every(Number.isFinite) || s < 0 || s > 1 || m < 0 || d < 0 || d > 1) throw new Error('柔らかさの頂点属性に不正な値があります。');
    }
    const index = geometry.getAttribute('skinIndex'), weight = geometry.getAttribute('skinWeight');
    const groups = mesh.skeleton.bones.map((bone, boneIndex) => ({
      bone, boneIndex, center: new Vector3(), mass: 0, softness: 0, damping: 0,
      position: new Vector3(), velocity: new Vector3(), offset: new Vector3(), speed: new Vector3(), target: -1,
    }));
    for (let i = 0; i < position.count; i++) {
      if (maximum.getX(i) <= 0 || softness.getX(i) <= 0) continue;
      activeVertices++;
      for (let k = 0; k < 4; k++) {
        const group = groups[index.getComponent(i, k)];
        const mass = weight.getComponent(i, k) * maximum.getX(i);
        if (!group || mass <= 0) continue;
        group.center.addScaledVector(new Vector3().fromBufferAttribute(position, i), mass);
        group.mass += mass; group.softness += softness.getX(i) * mass; group.damping += damping.getX(i) * mass;
      }
    }
    const active = groups.filter((g) => g.mass > 0);
    if (!active.length) continue;
    for (const g of active) { g.center.divideScalar(g.mass); g.softness /= g.mass; g.damping /= g.mass; }
    const original = { geometry, influences: mesh.morphTargetInfluences?.slice(), dictionary: mesh.morphTargetDictionary, metadata: mesh.userData[KEY] };
    const geo = geometry.clone();
    // A previously exported GLB already carries these bases. Reuse them on reimport.
    const saved = mesh.userData[KEY];
    const reuse = saved?.version === 1 && active.every((g) => {
      const item = saved.groups?.find((x) => x.bone === g.boneIndex);
      if (!item || item.target < 0 || item.target + 2 >= (geo.morphAttributes.position?.length || 0)) return false;
      g.target = item.target; return true;
    });
    if (!reuse) {
      geo.morphAttributes.position = [...(geo.morphAttributes.position || [])];
      const relative = geo.morphTargetsRelative || geo.morphAttributes.position.length === 0;
      geo.morphTargetsRelative = relative;
      for (const g of active) {
        g.target = geo.morphAttributes.position.length;
        for (let axis = 0; axis < 3; axis++) {
          const data = new Float32Array(position.count * 3);
          if (!relative) for (let i = 0; i < position.count; i++) for (let c = 0; c < 3; c++) data[i * 3 + c] = position.getComponent(i, c);
          for (let i = 0; i < position.count; i++) {
            if (softness.getX(i) <= 0) continue;
            let w = 0;
            for (let k = 0; k < 4; k++) if (index.getComponent(i, k) === g.boneIndex) w += weight.getComponent(i, k);
            data[i * 3 + axis] += maximum.getX(i) * w;
          }
          const target = new Float32BufferAttribute(data, 3);
          target.name = `soft_${g.boneIndex}_${axis}`;
          geo.morphAttributes.position.push(target);
          if (geo.morphAttributes.normal?.length) {
            const normal = geometry.getAttribute('normal');
            const values = new Float32Array(position.count * 3);
            if (!relative && normal) for (let i = 0; i < normal.count; i++) for (let c = 0; c < 3; c++) values[i * 3 + c] = normal.getComponent(i, c);
            geo.morphAttributes.normal.push(new Float32BufferAttribute(values, 3));
          }
        }
      }
    }
    mesh.geometry = geo;
    mesh.updateMorphTargets();
    for (let i = 0; i < (original.influences?.length || 0); i++) mesh.morphTargetInfluences[i] = original.influences[i];
    mesh.userData[KEY] = { version: 1, groups: active.map((g) => ({ bone: g.boneIndex, target: g.target })) };
    entries.push({ mesh, groups: active, original });
  }
  if (!entries.length) return null;
  const transform = new Matrix4(), inverse = new Matrix3();
  const point = new Vector3(), velocity = new Vector3(), acceleration = new Vector3(), local = new Vector3();
  let enabled = true;
  function matrix(mesh, group) {
    return transform.copy(group.bone.matrixWorld).multiply(mesh.skeleton.boneInverses[group.boneIndex]).multiply(mesh.bindMatrix);
  }
  function reset() {
    root.updateMatrixWorld(true);
    for (const { mesh, groups } of entries) for (const g of groups) {
      g.position.copy(g.center).applyMatrix4(matrix(mesh, g));
      g.velocity.set(0, 0, 0); g.offset.set(0, 0, 0); g.speed.set(0, 0, 0);
      for (let k = 0; k < 3; k++) mesh.morphTargetInfluences[g.target + k] = 0;
    }
  }
  reset();
  return {
    meshes: entries.map((e) => e.mesh), activeVertices,
    get enabled() { return enabled; },
    setEnabled(value) { enabled = Boolean(value); reset(); },
    reset,
    update(dt) {
      if (!enabled || !Number.isFinite(dt) || dt <= 0) return false;
      if (dt > 0.25) { reset(); return true; }
      root.updateMatrixWorld(true);
      let moving = false;
      const steps = Math.ceil(Math.min(dt, 0.1) * 120), h = Math.min(dt, 0.1) / steps;
      for (const { mesh, groups } of entries) for (const g of groups) {
        point.copy(g.center).applyMatrix4(matrix(mesh, g));
        velocity.copy(point).sub(g.position).divideScalar(dt);
        acceleration.copy(velocity).sub(g.velocity).divideScalar(dt).clampLength(0, 400);
        g.position.copy(point); g.velocity.copy(velocity);
        const omega = 12 - g.softness * 5, decay = 1.2 + g.damping * 10;
        const wasMoving = g.offset.lengthSq() + g.speed.lengthSq() > 1e-9;
        for (let step = 0; step < steps; step++) {
          g.speed.addScaledVector(g.offset, -omega * omega * h).multiplyScalar(Math.exp(-decay * h)).addScaledVector(acceleration, -1.5 * h);
          g.offset.addScaledVector(g.speed, h);
          if (g.offset.lengthSq() > 1) {
            g.offset.normalize();
            const outward = g.speed.dot(g.offset);
            if (outward > 0) g.speed.addScaledVector(g.offset, -outward);
          }
        }
        const active = g.offset.lengthSq() + g.speed.lengthSq() > 1e-9;
        if (!active) { g.offset.set(0, 0, 0); g.speed.set(0, 0, 0); }
        moving ||= active || wasMoving;
        inverse.setFromMatrix4(transform.invert());
        local.copy(g.offset).applyMatrix3(inverse).clampLength(0, 1);
        for (let k = 0; k < 3; k++) mesh.morphTargetInfluences[g.target + k] = local.getComponent(k);
      }
      return moving;
    },
    dispose() {
      for (const { mesh, original } of entries) {
        mesh.geometry.dispose(); mesh.geometry = original.geometry;
        mesh.morphTargetInfluences = original.influences; mesh.morphTargetDictionary = original.dictionary;
        if (original.metadata) mesh.userData[KEY] = original.metadata;
        else delete mesh.userData[KEY];
      }
    },
  };
}
