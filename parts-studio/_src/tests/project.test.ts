import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Assembly } from '../src/assembly-manager';
import { parseProject, projectToJson, restoreProject, snapshot, embeddedFinder, ProjectError } from '../src/project-manager';
import { addSynthetic, boxGarment, loadBody, syntheticFace, syntheticHair } from './helpers';

const U = undefined as never;

describe('project save / restore', () => {
  it('restores types, transforms, manual adjustments, visibility, hierarchy and neck settings', async () => {
    const asm = new Assembly();
    await loadBody(asm);
    await addSynthetic(asm, syntheticFace(), 'face.glb', 'face');
    await addSynthetic(asm, syntheticHair(1), 'hair.glb', 'hair');
    const t = asm.bodyFeatures(asm.body!).regions.torso.getSize(new THREE.Vector3());
    await addSynthetic(asm, boxGarment([t.x, t.y, t.z], [0, 1.1, 0], 'coat_shirt'), 'coat.glb', 'garment');
    asm.setNeck(asm.body!.id, { length: 1.4, thickness: 1.15 });
    asm.setTransform(asm.face!.id, { r: [0.07, U, U] });
    asm.setTransform(asm.of('garment')[0].id, { p: [U, 1.0, U] });
    asm.setVisible(asm.of('hair')[0].id, false);
    asm.setRegion(asm.of('garment')[0].id, 'chest');

    // embedded JSON round trip (the same path as a saved .parts-studio.json with data included)
    const json = await projectToJson(asm, 'p1', true);
    const state = parseProject(json);
    const before = snapshot(asm, 'p1').parts;

    const asm2 = new Assembly();
    const rep = await restoreProject(asm2, state, embeddedFinder());
    expect(rep.errors).toEqual([]);
    expect(rep.missing).toEqual([]);
    expect(asm2.parts.map((p) => p.id).sort()).toEqual(asm.parts.map((p) => p.id).sort());
    const after = snapshot(asm2, 'p1').parts;
    for (const a of before) {
      const b = after.find((x) => x.id === a.id)!;
      expect(b.type).toBe(a.type);
      expect(b.name).toBe(a.name);
      expect(b.visible).toBe(a.visible);
      expect(b.parentId).toBe(a.parentId);
      expect(JSON.stringify(b.manual)).toBe(JSON.stringify(a.manual));
      expect(JSON.stringify(b.auto)).toBe(JSON.stringify(a.auto));
      expect(b.garment?.region).toBe(a.garment?.region);
      for (let i = 0; i < 3; i++) {
        expect(b.current.p[i]).toBeCloseTo(a.current.p[i], 6);
        expect(b.current.r[i]).toBeCloseTo(a.current.r[i], 6);
        expect(b.current.s[i]).toBeCloseTo(a.current.s[i], 6);
      }
    }
    expect(asm2.body!.bodyOpts!.neckLength).toBe(1.4);
    expect(asm2.body!.bodyOpts!.neckThickness).toBe(1.15);
    // the neck deformation really is applied again
    const f1 = asm.bodyFeatures(asm.body!);
    const f2 = asm2.bodyFeatures(asm2.body!);
    expect(f2.neckBase[1]).toBeCloseTo(f1.neckBase[1], 4);
    // connections are re-checked
    expect(asm2.connections.length).toBeGreaterThan(0);
  });

  it('parts whose files are missing are reported and skipped; the rest is restored', async () => {
    const asm = new Assembly();
    await loadBody(asm);
    await addSynthetic(asm, syntheticFace(), 'face.glb', 'face');
    const state = parseProject(await projectToJson(asm, 'x', false));
    const asm2 = new Assembly();
    const bodyBlob = asm.body!.files[0].blob;
    const rep = await restoreProject(asm2, state, async (_id, f) => (f.name === asm.body!.files[0].name ? bodyBlob : null));
    expect(rep.restored).toHaveLength(1);
    expect(rep.missing[0].part).toBe('face');
    expect(rep.missing[0].files).toEqual(['face.glb']);
  });

  it('rejects damaged or foreign project files with a reason', () => {
    expect(() => parseProject('{not json')).toThrow(ProjectError);
    expect(() => parseProject('{"format":"other"}')).toThrow(/プロジェクトファイルではありません/);
    expect(() => parseProject(JSON.stringify({ format: 'parts-studio-project', version: 9, parts: [] }))).toThrow(/バージョン/);
  });
});
