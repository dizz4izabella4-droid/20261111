// features: geometric measurements of each part, taken in the part's own normalized frame
// (the space of `part.root`, so the part's current transform never matters).
// Skinning is applied, so a neck that was adjusted through its bone shows up in the numbers.
import * as THREE from 'three';
import type { GarmentRegion, Part, Vec3 } from './types';
import { bonesOf, boxOfPoints, meshesOf, percentile, sampleVertices, skinnedMeshesOf, v3 } from './util';

export type BoneGroup = 'head' | 'neck' | 'chest' | 'waist' | 'pelvis' | 'arm' | 'hand' | 'leg' | 'foot' | 'other';

export function boneGroup(name: string): BoneGroup {
  const n = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (/head|skull|jaw|eye|tongue/.test(n)) return 'head';
  if (/neck/.test(n)) return 'neck';
  if (/toe|foot|ankle|heel/.test(n)) return 'foot';
  if (/hand|wrist|finger|thumb|index|middle|ring|pinky|palm/.test(n)) return 'hand';
  if (/thigh|upleg|leg|shin|calf|knee/.test(n)) return 'leg';
  if (/shoulder|clavicle|collar/.test(n)) return 'chest';
  if (/arm|elbow/.test(n)) return 'arm';
  if (/chest|spine[23]|upperchest|torso|breast/.test(n)) return 'chest';
  if (/spine|waist|abdomen|belly|stomach/.test(n)) return 'waist';
  if (/hips|pelvis|root|center/.test(n)) return 'pelvis';
  return 'other';
}

export interface BodyFeatures {
  box: THREE.Box3;
  height: number;
  hasSkeleton: boolean;
  /** boxes of the vertices owned by each bone group (only when skinned) */
  groups: Partial<Record<BoneGroup, THREE.Box3>>;
  groupCount: Partial<Record<BoneGroup, number>>;
  head: THREE.Box3;
  headHasGeometry: boolean;
  neckBase: Vec3;
  neckTop: Vec3;
  neckVerts: number;
  /** width / depth of the neck tube at its base (measured on the mesh) */
  neckW: number;
  neckD: number;
  headH: number;
  /** x half width of the torso at shoulder level */
  shoulderHalfWidth: number;
  bones: Record<string, Vec3>;
  regions: Record<GarmentRegion, THREE.Box3>;
}

const ZERO: Vec3 = [0, 0, 0];

function slabCenter(pts: number[][], y: number, thick: number): Vec3 {
  // centre (x,z) of the points whose y is within `thick` of `y`
  let sx = 0;
  let sz = 0;
  let n = 0;
  let minx = Infinity;
  let maxx = -Infinity;
  let minz = Infinity;
  let maxz = -Infinity;
  for (const p of pts) {
    if (Math.abs(p[1] - y) <= thick) {
      n++;
      sx += p[0];
      sz += p[2];
      minx = Math.min(minx, p[0]);
      maxx = Math.max(maxx, p[0]);
      minz = Math.min(minz, p[2]);
      maxz = Math.max(maxz, p[2]);
    }
  }
  if (!n) return [0, y, 0];
  return [(minx + maxx) / 2, y, (minz + maxz) / 2];
}

