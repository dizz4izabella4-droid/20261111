import { describe, expect, it } from 'vitest';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { buildBody, type BodyMesh } from '../src/model/body';
import { presetParams, type PresetName } from '../src/model/params';
import { bakeSoftness, defaultSoftness, normalizeSoftness, previewOffset } from '../src/model/softness';
import { exportBodyGlb } from '../src/export/exportBody';

function verticesIn(body: BodyMesh, partName: string): Set<number> {
  const part = body.parts.find((p) => p.name === partName)!;
  return new Set(body.indices.subarray(part.start, part.start + part.count));
}

describe('softness field on the real body', () => {
  for (const preset of ['light', 'standard', 'high'] as PresetName[]) {
    for (const sex of ['male', 'female'] as const) {
      it(`${sex}/${preset}: finite, bounded and rigid head/hands/feet even after smoothing`, () => {
        const body = buildBody(presetParams(sex), preset);
        const options = { ...defaultSoftness(), smoothing: 10 };
        const field = bakeSoftness(body, options);
        expect(field.softness.length).toBe(body.positions.length / 3);
        expect(field.softness.every((s) => Number.isFinite(s) && s >= 0 && s <= 1)).toBe(true);
        expect(field.maxOffset.every((s, i) => s >= 0 && s <= options.maxOffset && Math.abs(s - field.softness[i] * options.maxOffset) < 1e-8)).toBe(true);
        expect(field.mean).toBeGreaterThan(0);
        for (const name of ['head', 'neck', 'hand_l', 'hand_r', 'foot_l', 'foot_r']) {
          for (const v of verticesIn(body, name)) expect(field.softness[v]).toBe(0);
        }
      });
    }
  }
  it('a region set to zero stays fixed without freezing other regions', () => {
    const body = buildBody(presetParams('female'), 'light');
    const o = defaultSoftness(); o.regions.arms = 0;
    const field = bakeSoftness(body, o);
    for (const v of verticesIn(body, 'upperarm_l')) expect(field.softness[v]).toBe(0);
    expect([...verticesIn(body, 'thigh_l')].some((v) => field.softness[v] > 0)).toBe(true);
    for (const key of Object.keys(o.regions) as (keyof typeof o.regions)[]) o.regions[key] = 0;
    expect(bakeSoftness(body, o).softness.every((v) => v === 0)).toBe(true);
  });
  it('a larger bone radius never increases softness', () => {
    const body = buildBody(presetParams('male'), 'standard');
    const small = bakeSoftness(body, { ...defaultSoftness(), radius: 0.01 });
    const large = bakeSoftness(body, { ...defaultSoftness(), radius: 0.06 });
    expect(large.softness.every((v, i) => v <= small.softness[i] + 1e-7)).toBe(true);
    expect(large.mean).toBeLessThan(small.mean);
  });
  it('mirrored vertices have the same softness', () => {
    const body = buildBody(presetParams('female'), 'standard');
    const field = bakeSoftness(body, defaultSoftness());
    const key = (x: number, y: number, z: number) => `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
    const values = new Map<string, number>();
    for (let i = 0; i < field.softness.length; i++) values.set(key(body.positions[3 * i], body.positions[3 * i + 1], body.positions[3 * i + 2]), field.softness[i]);
    let error = 0;
    for (let i = 0; i < field.softness.length; i++) {
      const mirrored = values.get(key(-body.positions[3 * i], body.positions[3 * i + 1], body.positions[3 * i + 2]))!;
      error = Math.max(error, Math.abs(mirrored - field.softness[i]));
    }
    expect(error).toBeLessThan(1e-6);
  });
});

describe('settings and impulse preview', () => {
  it('legacy settings get defaults; malformed values are normalized', () => {
    expect(normalizeSoftness(undefined)).toEqual(defaultSoftness());
    const s = normalizeSoftness({ radius: NaN, hardThickness: 0.9, softThickness: -1, smoothing: Infinity, maxOffset: -5, damping: 8, regions: { head: -1, arms: 3 } });
    expect(s.softThickness).toBeGreaterThan(s.hardThickness);
    expect(s.maxOffset).toBe(0); expect(s.damping).toBe(1);
    expect(s.regions.head).toBe(0); expect(s.regions.arms).toBe(1);
    expect(normalizeSoftness(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
  it('impulses respect the displacement limit and settle faster with more damping', () => {
    for (let t = 0; t < 8; t += 0.01) {
      expect(Math.abs(previewOffset(t, 0.8, 0.012, 0))).toBeLessThanOrEqual(0.012);
    }
    expect(Math.abs(previewOffset(1, 0.8, 0.012, 1))).toBeLessThan(Math.abs(previewOffset(1, 0.8, 0.012, 0)));
    expect(previewOffset(0, 1, 0.01, 0)).toBe(0);
    expect(previewOffset(0.5, 0, 0, 0)).toBe(0);
    expect(previewOffset(8, 1, 0.01, 0)).toBe(0);
  });
});

it('GLB round-trip retains all three fields, settings, skeleton and neutral appearance', async () => {
  const params = presetParams('male'), body = buildBody(params, 'light');
  const options = defaultSoftness(); options.regions.arms = 0.27; options.damping = 0.42;
  const field = bakeSoftness(body, options);
  const glb = exportBodyGlb(body, params, 'soft_body', options);
  const result: any = await new Promise((resolve, reject) => new GLTFLoader().parse(glb, '', resolve, reject));
  const mesh = result.scene.getObjectByProperty('isSkinnedMesh', true);
  for (const [name, expected] of [['_softness', field.softness], ['_max_offset', field.maxOffset], ['_damping', field.damping]] as const) {
    const attribute = mesh.geometry.getAttribute(name);
    expect(attribute.count).toBe(body.positions.length / 3);
    expect(Array.from(attribute.array)).toEqual(Array.from(expected));
  }
  expect(mesh.geometry.getAttribute('color')).toBeUndefined();
  expect(mesh.skeleton.bones.length).toBe(body.bones.length);
  expect(result.parser.json.scenes[0].extras.softness.settings).toEqual(options);
});
