import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Assembly, isHeadHidden } from '../src/assembly-manager';
import { addSynthetic, boxGarment, loadBody, syntheticFace, syntheticHair } from './helpers';
import { orientationMatrix, estimateOrientation } from '../src/coordinate-normalizer';
import { detectPartType } from '../src/part-detector';
import { boxIn } from '../src/util';

const worldBox = (a: Assembly, id: string) => boxIn(a.get(id)!.root, null);
const U = undefined as never;

describe('coordinate-normalizer', () => {
  it('converts Z-up / -Y-front / centimetre data to the studio frame without touching the model', () => {
    const m = orientationMatrix({ unit: 0.01, up: '+Z', forward: '-Y', yaw: 0, source: 'metadata' });
    const p = new THREE.Vector3(0, 0, 150).applyMatrix4(m); // 150cm tall in Z
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(1.5, 6);
    expect(p.z).toBeCloseTo(0, 6);
    const front = new THREE.Vector3(0, -10, 0).applyMatrix4(m); // 10cm toward the front (-Y)
    expect(front.z).toBeCloseTo(0.1, 6);
    expect(new THREE.Matrix4().extractRotation(m).determinant()).toBeCloseTo(1, 6);
  });

  it('reads declared metadata first, then falls back to size heuristics', () => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(50, 170, 30)));
    const est = estimateOrientation(g, { from: 'none' }, 'body');
    expect(est.unit).toBe(0.01); // 170 units tall cannot be metres for a body
    expect(est.source).toBe('estimated');
    const meta = estimateOrientation(g, { coordinateSystem: { up: 'Y', forward: 'Z', unit: 'meter' }, from: 'scene' }, 'body');
    expect(meta.unit).toBe(1);
    expect(meta.source).toBe('metadata');
  });
});

describe('part-detector', () => {
  it('trusts metadata, then skeleton, then names; unknown stays low-confidence', async () => {
    const asm = new Assembly();
    await loadBody(asm);
    expect(asm.body!.typeSource).toBe('metadata');
    const g = new THREE.Group();
    g.add(Object.assign(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1)), { name: 'cute_hair_strands' }));
    expect(detectPartType({ fileName: 'x.glb', names: ['cute_hair_strands'], meta: { from: 'none' }, model: g }).type).toBe('hair');
    expect(detectPartType({ fileName: 'x.glb', names: [], meta: { from: 'none', partType: 'garment' }, model: g }).confidence).toBe('high');
    const unk = detectPartType({ fileName: 'thing.glb', names: ['Cube'], meta: { from: 'none' }, model: g });
    expect(unk.confidence).toBe('low'); // the UI then asks the user
  });
});

