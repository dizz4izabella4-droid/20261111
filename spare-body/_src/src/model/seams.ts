// The body generator has known topology: join its open torso patches to continuous limb
// rings, instead of hiding intersections between capped, rigid components. Everything is
// generated locally; the original torso away from the joint bands is retained.
import { Vector3 } from 'three';
import { Pchip, smoothstep } from './interp';
import type { BaseMesh } from './mesh';
import type { BodyMesh, BoneName } from './body';
import type { BodyParams, PresetName } from './params';
import { buildDetailedHand } from './hand';

export interface SeamReport {
  format: 'spare-body-seams-v1';
  boundaryEdges: number;
  nonManifoldEdges: number;
  components: number;
  roundedVertices: number;
  joints: { name: string; vertices: number[] }[];
}
type Face = { a: number; b: number; c: number; part: string };
type Weights = Map<number, number>;
const vec = (a: ArrayLike<number>, offset = 0) => new Vector3(a[offset], a[offset + 1], a[offset + 2]);
const key = (p: Vector3) => `${Math.round(p.x * 1e7)},${Math.round(p.y * 1e7)},${Math.round(p.z * 1e7)}`;
const blendWeights = (a: Weights, b: Weights, t: number): Weights => {
  const out = new Map<number, number>();
  for (const [i, w] of a) out.set(i, w * (1 - t));
  for (const [i, w] of b) out.set(i, (out.get(i) ?? 0) + w * t);
  return out;
};

export class Surface {
  points: Vector3[] = [];
  originalNormals: Vector3[] = [];
  weights: Weights[] = [];
  faces: Face[] = [];
  masks: number[] = [];
  joints: SeamReport['joints'] = [];
  bridgeRows: number[][] = [];
  add(point: Vector3, weights: Weights, mask = 0, normal = new Vector3()): number {
    this.points.push(point); this.weights.push(weights); this.masks.push(mask); this.originalNormals.push(normal);
    return this.points.length - 1;
  }
  face(a: number, b: number, c: number, part: string): void { this.faces.push({ a, b, c, part }); }
  // Incoming loop follows the existing boundary orientation. Each added face reverses
  // that shared edge, and the outgoing loop has the same traversal order.
  connect(a: number[], b: number[], part: string): void {
    if (a.length !== b.length) throw new Error('接合ループの頂点数が一致しません');
    for (let i = 0; i < a.length; i++) {
      const j = (i + 1) % a.length;
      this.face(a[i], b[i], a[j], part); this.face(a[j], b[i], b[j], part);
    }
  }
  cap(loop: number[], center: Vector3, weights: Weights, part: string): void {
    const c = this.add(center, weights);
    for (let i = 0; i < loop.length; i++) this.face(loop[i], c, loop[(i + 1) % loop.length], part);
  }
  ring(points: Vector3[], weights: (p: Vector3) => Weights, mask = 0): number[] {
    return points.map((p) => this.add(p, weights(p), mask));
  }
  bridge(loop: number[], target: Vector3[], weights: (p: Vector3) => Weights, axis: Vector3, part: string, strength: number, startAxis?: Vector3, adjust?: (ring: Vector3[]) => void): number[] {
    const source = loop.map((i) => this.points[i].clone());
    const steps = startAxis ? 12 : 6;
    let previous = loop;
    this.bridgeRows = [loop];
    for (const i of loop) this.masks[i] = Math.max(this.masks[i], 0.3 * strength);
    for (let row = 1; row <= steps; row++) {
      const t = row / steps, tt = smoothstep(0, 1, t);
      const ps = target.map((b, i) => {
        const a = source[i], d = b.clone().sub(a), n = this.originalNormals[loop[i]];
        const m0 = startAxis
          ? startAxis.clone().multiplyScalar(0.4).addScaledVector(n, 0.6).normalize().multiplyScalar(d.length() * 0.55)
          : d.clone().addScaledVector(n, -d.dot(n) * strength).multiplyScalar(0.7);
        const m1 = axis.clone().multiplyScalar(d.length() * 0.7);
        return a.clone().multiplyScalar(2 * t ** 3 - 3 * t ** 2 + 1)
          .addScaledVector(m0, t ** 3 - 2 * t ** 2 + t)
          .addScaledVector(b, -2 * t ** 3 + 3 * t ** 2)
          .addScaledVector(m1, t ** 3 - t ** 2);
      });
      if (adjust && row < steps) adjust(ps);
      const next = ps.map((p, i) => this.add(p, blendWeights(this.weights[loop[i]], weights(target[i]), tt), strength * (0.25 + 0.5 * Math.sin(Math.PI * t))));
      this.connect(previous, next, part); previous = next; this.bridgeRows.push(next);
    }
    this.joints.push({ name: part, vertices: [...loop, ...previous] });
    return previous;
  }
}

