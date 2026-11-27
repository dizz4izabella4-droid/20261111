import { describe, expect, it } from 'vitest';
import { buildBody } from '../src/model/body';
import { presetParams } from '../src/model/params';
import { cropRect, defaultFaceCrop, normalizeFacePhoto, facePhotoGeometry, facePngBytes } from '../src/model/facePhoto';
import { exportBodyGlb } from '../src/export/exportBody';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const photo = { source: png, texture: png, crop: defaultFaceCrop() };

describe('face photo crop and portable export', () => {
  it('crops portrait, landscape and edge positions without leaving the image', () => {
    for (const [w,h] of [[4000,3000],[200,3000],[800,800]]) for (const x of [0,50,100]) for (const y of [0,50,100]) for (const zoom of [100,200,400]) {
      const r = cropRect(w,h,{x,y,zoom});
      expect(r.width / r.height).toBeCloseTo(0.75, 8);
      expect(r.x).toBeGreaterThanOrEqual(0); expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x+r.width).toBeLessThanOrEqual(w+1e-8); expect(r.y+r.height).toBeLessThanOrEqual(h+1e-8);
    }
  });
  it('saves and restores editable crop settings and rejects remote image references', () => {
    expect(normalizeFacePhoto(JSON.parse(JSON.stringify(photo)))).toEqual(photo);
    expect(normalizeFacePhoto(undefined)).toBeNull();
    expect(() => normalizeFacePhoto({ ...photo, source: 'https://example.com/face.jpg' })).toThrow();
    expect(normalizeFacePhoto({ ...photo, crop: { x:-10,y:999,zoom:NaN } })!.crop).toEqual({x:0,y:100,zoom:100});
  });
  it('embeds PNG, UVs and head weights in the GLB without modifying the body', () => {
    const p = presetParams('female'), body = buildBody(p,'light'), original = body.positions.slice();
    const decal = { ...facePhotoGeometry(body,p), png: facePngBytes(photo) };
    const glb = exportBodyGlb(body,p,'face_test',undefined,decal), view = new DataView(glb);
    const jsonLength = view.getUint32(12,true), json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb,20,jsonLength)));
    expect(json.meshes[0].primitives).toHaveLength(2);
    const front = json.meshes[0].primitives[1]; expect(front.attributes.TEXCOORD_0).toBeDefined();
    expect(json.materials[1].pbrMetallicRoughness.baseColorTexture.index).toBe(0);
    expect(json.images[0].mimeType).toBe('image/png'); expect(json.images[0].uri).toBeUndefined();
    const imageView = json.bufferViews[json.images[0].bufferView];
    expect(new Uint8Array(glb,28+jsonLength+imageView.byteOffset,imageView.byteLength)).toEqual(decal.png);
    const head = body.bones.findIndex((b) => b.name === 'head');
    for(let i=0;i<4;i++) { expect(decal.joints[i*4]).toBe(head); expect(decal.weights[i*4]).toBe(1); }
    expect(body.positions).toEqual(original);
  });
});