export function analyzeBody(part: Part): BodyFeatures {
  const root = part.root;
  root.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups: Partial<Record<BoneGroup, THREE.Box3>> = {};
  const groupCount: Partial<Record<BoneGroup, number>> = {};
  const groupPts: Partial<Record<BoneGroup, number[][]>> = {};
  const allPts: number[] = [];
  /** points that do not belong to the head (for the neck measurements) */
  const bodyPts: number[][] = [];
  const tmp = new THREE.Vector3();
  const mtx = new THREE.Matrix4();
  const skinned = skinnedMeshesOf(part.model).filter((m) => m.visible);
  const bones: Record<string, Vec3> = {};
  for (const b of bonesOf(part.model)) {
    b.getWorldPosition(tmp);
    tmp.applyMatrix4(inv);
    bones[b.name] = v3(tmp);
  }
  const plainMeshes = meshesOf(part.model).filter((m) => !(m as THREE.SkinnedMesh).isSkinnedMesh && m.visible);
  const addAll = (m: THREE.Mesh, group: (i: number) => BoneGroup | null) => {
    const pos = m.geometry.attributes.position;
    mtx.multiplyMatrices(inv, m.matrixWorld);
    const stride = Math.max(1, Math.ceil(pos.count / 40000));
    const sk = m as THREE.SkinnedMesh;
    for (let i = 0; i < pos.count; i += stride) {
      if (sk.isSkinnedMesh) sk.getVertexPosition(i, tmp);
      else tmp.fromBufferAttribute(pos, i);
      tmp.applyMatrix4(mtx);
      allPts.push(tmp.x, tmp.y, tmp.z);
      const g = group(i);
      if (g !== 'head') bodyPts.push([tmp.x, tmp.y, tmp.z]);
      if (g) {
        const box = (groups[g] ??= new THREE.Box3());
        box.expandByPoint(tmp);
        groupCount[g] = (groupCount[g] ?? 0) + 1;
        (groupPts[g] ??= []).push([tmp.x, tmp.y, tmp.z]);
      }
    }
  };
  for (const m of skinned) {
    const names = m.skeleton.bones.map((b) => boneGroup(b.name));
    const si = m.geometry.attributes.skinIndex;
    const sw = m.geometry.attributes.skinWeight;
    addAll(m, (i) => {
      if (!si || !sw) return null;
      let best = 0;
      let bw = -1;
      const acc: Partial<Record<BoneGroup, number>> = {};
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k);
        if (w <= 0) continue;
        const g = names[si.getComponent(i, k)] ?? 'other';
        acc[g] = (acc[g] ?? 0) + w;
      }
      let gb: BoneGroup = 'other';
      for (const g of Object.keys(acc) as BoneGroup[]) {
        if ((acc[g] ?? 0) > bw) {
          bw = acc[g] ?? 0;
          gb = g;
        }
      }
      void best;
      return gb;
    });
  }
  for (const m of plainMeshes) addAll(m, () => null);

  const pts = new Float32Array(allPts);
  const box = boxOfPoints(pts);
  const size = box.getSize(new THREE.Vector3());
  const height = size.y;
  const hasSkeleton = skinned.length > 0 && Object.keys(groups).length >= 3;

  let head: THREE.Box3;
  let headHasGeometry = false;
  let neckBase: Vec3;
  let neckTop: Vec3;
  let neckW = 0.09;
  let neckD = 0.09;
  let shoulderHalfWidth: number;
  const headBox = groups.head;
  const neckBox = groups.neck;
  if (hasSkeleton && headBox && (groupCount.head ?? 0) > 30) {
    head = headBox.clone();
    headHasGeometry = true;
    // top of the body below the head, and the neck tube just under it (all non-head vertices count,
    // because the weights of the neck ring are shared between neck / chest / head)
    let topY = -Infinity;
    for (const p of bodyPts) topY = Math.max(topY, p[1]);
    if (!Number.isFinite(topY)) topY = head.min.y;
    const bandH = 0.012 * (height / 1.5);
    const band = new THREE.Box3();
    for (const p of bodyPts) if (p[1] >= topY - bandH) band.expandByPoint(new THREE.Vector3(p[0], p[1], p[2]));
    neckBase = [(band.min.x + band.max.x) / 2, topY, (band.min.z + band.max.z) / 2];
    neckW = band.max.x - band.min.x;
    neckD = band.max.z - band.min.z;
    neckTop = slabCenter(groupPts.head ?? [], head.min.y, 0.004);
    void neckBox;
    if (neckTop[1] < neckBase[1]) neckTop = [neckTop[0], neckBase[1], neckTop[2]];
  } else {
    // no usable head geometry: use the head bone or the usual proportions
    const hb = bones['head'] ?? Object.entries(bones).find(([n]) => boneGroup(n) === 'head')?.[1];
    const nb = bones['neck'] ?? Object.entries(bones).find(([n]) => boneGroup(n) === 'neck')?.[1];
    const headH = height / 7.5;
    const topY = box.max.y;
    const nTop = hb ? hb[1] : topY - headH;
    neckTop = hb ? [hb[0], hb[1], hb[2]] : [(box.min.x + box.max.x) / 2, nTop, (box.min.z + box.max.z) / 2 - 0.01];
    neckBase = nb ? [nb[0], nb[1], nb[2]] : [neckTop[0], nTop - 0.04 * height, neckTop[2]];
    head = new THREE.Box3(new THREE.Vector3(neckTop[0] - headH * 0.45, nTop, neckTop[2] - headH * 0.5), new THREE.Vector3(neckTop[0] + headH * 0.45, topY, neckTop[2] + headH * 0.5));
  }
  const headH = head.max.y - head.min.y;
  // shoulder width: from the arm group, else a slice of the torso
  const armBox = groups.arm;
  if (armBox) shoulderHalfWidth = Math.max(Math.abs(armBox.min.x), Math.abs(armBox.max.x)) * 0.98;
  else shoulderHalfWidth = size.x * 0.28;

  // region boxes
  const U = (...bs: (THREE.Box3 | undefined)[]): THREE.Box3 => {
    const b = new THREE.Box3();
    for (const x of bs) if (x) b.union(x);
    return b;
  };
  const regions = {} as Record<GarmentRegion, THREE.Box3>;
  if (hasSkeleton) {
    const torso = U(groups.chest, groups.waist, groups.pelvis, groups.neck);
    regions.whole = box.clone();
    regions.torso = torso;
    const midY = (torso.min.y + torso.max.y) / 2;
    regions.chest = new THREE.Box3(new THREE.Vector3(torso.min.x, midY, torso.min.z), torso.max.clone());
    regions.waist = U(groups.waist);
    regions.pelvis = U(groups.pelvis);
    regions.arm = U(groups.arm, groups.hand);
    regions.hand = U(groups.hand);
    regions.leg = U(groups.leg, groups.foot);
    regions.foot = U(groups.foot);
    regions.neck = U(groups.neck);
    regions.neck = new THREE.Box3(new THREE.Vector3(neckBase[0] - neckW / 2, neckBase[1] - 0.05, neckBase[2] - neckD / 2), new THREE.Vector3(neckBase[0] + neckW / 2, Math.max(neckTop[1], neckBase[1] + 0.02), neckBase[2] + neckD / 2));
    regions.head = head.clone();
    for (const k of Object.keys(regions) as GarmentRegion[]) if (regions[k].isEmpty()) regions[k] = torso.clone();
  } else {
    const H = height;
    const y0 = box.min.y;
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    const band = (a: number, b: number, hx: number, hz: number) => new THREE.Box3(new THREE.Vector3(cx - hx, y0 + a * H, cz - hz), new THREE.Vector3(cx + hx, y0 + b * H, cz + hz));
    const tx = Math.min(size.x / 2, 0.13 * H);
    regions.whole = box.clone();
    regions.torso = band(0.5, 0.82, tx, size.z / 2);
    regions.chest = band(0.66, 0.82, tx, size.z / 2);
    regions.waist = band(0.57, 0.66, tx * 0.9, size.z / 2);
    regions.pelvis = band(0.47, 0.57, tx, size.z / 2);
    regions.arm = band(0.45, 0.82, size.x / 2, size.z / 2);
    regions.hand = band(0.38, 0.5, size.x / 2, size.z / 2);
    regions.leg = band(0, 0.5, tx, size.z / 2);
    regions.foot = band(0, 0.05, tx, size.z / 2);
    regions.neck = new THREE.Box3(new THREE.Vector3(neckBase[0] - 0.045, neckBase[1], neckBase[2] - 0.05), new THREE.Vector3(neckBase[0] + 0.045, neckTop[1], neckBase[2] + 0.05));
    regions.head = head.clone();
  }
  return { box, height, hasSkeleton, groups, groupCount, head, headHasGeometry, neckBase, neckTop, neckVerts: groupCount.neck ?? 0, neckW, neckD, headH, shoulderHalfWidth, bones, regions };
}