function boundaryLoops(faces: Face[]): number[][] {
  const edges = new Map<string, { a: number; b: number; count: number }>();
  for (const f of faces) for (const [a, b] of [[f.a, f.b], [f.b, f.c], [f.c, f.a]]) {
    const k = a < b ? `${a}/${b}` : `${b}/${a}`;
    const edge = edges.get(k);
    if (edge) edge.count++; else edges.set(k, { a, b, count: 1 });
  }
  const next = new Map<number, number>();
  for (const e of edges.values()) if (e.count === 1) {
    if (next.has(e.a)) throw new Error('接合境界が枝分かれしています');
    next.set(e.a, e.b);
  }
  const loops: number[][] = [];
  while (next.size) {
    const first = next.keys().next().value!;
    const loop: number[] = [];
    let i = first;
    do {
      loop.push(i); const j = next.get(i); next.delete(i);
      if (j === undefined) throw new Error('接合境界が閉じていません');
      i = j;
    } while (i !== first);
    loops.push(loop);
  }
  return loops;
}

/** Fair sharp opening corners BEFORE lofting, carrying the displacement into the
 * surrounding surface with a smooth falloff. The new bridge then follows the
 * corrected boundary and its recomputed tangent normals, rather than fighting it. */
function roundBoundaries(s: Surface, loops: number[][], strength: number): number {
  const original = s.points.map((p) => p.clone());
  const handles = new Map<number, Vector3>();
  for (const loop of loops) {
    let points = loop.map((i) => original[i].clone());
    for (let pass = 0; pass < 8; pass++) {
      points = points.map((p, i) => {
        const a = points[(i + points.length - 1) % points.length], b = points[(i + 1) % points.length];
        const incoming = p.clone().sub(a), outgoing = b.clone().sub(p);
        const la = incoming.length(), lb = outgoing.length();
        if (la < 1e-9 || lb < 1e-9) return p.clone();
        const turn = 1 - incoming.dot(outgoing) / (la * lb);
        const target = a.clone().multiplyScalar(lb / (la + lb)).addScaledVector(b, la / (la + lb));
        const next = p.clone().lerp(target, 0.45 * strength * smoothstep(0.025, 0.4, turn));
        const offset = next.clone().sub(original[loop[i]]);
        if (offset.length() > 0.009 * strength) next.copy(original[loop[i]]).add(offset.setLength(0.009 * strength));
        return next;
      });
    }
    loop.forEach((id, i) => handles.set(id, points[i].clone().sub(original[id])));
  }
  const radius = 0.035;
  for (let i = 0; i < s.points.length; i++) {
    const direct = handles.get(i);
    if (direct) { s.points[i].add(direct); continue; }
    const delta = new Vector3(); let sum = 0, nearest = Infinity;
    for (const [id, offset] of handles) {
      const distance = original[i].distanceTo(original[id]);
      if (distance >= radius) continue;
      const w = (1 - smoothstep(0, radius, distance)) ** 2 / Math.max(1e-7, distance * distance);
      delta.addScaledVector(offset, w); sum += w; nearest = Math.min(nearest, distance);
    }
    if (sum) s.points[i].addScaledVector(delta, (1 - smoothstep(0, radius, nearest)) / sum);
  }
  // Match the generator's exact left/right correspondence, including seam duplicates.
  const lookup = new Map(original.map((p, i) => [key(p), i]));
  for (let i = 0; i < original.length; i++) {
    const p = original[i], j = lookup.get(key(new Vector3(-p.x, p.y, p.z)));
    if (j === undefined || j < i) continue;
    const a = s.points[i], b = s.points[j], x = (a.x - b.x) / 2, y = (a.y + b.y) / 2, z = (a.z + b.z) / 2;
    a.set(x, y, z); b.set(-x, y, z);
  }
  s.originalNormals = s.points.map(() => new Vector3());
  for (const f of s.faces) {
    const n = s.points[f.b].clone().sub(s.points[f.a]).cross(s.points[f.c].clone().sub(s.points[f.a]));
    for (const i of [f.a, f.b, f.c]) s.originalNormals[i].add(n);
  }
  for (const n of s.originalNormals) n.normalize();
  return s.points.filter((p, i) => p.distanceToSquared(original[i]) > 1e-12).length;
}

