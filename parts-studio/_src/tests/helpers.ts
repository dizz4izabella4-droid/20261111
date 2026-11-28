// Test fixtures. The body is a REAL spare-body GLB from this repository (kugutsu/samples); heads, hair
// and garments are small synthetic stand-ins (real face / hair / garment data is checked in the browser
// script scripts/e2e.mjs, because the real face has a texture that needs a browser to decode).
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Assembly } from '../src/assembly-manager';
import { loadModelsFromFiles, type LoadedModel } from '../src/part-loader';

// minimal browser globals for the modules under test
const g = globalThis as unknown as Record<string, unknown>;
g.window ??= globalThis;
if (typeof g.FileReader === 'undefined') {
  g.FileReader = class {
    result: ArrayBuffer | string | null = null;
    onloadend: (() => void) | null = null;
    onload: (() => void) | null = null;
    readAsArrayBuffer(b: Blob): void {
      void b.arrayBuffer().then((r) => {
        this.result = r;
        this.onload?.();
        this.onloadend?.();
      });
    }
    readAsDataURL(b: Blob): void {
      void b.arrayBuffer().then((r) => {
        this.result = 'data:' + (b.type || 'application/octet-stream') + ';base64,' + Buffer.from(r).toString('base64');
        this.onload?.();
        this.onloadend?.();
      });
    }
  };
}

export const samplePath = (n: string): string => fileURLToPath(new URL(`../../../kugutsu/samples/${n}`, import.meta.url));
export const sampleBytes = (n: string): Uint8Array => new Uint8Array(readFileSync(samplePath(n)));

export function fileOf(bytes: BlobPart, name: string, type = 'model/gltf-binary'): File {
  return new File([bytes], name, { type });
}

export async function bodyFile(name = 'spare_body_female.glb'): Promise<File> {
  return fileOf(sampleBytes(name) as BlobPart, name);
}

export async function glbOf(obj: THREE.Object3D): Promise<Uint8Array> {
  const buf = (await new GLTFExporter().parseAsync(obj, { binary: true })) as ArrayBuffer;
  return new Uint8Array(buf);
}

/** an ellipsoid head with a neck tube under it; origin at the bottom of the neck, +Z is the face */
export function syntheticFace(scale = 1, neck = true): THREE.Group {
  const g = new THREE.Group();
  const neckH = neck ? 0.07 : 0;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 48, 32), new THREE.MeshStandardMaterial({ color: 0xffd9b0 }));
  head.name = 'Head';
  // a 14.6cm wide, 23cm tall, 19.6cm deep head sitting on the neck
  head.geometry.scale(0.146, 0.23, 0.196);
  head.geometry.translate(0, neckH + 0.115 - (neck ? 0.0 : 0.0), 0.012);
  g.add(head);
  if (neck) {
    const n = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.043, neckH + 0.02, 24, 16, true), head.material);
    n.name = 'Neck';
    n.geometry.translate(0, (neckH + 0.02) / 2, 0);
    g.add(n);
  }
  g.scale.setScalar(scale);
  g.updateMatrixWorld(true);
  bake(g);
  return g;
}

/** bake the group scale into geometry so loaded "files" carry real sizes */
function bake(g: THREE.Group): void {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.geometry.applyMatrix4(g.matrixWorld);
  });
  g.scale.set(1, 1, 1);
  g.updateMatrixWorld(true);
}

/** strands: arcs of thin quads over the skull, in `unit` sized coordinates, +Z front */
export function syntheticHair(scale = 1): THREE.Group {
  const g = new THREE.Group();
  const pos: number[] = [];
  const idx: number[] = [];
  let v = 0;
  for (let k = 0; k < 120; k++) {
    const az = (k / 120) * Math.PI * 2;
    for (let s = 0; s < 12; s++) {
      const el = (s / 11) * (Math.PI / 2) * 1.05;
      const rx = 0.085;
      const ry = 0.125;
      const rz = 0.105;
      const x = Math.cos(az) * Math.cos(el) * rx;
      const z = Math.sin(az) * Math.cos(el) * rz + 0.012;
      const y = Math.sin(el) * ry + 0.17;
      pos.push(x, y, z, x + 0.002, y, z);
      if (s) idx.push(v - 2, v - 1, v, v - 1, v + 1, v);
      v += 2;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.scale(scale, scale, scale);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x3a2418, side: THREE.DoubleSide }));
  m.name = 'hair_strands';
  g.add(m);
  return g;
}

/** a box-like garment (no skin) of the given size centred at `c` */
export function boxGarment(size: [number, number, number], c: [number, number, number], name = 'tunic'): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(...size, 4, 4, 4), new THREE.MeshStandardMaterial({ color: 0x3355aa }));
  m.geometry.translate(...c);
  m.name = name;
  g.add(m);
  return g;
}

export function modelOf(object: THREE.Object3D, fileName: string, bytes?: Uint8Array): LoadedModel {
  const names: string[] = [];
  object.traverse((o) => o.name && names.push(o.name));
  return {
    object,
    format: 'glb',
    fileName,
    meta: { from: 'none' },
    files: [{ name: fileName, type: 'model/gltf-binary', size: bytes?.length ?? 0, blob: new Blob([(bytes ?? new Uint8Array(0)) as BlobPart]) }],
    warnings: [],
    names,
  };
}

export async function loadBody(asm: Assembly, name = 'spare_body_female.glb'): Promise<void> {
  const { models, errors } = await loadModelsFromFiles([await bodyFile(name)]);
  if (!models.length) throw errors[0];
  await asm.addModel(models[0]);
}

/** a real GLB blob of a synthetic object, parsed through the real loader (so files/meta are genuine) */
export async function addSynthetic(asm: Assembly, obj: THREE.Object3D, fileName: string, type?: 'face' | 'hair' | 'garment' | 'body') {
  const bytes = await glbOf(obj);
  const { models, errors } = await loadModelsFromFiles([fileOf(bytes as BlobPart, fileName)]);
  if (!models.length) throw errors[0];
  return asm.addModel(models[0], type);
}
