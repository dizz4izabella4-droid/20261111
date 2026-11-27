import { describe, expect, it } from 'vitest';
import { buildBody } from '../src/model/body';
import { presetParams, type BodyParams } from '../src/model/params';
import { trianglesIntersect, watertight } from './geom';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Vector3 } from 'three';
import { exportBodyGlb } from '../src/export/exportBody';
import { applyPreviewPose, restPose } from '../src/model/pose';

describe('connected body surface', () => {
  for (const sex of ['female', 'male'] as const) for (const precision of ['light', 'standard', 'high'] as const) {
    it(`${sex}/${precision}: one closed connected surface`, () => {
      const body = buildBody(presetParams(sex), precision);
      expect(body.warnings.filter((s) => s.includes('接合') || s.includes('補正前'))).toEqual([]);
      expect(body.seams).toBeTruthy();
      expect(body.seams!.roundedVertices).toBeGreaterThan(0);
      const quality = watertight(body);
      expect(quality.badEdges).toBe(0);
      expect(quality.inconsistentEdges).toBe(0);
      expect(quality.degenerate).toBe(0);
      expect(quality.signedVolume).toBeGreaterThan(0);
      expect(body.seams?.components).toBe(1);
    });
  }
});

it('new shoulder and joint controls keep a connected surface at their limits', () => {
  for (const sex of ['male', 'female'] as const) for (const options of [
    { shoulderDrop: 0.045, shoulderForward: -0.035, shoulderRoundness: 0, seamWidth: 0, jointBlend: 0 },
    { shoulderDrop: 0.09, shoulderForward: 0.035, shoulderRoundness: 100, seamWidth: 100, jointBlend: 100 },
    { upperArmCirc: 0.4, elbowCirc: 0.15, forearmCirc: 0.33, thighCirc: 0.75, kneeCirc: 0.27, hipJointSpacing: 0.12 },
    { shoulderWidth: 0.26, chestDepth: 0.3, neckLength: 0.03, torsoHeight: 0.48, waistHeight: 0.44, navelHeight: 0.34 },
  ] as BodyParams[]) {
    const body = buildBody({ ...presetParams(sex), ...options }, 'light');
    expect(body.seams, body.warnings.join(' ')).toBeTruthy();
    expect(body.positions.every(Number.isFinite)).toBe(true);
    expect(body.normals.every(Number.isFinite)).toBe(true);
    expect(watertight(body).badEdges).toBe(0);
  }
});

it('exported joints remain connected in shoulder, elbow, knee, torso and twist poses', async () => {
  const params = presetParams('male'), body = buildBody(params, 'standard');
  const result: any = await new Promise((resolve, reject) => new GLTFLoader().parse(exportBodyGlb(body, params), '', resolve, reject));
  const mesh = result.scene.getObjectByProperty('isSkinnedMesh', true);
  const poses = [
    ...[0, 45, 90, 135, 180].map((armElevation) => ({ ...restPose(), armElevation })),
    ...[-90, 90].map((twist) => ({ ...restPose(), armElevation: 90, twist })),
    { ...restPose(), elbow: 120, knee: 120, hip: 60, torso: 35 },
  ];
  for (const pose of poses) {
    applyPreviewPose(body, mesh.skeleton.bones, pose);
    result.scene.updateMatrixWorld(true); mesh.skeleton.update();
    const positions = body.positions.slice(), point = new Vector3();
    for (let i = 0; i < positions.length / 3; i++) {
      point.fromArray(body.positions, i * 3); mesh.applyBoneTransform(i, point); point.toArray(positions, i * 3);
    }
    expect(positions.every(Number.isFinite)).toBe(true);
    const quality = watertight({ positions, indices: body.indices });
    expect(quality.badEdges, JSON.stringify(pose)).toBe(0);
    expect(quality.inconsistentEdges).toBe(0);
    expect(quality.degenerate).toBe(0);
  }
  // Elbow and knee rings must blend their parent and child bones, not be rigid islands.
  for (const name of ['elbow_l', 'elbow_r', 'knee_l', 'knee_r']) {
    const joint = body.seams!.joints.find((j) => j.name === name)!;
    expect(joint.vertices.every((i) => body.skinWeight[i * 4] < 0.99 && body.skinWeight[i * 4 + 1] > 0.01)).toBe(true);
  }
});

