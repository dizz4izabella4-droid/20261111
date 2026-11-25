// M1 automated tests: watertight base, circumference accuracy, breast monotonicity,
// no self-intersection, nipple sampling density, symmetry, GLB round-trip.
import { describe, expect, it, afterAll } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Mesh } from 'three';
import { defaultParams, type ModelParams, type PresetName, PRESETS, BODY_DEFS, BREAST_DEFS } from '../src/model/params';
import { buildBaseMesh, BodyModel, type BaseMesh } from '../src/model/mesh';
import { ArcTable, sectionPerimeter } from '../src/model/torso';
import { exportBaseGlb, LANDMARK_NODE_NAMES } from '../src/export/exportBase';
import { watertight, sliceGridPerimeter, selfIntersections, flippedFaces } from './geom';

const results: Record<string, unknown> = {};
afterAll(() => {
  mkdirSync('test-output', { recursive: true });
  writeFileSync('test-output/M1-metrics.json', JSON.stringify(results, null, 2));
});

const presets: PresetName[] = ['light', 'standard', 'high'];

/** deterministic pseudo random parameter sets inside the ranges */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randomParams(seed: number): ModelParams {
  const r = mulberry32(seed);
  const p = defaultParams();
  for (const d of BODY_DEFS) (p.body as any)[d.key] = d.min + (d.max - d.min) * r();
  for (const d of BREAST_DEFS) (p.breast as any)[d.key] = d.min + (d.max - d.min) * r();
  return p;
}
/** The defaults are flat (projection 0), so breast tests start from a non-flat reference shape. */
const REFERENCE_BREAST: Partial<ModelParams['breast']> = { projection: 0.045, nippleProjection: 0.006, areolaProjection: 0.001 };
function withBreast(over: Partial<ModelParams['breast']>, body?: Partial<ModelParams['body']>): ModelParams {
  const p = defaultParams();
  Object.assign(p.breast, REFERENCE_BREAST, over);
  if (body) Object.assign(p.body, body);
  return p;
}

function undeformed(mesh: BaseMesh, params: ModelParams): Float64Array {
  const model = new BodyModel(params);
  const cols = mesh.segments + 1;
  const out = new Float64Array(mesh.gridVertexCount * 3);
  for (let i = 0; i < mesh.rings; i++)
    for (let j = 0; j <= mesh.segments; j++) {
      const k = i * cols + j;
      const p = model.torso.pointU(mesh.thetas[j % mesh.segments], mesh.heights[i]);
      out[k * 3] = model.torso.clampX(p[0]);
      out[k * 3 + 1] = p[1];
      out[k * 3 + 2] = p[2];
    }
  return out;
}

describe('5.1-5 watertight base mesh', () => {
  const cases: [string, ModelParams][] = [['default', defaultParams()]];
  for (let s = 1; s <= 4; s++) cases.push([`random${s}`, randomParams(s * 101)]);
  for (const preset of presets)
    for (const [name, params] of cases)
      it(`${preset} / ${name}`, () => {
        const mesh = buildBaseMesh(params, preset);
        const r = watertight(mesh);
        results[`watertight/${preset}/${name}`] = { ...r, vertices: mesh.positions.length / 3 };
        expect(r.badEdges).toBe(0);
        expect(r.inconsistentEdges).toBe(0);
        expect(r.degenerate).toBe(0);
        expect(r.signedVolume).toBeGreaterThan(0);
      });
});

