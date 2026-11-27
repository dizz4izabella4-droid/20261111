import { Vector3 } from 'three';
import type { Surface } from './seams';
import type { BodyParams, PresetName } from './params';
import { HAND_JOINTS, handLayout, type HandLayout } from './handRig';
import { smoothstep } from './interp';
import { REFERENCE_LANE_X, REFERENCE_WEB_Y, referenceFinger, referencePalm } from './handReference';

type Weights = Map<number, number>;
const mixWeights = (a: Weights, b: Weights, t: number): Weights => {
  const out = new Map<number, number>();
  for (const [i, w] of a) out.set(i, w * (1 - t));
  for (const [i, w] of b) out.set(i, (out.get(i) ?? 0) + w * t);
  return out;
};

/** A palm with shared web edges, four independent finger branches, a side thumb
 * opening, and integrated nail relief. No overlapping finger capsules or detached nails. */
export function buildDetailedHand(s: Surface, wristRing: number[], wrist: Vector3, along: Vector3,
  p: BodyParams, precision: PresetName, bone: (name: string) => number): void {
  const h = handLayout(wrist, along, p), part = 'hand_l';
  const division = precision === 'high' ? 16 : precision === 'standard' ? 12 : 8;
  const rows = precision === 'high' ? 18 : precision === 'standard' ? 14 : 10;
  const columns = division * 4, rootY = p.handLength * 0.1;
  const rigid = (name: string): Weights => new Map([[bone(name), 1]]);
  const handWeight = rigid('hand_l');
  const world = (x: number, y: number, z: number) => wrist.clone().addScaledVector(h.across, x).addScaledVector(along, y).addScaledVector(h.palm, z);
  const laneValue = (values: readonly number[], u: number) => {
    const lane = Math.max(0, Math.min(3, Math.floor((u + 0.5) * 4)));
    const t = Math.max(0, Math.min(1, (u + 0.5) * 4 - lane));
    return values[lane] * (1 - t) + values[lane + 1] * t;
  };
  const distalY = (x: number) => laneValue(REFERENCE_WEB_Y, x / p.handWidth) * p.handLength;
  const palmWeights = (x: number, y: number): Weights => {
    const result = new Map<number, number>();
    const influence = smoothstep(p.handLength * 0.39, p.handLength * 0.55, y) * 0.7;
    let total = 0;
    const weights = [5, 9, 13, 17].map((index) => {
      const dx = (x - h.local[index].x) / (p.handWidth * 0.15);
      const w = Math.exp(-dx * dx * 2); total += w; return w;
    });
    result.set(bone('hand_l'), 1 - influence);
    weights.forEach((w, i) => { if (w > 1e-5) result.set(bone(`${HAND_JOINTS[5 + i * 4]}_l`), influence * w / total); });
    // Thenar region follows the thumb's basal joint gradually.
    const thumb = smoothstep(0.05, 0.45, x / p.handWidth) * Math.exp(-(((y / p.handLength - 0.29) / 0.13) ** 2)) * 0.45;
    return mixWeights(result, rigid('thumb_cmc_l'), thumb);
  };
  const top: number[][] = [], bottom: number[][] = [];
  for (let row = 0; row <= rows; row++) {
    top.push([]); bottom.push([]);
    const t = row / rows;
    for (let col = 0; col <= columns; col++) {
      const u = col / columns - 0.5;
      const y = rootY * (1 - t) + distalY(u * p.handWidth) * t;
      const edges = referencePalm(y / p.handLength);
      const palmX = edges.lo + (u + 0.5) * (edges.hi - edges.lo);
      const laneX = laneValue(REFERENCE_LANE_X, u);
      const x = (palmX + (laneX - palmX) * smoothstep(0.7, 1, t)) * p.handWidth;
      const edge = Math.abs(u) * 2, halfDepth = p.handThickness * 0.5 * (0.87 - 0.20 * t) * (1 - 0.22 * edge ** 3) * (1 + 0.25 * Math.sin(Math.PI * t) ** 2);
      const arch = p.handThickness * 0.07 * (1 - edge * edge) * Math.sin(Math.PI * t);
      top[row].push(s.add(world(x, y, halfDepth + arch), palmWeights(x, y)));
      bottom[row].push(s.add(world(x, y, -halfDepth - arch), palmWeights(x, y)));
    }
  }
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    for (const [grid, reverse] of [[top, false], [bottom, true]] as const) {
      const a = grid[row][col], b = grid[row + 1][col], c = grid[row][col + 1], d = grid[row + 1][col + 1];
      if (!reverse) { s.face(a, b, c, part); s.face(c, b, d, part); }
      else { s.face(a, c, b, part); s.face(c, d, b, part); }
    }
  }
  const thumbLo = Math.max(1, Math.round(rows * 0.14)), thumbHi = Math.round(rows * 0.56);
  for (let row = 0; row < rows; row++) for (const col of [0, columns]) {
    if (col === columns && row >= thumbLo && row < thumbHi) continue;
    const a = top[row][col], b = top[row + 1][col], c = bottom[row][col], d = bottom[row + 1][col];
    if (col === columns) { s.face(a, b, c, part); s.face(c, b, d, part); }
    else { s.face(a, c, b, part); s.face(c, d, b, part); }
  }

  // Connect loops of different resolutions without T-junctions.
  const stitch = (a: number[], b: number[]) => {
    let i = 0, j = 0;
    while (i < a.length || j < b.length) {
      const ai = a[i % a.length], bj = b[j % b.length];
      if ((i + 1) / a.length <= (j + 1) / b.length && i < a.length) {
        s.face(ai, bj, a[(i + 1) % a.length], part); i++;
      } else { s.face(ai, bj, b[(j + 1) % b.length], part); j++; }
    }
  };
  const align = (a: number[], b: number[]) => {
    let best = b, score = Infinity;
    for (let offset = 0; offset < b.length; offset++) {
      const candidate = b.map((_, i) => b[(offset + i) % b.length]); let cost = 0;
      for (let i = 0; i < a.length; i++) cost += s.points[a[i]].distanceToSquared(s.points[candidate[Math.floor(i * b.length / a.length)]]);
      if (cost < score) { score = cost; best = candidate; }
    }
    return best;
  };
  // The proximal palm boundary is traversed opposite to the outgoing wrist loop.
  const proximal = [...top[0].slice().reverse(), ...bottom[0]];
  const incoming = align(wristRing, proximal.slice().reverse());
  let collar = wristRing;
  // Use wrist resolution for the transition, then stitch to the palm boundary.
  for (let row = 1; row < 5; row++) {
    const t = row / 5;
    const ring = wristRing.map((id, i) => {
      const target = s.points[incoming[Math.floor(i * incoming.length / wristRing.length)]];
      return s.add(s.points[id].clone().lerp(target, t), mixWeights(s.weights[id], handWeight, smoothstep(0, 1, t)));
    });
    s.connect(collar, ring, part); collar = ring;
  }
  stitch(collar, incoming);

  const anglesFor = (loop: number[], center: Vector3, u: Vector3, v: Vector3) => {
    const coords = loop.map((id) => { const d = s.points[id].clone().sub(center); return [d.dot(u), d.dot(v)]; });
    let area = 0; const arc = [0];
    for (let i = 0; i < coords.length; i++) { const a = coords[i], b = coords[(i + 1) % coords.length]; area += a[0] * b[1] - b[0] * a[1]; arc.push(arc[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
    const sign = area >= 0 ? 1 : -1;
    const base = coords.map((_, i) => sign * arc[i] * 2 * Math.PI / arc[coords.length]);
    let a = 0, b = 0;
    coords.forEach(([x, y], i) => { a += x * Math.cos(base[i]) + y * Math.sin(base[i]); b += -x * Math.sin(base[i]) + y * Math.cos(base[i]); });
    const phase = Math.atan2(b, a); return base.map((th) => th + phase);
  };

  const finger = (f: number, source: number[]) => {
    const first = 1 + f * 4, joints = h.points.slice(first, first + 4);
    const lengths = [0, joints[0].distanceTo(joints[1]), joints[1].distanceTo(joints[2]), joints[2].distanceTo(joints[3])];
    for (let i = 1; i < 4; i++) lengths[i] += lengths[i - 1];
    const axis = joints[3].clone().sub(joints[0]).normalize();
    const u = f === 0 ? h.along.clone().negate().addScaledVector(axis, h.along.dot(axis)).normalize() : h.across.clone().addScaledVector(axis, -h.across.dot(axis)).normalize();
    const v = axis.clone().cross(u).normalize();
    const center = source.reduce((c, i) => c.add(s.points[i]), new Vector3()).divideScalar(source.length);
    const angles = anglesFor(source, center, u, v);
    // The inherited rectangular boundary has uneven angular samples. Normalize
    // its extrema so every precision reaches both measured silhouette edges.
    const cosines = angles.map(Math.cos);
    const positiveExtent = Math.max(...cosines), negativeExtent = -Math.min(...cosines);
    const fingerName = ['thumb', 'index', 'middle', 'ring', 'pinky'][f];
    const widthScale = (p[`${fingerName}Width`] ?? 100) / 100;
    const lengthScale = (p[`${fingerName}Length`] ?? 100) / 100;
    const total = lengths[3], root = h.local[first];
    const base = referenceFinger(f, 0), apex = referenceFinger(f, 1);
    const referenceRootY = f === 0 ? base.y : root.y / p.handLength;
    const baseT = f === 0 ? 0 : (base.y - referenceRootY) / (apex.y - referenceRootY);
    const skin = (distance: number): Weights => {
      let result = rigid(`${HAND_JOINTS[first]}_l`);
      for (let k = 1; k < 3; k++) {
        const band = Math.min(lengths[k] - lengths[k - 1], lengths[k + 1] - lengths[k]) * 0.22;
        result = mixWeights(result, rigid(`${HAND_JOINTS[first + k]}_l`), smoothstep(lengths[k] - band, lengths[k] + band, distance));
      }
      return result;
    };
    const shape = (d: number) => {
      const t = d / total;
      const q = f === 0 ? t : (t - baseT) / (1 - baseT);
      const traced = referenceFinger(f, q);
      let bulge = 0;
      for (const joint of lengths.slice(1, 3)) bulge += ((p.knuckleProminence ?? 8) - 8) / 100 * Math.exp(-(((d - joint) / (total * 0.05)) ** 2));
      const r = traced.radius * p.handWidth * widthScale * Math.max(0.1, 1 - ((p.fingerTaper ?? 24) - 24) / 100 * t + bulge);
      const centerX = root.x + (traced.x * p.handWidth - root.x) * lengthScale;
      const centerY = root.y + (traced.y * p.handLength - root.y) * lengthScale;
      const spread = f === 0 ? 0 : (joints[3].clone().sub(joints[0]).dot(h.across) - (apex.x * p.handWidth - root.x) * lengthScale) * t;
      const center = world(centerX + spread, centerY, root.z);
      const transverse = f === 0 ? u : h.across;
      const depth = f === 0 ? v : h.palm;
      return angles.map((theta) => {
        const dorsal = -depth.dot(h.palm) * Math.sin(theta);
        const nailStart = lengths[2] + (total - lengths[2]) * 0.23;
        const nail = smoothstep(nailStart, nailStart + total * 0.035, d) * (1 - smoothstep(total * 0.94, total * 0.985, d)) * smoothstep(0.45, 0.9, dorsal);
        const relief = nail * p.handLength * 0.0028;
        // Use the measured outline for the visible contour, retaining closed rings
        // and the existing three-joint skinning and integrated nail relief.
        const cosine = Math.cos(theta);
        const edge = cosine / (cosine >= 0 ? positiveExtent : negativeExtent);
        return center.clone().addScaledVector(transverse, r * edge)
          .addScaledVector(depth, r * 0.83 * Math.sin(theta)).addScaledVector(h.palm, -relief);
      });
    };
    const start = f === 0 ? lengths[1] * 1.12 : total * (baseT + (1 - baseT) * 0.015);
    const count = precision === 'high' ? 42 : precision === 'standard' ? 33 : 24;
    const stations = [...new Set([start, ...Array.from({ length: count }, (_, i) => start + (total * 0.998 - start) * i / (count - 1)), lengths[1], lengths[2], total * 0.93])].filter((d) => d >= start).sort((a, b) => a - b);
    let loop = source;
    const target = shape(start);
    // Short web collar, preserving the exact shared palm boundary.
    const originals = source.map((id) => s.points[id].clone());
    for (let row = 1; row <= 5; row++) {
      const t = row / 5;
      const next = target.map((b, i) => {
        const point = originals[i].clone().lerp(b, smoothstep(0, 1, t));
        if (f === 0) {
          // Leave the concave palm boundary outward before approaching the
          // thumb section; a straight loft cuts back through the palm skin.
          point.addScaledVector(h.across, p.handWidth * 0.1 * Math.sin(Math.PI * t) * (1 - t) ** 2);
        }
        return s.add(point, mixWeights(s.weights[source[i]], skin(start), t));
      });
      s.connect(loop, next, part); loop = next;
    }
    for (const d of stations.slice(1)) { const next = s.ring(shape(d), () => skin(d)); s.connect(loop, next, part); loop = next; }
    s.cap(loop, joints[3].clone(), skin(total), part);
    s.joints.push({ name: `${HAND_JOINTS[first]}_l`, vertices: source.slice() });
  };
  // Four finger openings share their vertical web edges; no internal end caps remain.
  for (let lane = 0; lane < 4; lane++) {
    const lo = lane * division, hi = (lane + 1) * division;
    const source = [...top[rows].slice(lo, hi + 1), ...bottom[rows].slice(lo, hi + 1).reverse()];
    finger(4 - lane, source);
  }
  const thumbSource: number[] = [];
  for (let row = thumbHi; row >= thumbLo; row--) thumbSource.push(top[row][columns]);
  for (let row = thumbLo; row <= thumbHi; row++) thumbSource.push(bottom[row][columns]);
  finger(0, thumbSource);
  s.joints.push({ name: 'wrist_l', vertices: [...wristRing, ...incoming] });
}