it('the uncorrected comparison keeps the original separate parts', () => {
  const body = buildBody({ ...presetParams('male'), seamCorrection: 0 }, 'light');
  expect(body.seams).toBeUndefined();
  expect(body.parts.length).toBe(15);
});

it('adjacent joint surfaces do not intersect at rest or at the arm-opening limits', () => {
  for (const sex of ['male', 'female'] as const) for (const armAngle of [0, 18, 80]) {
    const body = buildBody({ ...presetParams(sex), armAngle }, 'light'), cell = 0.035;
    const grid = new Map<string, number[]>(), triangles: [number, number, number][] = [], boxes: number[][] = [];
    const point = (i: number): [number, number, number] => [body.positions[i * 3], body.positions[i * 3 + 1], body.positions[i * 3 + 2]];
    for (let t = 0; t < body.indices.length / 3; t++) {
      const ids: [number, number, number] = [body.indices[t * 3], body.indices[t * 3 + 1], body.indices[t * 3 + 2]];
      triangles.push(ids); const ps = ids.map(point);
      const lo = [0, 1, 2].map((c) => Math.min(...ps.map((p) => p[c]))), hi = [0, 1, 2].map((c) => Math.max(...ps.map((p) => p[c])));
      boxes.push([...lo, ...hi]);
      for (let x = Math.floor(lo[0] / cell); x <= Math.floor(hi[0] / cell); x++) for (let y = Math.floor(lo[1] / cell); y <= Math.floor(hi[1] / cell); y++) for (let z = Math.floor(lo[2] / cell); z <= Math.floor(hi[2] / cell); z++) {
        const k = `${x}/${y}/${z}`, list = grid.get(k) ?? []; list.push(t); grid.set(k, list);
      }
    }
    const hits: string[] = [];
    const part = (t: number) => body.parts.find((p) => t * 3 >= p.start && t * 3 < p.start + p.count)?.name;
    const parent: Record<string, string> = { neck: 'torso', head: 'neck' };
    for (const side of ['l', 'r']) {
      parent[`upperarm_${side}`] = 'torso'; parent[`forearm_${side}`] = `upperarm_${side}`; parent[`hand_${side}`] = `forearm_${side}`;
      parent[`thigh_${side}`] = 'torso'; parent[`shin_${side}`] = `thigh_${side}`; parent[`foot_${side}`] = `shin_${side}`;
    }
    const parts = triangles.map((_, i) => part(i)!);
    for (let t = 0; t < triangles.length; t++) {
      const a = boxes[t], ids = triangles[t], seen = new Set<number>();
      for (let x = Math.floor(a[0] / cell); x <= Math.floor(a[3] / cell); x++) for (let y = Math.floor(a[1] / cell); y <= Math.floor(a[4] / cell); y++) for (let z = Math.floor(a[2] / cell); z <= Math.floor(a[5] / cell); z++) {
        for (const u of grid.get(`${x}/${y}/${z}`) ?? []) {
          if (u <= t || seen.has(u)) continue; seen.add(u);
          // This checks a joint and its adjoining surfaces. Hand/thigh contact, for
          // example, is a separate collision problem rather than a broken joint.
          if (parts[t] !== parts[u] && parent[parts[t]] !== parts[u] && parent[parts[u]] !== parts[t]) continue;
          const other = triangles[u], b = boxes[u];
          if (other.some((i) => ids.includes(i)) || [0, 1, 2].some((c) => a[c] > b[c + 3] || a[c + 3] < b[c])) continue;
          if (trianglesIntersect(ids.map(point), other.map(point))) hits.push(`${part(t)}:${t}/${part(u)}:${u}`);
        }
      }
    }
    expect(hits.length, `${sex}/${armAngle}: ${hits.slice(0, 5).join(', ')}`).toBe(0);
  }
});