describe('5.2 circumference accuracy (±1%)', () => {
  const cases: [string, ModelParams][] = [['default', defaultParams()]];
  for (let s = 1; s <= 6; s++) cases.push([`random${s}`, randomParams(s * 7919)]);
  for (const [name, params] of cases)
    it(name, () => {
      const model = new BodyModel(params);
      const k = model.torso.keys;
      const out: Record<string, number> = {};
      // analytic cross-section of the generated surface
      const wA = sectionPerimeter(model.torso.section(k.waist));
      const uA = sectionPerimeter(model.torso.section(k.underbust));
      out.waistAnalyticErr = wA / params.body.waistCirc - 1;
      out.underbustAnalyticErr = uA / params.body.underbustCirc - 1;
      const heightsHonored = k.waist === params.body.waistHeight && k.underbust === params.body.underbustHeight;
      out.heightsHonored = heightsHonored ? 1 : 0;
      for (const preset of presets) {
        const mesh = buildBaseMesh(params, preset);
        out[`waistMeshErr_${preset}`] = sliceGridPerimeter(mesh, k.waist) / params.body.waistCirc - 1;
        out[`underbustMeshErr_${preset}`] = sliceGridPerimeter(mesh, k.underbust) / params.body.underbustCirc - 1;
      }
      results[`circumference/${name}`] = out;
      for (const [key, v] of Object.entries(out)) if (key.endsWith('Err')) expect(Math.abs(v), key).toBeLessThan(0.01);
      for (const [key, v] of Object.entries(out)) if (key.includes('MeshErr')) expect(Math.abs(v), key).toBeLessThan(0.01);
    });
});

// ---- breast measurements on the analytic surface (dense sampling, resolution independent) ----
function sampleLeftBreast(params: ModelParams, nTheta = 260, nY = 260) {
  const model = new BodyModel(params);
  const f = model.frames.find((fr) => fr.sigma > 0)!;
  let maxZ = -Infinity;
  let maxX = -Infinity;
  const y0 = f.yc - f.H2 - 0.01;
  const y1 = f.yc + f.H2 + 0.01;
  for (let i = 0; i <= nY; i++) {
    const y = y0 + ((y1 - y0) * i) / nY;
    const tab = new ArcTable(model.torso.section(y));
    for (let j = 0; j <= nTheta; j++) {
      const th = Math.PI * 0.25 + (Math.PI * 0.75 * j) / nTheta; // left/front quadrant
      const r = model.evalAt(th, y, tab);
      const c = r.comps[1]; // left breast
      const s = f.sigma * r.sMid - f.sB;
      const t = y - f.yc;
      const insideBase = (s / f.W2) ** 2 + (t / f.H2) ** 2 < 1;
      if (insideBase) maxZ = Math.max(maxZ, r.pos[2]);
      if (c.mask * (c.dome + c.areola + c.nipple) > 1e-5) maxX = Math.max(maxX, r.pos[0]);
    }
  }
  // apex = displaced dome peak (preimage s = cS, t = cT)
  const yA = f.yc + f.cT;
  const tabA = new ArcTable(model.torso.section(yA));
  const apex = model.evalAt(tabA.thetaAt(f.sB + f.cS), yA, tabA).pos;
  // nipple diameter: width (full width at half nipple height) along s through the nipple center
  let first = Infinity;
  let last = -Infinity;
  const tabN = new ArcTable(model.torso.section(f.yN));
  for (let i = 0; i <= 4000; i++) {
    const ds = -0.025 + (0.05 * i) / 4000;
    const th = tabN.thetaAt(f.sB + f.nS + ds);
    const r = model.evalAt(th, f.yN, tabN);
    if (r.comps[1].nipple >= 0.5 * f.nProj) {
      first = Math.min(first, ds);
      last = Math.max(last, ds);
    }
  }
  return { maxZ, maxX, apexY: apex[1], nippleDiameter: last - first, frame: f };
}

function expectIncreasing(name: string, vals: number[], xs: number[]) {
  results[`monotonic/${name}`] = xs.map((x, i) => ({ param: x, measured: vals[i] }));
  for (let i = 1; i < vals.length; i++) expect(vals[i], `${name} at ${xs[i]}`).toBeGreaterThan(vals[i - 1]);
}

