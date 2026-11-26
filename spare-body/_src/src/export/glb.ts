// Minimal GLB (glTF 2.0 binary) writer: indexed triangle meshes + empty nodes.
// Meters, +Y up, +Z front (glTF convention). No external dependencies.

export interface GlbMeshPart {
  name: string;
  positions: Float32Array;
  normals: Float32Array;
  uvs?: Float32Array;
  indices: Uint32Array;
  /** sRGB hex color, e.g. 0x3a6fd8 */
  color: number;
  materialName: string;
}

export interface GlbEmpty {
  name: string;
  translation: [number, number, number];
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function hexToLinear(hex: number): [number, number, number] {
  return [srgbToLinear(((hex >> 16) & 255) / 255), srgbToLinear(((hex >> 8) & 255) / 255), srgbToLinear((hex & 255) / 255)];
}

export function writeGlb(parts: GlbMeshPart[], empties: GlbEmpty[], generator = 'photo-tex'): ArrayBuffer {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const bufferViews: object[] = [];
  const accessors: object[] = [];

  const addView = (data: ArrayBufferView, target: number): number => {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const pad = (4 - (offset % 4)) % 4;
    if (pad) {
      chunks.push(new Uint8Array(pad));
      offset += pad;
    }
    chunks.push(bytes);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, target });
    offset += bytes.byteLength;
    return bufferViews.length - 1;
  };

  const meshes: object[] = [];
  const materials: object[] = [];
  const nodes: object[] = [];
  const sceneNodes: number[] = [];

  for (const p of parts) {
    const n = p.positions.length / 3;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++)
      for (let c = 0; c < 3; c++) {
        const v = p.positions[i * 3 + c];
        if (v < min[c]) min[c] = v;
        if (v > max[c]) max[c] = v;
      }
    const vPos = addView(p.positions, 34962);
    accessors.push({ bufferView: vPos, componentType: 5126, count: n, type: 'VEC3', min, max });
    const aPos = accessors.length - 1;
    const vNrm = addView(p.normals, 34962);
    accessors.push({ bufferView: vNrm, componentType: 5126, count: n, type: 'VEC3' });
    const aNrm = accessors.length - 1;
    const attributes: Record<string, number> = { POSITION: aPos, NORMAL: aNrm };
    if (p.uvs) {
      const vUv = addView(p.uvs, 34962);
      accessors.push({ bufferView: vUv, componentType: 5126, count: n, type: 'VEC2' });
      attributes.TEXCOORD_0 = accessors.length - 1;
    }
    const vIdx = addView(p.indices, 34963);
    accessors.push({ bufferView: vIdx, componentType: 5125, count: p.indices.length, type: 'SCALAR' });
    const aIdx = accessors.length - 1;
    const c = hexToLinear(p.color);
    materials.push({
      name: p.materialName,
      pbrMetallicRoughness: { baseColorFactor: [c[0], c[1], c[2], 1], metallicFactor: 0, roughnessFactor: 1 },
      doubleSided: false,
    });
    meshes.push({ name: p.name, primitives: [{ attributes, indices: aIdx, material: materials.length - 1, mode: 4 }] });
    nodes.push({ name: p.name, mesh: meshes.length - 1 });
    sceneNodes.push(nodes.length - 1);
  }
  for (const e of empties) {
    nodes.push({ name: e.name, translation: e.translation });
    sceneNodes.push(nodes.length - 1);
  }

  const binLength = offset + ((4 - (offset % 4)) % 4);
  const json = {
    asset: { version: '2.0', generator },
    scene: 0,
    scenes: [{ name: 'bust', nodes: sceneNodes }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binLength }],
  };
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  if (jsonPad) {
    const padded = new Uint8Array(jsonBytes.length + jsonPad).fill(0x20);
    padded.set(jsonBytes);
    jsonBytes = padded;
  }
  const totalLength = 12 + 8 + jsonBytes.length + 8 + binLength;
  const out = new ArrayBuffer(totalLength);
  const dv = new DataView(out);
  const u8 = new Uint8Array(out);
  dv.setUint32(0, 0x46546c67, true); // 'glTF'
  dv.setUint32(4, 2, true);
  dv.setUint32(8, totalLength, true);
  dv.setUint32(12, jsonBytes.length, true);
  dv.setUint32(16, 0x4e4f534a, true); // 'JSON'
  u8.set(jsonBytes, 20);
  let p = 20 + jsonBytes.length;
  dv.setUint32(p, binLength, true);
  dv.setUint32(p + 4, 0x004e4942, true); // 'BIN\0'
  p += 8;
  let o = 0;
  for (const c of chunks) {
    u8.set(c, p + o);
    o += c.byteLength;
  }
  return out;
}

export interface SkinnedPart {
  name: string;
  positions: Float32Array; // bind pose (world)
  normals: Float32Array;
  indices: Uint32Array;
  joints: Uint16Array; // 4 per vertex (indices into `bones`)
  weights: Float32Array; // 4 per vertex
  color: number;
  materialName: string;
}

