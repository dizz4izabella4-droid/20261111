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