describe('5.3-2 breast monotonicity', () => {
  it('projection -> max Z of the breast region', () => {
    const xs = [0, 0.02, 0.045, 0.08, 0.12];
    expectIncreasing('projection_maxZ', xs.map((v) => sampleLeftBreast(withBreast({ projection: v })).maxZ), xs);
  });
  it('baseWidth -> X extent of the deformed region', () => {
    const xs = [0.07, 0.1, 0.12, 0.15, 0.18];
    expectIncreasing('baseWidth_maxX', xs.map((v) => sampleLeftBreast(withBreast({ baseWidth: v })).maxX), xs);
  });
  it('centerHeight -> apex Y', () => {
    const xs = [0.3, 0.33, 0.37, 0.4, 0.44];
    expectIncreasing('centerHeight_apexY', xs.map((v) => sampleLeftBreast(withBreast({ centerHeight: v })).apexY), xs);
  });
  it('ptosis -> apex Y relative to centerHeight decreases', () => {
    const xs = [0, 25, 50, 75, 100];
    const vals = xs.map((v) => sampleLeftBreast(withBreast({ ptosis: v })).apexY - defaultParams().breast.centerHeight);
    expectIncreasing('ptosis_negApexYrel', vals.map((v) => -v), xs);
  });
  it('nippleDiameter -> measured nipple diameter', () => {
    const xs = [0.004, 0.008, 0.012, 0.016, 0.02];
    expectIncreasing('nippleDiameter_measured', xs.map((v) => sampleLeftBreast(withBreast({ nippleDiameter: v })).nippleDiameter), xs);
  });
});

describe('5.3-4 no self-intersection (Standard)', () => {
  const corners: [string, ModelParams][] = [];
  const ext = { size: [0, 100], projection: [0, 0.12], ptosis: [0, 100], baseWidth: [0.07, 0.18] };
  for (let m = 0; m < 16; m++) {
    const o: Record<string, number> = {};
    Object.entries(ext).forEach(([k, v], i) => (o[k] = v[(m >> i) & 1]));
    corners.push([`corner${m.toString(2).padStart(4, '0')}`, withBreast(o)]);
  }
  // extra extremes of the other breast parameters on top of the largest breast
  const big = { size: 100, projection: 0.12, ptosis: 100, baseWidth: 0.18, baseHeight: 0.17 };
  corners.push(['big+out30+narrow', withBreast({ ...big, outwardAngle: 30, spacing: 0.12 })]);
  corners.push(['big+out0+wide', withBreast({ ...big, outwardAngle: 0, spacing: 0.26 })]);
  corners.push(['big+high', withBreast({ ...big, centerHeight: 0.44 })]);
  corners.push(['big+low', withBreast({ ...big, centerHeight: 0.3, upperFullness: 100, lowerFullness: 100 })]);
  corners.push(['big+fullness0', withBreast({ ...big, upperFullness: 0, lowerFullness: 0, nippleProjection: 0.015, nippleDiameter: 0.004, areolaProjection: 0.008, areolaDiameter: 0.07, nippleOffsetX: 0.02, nippleOffsetY: -0.025 })]);
  corners.push(['big+thinChest', withBreast(big, { chestDepth: 0.15, underbustCirc: 0.6, shoulderWidth: 0.28 })]);
  for (const [name, params] of corners)
    it(name, () => {
      const mesh = buildBaseMesh(params, 'standard');
      const si = selfIntersections(mesh);
      const flips = flippedFaces(mesh, undeformed(mesh, params), new BodyModel(params).center);
      results[`selfIntersection/${name}`] = { ...si, flippedFaces: flips };
      expect(si.hits).toBe(0);
      expect(flips).toBe(0);
    });
});