// ---- face ---------------------------------------------------------------------------------------

export interface FaceFeatures {
  box: THREE.Box3;
  height: number;
  hasNeck: boolean;
  /** where the head proper starts (chin level); equals box.min.y when there is no neck */
  chinY: number;
  headH: number;
  headW: number;
  headD: number;
  /** centre of the skull seen from above (x,z) */
  skullCx: number;
  skullCz: number;
  /** point under the skull where a neck would enter */
  headRoot: Vec3;
  crown: Vec3;
  neckBase: Vec3 | null;
  /** width / depth of the neck part (when the face has one) */
  neckW: number;
  neckD: number;
  cranBox: THREE.Box3;
}

export function analyzeFace(part: Part): FaceFeatures {
  const pts = sampleVertices(part.model, part.root, 60000);
  const box = boxOfPoints(pts);
  const size = box.getSize(new THREE.Vector3());
  const H = size.y;
  // width profile along Y. The width of a slice is 2 x the 90th percentile of |x - centre|, so thin
  // protrusions (pointed ears modelled as separate meshes) do not count as head width.
  const bins = 48;
  const per: number[][] = Array.from({ length: bins }, () => []);
  const xsAll: number[] = [];
  for (let i = 0; i < pts.length; i += 3) xsAll.push(pts[i]);
  xsAll.sort((p, q) => p - q);
  const cx0 = xsAll[Math.floor(xsAll.length / 2)] ?? 0;
  for (let i = 0; i < pts.length; i += 3) {
    const b = Math.min(bins - 1, Math.floor(((pts[i + 1] - box.min.y) / H) * bins));
    per[b].push(Math.abs(pts[i] - cx0));
  }
  const width = per.map((a) => (a.length > 8 ? 2 * percentile(a, 0.9) : 0));
  const maxW = Math.max(...width);
  // a neck = a run of slices at the bottom that are clearly narrower than the head and about as wide
  // as each other (a tube), covering at least 8% of the height
  const w0 = width[0] || 1e-9;
  let run = 0;
  for (let b = 0; b < bins; b++) {
    // an empty slice inside a tube (long polygons, few vertices) does not end the neck
    if (width[b] === 0 && b > 0) run++;
    else if (width[b] > 0 && width[b] < maxW * 0.78 && Math.abs(width[b] - w0) < 0.25 * w0) run++;
    else break;
  }
  // trailing empty slices do not count as neck
  while (run > 0 && width[run - 1] === 0) run--;
  const hasNeck = run >= Math.ceil(bins * 0.08) && run < bins * 0.5 && w0 < maxW * 0.8;
  const chinY = hasNeck ? box.min.y + (run / bins) * H : box.min.y;
  const headH = box.max.y - chinY;
  const headW = size.x;
  const headD = size.z;
  // skull centre: upper part of the head, where the nose and chin do not matter
  const cranLo = chinY + headH * 0.55;
  const cranHi = chinY + headH * 0.92;
  const cran = new THREE.Box3();
  for (let i = 0; i < pts.length; i += 3) if (pts[i + 1] >= cranLo && pts[i + 1] <= cranHi) cran.expandByPoint(new THREE.Vector3(pts[i], pts[i + 1], pts[i + 2]));
  if (cran.isEmpty()) cran.copy(box);
  const skullCx = (cran.min.x + cran.max.x) / 2;
  const skullCz = (cran.min.z + cran.max.z) / 2;
  // lowest point under the skull, near the neck axis
  let underY = Infinity;
  const zs: number[] = [];
  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i];
    const z = pts[i + 2];
    if (Math.abs(x - skullCx) < headW * 0.18 && z > skullCz - headD * 0.28 && z < skullCz + headD * 0.12 && pts[i + 1] >= chinY - 1e-6) {
      zs.push(pts[i + 1]);
    }
  }
  if (zs.length) {
    zs.sort((a, b) => a - b);
    underY = zs[Math.floor(zs.length * 0.02)];
  } else underY = chinY;
  const headRoot: Vec3 = [skullCx, underY, skullCz];
  const crown: Vec3 = [skullCx, box.max.y, skullCz];
  // the neck part: its own centre and size (the head proper is wider and sits further forward)
  let neckBase: Vec3 | null = null;
  let neckW = 0;
  let neckD = 0;
  if (hasNeck) {
    // the lower part of the neck only: ears and the jaw must not pull the centre around
    const yMax = box.min.y + 0.7 * (chinY - box.min.y);
    const xs: number[] = [];
    const zs2: number[] = [];
    for (let i = 0; i < pts.length; i += 3)
      if (pts[i + 1] < yMax) {
        xs.push(pts[i]);
        zs2.push(pts[i + 2]);
      }
    if (xs.length > 20) {
      xs.sort((a, b) => a - b);
      zs2.sort((a, b) => a - b);
      const q = (a: number[], f: number) => a[Math.min(a.length - 1, Math.max(0, Math.floor(a.length * f)))];
      const x0 = q(xs, 0.02);
      const x1 = q(xs, 0.98);
      const z0 = q(zs2, 0.02);
      const z1 = q(zs2, 0.98);
      neckBase = [(x0 + x1) / 2, box.min.y, (z0 + z1) / 2];
      neckW = x1 - x0;
      neckD = z1 - z0;
    }
  }
  return { box, height: H, hasNeck: hasNeck && !!neckBase, chinY, headH, headW: faceWidth(pts, box, chinY, headH), headD, skullCx, skullCz, headRoot, crown, neckBase, neckW, neckD, cranBox: cran };
}

