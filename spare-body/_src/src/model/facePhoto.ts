import type { BodyMesh } from './body';
import type { BodyParams } from './params';

export interface FaceCrop { x: number; y: number; zoom: number; }
export interface FacePhoto { source: string; texture: string; crop: FaceCrop; }
export const defaultFaceCrop = (): FaceCrop => ({ x: 50, y: 50, zoom: 100 });
const clamp = (v: unknown, min: number, max: number, fallback: number) => typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
export function cropRect(width: number, height: number, crop: FaceCrop) {
  const zoom = clamp(crop.zoom, 100, 400, 100) / 100;
  const w = Math.min(width, height * 0.75) / zoom, h = w / 0.75;
  const x = Math.max(0, Math.min(width - w, width * clamp(crop.x, 0, 100, 50) / 100 - w / 2));
  const y = Math.max(0, Math.min(height - h, height * clamp(crop.y, 0, 100, 50) / 100 - h / 2));
  return { x, y, width: w, height: h };
}
export function normalizeFacePhoto(value: unknown): FacePhoto | null {
  if (value == null) return null;
  const p = value as FacePhoto;
  const valid = (s: unknown) => typeof s === 'string' && s.length <= 16 * 1024 * 1024 && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(s);
  if (!valid(p.source) || !valid(p.texture) || !p.texture.startsWith('data:image/png;base64,')) throw new Error('顔画像の保存データが不正です。');
  return { source: p.source, texture: p.texture, crop: { x: clamp(p.crop?.x, 0, 100, 50), y: clamp(p.crop?.y, 0, 100, 50), zoom: clamp(p.crop?.zoom, 100, 400, 100) } };
}
/** Front decal, weighted entirely to the existing head; the body surface is preserved. */
export function facePhotoGeometry(body: BodyMesh, p: BodyParams) {
  const head = body.bones.findIndex((b) => b.name === 'head'), base = body.bones[head].head;
  const halfWidth = p.headWidth * 0.47;
  const bottom = base[1] + p.headHeight * 0.14, top = base[1] + p.headHeight * 0.98;
  const z = base[2] + 0.01 + p.headDepth / 2 + 0.001;
  return { positions: new Float32Array([-halfWidth, bottom, z, halfWidth, bottom, z, halfWidth, top, z, -halfWidth, top, z]),
    normals: new Float32Array([0,0,1, 0,0,1, 0,0,1, 0,0,1]), uvs: new Float32Array([0,1, 1,1, 1,0, 0,0]),
    indices: new Uint32Array([0,1,2, 0,2,3]), joints: new Uint16Array([head,0,0,0, head,0,0,0, head,0,0,0, head,0,0,0]),
    weights: new Float32Array([1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0]) };
}
export function facePngBytes(photo: FacePhoto): Uint8Array {
  if (!photo.texture.startsWith('data:image/png;base64,')) throw new Error('顔の切り取り画像はPNG形式で保存してください。');
  return Uint8Array.from(atob(photo.texture.split(',')[1]), (c) => c.charCodeAt(0));
}