describe('automatic fitting: body + face + hair + garment', () => {
  it('puts the head on the neck with a natural proportion, whatever the load order', async () => {
    for (const order of ['face-first', 'body-first'] as const) {
      const asm = new Assembly();
      if (order === 'face-first') {
        await addSynthetic(asm, syntheticFace(), 'face.glb', 'face');
        await loadBody(asm);
      } else {
        await loadBody(asm);
        await addSynthetic(asm, syntheticFace(), 'face.glb', 'face');
      }
      const body = asm.body!;
      const face = asm.face!;
      const bf = asm.bodyFeatures(body);
      const ff = asm.faceFeatures(face);
      expect(ff.hasNeck).toBe(true);
      const box = worldBox(asm, face.id);
      const headH = ff.headH * face.root.scale.y;
      expect(bf.height / headH).toBeGreaterThan(6);
      expect(bf.height / headH).toBeLessThan(9);
      expect(box.max.y).toBeGreaterThan(bf.box.max.y * 0.9);
      // neck axes coincide
      const neckW = new THREE.Vector3(...ff.neckBase!).applyMatrix4(face.root.matrixWorld);
      expect(Math.abs(neckW.x - bf.neckBase[0])).toBeLessThan(0.003);
      expect(Math.abs(neckW.z - bf.neckBase[2])).toBeLessThan(0.003);
      // the face's own neck overlaps the body's neck (no gap)
      expect(neckW.y).toBeLessThanOrEqual(bf.neckBase[1] + 1e-6);
      // the stand-in head of the body is hidden once a face exists
      const hm = body.model.getObjectByProperty('isSkinnedMesh', true) as THREE.SkinnedMesh;
      expect(isHeadHidden(hm)).toBe(true);
      expect(JSON.stringify(hm.userData)).not.toContain('_orig'); // internal state never lands in userData (it would be exported)
      expect(asm.connections.find((c) => c.kind === 'head-body')!.status).toBe('ok');
    }
  });

  it('handles a face WITHOUT a neck', async () => {
    const asm = new Assembly();
    await loadBody(asm);
    await addSynthetic(asm, syntheticFace(1, false), 'face_noneck.glb', 'face');
    const ff = asm.faceFeatures(asm.face!);
    expect(ff.hasNeck).toBe(false);
    const bf = asm.bodyFeatures(asm.body!);
    const root = new THREE.Vector3(...ff.headRoot).applyMatrix4(asm.face!.root.matrixWorld);
    expect(Math.abs(root.x - bf.neckTop[0])).toBeLessThan(0.003);
    expect(root.y).toBeLessThanOrEqual(bf.neckBase[1] + 1e-6); // the body's neck enters the jaw
    expect(asm.connections.find((c) => c.kind === 'head-body')!.status).toBe('ok');
  });

  it('fits hair in a different unit and size onto the skull, and the shape stays unchanged', async () => {
    const asm = new Assembly();
    await loadBody(asm);
    await addSynthetic(asm, syntheticFace(), 'face.glb', 'face');
    const hairObj = syntheticHair(10); // hair authored 10x too big (arbitrary units)
    const before = (hairObj.children[0] as THREE.Mesh).geometry.attributes.position.array.slice();
    await addSynthetic(asm, hairObj, 'hair.glb', 'hair');
    const hair = asm.of('hair')[0];
    expect(hair.parentId).toBe(asm.face!.id); // rides on the face
    expect(hair.root.scale.x).toBeLessThan(0.2); // scaled down to the head
    const hc = asm.connections.find((c) => c.kind === 'hair-head')!;
    expect(['ok', 'adjust']).toContain(hc.status);
    expect(hc.metrics.rootRadius).toBeGreaterThan(0.6);
    expect(hc.metrics.rootRadius).toBeLessThan(1.5);
    // the model itself was not modified
    const after = (hair.model.getObjectByName('hair_strands') as THREE.Mesh).geometry.attributes.position.array;
    expect(Array.from(after.slice(0, 30))).toEqual(Array.from(before.slice(0, 30)));
  });

  it('hair made in the same frame as the face is attached as-is', async () => {
    const asm = new Assembly();
    await loadBody(asm);
    await addSynthetic(asm, syntheticFace(), 'face.glb', 'face');
    await addSynthetic(asm, syntheticHair(1), 'hair.glb', 'hair');
    const hair = asm.of('hair')[0];
    expect(hair.fit.status).toBe('ok');
    expect(hair.root.scale.x).toBeCloseTo(1, 6);
    expect(hair.root.position.length()).toBeLessThan(1e-9);
    expect(hair.fit.note).toContain('同じ座標系');
  });

  it('places a rigid garment on the torso without changing its shape, and keeps two garments apart', async () => {
    const asm = new Assembly();
    await loadBody(asm);
    const bf = asm.bodyFeatures(asm.body!);
    const t = bf.regions.torso;
    const size = t.getSize(new THREE.Vector3());
    // a tunic authored 3x too big and shifted away from the body
    await addSynthetic(asm, boxGarment([size.x * 3.3, size.y * 3, size.z * 3], [5, 5, 5], 'tunic_shirt'), 'tunic.glb', 'garment');
    const g = asm.of('garment')[0];
    expect(g.garment!.region).toBe('torso'); // from the name "shirt"
    expect(g.garment!.rigMode).toBe('none');
    const gb = worldBox(asm, g.id);
    const tc = t.getCenter(new THREE.Vector3());
    expect(Math.abs(gb.getCenter(new THREE.Vector3()).x - tc.x)).toBeLessThan(0.02);
    expect(gb.max.y).toBeCloseTo(t.max.y, 1);
    // uniform scale only (shape intact)
    expect(g.root.scale.x).toBeCloseTo(g.root.scale.y, 9);
    expect(g.root.scale.y).toBeCloseTo(g.root.scale.z, 9);
    // a second garment for the same region gets an outward scale step
    await addSynthetic(asm, boxGarment([size.x * 3.3, size.y * 3, size.z * 3], [5, 5, 5], 'tunic2_shirt'), 'tunic2.glb', 'garment');
    const [a, b] = asm.of('garment');
    expect(b.root.scale.x).toBeGreaterThan(a.root.scale.x);
    expect(asm.connections.some((c) => c.kind === 'garment-garment')).toBe(true);
  });

  it('works with no anchors in the file (estimates them) and with a manual anchor override', async () => {
    const asm = new Assembly();
    await loadBody(asm);
    await addSynthetic(asm, syntheticFace(), 'face.glb', 'face');
    const r = asm.anchors(asm.face!);
    expect(r.anchors.headRoot?.source).toBe('estimated');
    asm.setAnchor(asm.face!.id, 'headRoot', [0, 0.1, 0]);
    expect(asm.anchors(asm.face!).anchors.headRoot).toEqual({ p: [0, 0.1, 0], source: 'manual' });
    asm.setAnchor(asm.face!.id, 'headRoot', null);
    expect(asm.anchors(asm.face!).anchors.headRoot?.source).toBe('estimated');
  });

  it('metadata anchors that lie outside the model are ignored with a warning, not trusted', async () => {
    const asm = new Assembly();
    await addSynthetic(asm, syntheticFace(), 'face.glb', 'face');
    const f = asm.face!;
    f.meta = { ...f.meta, anchors: { headRoot: [50, 50, 50], hairRoot: [0, 0.3, 0] } };
    const r = asm.anchors(f);
    expect(r.warnings[0]).toContain('headRoot');
    expect(r.anchors.headRoot?.source).toBe('estimated');
    expect(r.anchors.hairRoot?.source).toBe('metadata');
  });

  it('a second body replaces the first (one reference body only) and the rest follow it', async () => {
    const asm = new Assembly();
    await loadBody(asm, 'spare_body_female.glb');
    await addSynthetic(asm, syntheticFace(), 'face.glb', 'face');
    const y1 = asm.face!.root.position.y;
    await loadBody(asm, 'spare_body_male.glb');
    expect(asm.of('body')).toHaveLength(1);
    expect(asm.body!.fileName).toBe('spare_body_male.glb');
    expect(asm.face!.root.position.y).not.toBeCloseTo(y1, 3); // re-fitted to the taller body
  });
});