/** width of the head itself (the ears of a separate ear mesh must not count) */
function faceWidth(pts: Float32Array, box: THREE.Box3, chinY: number, headH: number): number {
  const xs: number[] = [];
  const lo = chinY + headH * 0.3;
  const hi = chinY + headH * 0.8;
  for (let i = 0; i < pts.length; i += 3) if (pts[i + 1] >= lo && pts[i + 1] <= hi) xs.push(pts[i]);
  if (xs.length < 10) return box.max.x - box.min.x;
  xs.sort((a, b) => a - b);
  // 1st-99th percentile trims thin protrusions such as pointed ears
  return xs[Math.floor(xs.length * 0.99)] - xs[Math.floor(xs.length * 0.01)];
}

// ---- hair ---------------------------------------------------------------------------------------

export interface HairFeatures {
  box: THREE.Box3;
  cap: THREE.Box3;
  capCx: number;
  capCz: number;
  top: number;
  meshCount: number;
  /** radial positions are measured against this ellipsoid by the checker */
}

export function analyzeHair(part: Part): HairFeatures {
  const pts = sampleVertices(part.model, part.root, 60000);
  const box = boxOfPoints(pts);
  const h = box.max.y - box.min.y;
  // the cap = the vertices near the top of the hair (long tails hang below and must not count)
  const capLo = box.max.y - Math.min(h * 0.35, 0.09 / Math.max(1e-6, 1) * 1e6);
  const cap = new THREE.Box3();
  // use a robust lower bound: top 35% of the height
  for (let i = 0; i < pts.length; i += 3) if (pts[i + 1] >= box.max.y - h * 0.35) cap.expandByPoint(new THREE.Vector3(pts[i], pts[i + 1], pts[i + 2]));
  void capLo;
  if (cap.isEmpty()) cap.copy(box);
  return { box, cap, capCx: (cap.min.x + cap.max.x) / 2, capCz: (cap.min.z + cap.max.z) / 2, top: box.max.y, meshCount: meshesOf(part.model).length };
}

