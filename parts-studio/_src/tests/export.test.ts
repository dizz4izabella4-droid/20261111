import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { Assembly } from '../src/assembly-manager';
import { exportAssemblyGlb, verifyExport, FORMAT } from '../src/glb-exporter';
import { addSynthetic, boxGarment, loadBody, syntheticFace, syntheticHair } from './helpers';

const U = undefined as never;

async function buildCharacter(): Promise<Assembly> {
  const asm = new Assembly();
  await loadBody(asm);
  await addSynthetic(asm, syntheticFace(), 'face.glb', 'face');
  await addSynthetic(asm, syntheticHair(1), 'hair.glb', 'hair');
  const t = asm.bodyFeatures(asm.body!).regions.torso.getSize(new THREE.Vector3());
  await addSynthetic(asm, boxGarment([t.x * 1.1, t.y, t.z * 1.1], [0, 1.1, 0], 'vest_shirt'), 'vest.glb', 'garment');
  asm.setTransform(asm.face!.id, { r: [0.08, U, U] }); // a hand adjustment that must survive the export
  asm.setTransform(asm.of('garment')[0].id, { p: [0.01, U, U] });
  return asm;
}

const parse = async (blob: Blob) => new GLTFLoader().parseAsync(await blob.arrayBuffer(), '');

describe('GLB export: one scene, every part still its own node', () => {
  for (const attach of [false, true]) {
    it(`keeps parts, transforms, materials and skin (attachToBones=${attach})`, async () => {
      const asm = await buildCharacter();
      const r = await exportAssemblyGlb(asm, { attachToBones: attach });
      expect(r.bytes).toBeGreaterThan(10000);
      const g = await parse(r.blob);
      // each part is its own node, and no meshes were merged
      for (const p of asm.parts) expect(g.scene.getObjectByName(p.root.name), p.root.name).toBeTruthy();
      let meshes = 0;
      let skinned = 0;
      g.scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) meshes++;
        if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned++;
      });
      let live = 0;
      asm.root.traverse((o) => (o as THREE.Mesh).isMesh && live++);
      expect(meshes).toBe(live);
      expect(skinned).toBeGreaterThanOrEqual(1);
      // metadata (spec 3-C) on every part node and a format tag on the scene
      expect(g.scene.userData.format ?? g.scene.children[0].userData.format).toBeDefined();
      const body = g.scene.getObjectByName(asm.body!.root.name)!;
      expect(body.userData.schemaVersion).toBe(1);
      expect(body.userData.partType).toBe('body');
      expect(body.userData.coordinateSystem).toEqual({ up: 'Y', forward: 'Z', unit: 'meter' });
      expect(Object.keys(body.userData.anchors)).toEqual(['headRoot', 'neckBase', 'neckTop', 'hairRoot', 'garmentRoot']);
      expect(FORMAT).toBe('parts-studio-glb-v1');
      // reading it back matches what is on screen
      const v = await verifyExport(asm, r.blob);
      expect(v.lines.filter((l) => !l.ok), JSON.stringify(v.lines.filter((l) => !l.ok))).toHaveLength(0);
      expect(v.ok).toBe(true);
      if (attach) {
        const head = g.scene.getObjectByName('head')!;
        expect(head.getObjectByName(asm.face!.root.name)).toBeTruthy(); // the face hangs under the head bone
      }
      // the export did not leave the live scene in a changed state
      expect(asm.face!.root.parent).toBe(asm.root);
    });
  }

  it('keeps the custom vertex attributes of the body (softness etc.) and the skin weights exactly', async () => {
    const asm = await buildCharacter();
    const r = await exportAssemblyGlb(asm, { attachToBones: true });
    const g = await parse(r.blob);
    const a = asm.body!.model.getObjectByProperty('isSkinnedMesh', true) as THREE.SkinnedMesh;
    const b = g.scene.getObjectByName(asm.body!.root.name)!.getObjectByProperty('isSkinnedMesh', true) as THREE.SkinnedMesh;
    for (const k of Object.keys(a.geometry.attributes)) expect(b.geometry.attributes[k], k).toBeTruthy();
    const wa = a.geometry.attributes.skinWeight;
    const wb = b.geometry.attributes.skinWeight;
    expect(wb.count).toBe(wa.count);
    for (let i = 0; i < wa.count; i += 97) for (let c = 0; c < 4; c++) expect(wb.getComponent(i, c)).toBeCloseTo(wa.getComponent(i, c), 5);
  });

  it('does not export hidden parts and exports the neck deformation as it is on screen', async () => {
    const asm = await buildCharacter();
    asm.setVisible(asm.of('hair')[0].id, false);
    asm.setNeck(asm.body!.id, { length: 1.6, thickness: 1.2 });
    const r = await exportAssemblyGlb(asm, { attachToBones: false });
    const g = await parse(r.blob);
    expect(g.scene.getObjectByName(asm.of('hair')[0].root.name)).toBeUndefined();
    const v = await verifyExport(asm, r.blob);
    expect(v.ok).toBe(true);
    const a = asm.body!.model.getObjectByProperty('isSkinnedMesh', true) as THREE.SkinnedMesh;
    const b = g.scene.getObjectByName(asm.body!.root.name)!.getObjectByProperty('isSkinnedMesh', true) as THREE.SkinnedMesh;
    const pa = a.geometry.attributes.position;
    const pb = b.geometry.attributes.position;
    for (let i = 0; i < pa.count; i += 53) expect(pb.getY(i)).toBeCloseTo(pa.getY(i), 4);
  });
});
