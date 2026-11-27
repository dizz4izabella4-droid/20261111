/** Store mostly-zero morph deltas as standard glTF sparse accessors for smaller Web assets. */
export function compactMorphTargets(input: ArrayBuffer): ArrayBuffer {
  const header = new DataView(input);
  const jsonLength = header.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(input, 20, jsonLength)));
  const binary = new Uint8Array(input, 28 + jsonLength);
  const additions = new Map<number, Uint8Array>();
  const targets = new Set<number>();
  for (const mesh of json.meshes ?? []) for (const primitive of mesh.primitives) for (const target of primitive.targets ?? []) {
    if (target.POSITION !== undefined) targets.add(target.POSITION);
  }
  if (!targets.size) return input;
  const viewData = (index: number) => {
    const view = json.bufferViews[index];
    return additions.get(index) ?? binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  };
  const addView = (data: Uint8Array) => {
    const index = json.bufferViews.length;
    json.bufferViews.push({ buffer: 0, byteLength: data.byteLength });
    additions.set(index, data); return index;
  };
  for (const index of targets) {
    const accessor = json.accessors[index];
    if (accessor.type !== 'VEC3' || accessor.componentType !== 5126 || accessor.bufferView === undefined || accessor.sparse) continue;
    const view = json.bufferViews[accessor.bufferView];
    const bytes = viewData(accessor.bufferView);
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const indices: number[] = [], values: number[] = [];
    for (let i = 0; i < accessor.count; i++) {
      const offset = (accessor.byteOffset ?? 0) + i * (view.byteStride ?? 12);
      const xyz = [0, 1, 2].map((j) => data.getFloat32(offset + j * 4, true));
      if (xyz.some((x) => x !== 0)) { indices.push(i); values.push(...xyz); }
    }
    if (indices.length * 16 >= accessor.count * 12) continue;
    delete accessor.bufferView; delete accessor.byteOffset;
    if (indices.length) {
      const small = accessor.count <= 65536;
      const ids = small ? Uint16Array.from(indices) : Uint32Array.from(indices);
      const floats = Float32Array.from(values);
      accessor.sparse = {
        count: indices.length,
        indices: { bufferView: addView(new Uint8Array(ids.buffer)), componentType: small ? 5123 : 5125 },
        values: { bufferView: addView(new Uint8Array(floats.buffer)) },
      };
    }
  }
  const references: { object: Record<string, number>; key: string }[] = [];
  for (const accessor of json.accessors ?? []) {
    if (accessor.bufferView !== undefined) references.push({ object: accessor, key: 'bufferView' });
    if (accessor.sparse) for (const key of ['indices', 'values']) references.push({ object: accessor.sparse[key], key: 'bufferView' });
  }
  for (const image of json.images ?? []) if (image.bufferView !== undefined) references.push({ object: image, key: 'bufferView' });
  const used = [...new Set(references.map(({ object, key }) => object[key]))].sort((a, b) => a - b);
  const chunks: { bytes: Uint8Array; offset: number }[] = [];
  let size = 0;
  const views = used.map((index) => {
    const bytes = viewData(index);
    const offset = Math.ceil(size / 4) * 4;
    chunks.push({ bytes, offset }); size = offset + bytes.byteLength;
    return { ...json.bufferViews[index], byteOffset: offset };
  });
  const remap = new Map(used.map((old, index) => [old, index]));
  for (const { object, key } of references) object[key] = remap.get(object[key])!;
  json.bufferViews = views;
  json.buffers[0].byteLength = size;
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const paddedJson = Math.ceil(encoded.byteLength / 4) * 4, paddedBin = Math.ceil(size / 4) * 4;
  const result = new ArrayBuffer(28 + paddedJson + paddedBin), out = new DataView(result);
  out.setUint32(0, 0x46546c67, true); out.setUint32(4, 2, true); out.setUint32(8, result.byteLength, true);
  out.setUint32(12, paddedJson, true); out.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(result, 20, paddedJson).fill(0x20); new Uint8Array(result, 20, encoded.length).set(encoded);
  out.setUint32(20 + paddedJson, paddedBin, true); out.setUint32(24 + paddedJson, 0x004e4942, true);
  const destination = new Uint8Array(result, 28 + paddedJson);
  for (const { bytes, offset } of chunks) destination.set(bytes, offset);
  return result;
}