function ringAngles(surface: Surface, loop: number[], u: Vector3, v: Vector3): number[] {
  const center = new Vector3(); for (const i of loop) center.add(surface.points[i]); center.divideScalar(loop.length);
  const coords = loop.map((i) => { const p = surface.points[i].clone().sub(center); return [p.dot(u), p.dot(v)]; });
  let area = 0;
  for (let i = 0; i < coords.length; i++) { const a = coords[i], b = coords[(i + 1) % coords.length]; area += a[0] * b[1] - b[0] * a[1]; }
  const sign = area >= 0 ? 1 : -1;
  const arc = [0];
  for (let i = 0; i < coords.length; i++) {
    const a = coords[i], b = coords[(i + 1) % coords.length];
    arc.push(arc[i] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const parameter = coords.map((_, i) => sign * arc[i] * 2 * Math.PI / arc[coords.length]);
  let a = 0, b = 0;
  for (let i = 0; i < coords.length; i++) {
    const th = parameter[i], [x, y] = coords[i];
    a += x * Math.cos(th) + y * Math.sin(th); b += -x * Math.sin(th) + y * Math.cos(th);
  }
  const phase = Math.atan2(b, a);
  return parameter.map((th) => phase + th);
}
const ellipse = (center: Vector3, u: Vector3, v: Vector3, ru: number, rv: number, angles: number[]) =>
  angles.map((th) => center.clone().addScaledVector(u, ru * Math.cos(th)).addScaledVector(v, rv * Math.sin(th)));
const rectangle = (center: Vector3, u: Vector3, v: Vector3, hu: number, hv: number, angles: number[]) => angles.map((th) => {
  const x = Math.cos(th), y = Math.sin(th), r = Math.min(hu / Math.max(1e-9, Math.abs(x)), hv / Math.max(1e-9, Math.abs(y)));
  return center.clone().addScaledVector(u, x * r).addScaledVector(v, y * r);
});

/** Preserve symmetry while locally smoothing only the generated joint bands. */
function smoothBands(s: Surface, strength: number): void {
  const nb = s.points.map(() => new Set<number>());
  for (const f of s.faces) for (const [a, b] of [[f.a, f.b], [f.b, f.c], [f.c, f.a]]) { nb[a].add(b); nb[b].add(a); }
  // Every structural junction participates, including wrist collars that were
  // previously unmasked. Finger webs and shafts retain their accepted geometry.
  for (const joint of s.joints) {
    if (!/^(upperarm|thigh|elbow|knee|wrist|ankle|neck|head)/.test(joint.name)) continue;
    for (const i of joint.vertices) s.masks[i] = Math.max(s.masks[i], 0.65 * strength);
  }
  // Feather the effect into adjacent rows instead of ending it at a hard seam.
  for (let pass = 0; pass < 2; pass++) {
    const previous = s.masks.slice();
    for (let i = 0; i < nb.length; i++) for (const j of nb[i]) {
      s.masks[i] = Math.max(s.masks[i], previous[j] * 0.45);
    }
  }
  const lookup = new Map(s.points.map((p, i) => [key(p), i]));
  const mirrors = s.points.map((p) => lookup.get(key(new Vector3(-p.x, p.y, p.z))) ?? -1);
  for (let iteration = 0; iteration < 4; iteration++) for (const lambda of [0.42, -0.43]) {
    const next = s.points.map((p, i) => {
      if (!s.masks[i] || !nb[i].size) return p.clone();
      const mean = new Vector3(); for (const j of nb[i]) mean.add(s.points[j]); mean.divideScalar(nb[i].size);
      const delta = mean.sub(p).multiplyScalar(lambda * s.masks[i]);
      const limit = 0.002 * strength;
      if (delta.length() > limit) delta.setLength(limit);
      return p.clone().add(delta);
    });
    for (let i = 0; i < next.length; i++) {
      const j = mirrors[i]; if (j < i || j < 0) continue;
      const x = (next[i].x - next[j].x) / 2, y = (next[i].y + next[j].y) / 2, z = (next[i].z + next[j].z) / 2;
      next[i].set(x, y, z); next[j].set(-x, y, z);
    }
    s.points = next;
  }
}

function finish(s: Surface, body: BodyMesh, roundedVertices: number): BodyMesh {
  // Remove unused vertices from the removed torso patches/caps.
  const used = new Set<number>(); for (const f of s.faces) { used.add(f.a); used.add(f.b); used.add(f.c); }
  const ids = [...used].sort((a, b) => a - b), remap = new Map(ids.map((id, i) => [id, i]));
  const positions = new Float32Array(ids.length * 3), normals = new Float32Array(ids.length * 3);
  const skinIndex = new Uint16Array(ids.length * 4), skinWeight = new Float32Array(ids.length * 4);
  const sums = ids.map(() => new Vector3());
  ids.forEach((id, i) => {
    const point = s.points[id]; point.toArray(positions, i * 3);
    const weights = [...s.weights[id]].filter(([, w]) => w > 1e-8).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const total = weights.reduce((n, [, w]) => n + w, 0);
    if (!Number.isFinite(point.lengthSq()) || !total) throw new Error('接合頂点または重みが不正です');
    weights.forEach(([bone, weight], j) => { skinIndex[i * 4 + j] = bone; skinWeight[i * 4 + j] = weight / total; });
  });
  const parts: BodyMesh['parts'] = [], indices: number[] = [];
  const partNames = [...new Set(s.faces.map((f) => f.part))];
  for (const name of partNames) {
    const start = indices.length;
    for (const f of s.faces) if (f.part === name) {
      const a = remap.get(f.a)!, b = remap.get(f.b)!, c = remap.get(f.c)!;
      indices.push(a, b, c);
      const pa = vec(positions, a * 3), pb = vec(positions, b * 3), pc = vec(positions, c * 3);
      const n = pb.clone().sub(pa).cross(pc.clone().sub(pa));
      if (n.lengthSq() < 1e-20) throw new Error(`面積のない接合面：${name}`);
      // Corner-angle weighting stays continuous across unequal-density part boundaries.
      const len = n.length(); n.divideScalar(len);
      for (const [i, p, q, r] of [[a, pa, pb, pc], [b, pb, pc, pa], [c, pc, pa, pb]] as [number, Vector3, Vector3, Vector3][]) {
        sums[i].addScaledVector(n, q.clone().sub(p).angleTo(r.clone().sub(p)));
      }
    }
    parts.push({ name, start, count: indices.length - start });
  }
  sums.forEach((n, i) => {
    if (n.lengthSq() < 1e-20) throw new Error('接合部の法線を計算できません');
    n.normalize().toArray(normals, i * 3);
  });
  const edges = new Map<string, { count: number; direction: number }>(), adjacency = ids.map(() => [] as number[]);
  for (let i = 0; i < indices.length; i += 3) for (let j = 0; j < 3; j++) {
    const a = indices[i + j], b = indices[i + (j + 1) % 3], k = a < b ? `${a}/${b}` : `${b}/${a}`;
    const e = edges.get(k) ?? { count: 0, direction: 0 }; e.count++; e.direction += a < b ? 1 : -1; edges.set(k, e); adjacency[a].push(b);
  }
  const boundaryEdges = [...edges.values()].filter((e) => e.count === 1).length;
  const nonManifoldEdges = [...edges.values()].filter((e) => e.count !== 2 || e.direction !== 0).length;
  const seen = new Set<number>(); let components = 0;
  for (let i = 0; i < ids.length; i++) if (!seen.has(i)) {
    components++; const todo = [i]; seen.add(i);
    while (todo.length) for (const j of adjacency[todo.pop()!]) if (!seen.has(j)) { seen.add(j); todo.push(j); }
  }
  if (boundaryEdges || nonManifoldEdges || components !== 1) throw new Error(`接合検査：境界${boundaryEdges}・不正な辺${nonManifoldEdges}・分離${components}`);
  return { ...body, positions, normals, indices: Uint32Array.from(indices), skinIndex, skinWeight, parts,
    seams: { format: 'spare-body-seams-v1', boundaryEdges, nonManifoldEdges, components, roundedVertices,
      joints: s.joints.map((j) => ({ name: j.name, vertices: [...new Set(j.vertices.map((i) => remap.get(i)).filter((i): i is number => i !== undefined))] })) } };
}

export function connectBody(body: BodyMesh, torsoMesh: BaseMesh, p: BodyParams, preset: PresetName): BodyMesh {
  const s = new Surface(), strength = (p.seamCorrection ?? 80) / 100, width = (p.seamWidth ?? 60) / 100;
  const jointWidth = (p.jointBlend ?? 65) / 100;
  const bone = (name: BoneName) => body.bones.findIndex((b) => b.name === name);
  const head = (name: BoneName) => vec(body.bones[bone(name)].head);
  const rigid = (name: BoneName): Weights => new Map([[bone(name), 1]]);
  const between = (a: BoneName, b: BoneName, t: number) => blendWeights(rigid(a), rigid(b), t);
  const { segments: M, rings: N, heights, thetas } = torsoMesh, cols = M + 1;
  const nearest = (values: Float64Array, target: number) => { let best = 0; for (let i = 1; i < values.length; i++) if (Math.abs(values[i] - target) < Math.abs(values[best] - target)) best = i; return best; };
  const patch = (y0: number, y1: number, theta: number, half: number) => {
    const lo = Math.min(N - 3, nearest(heights, y0));
    const hi = Math.max(lo + 2, Math.min(N - 2, nearest(heights, y1)));
    return { lo, hi, left: nearest(thetas, theta - half), right: nearest(thetas, theta + half) };
  };
  const local = (y: number) => y - body.crotchY;
  const shoulder = patch(local(body.keyY.armpit) - 0.015 - width * 0.015, local(body.keyY.shoulderTop) + 0.004, Math.PI / 2, 0.55 + width * 0.18);
  const hipCut = Math.max(1, nearest(heights, local(body.keyY.hip)));
  const reflectPatch = (a: typeof shoulder) => ({ ...a, left: M - a.right, right: M - a.left });
  const patches = [shoulder, reflectPatch(shoulder)];
  const remap: number[] = [], byPosition = new Map<string, number>();
  const torsoPart = body.parts.find((part) => part.name === 'torso')!;
  const rawStart = body.indices[torsoPart.start]; // torso is the first generated part (base vertex = 0)
  if (rawStart !== 0) throw new Error('胴の頂点配置が想定と異なります');
  for (let i = 0; i < torsoMesh.positions.length / 3; i++) {
    const point = vec(body.positions, i * 3), k = key(point), known = byPosition.get(k);
    if (known !== undefined) remap[i] = known;
    else {
      const weights = new Map<number, number>();
      for (let j = 0; j < 4; j++) { const w = body.skinWeight[i * 4 + j]; if (w) weights.set(body.skinIndex[i * 4 + j], w); }
      const id = s.add(point, weights, 0, vec(body.normals, i * 3)); remap[i] = id; byPosition.set(k, id);
    }
  }
  const gridFaces = (N - 1) * M * 2;
  for (let i = 0; i < torsoMesh.indices.length; i += 3) {
    const face = i / 3;
    if (face >= gridFaces) continue; // replace the neck and crotch caps with connected branches
    if (face < gridFaces) {
      const cell = Math.floor(face / 2), row = Math.floor(cell / M), col = cell % M;
      if (row < hipCut) continue;
      if (patches.some((a) => row >= a.lo && row < a.hi && col >= a.left && col < a.right)) continue;
    }
    s.face(remap[torsoMesh.indices[i]], remap[torsoMesh.indices[i + 1]], remap[torsoMesh.indices[i + 2]], 'torso');
  }
  const loops = boundaryLoops(s.faces);
  if (loops.length !== 4) throw new Error(`接合口が${loops.length}個です（想定4個）`);
  const roundedVertices = roundBoundaries(s, loops, strength);
  const centers = loops.map((loop) => loop.reduce((v, i) => v.add(s.points[i]), new Vector3()).divideScalar(loop.length));
  // Pose-space soft contact shares compression between arm and torso tissue.
  // Classify actual boundary loops by their relative positions. Comparing a
  // quantized mesh row with the exact hip height can reject a valid opening
  // after body proportions change, reverting the entire model to placeholders.
  if (centers.length < 4) throw new Error('接合口の数が不足しています');
  const neckIndex = centers.reduce((best, c, i) => c.y > centers[best].y ? i : best, 0);
  const hipIndex = centers.reduce((best, c, i) => c.y < centers[best].y ? i : best, 0);
  const shoulderIndex = centers.reduce((best, c, i) => {
    if (i === neckIndex || i === hipIndex) return best;
    return best < 0 || c.x > centers[best].x ? i : best;
  }, -1);
  if (neckIndex === hipIndex || shoulderIndex < 0 || centers[shoulderIndex].x <= 0) throw new Error('接合口を特定できません');


  // A pair-of-pants junction: split one lower-pelvis boundary into two leg openings
  // with a shared front-to-back crotch arch. This avoids a closed pelvis cap hanging
  // above the thighs, which leaves a visible slit despite a topologically closed mesh.
  const pelvisLoop = loops[hipIndex];
  const back = pelvisLoop.reduce((best, id) => s.points[id].z < s.points[best].z ? id : best);
  const front = pelvisLoop.reduce((best, id) => s.points[id].z > s.points[best].z ? id : best);
  const arc = (start: number, end: number) => {
    const result: number[] = []; let i = pelvisLoop.indexOf(start);
    while (true) { const id = pelvisLoop[i]; result.push(id); if (id === end) break; i = (i + 1) % pelvisLoop.length; }
    return result;
  };
  let hipSource = arc(back, front);
  if (hipSource.reduce((sum, i) => sum + s.points[i].x, 0) < 0) hipSource = arc(front, back);
  const from = s.points[hipSource[hipSource.length - 1]], to = s.points[hipSource[0]];
  for (let i = 1; i < 12; i++) {
    const t = i / 12, point = from.clone().lerp(to, t);
    point.x = 0; point.y -= (point.y - body.crotchY + 0.005) * Math.sin(Math.PI * t);
    hipSource.push(s.add(point, rigid('hips'), 0.15 * strength, new Vector3(0, -1, 0)));
  }

  // Build the left branches, then reflect them to preserve exact geometric symmetry.
  const torsoVertices = s.points.length, firstBranchFace = s.faces.length;
  // Torso envelope on the body's left (+x): the farthest surface point at height y and depth z.
  // A hanging arm presses against the side of the chest, so arm sections that would sink
  // into it are flattened against it (contact) instead of crossing the torso surface and
  // flickering (z-fighting) or being webbed to it by the shoulder bridge.
  const envelopeRows = (() => {
    const rows: { y: number; pts: Vector3[] }[] = [];
    for (let r = 0; r < N; r++) {
      const pts: Vector3[] = []; let y = 0;
      for (let c = 0; c < cols; c++) { const q = s.points[remap[r * cols + c]]; pts.push(q); y += q.y; }
      rows.push({ y: y / cols, pts });
    }
    return rows;
  })();
  const envelopeAt = (row: { pts: Vector3[] }, z: number): number | null => {
    let best: number | null = null;
    for (let c = 0; c + 1 < row.pts.length; c++) {
      const a = row.pts[c], b = row.pts[c + 1];
      if ((z - a.z) * (z - b.z) > 0 || Math.abs(b.z - a.z) < 1e-9) continue;
      const x = a.x + (b.x - a.x) * (z - a.z) / (b.z - a.z);
      if (x > 0 && (best === null || x > best)) best = x;
    }
    return best;
  };
  const torsoExtentX = (y: number, z: number): number | null => {
    if (y <= envelopeRows[0].y || y >= envelopeRows[N - 1].y) return null;
    let lo = 0; while (lo + 2 < N && envelopeRows[lo + 1].y <= y) lo++;
    const a = envelopeAt(envelopeRows[lo], z), b = envelopeAt(envelopeRows[lo + 1], z);
    if (a === null || b === null) return null;
    const t = (y - envelopeRows[lo].y) / Math.max(1e-9, envelopeRows[lo + 1].y - envelopeRows[lo].y);
    return a + (b - a) * t;
  };
  const armpitY = body.crotchY + heights[shoulder.lo];
  const pressAgainstTorso = (ring: Vector3[]): void => {
    const n = ring.length, push = ring.map((point) => {
      if (point.y >= armpitY) return 0;
      const extent = torsoExtentX(point.y, point.z);
      const gap = 0.003 * smoothstep(armpitY, armpitY - 0.02, point.y);
      return extent !== null && point.x < extent + gap ? extent + gap - point.x : 0;
    });
    if (!push.some((v) => v > 0)) return;
    // Spread the contact over neighbouring points so the flattened flank stays smooth
    // (a per-point clamp folds the section where the chest profile changes quickly).
    let field = push.map((_, i) => Math.max(...[-2, -1, 0, 1, 2].map((k) => push[(i + k + n) % n])));
    for (let pass = 0; pass < 3; pass++) field = field.map((v, i) => 0.25 * field[(i + n - 1) % n] + 0.5 * v + 0.25 * field[(i + 1) % n]);
    ring.forEach((point, i) => { point.x += field[i]; });
  };
  const firstBranchJoint = s.joints.length;
  function limb(isArm: boolean, source: number[]): void {
    const root = head(isArm ? 'upperarm_l' : 'thigh_l');
    const middle = head(isArm ? 'forearm_l' : 'shin_l');
    const end = head(isArm ? 'hand_l' : 'foot_l');
    const axis = middle.clone().sub(root).normalize(), u = isArm ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0), v = axis.clone().cross(u).normalize();
    const length1 = root.distanceTo(middle), length2 = middle.distanceTo(end), total = length1 + length2;
    const elevation = Math.atan2(Math.abs(axis.x), -axis.y);
    const lowered = 1 - smoothstep(Math.PI / 9, Math.PI / 2, elevation);
    // A lowered arm needs a longer sleeve transition to distribute shoulder
    // compression and armpit extension without forming a short, folded elbow.
    const start = length1 * (isArm ? 0.30 + 0.08 * width + 0.20 * lowered : 0.18 + 0.08 * width);
    const circ = isArm
      ? new Pchip([0, length1 * 0.35, length1, length1 + length2 * 0.25, total], [p.upperArmCirc * (0.85 + 0.25 * (p.shoulderRoundness ?? 35) / 100), p.upperArmCirc, p.elbowCirc, p.forearmCirc, p.wristCirc])
      : new Pchip([0, length1 * 0.15, length1 * 0.75, length1, length1 + length2 * 0.3, total], [p.thighCirc * 0.9, p.thighCirc, (p.thighCirc + p.kneeCirc) * 0.475, p.kneeCirc, p.calfCirc, p.ankleCirc]);
    // Parameterize the shoulder opening in its own side-facing plane, then
    // transport that order into the arm plane. Projecting directly into an almost
    // vertical arm's cross-section can collapse the opening and twist the bridge.
    const angles = ringAngles(s, source, u, isArm ? new Vector3(0, -1, 0) : v);
    const band = Math.min(length1, length2) * (0.07 + jointWidth * 0.18);
    const weights = (point: Vector3) => {
      const d = point.clone().sub(root).dot(axis);
      const distal = smoothstep(length1 - band, length1 + band, d);
      let w = between(isArm ? 'upperarm_l' : 'thigh_l', isArm ? 'forearm_l' : 'shin_l', distal);
      const proximal = smoothstep(0, length1 * (0.24 + width * 0.08), d);
      w = blendWeights(rigid(isArm ? 'chest' : 'hips'), w, proximal);
      const terminal = smoothstep(total - band * 0.7, total + band * 0.7, d);
      return blendWeights(w, rigid(isArm ? 'hand_l' : 'foot_l'), terminal);
    };
    const distalAxis = end.clone().sub(middle).normalize();
    const circle = (d: number) => {
      // Follow both bone segments so the surface reaches the actual knee and
      // ankle after the femur is angled inward and the knee is moved forward.
      const center = d <= length1 ? root.clone().addScaledVector(axis, d)
        : middle.clone().addScaledVector(distalAxis, d - length1);
      if (!isArm) {
        const bulge = d < length1
          ? (p.thighFront ?? 0) * Math.sin(Math.PI * d / length1) ** 2
          : -(p.calfBack ?? 0) * Math.sin(Math.PI * (d - length1) / length2) ** 2;
        center.z += bulge;
      }
      const tangent = axis.clone().lerp(distalAxis, smoothstep(length1 - band, length1 + band, d)).normalize();
      const sectionU = u.clone().addScaledVector(tangent, -u.dot(tangent)).normalize();
      const sectionV = tangent.clone().cross(sectionU).normalize();
      const r = circ.eval(d) / (2 * Math.PI), aspect = isArm ? 1.08 + 0.07 * smoothstep(length1 - band, length1 + band, d) : 1;
      const points = ellipse(center, sectionU, sectionV, r * Math.sqrt(aspect), r / Math.sqrt(aspect), angles);
      if (isArm && d >= start - 1e-9) pressAgainstTorso(points);
      if (!isArm) for (const point of points) {
        // Keep the inner thighs on their own side even when width sliders would overlap them.
        const minX = 0.003;
        const t = (point.x - minX) / 0.006;
        if (t < 30) point.x = minX + 0.006 * Math.log1p(Math.exp(t));
      }
      return points;
    };
    let ring = s.bridge(source, circle(start), weights, axis, isArm ? 'upperarm_l' : 'thigh_l', strength, isArm ? new Vector3(1, 0, 0) : undefined, isArm ? pressAgainstTorso : undefined);
    if (isArm) {
      // Relax the shoulder bridge (end rows stay fixed) so rows pressed against the chest do not
      // fold over each other, then press it against the torso once more.
      const rows = s.bridgeRows, n = source.length;
      for (let iteration = 0; iteration < 24; iteration++) {
        const moved = new Map<number, Vector3>();
        for (let r = 1; r < rows.length - 1; r++) for (let i = 0; i < n; i++) {
          const mean = s.points[rows[r - 1][i]].clone().add(s.points[rows[r + 1][i]]).add(s.points[rows[r][(i + n - 1) % n]]).add(s.points[rows[r][(i + 1) % n]]).multiplyScalar(0.25);
          moved.set(rows[r][i], s.points[rows[r][i]].clone().lerp(mean, 0.5));
        }
        for (const [id, q] of moved) s.points[id].copy(q);
        for (let r = 1; r < rows.length - 1; r++) { const ringPoints = rows[r].map((id) => s.points[id]); pressAgainstTorso(ringPoints); }
      }
    }
    const steps = 34;
    const stations = [...new Set([...Array.from({ length: steps }, (_, i) => start + (total - start) * (i + 1) / steps), length1])].sort((a, b) => a - b);
    for (const d of stations) {
      const part = isArm ? d <= length1 ? 'upperarm_l' : 'forearm_l' : d <= length1 ? 'thigh_l' : 'shin_l';
      const next = s.ring(circle(d), weights);
      s.connect(ring, next, part); ring = next;
      if (d === length1) s.joints.push({ name: isArm ? 'elbow_l' : 'knee_l', vertices: ring.slice() });
    }
    if (isArm) {
      buildDetailedHand(s, ring, end, axis, p, preset, (name) => bone(name as BoneName));
      return;
    }
    // The foot placeholder is joined with a short transition collar.
    const center = isArm ? end.clone().addScaledVector(axis, Math.min(0.035, p.handLength * 0.2))
      : new Vector3(end.x, p.ankleHeight * 0.62, p.footLength * 0.25);
    const hu = isArm ? p.handWidth / 2 : p.footWidth / 2, hv = isArm ? p.handThickness / 2 : p.footLength / 2;
    const footV = isArm ? v : new Vector3(0, 0, 1);
    const rect = rectangle(center, u, footV, hu, hv, angles), terminalName = isArm ? 'hand_l' : 'foot_l';
    const startRing = ring;
    for (let row = 1; row <= 5; row++) {
      const t = row / 5;
      const target = rect.map((b, i) => s.points[startRing[i]].clone().lerp(b, smoothstep(0, 1, t)));
      const next = s.ring(target, (point) => isArm ? weights(point) : between('shin_l', 'foot_l', smoothstep(end.y + band * 0.7, end.y - band * 0.7, point.y)), 0.3 * strength);
      s.connect(ring, next, terminalName); ring = next;
    }
    s.joints.push({ name: isArm ? 'wrist_l' : 'ankle_l', vertices: [...startRing, ...ring] });
    const tip = isArm ? end.clone().addScaledVector(axis, p.handLength) : new Vector3(center.x, 0, center.z);
    const tipRing = s.ring(rectangle(tip, u, footV, hu, hv, angles), () => rigid(isArm ? 'hand_l' : 'foot_l'));
    s.connect(ring, tipRing, terminalName); s.cap(tipRing, tip, rigid(isArm ? 'hand_l' : 'foot_l'), terminalName);
  }
  limb(true, loops[shoulderIndex]); limb(false, hipSource);
  const leftEnd = s.points.length;
  const mirrored = new Map<number, number>();
  const torsoLookup = new Map(s.points.slice(0, torsoVertices).map((point, i) => [key(point), i]));
  for (let i = 0; i < torsoVertices; i++) {
    const p0 = s.points[i], mirror = torsoLookup.get(key(new Vector3(-p0.x, p0.y, p0.z)));
    if (mirror !== undefined) mirrored.set(i, mirror);
  }
  for (let i = torsoVertices; i < leftEnd; i++) {
    const point = s.points[i], weights = new Map<number, number>();
    for (const [b, w] of s.weights[i]) {
      const name = body.bones[b].name.replace(/_l$/, '_r') as BoneName; weights.set(bone(name), w);
    }
    mirrored.set(i, s.add(new Vector3(-point.x, point.y, point.z), weights, s.masks[i]));
  }
  const leftFaces = s.faces.slice(firstBranchFace);
  for (const f of leftFaces) {
    const a = mirrored.get(f.a), b = mirrored.get(f.b), c = mirrored.get(f.c);
    if (a === undefined || b === undefined || c === undefined) throw new Error('左右の接合境界が一致しません');
    s.face(a, c, b, f.part.replace(/_l$/, '_r'));
  }
  for (const j of s.joints.slice(firstBranchJoint)) s.joints.push({ name: j.name.replace(/_l$/, '_r'), vertices: j.vertices.map((i) => mirrored.get(i)!) });
  for (const i of loops[shoulderIndex].concat(hipSource)) { const j = mirrored.get(i)!; s.masks[j] = s.masks[i]; }

  // Neck and head retain the torso's mirrored sampling and the head's box dimensions.
  let neck = loops[neckIndex]; const rootPoints = neck.map((i) => s.points[i].clone());
  // Use the opening's bounding-box centre: the torso grid is denser at the front, so the mean
  // of its points sits well forward of the true centre.
  const lowX = Math.min(...rootPoints.map((a) => a.x)), highX = Math.max(...rootPoints.map((a) => a.x));
  const lowZ = Math.min(...rootPoints.map((a) => a.z)), highZ = Math.max(...rootPoints.map((a) => a.z));
  const neckCenter = new Vector3((lowX + highX) / 2, rootPoints.reduce((sum, a) => sum + a.y, 0) / rootPoints.length, (lowZ + highZ) / 2);
  const headBase = head('head'), topY = headBase.y + p.headHeight;
  const radiusX = (highX - lowX) / 2, radiusZ = (highZ - lowZ) / 2;
  const angles = rootPoints.map((a) => Math.atan2((a.z - neckCenter.z) / radiusZ, (a.x - neckCenter.x) / radiusX));
  // The neck rises from the torso's neck opening as a continuation of it: same section, tapering
  // gently into the head's base. A target much smaller than the opening, only a couple of
  // millimetres above it, forms a flat ledge (and folds the bridge over itself).
  const headBottomY = headBase.y + Math.min(0.025, p.headHeight * 0.12);
  const headStartScale = (p.headRoundness ?? 0) > 0 ? 0.52 : 1;
  const headStartX = p.headWidth * 0.5 * headStartScale, headStartZ = p.headDepth * 0.5 * headStartScale;
  const neckY = Math.min(neckCenter.y + 0.014, Math.max(neckCenter.y + 0.004, headBottomY - 0.006));
  const neckTarget = ellipse(new Vector3(0, neckY, neckCenter.z), new Vector3(1, 0, 0), new Vector3(0, 0, 1), Math.min(radiusX, radiusX + 0.75 * (headStartX - radiusX)), Math.min(radiusZ, radiusZ + 0.75 * (headStartZ - radiusZ)), angles);
  neck = s.bridge(neck, neckTarget, () => between('neck', 'head', 0.25), new Vector3(0, 1, 0), 'neck', strength);
  const headBottom = new Vector3(0, headBase.y + Math.min(0.025, p.headHeight * 0.12), headBase.z);
  if ((p.headRoundness ?? 0) > 0) {
    // A rounded cranium and tapered jaw, connected to the existing neck opening.
    const fullness = new Pchip([0, 0.12, 0.3, 0.52, 0.72, 0.88, 0.97, 1], [0.52, 0.72, 0.94, 1, 0.98, 0.8, 0.42, 0.04]);
    let loop = neck;
    for (let row = 0; row <= 24; row++) {
      const t = row / 24, scale = fullness.eval(t);
      const center = new Vector3(0, headBottom.y + (topY - headBottom.y) * t, headBase.z + 0.008 * Math.sin(Math.PI * t));
      const next = s.ring(ellipse(center, new Vector3(1, 0, 0), new Vector3(0, 0, 1), p.headWidth * 0.5 * scale, p.headDepth * 0.5 * scale, angles), () => rigid('head'));
      s.connect(loop, next, 'head');
      if (row === 0) s.joints.push({ name: 'head', vertices: [...neck, ...next] });
      loop = next;
    }
    s.cap(loop, new Vector3(0, topY, headBase.z), rigid('head'), 'head');
  } else {
  const headRect = rectangle(headBottom, new Vector3(1, 0, 0), new Vector3(0, 0, 1), p.headWidth / 2, p.headDepth / 2, angles);
  const bottomRing = s.ring(headRect, () => rigid('head'));
  s.connect(neck, bottomRing, 'head'); s.joints.push({ name: 'head', vertices: [...neck, ...bottomRing] });
  const headTop = new Vector3(0, topY, headBase.z);
  const topRing = s.ring(rectangle(headTop, new Vector3(1, 0, 0), new Vector3(0, 0, 1), p.headWidth / 2, p.headDepth / 2, angles), () => rigid('head'));
  s.connect(bottomRing, topRing, 'head'); s.cap(topRing, headTop, rigid('head'), 'head');
  }
  smoothBands(s, strength);
  return finish(s, body, roundedVertices);
}
