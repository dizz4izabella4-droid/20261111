import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Assembly } from '../src/assembly-manager';
import { addSynthetic, loadBody, syntheticFace } from './helpers';

const U = undefined as never;

/** an open tube (like a sleeve or a tunic) around the torso */
function tube(radiusX: number, radiusZ: number, y0: number, y1: number, name: string): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.CylinderGeometry(1, 1, y1 - y0, 48, 16, true);
  geo.scale(radiusX, 1, radiusZ);
  geo.translate(0, (y0 + y1) / 2, 0);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }));
  m.name = name;
  g.add(m);
  return g;
}

describe('connection checks', () => {
  it('detects a gap between head and neck, and recovers when the head is lowered', async () => {
    const asm = new Assembly();
    await loadBody(asm);
    await addSynthetic(asm, syntheticFace(), 'face.glb', 'face');
    const face = asm.face!;
    expect(asm.connections.find((c) => c.kind === 'head-body')!.status).toBe('ok');
    asm.setTransform(face.id, { p: [U, face.root.position.y + 0.06, U] });
    asm.runChecks(false);
    const c = asm.connections.find((x) => x.kind === 'head-body')!;
    expect(c.status).toBe('adjust');
    expect(c.messages.some((m) => m.text.includes('隙間'))).toBe(true);
    asm.resetAuto(face.id);
    asm.setTransform(face.id, { p: [U, face.root.position.y - 0.09, U] });
    asm.runChecks(false);
    expect(asm.connections.find((x) => x.kind === 'head-body')!.messages.some((m) => m.text.includes('埋まりすぎ'))).toBe(true);
  });

  it('flags a head that has been moved sideways off the neck', async () => {
    const asm = new Assembly();
    await loadBody(asm);
    await addSynthetic(asm, syntheticFace(), 'face.glb', 'face');
    asm.setTransform(asm.face!.id, { p: [asm.face!.root.position.x + 0.08, U, U] });
    asm.runChecks(false);
    expect(asm.connections.find((x) => x.kind === 'head-body')!.status).toBe('adjust');
  });

  it('detailed check: a garment inside the body is a penetration, outside is fine, far away floats', async () => {
    const asm = new Assembly();
    await loadBody(asm);
    const bf = asm.bodyFeatures(asm.body!);
    const t = bf.regions.torso;
    const c = t.getCenter(new THREE.Vector3());
    const s = t.getSize(new THREE.Vector3());
    // tight tube: inside the chest/hips -> penetration
    await addSynthetic(asm, tube(0.06, 0.05, t.min.y + 0.05, t.max.y - 0.03, 'tight_shirt'), 'tight.glb', 'garment');
    const g = asm.of('garment')[0];
    asm.resetInitial(g.id); // exactly as authored: around the body's axis, far smaller than the torso
    g.root.position.set(0, 0, bf.neckBase[2]);
    asm.runChecks(true, [g.id]);
    const conn = asm.connections.find((x) => x.kind === 'garment-body')!;
    expect(conn.detailed).toBe(true);
    expect(conn.metrics.penetrationRatio).toBeGreaterThan(0.3);
    expect(conn.status).toBe('adjust');
    // a snug tube just outside the body surface: not a penetration problem
    g.root.position.set(0, 0, 0);
    asm.resetInitial(g.id);
    asm.runChecks(false);
    // moved far away: floating (light check notices the displacement)
    asm.setTransform(g.id, { p: [2, U, U] });
    asm.runChecks(false);
    expect(asm.connections.find((x) => x.kind === 'garment-body')!.status).toBe('adjust');
    expect(asm.connections.find((x) => x.kind === 'whole')!.status).toBe('adjust'); // part far from the body
  });

  it('two garments in the same place are reported', async () => {
    const asm = new Assembly();
    await loadBody(asm);
    const t = asm.bodyFeatures(asm.body!).regions.torso;
    await addSynthetic(asm, tube(0.17, 0.12, t.min.y, t.max.y, 'a_shirt'), 'a.glb', 'garment');
    await addSynthetic(asm, tube(0.17, 0.12, t.min.y, t.max.y, 'b_shirt'), 'b.glb', 'garment');
    const [a, b] = asm.of('garment');
    // undo the automatic layering step to force the coincident situation
    asm.setTransform(b.id, { s: [a.root.scale.x, a.root.scale.y, a.root.scale.z], p: [a.root.position.x, a.root.position.y, a.root.position.z] });
    asm.runChecks(false);
    const c = asm.connections.find((x) => x.kind === 'garment-garment')!;
    expect(c.status).toBe('adjust');
  });

  it('with no body, nothing is claimed: statuses stay 未判定 (unknown)', async () => {
    const asm = new Assembly();
    await addSynthetic(asm, syntheticFace(), 'face.glb', 'face');
    asm.runChecks(false);
    expect(asm.face!.fit.status).toBe('unknown');
    expect(asm.connections.find((x) => x.kind === 'head-body')!.status).toBe('unknown');
  });
});
