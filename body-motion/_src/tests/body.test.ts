import { describe, expect, it, afterAll } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ALL_DEFS, defaultParams, presetParams, type BodyParams, type PresetName } from '../src/model/params';
import { buildBody, BONE_NAMES, HIP_JOINT_ABOVE_CROTCH, type BodyMesh } from '../src/model/body';
import { buildBaseMesh, BodyModel } from '../src/model/mesh';
import { sectionPerimeter } from '../src/model/torso';
import { exportBodyGlb } from '../src/export/exportBody';
import { watertight, sliceGridPerimeter } from './geom';

const results: Record<string, unknown> = {};
afterAll(() => {
  mkdirSync('test-output', { recursive: true });
  writeFileSync('test-output/body-metrics.json', JSON.stringify(results, null, 2));
});

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randomParams(seed: number): BodyParams {
  const r = mulberry32(seed);
  const p = defaultParams();
  for (const d of ALL_DEFS) p[d.key] = d.min + (d.max - d.min) * r();
  return p;
}

function partOf(b: BodyMesh, name: string) {
  const part = b.parts.find((p) => p.name === name)!;
  const idx = b.indices.subarray(part.start, part.start + part.count);
  return { positions: b.positions, indices: Uint32Array.from(idx) };
}

const presets: PresetName[] = ['light', 'standard', 'high'];
const cases: [string, BodyParams][] = [['female', presetParams('female')], ['male', presetParams('male')]];
for (let s = 1; s <= 4; s++) cases.push([`random${s}`, randomParams(s * 313)]);

describe('every part is a closed (watertight) surface', () => {
  for (const preset of presets)
    for (const [name, params] of cases)
      it(`${preset} / ${name}`, () => {
        const b = buildBody(params, preset);
        const bad: string[] = [];
        for (const part of b.parts) {
          const w = watertight(partOf(b, part.name));
          if (w.badEdges || w.inconsistentEdges || w.degenerate || !(w.signedVolume > 0)) bad.push(`${part.name}:${JSON.stringify(w)}`);
        }
        results[`watertight/${preset}/${name}`] = { parts: b.parts.length, vertices: b.positions.length / 3, bad };
        expect(bad).toEqual([]);
        expect(b.positions.every(Number.isFinite)).toBe(true);
      });
});

describe('dimensions', () => {
  for (const [name, params] of cases)
    it(`${name}: height, floor, joint distances`, () => {
      const b = buildBody(params, 'standard');
      const bone = (n: string) => b.bones.find((x) => x.name === n)!.head;
      const dist = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      let minY = Infinity;
      for (let i = 1; i < b.positions.length; i += 3) minY = Math.min(minY, b.positions[i]);
      const expectedTop = b.crotchY + b.keyY.neckBase - b.crotchY + params.neckLength + params.headHeight;
      results[`dimensions/${name}`] = { height_cm: b.height * 100, minY_mm: minY * 1000 };
      expect(minY).toBeCloseTo(0, 6); // feet on the floor
      expect(b.height).toBeCloseTo(expectedTop, 6); // head box top
      expect(bone('hips')[1] - b.crotchY).toBeCloseTo(HIP_JOINT_ABOVE_CROTCH, 9);
      expect(b.keyY.neckBase - b.crotchY).toBeCloseTo(params.torsoHeight, 9);
      for (const sd of ['l', 'r']) {
        expect(dist(bone(`upperarm_${sd}`), bone(`forearm_${sd}`))).toBeCloseTo(params.upperArmLength, 9);
        expect(dist(bone(`forearm_${sd}`), bone(`hand_${sd}`))).toBeCloseTo(params.forearmLength, 9);
        expect(dist(bone(`thigh_${sd}`), bone(`shin_${sd}`))).toBeCloseTo(params.thighLength, 9);
        expect(dist(bone(`shin_${sd}`), bone(`foot_${sd}`))).toBeCloseTo(params.shinLength, 9);
        expect(bone(`foot_${sd}`)[1]).toBeCloseTo(params.ankleHeight, 9);
      }
      expect(Math.abs(bone('thigh_l')[0] - bone('thigh_r')[0])).toBeCloseTo(params.hipJointSpacing, 9);
    });
});

