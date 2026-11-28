// coordinate-normalizer: bring every part into the studio's common frame
// (meters, +Y up, +Z front, +X the character's left) WITHOUT touching the loaded data.
// The conversion lives on a wrapper group (`part.norm`); the model inside is left as it was read.
import * as THREE from 'three';
import type { AxisSpec, Orientation, PartMeta, PartType } from './types';
import { boxIn, rad } from './util';

const AXIS: Record<AxisSpec, THREE.Vector3> = {
  '+X': new THREE.Vector3(1, 0, 0),
  '-X': new THREE.Vector3(-1, 0, 0),
  '+Y': new THREE.Vector3(0, 1, 0),
  '-Y': new THREE.Vector3(0, -1, 0),
  '+Z': new THREE.Vector3(0, 0, 1),
  '-Z': new THREE.Vector3(0, 0, -1),
};

export const UNIT_PRESETS: { id: string; ja: string; value: number }[] = [
  { id: 'meter', ja: 'm（メートル）', value: 1 },
  { id: 'centimeter', ja: 'cm', value: 0.01 },
  { id: 'millimeter', ja: 'mm', value: 0.001 },
  { id: 'inch', ja: 'inch', value: 0.0254 },
];

export function parseAxis(s: unknown): AxisSpec | null {
  if (typeof s !== 'string') return null;
  const t = s.trim().toUpperCase().replace(/\s/g, '');
  const m = /^([+-]?)([XYZ])$/.exec(t);
  if (!m) return null;
  return ((m[1] || '+') + m[2]) as AxisSpec;
}

export function parseUnit(s: unknown): number | null {
  if (typeof s === 'number' && s > 0) return s;
  if (typeof s !== 'string') return null;
  const t = s.trim().toLowerCase();
  if (/^(m|meter|meters|metre|metres)$/.test(t)) return 1;
  if (/^(cm|centimeter|centimeters|centimetre)$/.test(t)) return 0.01;
  if (/^(mm|millimeter|millimeters|millimetre)$/.test(t)) return 0.001;
  if (/^(in|inch|inches)$/.test(t)) return 0.0254;
  return null;
}

/** M such that M * (file axis) = studio axis, with scale `unit` and an extra yaw. */
export function orientationMatrix(o: Orientation): THREE.Matrix4 {
  const up = AXIS[o.up].clone();
  let fwd = AXIS[o.forward].clone();
  // make forward perpendicular to up (metadata may name e.g. up +Z with forward +Z by mistake)
  if (Math.abs(up.dot(fwd)) > 0.99) fwd = Math.abs(up.y) > 0.5 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const x = new THREE.Vector3().crossVectors(up, fwd).normalize();
  const basis = new THREE.Matrix4().makeBasis(x, up, fwd); // studio->file axes
  const m = basis.clone().invert();
  const yaw = new THREE.Matrix4().makeRotationY(rad(o.yaw));
  const sc = new THREE.Matrix4().makeScale(o.unit, o.unit, o.unit);
  return new THREE.Matrix4().multiplyMatrices(yaw, m).premultiply(sc);
}

export function applyOrientation(norm: THREE.Group, o: Orientation): void {
  norm.matrixAutoUpdate = false;
  norm.matrix.copy(orientationMatrix(o));
  norm.matrixWorldNeedsUpdate = true;
  norm.updateMatrixWorld(true);
}

export function isIdentityOrientation(o: Orientation): boolean {
  return o.unit === 1 && o.up === '+Y' && o.forward === '+Z' && o.yaw === 0;
}

const typicalSize: Record<PartType, [number, number]> = {
  // plausible max extent in meters
  face: [0.12, 0.5],
  hair: [0.12, 1.4],
  body: [0.5, 2.6],
  garment: [0.05, 2.6],
};

/**
 * Work out unit / up / forward for a freshly loaded model.
 * Priority: metadata (explicit) > skeleton / extents heuristics.
 */
export function estimateOrientation(model: THREE.Object3D, meta: PartMeta, type: PartType, bodyHeight?: number): Orientation {
  const raw = (meta.raw ?? {}) as Record<string, unknown>;
  const cs = meta.coordinateSystem;
  let up = parseAxis(cs?.up) ?? parseAxis(raw.up);
  let forward = parseAxis(cs?.forward) ?? parseAxis(raw.front) ?? parseAxis(raw.forward);
  let unit = parseUnit(cs?.unit) ?? parseUnit(raw.units) ?? parseUnit(raw.unit);
  const explicit = !!(up || forward || unit);

  const box = boxIn(model, null);
  const size = box.getSize(new THREE.Vector3());

  if (!up) {
    up = '+Y';
    // a tall Z (and short Y) means a Z-up export (e.g. Blender with "Y up" off, many CAD / OBJ files)
    if ((type === 'body' || type === 'garment') && size.z > size.y * 1.35 && size.z > size.x * 0.9) up = '+Z';
  }
  if (!forward) {
    if (up === '+Z') forward = '-Y'; // Blender convention: front looks to -Y
    else forward = '+Z';
  }
  if (!unit) {
    // No declared unit. Metres is the default; centimetres / millimetres are only chosen when the
    // size is implausible in metres but plausible after the conversion. Anything else stays in metres
    // (unknown units: the fitter scales the part to its neighbours and says so).
    const e = Math.max(size.x, size.y, size.z);
    const [lo, hi] = typicalSize[type];
    unit = 1;
    if (e > 0 && (e * unit < lo || e * unit > hi)) {
      for (const c of [0.01, 0.001]) {
        const m = e * c;
        if (m >= lo && m <= hi) {
          unit = c;
          break;
        }
      }
    }
    // garments are checked against the body when there is one
    if (type === 'garment' && bodyHeight && e / bodyHeight > 20) unit = e / bodyHeight > 400 ? 0.001 : 0.01;
  }
  return { unit, up, forward, yaw: 0, source: explicit ? 'metadata' : 'estimated' };
}
