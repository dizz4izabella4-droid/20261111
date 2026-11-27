import type { BodyMesh } from './body';
import { frameRadius } from './frameProfile';

export const SOFTNESS_REGIONS = {
  chest: '胸・背中', abdomen: 'お腹', pelvis: '腰・お尻',
  arms: '腕', legs: '脚', head: '頭・首', extremities: '足',
} as const;
export type SoftnessRegion = keyof typeof SOFTNESS_REGIONS;
export interface SoftnessSettings {
  radius: number;
  hardThickness: number;
  softThickness: number;
  smoothing: number;
  maxOffset: number;
  damping: number;
  regions: Record<SoftnessRegion, number>;
}
export interface SoftnessField {
  softness: Float32Array;
  frameRadii?: Float32Array;
  maxOffset: Float32Array;
  damping: Float32Array;
  mean: number;
  movingPercent: number;
}

export function defaultSoftness(): SoftnessSettings {
  return {
    radius: 0.035, hardThickness: 0, softThickness: 0.08, smoothing: 3,
    maxOffset: 0.012, damping: 0.6,
    regions: { chest: 1, abdomen: 0.83, pelvis: 0.85, arms: 0.66, legs: 0.55, head: 0, extremities: 0 },
  };
}

export function normalizeSoftness(input: unknown): SoftnessSettings {
  const d = defaultSoftness();
  if (!input || typeof input !== 'object') return d;
  const j = input as Record<string, unknown>;
  const num = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  d.radius = num(j.radius, d.radius, 0, 0.1);
  d.hardThickness = num(j.hardThickness, d.hardThickness, 0, 0.099);
  d.softThickness = num(j.softThickness, d.softThickness, d.hardThickness + 0.001, 0.2);
  d.smoothing = Math.round(num(j.smoothing, d.smoothing, 0, 10));
  d.maxOffset = num(j.maxOffset, d.maxOffset, 0, 0.04);
  d.damping = num(j.damping, d.damping, 0, 1);
  const regions = j.regions && typeof j.regions === 'object' ? j.regions as Record<string, unknown> : {};
  for (const key of Object.keys(d.regions) as SoftnessRegion[]) d.regions[key] = num(regions[key], d.regions[key], 0, 1);
  return d;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / Math.max(1e-9, b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

interface GeometryCache {
  distances: Float32Array;
  nearestBone: Int32Array;
  neighbors: number[][];
  regions: SoftnessRegion[];
  symmetricVertices: number[][];
  fixedHands: boolean[];
}
const cache = new WeakMap<BodyMesh, GeometryCache>();
const bakedCache = new WeakMap<BodyMesh, { key: string; field: SoftnessField }>();

function geometryData(body: BodyMesh): GeometryCache {
  const previous = cache.get(body);
  if (previous) return previous;
  const n = body.positions.length / 3;
  const distances = new Float32Array(n).fill(Infinity);
  const nearestBone = new Int32Array(n).fill(-1);
  const neighborSets = Array.from({ length: n }, () => new Set<number>());
  const regions: SoftnessRegion[] = new Array(n).fill('chest');
  const partNames: string[] = new Array(n).fill('torso');
  const fixedHands = new Array<boolean>(n).fill(false);
  // Use the known body parts instead of assigning ownership to the nearest joint.
  // This keeps e.g. a hand near the torso from acquiring the torso's multiplier.
  for (const part of body.parts) {
    const region: SoftnessRegion = /^(head|neck)$/.test(part.name) ? 'head'
      : /^(hand|foot)_/.test(part.name) ? 'extremities'
      : /^(upperarm|forearm)_/.test(part.name) ? 'arms' : /^(thigh|shin)_/.test(part.name) ? 'legs' : 'chest';
    for (let i = part.start; i < part.start + part.count; i++) {
      regions[body.indices[i]] = region;
      partNames[body.indices[i]] = part.name.replace(/_[lr]$/, '');
      if (part.name.startsWith('hand_')) fixedHands[body.indices[i]] = true;
    }
  }
  for (let i = 0; i < body.indices.length; i += 3) {
    const [a, b, c] = body.indices.subarray(i, i + 3);
    neighborSets[a].add(b); neighborSets[a].add(c);
    neighborSets[b].add(a); neighborSets[b].add(c);
    neighborSets[c].add(a); neighborSets[c].add(b);
  }
  for (const bone of body.bones) {
    if (bone.parent < 0) continue;
    const a = body.bones[bone.parent].head, b = bone.head;
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len2 = dx * dx + dy * dy + dz * dz;
    for (let i = 0; i < n; i++) {
      const x = body.positions[i * 3] - a[0], y = body.positions[i * 3 + 1] - a[1], z = body.positions[i * 3 + 2] - a[2];
      const t = len2 > 1e-12 ? Math.min(1, Math.max(0, (x * dx + y * dy + z * dz) / len2)) : 0;
      const segment = body.bones[bone.parent].name;
      const part = partNames[i];
      // A nearby hand or the other leg must not become this tissue's hard core.
      if (part === 'torso' && !['hips', 'spine', 'chest'].includes(segment)) continue;
      if (/^(upperarm|forearm)$/.test(part) && !/^(upperarm|forearm)_/.test(segment)) continue;
      if (/^(thigh|shin)$/.test(part) && !/^(thigh|shin)_/.test(segment)) continue;
      const distance = Math.hypot(x - t * dx, y - t * dy, z - t * dz);
      if (distance < distances[i]) { distances[i] = distance; nearestBone[i] = bone.parent; }
    }
  }
  // The generator produces a symmetric body, but its triangle diagonals and duplicated
  // seam vertices are not symmetric graphs. Share the result at equivalent positions
  // within each part so smoothing cannot introduce a stripe or a left/right bias.
  const symmetric = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const key = `${partNames[i]}:${Math.round(Math.abs(body.positions[i * 3]) * 1e5)},${Math.round(body.positions[i * 3 + 1] * 1e5)},${Math.round(body.positions[i * 3 + 2] * 1e5)}`;
    const group = symmetric.get(key);
    if (group) group.push(i); else symmetric.set(key, [i]);
  }
  const data = { distances, nearestBone, neighbors: neighborSets.map((s) => [...s]), regions, fixedHands, symmetricVertices: [...symmetric.values()].filter((g) => g.length > 1) };
  cache.set(body, data);
  return data;
}

/** Bone-distance mask; the region multiplier is applied AFTER smoothing so 0 stays exactly rigid. */
export function bakeSoftness(body: BodyMesh, input: SoftnessSettings): SoftnessField {
  const o = normalizeSoftness(input);
  const key = JSON.stringify(o);
  const previous = bakedCache.get(body);
  if (previous?.key === key) return previous.field;
  const { distances, nearestBone, neighbors, regions, symmetricVertices, fixedHands } = geometryData(body);
  const frameRadii = Float32Array.from(body.bones, bone => frameRadius(bone.name, o.radius));
  let values = Float32Array.from(distances, (dist, i) => {
    const radius = nearestBone[i] >= 0 ? frameRadii[nearestBone[i]] : o.radius;
    const depth = Math.max(0, dist - radius - o.hardThickness), muscle = Math.max(0.008, radius * 0.65);
    // Firm muscle immediately surrounds the hard core; the outer tissue is softer.
    return 0.2 * smoothstep(0, muscle, depth) + 0.8 * smoothstep(muscle, muscle + o.softThickness, depth);
  });
  const equalize = (data: Float32Array) => {
    for (const group of symmetricVertices) {
      let sum = 0;
      for (const i of group) sum += data[i];
      for (const i of group) data[i] = sum / group.length;
    }
  };
  equalize(values);
  for (let iteration = 0; iteration < o.smoothing; iteration++) {
    const next = new Float32Array(values.length);
    for (let i = 0; i < values.length; i++) {
      const nb = neighbors[i];
      let sum = 0;
      for (const j of nb) sum += values[j];
      next[i] = nb.length ? 0.5 * values[i] + 0.5 * sum / nb.length : values[i];
    }
    values = next;
    equalize(values);
  }
  const maxOffset = new Float32Array(values.length), damping = new Float32Array(values.length).fill(o.damping);
  let sum = 0, moving = 0;
  for (let i = 0; i < values.length; i++) {
    let factor = fixedHands[i] ? 0 : o.regions[regions[i]];
    if (regions[i] === 'chest') {
      const y = body.positions[i * 3 + 1];
      factor = y <= body.keyY.waist
        ? mix(o.regions.pelvis, o.regions.abdomen, smoothstep(body.keyY.hip, body.keyY.waist, y))
        : mix(o.regions.abdomen, o.regions.chest, smoothstep(body.keyY.waist, body.keyY.underbust, y));
    }
    values[i] *= factor;
    maxOffset[i] = values[i] * o.maxOffset;
    sum += values[i];
    if (values[i] > 0.01) moving++;
  }
  const field = { softness: values, frameRadii, maxOffset, damping, mean: sum / values.length, movingPercent: 100 * moving / values.length };
  bakedCache.set(body, { key, field });
  return field;
}

/** Bounded damped response to one impulse, for the local preview only (not exported animation). */
export function previewOffset(time: number, softness: number, maxOffset: number, damping: number): number {
  if (time < 0 || time >= 8 || maxOffset <= 0) return 0;
  const decay = 0.6 + damping * 5;
  const frequency = 12 - softness * 5;
  return maxOffset * Math.exp(-decay * time) * Math.sin(frequency * time);
}

/** Blue → teal → amber → red. Shared by the 3D overlay and the legend. */
export function softnessColor(s: number): [number, number, number] {
  const stops = [[0.12, 0.28, 0.78], [0.05, 0.72, 0.66], [0.98, 0.74, 0.16], [0.92, 0.2, 0.12]];
  const x = Math.min(1, Math.max(0, s)) * 3, k = Math.min(2, Math.floor(x));
  return stops[k].map((v, c) => mix(v, stops[k + 1][c], x - k)) as [number, number, number];
}