describe('torso circumferences (±1%)', () => {
  for (const [name, params] of cases)
    it(name, () => {
      const model = new BodyModel(params);
      const k = model.torso.keys;
      const out: Record<string, number> = {};
      const target: [string, number, number][] = [['waist', k.waist, params.waistCirc], ['underbust', k.underbust, params.underbustCirc], ['hip', k.hip, params.hipCirc]];
      const tm = buildBaseMesh(params, 'standard');
      for (const [key, y, c] of target) {
        out[`${key}Analytic`] = sectionPerimeter(model.torso.section(y)) / c - 1;
        out[`${key}Mesh`] = sliceGridPerimeter(tm, y) / c - 1;
      }
      results[`circumference/${name}`] = out;
      const heightsHonored = k.waist === params.waistHeight && k.underbust === params.underbustHeight && k.hip === params.hipHeight;
      for (const [key, v] of Object.entries(out)) if (heightsHonored || key.endsWith('Analytic')) expect(Math.abs(v), key).toBeLessThan(0.01);
    });
});

describe('symmetry and skin', () => {
  it('left and right mirror each other (X = 0)', () => {
    const b = buildBody(presetParams('female'), 'standard');
    for (const n of BONE_NAMES) {
      if (!n.endsWith('_l')) continue;
      const l = b.bones.find((x) => x.name === n)!.head;
      const r = b.bones.find((x) => x.name === n.replace(/_l$/, '_r'))!.head;
      expect(l[0]).toBeCloseTo(-r[0], 9);
      expect(l[1]).toBeCloseTo(r[1], 9);
      expect(l[2]).toBeCloseTo(r[2], 9);
    }
    // every vertex has a mirror vertex
    const key = (x: number, y: number, z: number) => `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
    const set = new Set<string>();
    for (let i = 0; i < b.positions.length; i += 3) set.add(key(b.positions[i], b.positions[i + 1], b.positions[i + 2]));
    let missing = 0;
    for (let i = 0; i < b.positions.length; i += 3) if (!set.has(key(-b.positions[i], b.positions[i + 1], b.positions[i + 2]))) missing++;
    results['symmetry/verticesWithoutMirror'] = missing;
    expect(missing).toBe(0);
  });
  it('skin weights sum to 1 and use valid bones', () => {
    for (const [, params] of cases) {
      const b = buildBody(params, 'standard');
      for (let v = 0; v < b.skinWeight.length; v += 4) {
        const s = b.skinWeight[v] + b.skinWeight[v + 1] + b.skinWeight[v + 2] + b.skinWeight[v + 3];
        expect(s).toBeCloseTo(1, 6);
        for (let q = 0; q < 4; q++) expect(b.skinIndex[v + q]).toBeLessThan(b.bones.length);
      }
    }
  });
  it('arm angle opens the arms (wrist moves outward)', () => {
    const xs = [0, 20, 40, 60, 80].map((a) => buildBody({ ...presetParams('female'), armAngle: a }, 'light').bones.find((x) => x.name === 'hand_l')!.head[0]);
    results['monotonic/armAngle_wristX'] = xs;
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
  });
});

describe('GLB export round-trip (GLTFLoader)', () => {
  it('body mesh and joint nodes', async () => {
    const b = buildBody(presetParams('female'), 'standard');
    const glb = exportBodyGlb(b);
    mkdirSync('test-output', { recursive: true });
    writeFileSync('test-output/body.glb', new Uint8Array(glb));
    const gltf: any = await new Promise((res, rej) => new GLTFLoader().parse(glb, '', res, rej));
    const names: string[] = [];
    gltf.scene.traverse((o: any) => names.push(o.name));
    expect(names).toContain('body');
    for (const n of BONE_NAMES) expect(names).toContain(`J_${n}`);
    expect(gltf.scene.getObjectByName('body').geometry.getAttribute('position').count).toBe(b.positions.length / 3);
    results['glb'] = { bytes: glb.byteLength, vertices: b.positions.length / 3, nodes: names.length };
  });
});