export interface SkinBone {
  name: string;
  parent: number; // -1 = root
  /** joint position in the bind pose (world); bind rotations are identity */
  head: [number, number, number];
}

/**
 * GLB with one skinned mesh and its skeleton (glTF 2.0 skin). Bones are nodes named after the bones,
 * translated relative to their parent, with identity rotations in the bind pose. `extras` is stored
 * on the scene (glTF "extras") for programs that read the file.
 */
export function writeSkinnedGlb(part: SkinnedPart, bones: SkinBone[], extras: Record<string, unknown>, generator: string): ArrayBuffer {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const bufferViews: object[] = [];
  const accessors: object[] = [];
  const addView = (data: ArrayBufferView, target?: number): number => {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const pad = (4 - (offset % 4)) % 4;
    if (pad) {
      chunks.push(new Uint8Array(pad));
      offset += pad;
    }
    chunks.push(bytes);
    bufferViews.push(target ? { buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, target } : { buffer: 0, byteOffset: offset, byteLength: bytes.byteLength });
    offset += bytes.byteLength;
    return bufferViews.length - 1;
  };
  const n = part.positions.length / 3;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++)
    for (let c = 0; c < 3; c++) {
      const v = part.positions[i * 3 + c];
      if (v < min[c]) min[c] = v;
      if (v > max[c]) max[c] = v;
    }
  accessors.push({ bufferView: addView(part.positions, 34962), componentType: 5126, count: n, type: 'VEC3', min, max });
  accessors.push({ bufferView: addView(part.normals, 34962), componentType: 5126, count: n, type: 'VEC3' });
  accessors.push({ bufferView: addView(part.joints, 34962), componentType: 5123, count: n, type: 'VEC4' });
  accessors.push({ bufferView: addView(part.weights, 34962), componentType: 5126, count: n, type: 'VEC4' });
  accessors.push({ bufferView: addView(part.indices, 34963), componentType: 5125, count: part.indices.length, type: 'SCALAR' });
  // inverse bind matrices: bind rotations are identity, so each is a translation by −head (column-major)
  const ibm = new Float32Array(bones.length * 16);
  bones.forEach((b, i) => {
    ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -b.head[0], -b.head[1], -b.head[2], 1], i * 16);
  });
  accessors.push({ bufferView: addView(ibm), componentType: 5126, count: bones.length, type: 'MAT4' });
  const c = hexToLinear(part.color);
  // nodes: 0 = mesh, 1.. = bones
  const nodes: object[] = [{ name: part.name, mesh: 0, skin: 0 }];
  bones.forEach((b) => {
    const ph = b.parent >= 0 ? bones[b.parent].head : [0, 0, 0];
    const children = bones.map((x, j) => (x.parent === bones.indexOf(b) ? j + 1 : -1)).filter((j) => j >= 0);
    nodes.push({ name: b.name, translation: [b.head[0] - ph[0], b.head[1] - ph[1], b.head[2] - ph[2]], ...(children.length ? { children } : {}) });
  });
  const rootJoint = bones.findIndex((b) => b.parent < 0) + 1;
  const binLength = offset + ((4 - (offset % 4)) % 4);
  const json = {
    asset: { version: '2.0', generator },
    scene: 0,
    scenes: [{ name: 'body', nodes: [0, rootJoint], extras }],
    nodes,
    meshes: [{ name: part.name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1, JOINTS_0: 2, WEIGHTS_0: 3 }, indices: 4, material: 0, mode: 4 }] }],
    materials: [{ name: part.materialName, pbrMetallicRoughness: { baseColorFactor: [c[0], c[1], c[2], 1], metallicFactor: 0, roughnessFactor: 1 } }],
    skins: [{ name: 'skeleton', joints: bones.map((_, i) => i + 1), inverseBindMatrices: 5, skeleton: rootJoint }],
    accessors,
    bufferViews,
    buffers: [{ byteLength: binLength }],
  };
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  if (jsonPad) {
    const padded = new Uint8Array(jsonBytes.length + jsonPad).fill(0x20);
    padded.set(jsonBytes);
    jsonBytes = padded;
  }
  const totalLength = 12 + 8 + jsonBytes.length + 8 + binLength;
  const out = new ArrayBuffer(totalLength);
  const dv = new DataView(out);
  const u8 = new Uint8Array(out);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, totalLength, true);
  dv.setUint32(12, jsonBytes.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  u8.set(jsonBytes, 20);
  let p = 20 + jsonBytes.length;
  dv.setUint32(p, binLength, true);
  dv.setUint32(p + 4, 0x004e4942, true);
  p += 8;
  let o = 0;
  for (const ch of chunks) {
    u8.set(ch, p + o);
    o += ch.byteLength;
  }
  return out;
}