// ---- garment ------------------------------------------------------------------------------------

export interface GarmentFeatures {
  box: THREE.Box3;
  size: THREE.Vector3;
  skinned: boolean;
  /** share of skin weight on each bone group (skinned garments) */
  groupShare: Partial<Record<BoneGroup, number>>;
}

export function analyzeGarment(part: Part): GarmentFeatures {
  const pts = sampleVertices(part.model, part.root, 60000);
  const box = boxOfPoints(pts);
  const groupShare: Partial<Record<BoneGroup, number>> = {};
  let total = 0;
  const sk = skinnedMeshesOf(part.model);
  for (const m of sk) {
    const names = m.skeleton.bones.map((b) => boneGroup(b.name));
    const si = m.geometry.attributes.skinIndex;
    const sw = m.geometry.attributes.skinWeight;
    if (!si || !sw) continue;
    const step = Math.max(1, Math.ceil(si.count / 8000));
    for (let i = 0; i < si.count; i += step)
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k);
        if (w <= 0) continue;
        const g = names[si.getComponent(i, k)] ?? 'other';
        groupShare[g] = (groupShare[g] ?? 0) + w;
        total += w;
      }
  }
  if (total) for (const g of Object.keys(groupShare) as BoneGroup[]) groupShare[g] = (groupShare[g] ?? 0) / total;
  return { box, size: box.getSize(new THREE.Vector3()), skinned: sk.length > 0, groupShare };
}

export { ZERO };