describe('5.3-3 nipple sampling density', () => {
  for (const preset of presets)
    it(`${preset}: grid spacing at the nipple with nippleDiameter = 4 mm`, () => {
      const params = withBreast({ nippleDiameter: 0.004 });
      const mesh = buildBaseMesh(params, preset);
      const model = new BodyModel(params);
      const f = model.frames.find((fr) => fr.sigma > 0)!;
      // spacing between neighboring grid lines nearest to the nipple center
      const j = mesh.thetas.findIndex((t) => t > f.thetaN);
      const i = mesh.heights.findIndex((y) => y > f.yN);
      const tab = new ArcTable(model.torso.section(f.yN));
      const du = Math.abs(tab.sAt(mesh.thetas[j]) - tab.sAt(mesh.thetas[j - 1]));
      const dv = mesh.heights[i] - mesh.heights[i - 1];
      // grid vertices inside the nipple disk (footprint coords)
      const cols = mesh.segments + 1;
      let inside = 0;
      for (let ii = 0; ii < mesh.rings; ii++) {
        const tb = new ArcTable(model.torso.section(mesh.heights[ii]));
        for (let jj = 0; jj < mesh.segments; jj++) {
          const s = tb.sAt(mesh.thetas[jj]) - f.sB;
          const t = mesh.heights[ii] - f.yc;
          if (Math.hypot(s - f.nS, t - f.nT) < f.Rn) inside++;
        }
      }
      void cols;
      results[`nippleDensity/${preset}`] = { spacingU_mm: du * 1000, spacingV_mm: dv * 1000, verticesInside4mmNipple: inside };
      if (preset === 'standard') {
        expect(du).toBeLessThan(0.0012);
        expect(dv).toBeLessThan(0.0012);
        expect(inside).toBeGreaterThanOrEqual(9);
      }
    });
});

describe('symmetry (X = 0 plane)', () => {
  it('vertex j mirrors vertex M-j', () => {
    const mesh = buildBaseMesh(withBreast({}), 'standard');
    const cols = mesh.segments + 1;
    let maxErr = 0;
    for (let i = 0; i < mesh.rings; i++)
      for (let j = 0; j <= mesh.segments; j++) {
        const a = (i * cols + j) * 3;
        const b = (i * cols + (mesh.segments - j)) * 3;
        maxErr = Math.max(maxErr, Math.abs(mesh.positions[a] + mesh.positions[b]), Math.abs(mesh.positions[a + 1] - mesh.positions[b + 1]), Math.abs(mesh.positions[a + 2] - mesh.positions[b + 2]));
      }
    results['symmetry/maxErr_m'] = maxErr;
    expect(maxErr).toBeLessThan(1e-6);
  });
});

describe('10.3 GLB export round-trip (GLTFLoader)', () => {
  for (const preset of presets)
    it(preset, async () => {
      const mesh = buildBaseMesh(defaultParams(), preset);
      const glb = exportBaseGlb(mesh);
      mkdirSync('test-output', { recursive: true });
      writeFileSync(`test-output/base_${preset}.glb`, new Uint8Array(glb));
      const gltf: any = await new Promise((res, rej) => new GLTFLoader().parse(glb, '', res, rej));
      const names: string[] = [];
      gltf.scene.traverse((o: any) => names.push(o.name));
      for (const n of ['base', ...LANDMARK_NODE_NAMES]) expect(names, n).toContain(n);
      const base = gltf.scene.getObjectByName('base') as Mesh;
      const count = base.geometry.getAttribute('position').count;
      expect(count).toBe(mesh.positions.length / 3);
      expect(base.geometry.index!.count).toBe(mesh.indices.length);
      const lm = gltf.scene.getObjectByName('LM_nipple_L');
      expect(lm.position.x).toBeCloseTo(mesh.landmarks.LM_nipple_L[0], 6);
      results[`glb/${preset}`] = { bytes: glb.byteLength, vertices: count, triangles: mesh.indices.length / 3, nodes: names.filter((n) => n).length };
    });
});

describe('preset table', () => {
  it('grid sizes follow SPEC 11.1', () => {
    for (const p of presets) {
      const mesh = buildBaseMesh(defaultParams(), p);
      expect(mesh.segments).toBe(PRESETS[p].segments);
      expect(mesh.rings).toBe(PRESETS[p].rings);
    }
  });
});

describe('timing (info only, not a pass/fail threshold)', () => {
  it('base mesh build time per preset (Node, this machine)', () => {
    const out: Record<string, number> = {};
    for (const p of presets) {
      buildBaseMesh(defaultParams(), p); // warm-up
      const t0 = performance.now();
      const n = 5;
      for (let i = 0; i < n; i++) buildBaseMesh(defaultParams(), p);
      out[`${p}_ms`] = (performance.now() - t0) / n;
    }
    results['timing/buildBaseMesh'] = out;
  });
});