describe('manual adjustment vs automatic fitting', () => {
  it('re-running the auto fit keeps hand adjustments, and each reset does what it says', async () => {
    const asm = new Assembly();
    await loadBody(asm);
    await addSynthetic(asm, syntheticFace(), 'face.glb', 'face');
    const face = asm.face!;
    const autoY = face.root.position.y;
    asm.setTransform(face.id, { p: [U, autoY + 0.02, U] }); // absolute values, as typed in the number boxes
    asm.setTransform(face.id, { r: [0.1, U, U] });
    expect(face.manual).not.toBeNull();
    expect(face.root.position.y).toBeCloseTo(autoY + 0.02, 9);
    // re-run: the auto result is recomputed but the hand offset rides on top of it
    asm.refit({ keepManual: true });
    expect(face.root.position.y).toBeCloseTo(autoY + 0.02, 9);
    expect(face.root.rotation.x).toBeCloseTo(0.1, 9);
    // changing the body moves the auto result; the hand offset is kept relative to it
    asm.setNeck(asm.body!.id, { length: 1.5 });
    expect(face.root.position.y).toBeGreaterThan(autoY + 0.03);
    const yAfterNeck = face.root.position.y;
    // reset to auto drops the hand work of this part only
    asm.resetAuto(face.id);
    expect(face.manual).toBeNull();
    expect(face.root.position.y).toBeCloseTo(yAfterNeck - 0.02, 6);
    expect(face.root.rotation.x).toBeCloseTo(0, 9);
    // reset to initial = untouched file frame
    asm.resetInitial(face.id);
    expect(face.root.position.length()).toBe(0);
    expect(face.root.scale.x).toBe(1);
    // an explicit "discard" refit puts it back on the auto result
    asm.setTransform(face.id, { p: [U, autoY + 0.05, U] });
    asm.refit({ keepManual: false });
    expect(face.manual).toBeNull();
  });

  it('the neck can be lengthened and thickened by limited vertex deformation, and restored exactly', async () => {
    const asm = new Assembly();
    await loadBody(asm);
    const body = asm.body!;
    expect(body.bodyOpts!.neckSupported).toBe(true);
    const mesh = body.model.getObjectByProperty('isSkinnedMesh', true) as THREE.SkinnedMesh;
    const orig = (mesh.geometry.attributes.position.array as Float32Array).slice();
    const idx = mesh.geometry.index!.count;
    const f0 = asm.bodyFeatures(body);
    asm.setNeck(body.id, { length: 2, thickness: 1.4 });
    const f1 = asm.bodyFeatures(body);
    expect(f1.neckBase[1]).toBeGreaterThan(f0.neckBase[1] + 0.02);
    expect(f1.neckW).toBeGreaterThan(f0.neckW * 1.2);
    // topology, skin weights and vertex count are untouched
    expect(mesh.geometry.index!.count).toBe(idx);
    expect(mesh.geometry.attributes.skinWeight.count).toBe(orig.length / 3);
    asm.setNeck(body.id, { length: 1, thickness: 1 });
    const back = mesh.geometry.attributes.position.array as Float32Array;
    let maxd = 0;
    for (let i = 0; i < orig.length; i++) maxd = Math.max(maxd, Math.abs(orig[i] - back[i]));
    expect(maxd).toBeLessThan(1e-6);
  });

  it('a garment that follows the body bones refuses transforms (they would do nothing)', async () => {
    const asm = new Assembly();
    await loadBody(asm);
    const body = asm.body!;
    const skinned = body.model.getObjectByProperty('isSkinnedMesh', true) as THREE.SkinnedMesh;
    // a skinned garment with its own copy of the body's skeleton (same bone names)
    const geo = new THREE.CylinderGeometry(0.2, 0.2, 0.4, 16, 4);
    const chest = skinned.skeleton.bones.findIndex((b) => b.name === 'chest');
    expect(chest).toBeGreaterThan(-1);
    const n = geo.attributes.position.count;
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      si[i * 4] = chest;
      sw[i * 4] = 1;
    }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    geo.translate(0, 1.1, 0);
    const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xaa3333 }));
    mesh.name = 'cloth_vest';
    const copies = skinned.skeleton.bones.map((b) => {
      const c = new THREE.Bone();
      c.name = b.name;
      c.position.copy(b.position);
      c.quaternion.copy(b.quaternion);
      return c;
    });
    const root = new THREE.Group();
    skinned.skeleton.bones.forEach((b, i) => {
      const pi = skinned.skeleton.bones.indexOf(b.parent as THREE.Bone);
      if (pi >= 0) copies[pi].add(copies[i]);
      else root.add(copies[i]);
    });
    root.add(mesh);
    root.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(copies, skinned.skeleton.boneInverses.map((m) => m.clone())));
    await addSynthetic(asm, root, 'vest.glb', 'garment');
    const g = asm.of('garment')[0];
    expect(g.garment!.rigMode).toBe('follow');
    expect(asm.isLocked(g)).toBe(true);
    const before = g.root.position.toArray();
    asm.setTransform(g.id, { p: [1, 1, 1] });
    expect(g.root.position.toArray()).toEqual(before); // refused: nothing visible would change
    asm.setRigMode(g.id, 'independent');
    expect(g.garment!.rigMode).toBe('independent');
    expect(asm.isLocked(g)).toBe(false);
    asm.setTransform(g.id, { p: [0.05, U, U] });
    expect(g.root.position.x).toBeCloseTo(0.05, 6);
  });

  it('a garment with an incompatible rig is not re-targeted', async () => {
    const asm = new Assembly();
    await loadBody(asm);
    const geo = new THREE.CylinderGeometry(0.2, 0.2, 0.4, 16, 2);
    const n = geo.attributes.position.count;
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4));
    const sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) sw[i * 4] = 1;
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial());
    mesh.name = 'cloth_alien';
    const bone = new THREE.Bone();
    bone.name = 'zzz_unknown_bone';
    const root = new THREE.Group();
    root.add(bone, mesh);
    mesh.bind(new THREE.Skeleton([bone]));
    await addSynthetic(asm, root, 'alien.glb', 'garment');
    const g = asm.of('garment')[0];
    expect(g.garment!.rigMode).toBe('independent'); // own skeleton kept, placed by transform
    expect(g.garment!.rigCompatible).toBe(false);
    expect(g.garment!.rigInfo).toContain('非互換');
  });
});
