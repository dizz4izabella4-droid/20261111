import { describe, expect, it } from 'vitest';
import { loadModelsFromFiles, validateGlb } from '../src/part-loader';
import { bodyFile, fileOf } from './helpers';

describe('part-loader: reading and rejecting files', () => {
  it('reads a real spare-body GLB with its metadata and skeleton', async () => {
    const { models, errors } = await loadModelsFromFiles([await bodyFile()]);
    expect(errors).toHaveLength(0);
    expect(models).toHaveLength(1);
    const m = models[0];
    expect(m.format).toBe('glb');
    expect(m.meta.partType).toBe('body'); // spare-body-glb-v1 extras
    expect((m.meta.raw as { up?: string }).up).toBe('+Y');
    let bones = 0;
    m.object.traverse((o) => (o as { isBone?: boolean }).isBone && bones++);
    expect(bones).toBeGreaterThanOrEqual(15);
  });

  it('rejects an empty file, with the reason', async () => {
    const { models, errors } = await loadModelsFromFiles([fileOf(new Uint8Array(0), 'empty.glb')]);
    expect(models).toHaveLength(0);
    expect(errors[0].reason).toContain('空');
  });

  it('rejects a file that is not a GLB although it is named .glb', async () => {
    const { errors } = await loadModelsFromFiles([fileOf('hello this is not a glb file at all', 'fake.glb')]);
    expect(errors[0].reason).toContain('GLBではありません');
  });

  it('rejects a truncated GLB', async () => {
    const bytes = new Uint8Array(await (await bodyFile()).arrayBuffer());
    const { errors } = await loadModelsFromFiles([fileOf(bytes.slice(0, 5000) as BlobPart, 'cut.glb')]);
    expect(errors[0].reason).toMatch(/途中で切れ|壊れ/);
  });

  it('rejects a GLB with a wrong version', () => {
    const buf = new ArrayBuffer(40);
    const dv = new DataView(buf);
    dv.setUint32(0, 0x46546c67, true);
    dv.setUint32(4, 1, true);
    dv.setUint32(8, 40, true);
    expect(() => validateGlb(buf, 'v1.glb')).toThrow(/バージョン/);
  });

  it('names the unsupported format', async () => {
    const { errors } = await loadModelsFromFiles([fileOf('x', 'model.fbx', 'application/octet-stream')]);
    expect(errors[0].reason).toContain('.fbx');
  });

  it('rejects an OBJ without vertices and loads a valid one', async () => {
    const bad = await loadModelsFromFiles([fileOf('o nothing\n', 'a.obj', 'text/plain')]);
    expect(bad.errors[0].reason).toContain('頂点');
    const obj = 'o tri\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n';
    const ok = await loadModelsFromFiles([fileOf(obj, 'tri.obj', 'text/plain')]);
    expect(ok.errors).toHaveLength(0);
    expect(ok.models[0].format).toBe('obj');
  });

  it('reads OBJ + MTL when both are given, and warns when the MTL is missing', async () => {
    const obj = 'mtllib hat.mtl\no hat\nv 0 0 0\nv 1 0 0\nv 0 1 0\nusemtl red\nf 1 2 3\n';
    const mtl = 'newmtl red\nKd 1 0 0\n';
    const both = await loadModelsFromFiles([fileOf(obj, 'hat.obj', 'text/plain'), fileOf(mtl, 'hat.mtl', 'text/plain')]);
    expect(both.errors).toHaveLength(0);
    expect(both.models[0].warnings).toHaveLength(0);
    expect(both.models[0].files.map((f) => f.name).sort()).toEqual(['hat.mtl', 'hat.obj']);
    const solo = await loadModelsFromFiles([fileOf(obj, 'hat.obj', 'text/plain')]);
    expect(solo.models[0].warnings[0]).toContain('MTL');
  });

  it('reports an unsupported file even when other files load fine', async () => {
    const { models, errors } = await loadModelsFromFiles([await bodyFile(), fileOf('x', 'extra.fbx', 'application/octet-stream')]);
    expect(models).toHaveLength(1);
    expect(errors.map((e) => e.fileName)).toEqual(['extra.fbx']);
  });

  it('keeps going when one of several files is broken', async () => {
    const good = await bodyFile();
    const { models, errors } = await loadModelsFromFiles([fileOf('junk', 'bad.glb'), good]);
    expect(models).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });

  it('GLTF that points at a missing .bin says which file is missing', async () => {
    const gltf = JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'missing.bin', byteLength: 10 }], scenes: [{ nodes: [] }], scene: 0 });
    const { errors } = await loadModelsFromFiles([fileOf(gltf, 'x.gltf', 'model/gltf+json')]);
    expect(errors[0].reason).toContain('missing.bin');
  });
});
