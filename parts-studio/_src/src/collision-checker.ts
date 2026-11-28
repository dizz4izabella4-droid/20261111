// collision-checker: connection quality. NOT a proof of geometric watertightness — a check based on
// anchors, bounding boxes and (when asked) sampled vertices, reported as 正常 / 要調整 / 未判定 / 非対応.
//   light   : runs after edits; only numbers already measured (features, anchors, transforms).
//   detailed: runs on request for chosen parts; samples vertices and uses a spatial hash / ray casts.
import * as THREE from 'three';
import type { Connection, ConnectionKind, FitMessage, FitStatus, Part } from './types';
import { REGION_JA } from './types';
import type { BodyFeatures, FaceFeatures, GarmentFeatures, HairFeatures } from './features';
import { PointGrid, meshesOf, percentile, sampleVertices } from './util';

export interface CheckContext {
  parts: Part[];
  body: Part | null;
  face: Part | null;
  bodyF: BodyFeatures | null;
  faceF: FaceFeatures | null;
  hairF: (p: Part) => HairFeatures;
  garmentF: (p: Part) => GarmentFeatures;
  detailed: boolean;
  /** limit the detailed checks to connections that involve one of these parts */
  detailedFor?: Set<string>;
}

const wd = (ctx: CheckContext, ...ids: (string | undefined)[]): boolean =>
  ctx.detailed && (!ctx.detailedFor || ids.some((i) => !!i && ctx.detailedFor!.has(i)));

const mm = (m: number): string => `${(m * 1000).toFixed(1)}mm`;
const cm = (m: number): string => `${(m * 100).toFixed(1)}cm`;

function conn(kind: ConnectionKind, a: Part | null, b: Part | null, label: string, _detailed: boolean): Connection {
  return { id: `${kind}:${a?.id ?? ''}:${b?.id ?? ''}`, kind, a: a?.id ?? '', b: b?.id ?? null, label, status: 'unknown', messages: [], metrics: {}, detailed: false };
}

const worst = (a: FitStatus, b: FitStatus): FitStatus => {
  const order: FitStatus[] = ['ok', 'unknown', 'unsupported', 'adjust'];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
};

function worldBox(box: THREE.Box3, m: THREE.Matrix4): THREE.Box3 {
  return box.clone().applyMatrix4(m);
}

export function checkAll(ctx: CheckContext): Connection[] {
  const out: Connection[] = [];
  const { body, face } = ctx;
  for (const p of ctx.parts) p.root.updateWorldMatrix(true, true);
  if (face) out.push(checkHeadBody(face, body, ctx));
  for (const h of ctx.parts.filter((p) => p.type === 'hair')) out.push(checkHairHead(h, face, body, ctx));
  const garments = ctx.parts.filter((p) => p.type === 'garment');
  for (const g of garments) out.push(checkGarmentBody(g, body, ctx));
  for (let i = 0; i < garments.length; i++)
    for (let j = i + 1; j < garments.length; j++) out.push(checkGarmentGarment(garments[i], garments[j], ctx));
  if (ctx.parts.length) out.push(checkWhole(ctx));
  return out;
}

// ---- head <-> body ----------------------------------------------------------------------------

function checkHeadBody(face: Part, body: Part | null, ctx: CheckContext): Connection {
  const c = conn('head-body', face, body, '頭部 ⇔ 身体（首）', ctx.detailed);
  const bf = ctx.bodyF;
  const ff = ctx.faceF;
  if (!body || !bf || !ff) {
    c.messages.push({ level: 'info', text: '身体が未読込のため判定できません。' });
    return c;
  }
  const H = bf.height * body.root.matrixWorld.getMaxScaleOnAxis();
  const faceM = face.root.matrixWorld;
  const bodyM = body.root.matrixWorld;
  const root = new THREE.Vector3(...(ff.hasNeck && ff.neckBase ? [ff.neckBase[0], ff.box.min.y, ff.neckBase[2]] : ff.headRoot)).applyMatrix4(faceM);
  const neckBase = new THREE.Vector3(...bf.neckBase).applyMatrix4(bodyM);
  const neckTop = new THREE.Vector3(...bf.neckTop).applyMatrix4(bodyM);
  const msgs: FitMessage[] = [];
  let st: FitStatus = 'ok';
  // vertical: face root vs body neck
  const refY = ff.hasNeck ? neckBase.y : neckBase.y;
  const dy = root.y - refY; // + => the face floats above the neck, - => the neck goes into the head
  const dx = root.x - neckBase.x;
  const dz = root.z - neckBase.z;
  c.metrics.gapY = dy;
  c.metrics.offsetX = dx;
  c.metrics.offsetZ = dz;
  const gapTol = 0.012 * (H / 1.5);
  const sinkTol = 0.05 * (H / 1.5);
  if (dy > gapTol) {
    st = 'adjust';
    msgs.push({ level: 'warn', text: `首と頭の間に隙間があります（約 ${mm(dy)} 浮いています）。頭を下げるか首を伸ばしてください。` });
  } else if (-dy > sinkTol) {
    st = 'adjust';
    msgs.push({ level: 'warn', text: `頭が首に埋まりすぎています（約 ${mm(-dy)}）。頭を上げてください。` });
  } else msgs.push({ level: 'info', text: `首と頭の上下の差 ${mm(dy)}（許容 隙間 ${mm(gapTol)} / 埋まり ${mm(sinkTol)}）。` });
  const lateral = Math.hypot(dx, dz);
  const headWWorld = ff.headW * faceM.getMaxScaleOnAxis();
  if (lateral > headWWorld * 0.3) {
    st = 'adjust';
    msgs.push({ level: 'warn', text: `頭が首の中心から ${mm(lateral)} ずれています（左右 ${mm(dx)}・前後 ${mm(dz)}）。` });
  }
  // proportion
  const headHWorld = ff.headH * faceM.getMaxScaleOnAxis();
  const heads = H / headHWorld;
  c.metrics.headsTall = heads;
  if (heads < 5.2 || heads > 10) {
    st = 'adjust';
    msgs.push({ level: 'warn', text: `頭身が約 ${heads.toFixed(1)} 頭身で不自然な可能性があります（5.2〜10頭身が目安）。` });
  } else msgs.push({ level: 'info', text: `頭身 約 ${heads.toFixed(1)}。` });
  // tilt
  const e = new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().extractRotation(faceM));
  const tilt = Math.max(Math.abs(e.x), Math.abs(e.z)) * (180 / Math.PI);
  if (tilt > 20) {
    st = 'adjust';
    msgs.push({ level: 'warn', text: `頭が ${tilt.toFixed(0)}° 傾いています。` });
  }
  void neckTop;
  if (wd(ctx, face.id, body.id)) {
    const d = headBodyDetail(face, body, bf);
    if (d) {
      c.metrics.rayGap = d.gap;
      msgs.push({ level: d.status === 'ok' ? 'info' : 'warn', text: d.text });
      st = worst(st, d.status);
      c.detailed = true;
    }
  }
  c.status = st;
  c.messages = msgs;
  return c;
}

/** Ray casts up from inside the neck: how far below the head surface does the neck end? */
function headBodyDetail(face: Part, body: Part, bf: BodyFeatures): { gap: number; status: FitStatus; text: string } | null {
  const meshes = meshesOf(face.model).filter((m) => m.visible);
  if (!meshes.length) return null;
  const rc = new THREE.Raycaster();
  const bodyM = body.root.matrixWorld;
  const nb = new THREE.Vector3(...bf.neckBase).applyMatrix4(bodyM);
  const r = Math.max(0.01, (bf.regions.neck.max.x - bf.regions.neck.min.x) / 2) * 0.5;
  const gaps: number[] = [];
  let hits = 0;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const o = new THREE.Vector3(nb.x + Math.cos(a) * r * (k % 2 ? 1 : 0.4), nb.y - 0.03, nb.z + Math.sin(a) * r * (k % 2 ? 1 : 0.4));
    rc.set(o, new THREE.Vector3(0, 1, 0));
    const hit = rc.intersectObjects(meshes, false).find((h) => h.point.y > o.y - 1e-9);
    if (hit) {
      hits++;
      gaps.push(hit.point.y - nb.y);
    }
  }
  if (!hits) {
    return { gap: Infinity, status: 'adjust', text: '詳細検査：首の真上に顔のメッシュがありません（頭が首の上にありません）。' };
  }
  const g = percentile(gaps, 0.5);
  const tol = 0.012 * (bf.height / 1.5);
  const st: FitStatus = g > tol ? 'adjust' : g < -0.05 * (bf.height / 1.5) ? 'adjust' : 'ok';
  return { gap: g, status: st, text: `詳細検査：首の上端から頭の下面まで ${mm(g)}（${g > 0 ? '隙間' : '首が頭に入っている量'}）。${hits}/8 本の光線が頭に当たりました。` };
}

// ---- hair <-> head -----------------------------------------------------------------------------

function checkHairHead(hair: Part, face: Part | null, body: Part | null, ctx: CheckContext): Connection {
  const c = conn('hair-head', hair, face ?? body, '髪型 ⇔ 頭部', ctx.detailed);
  const ff = ctx.faceF;
  if (!face || !ff) {
    c.messages.push({ level: 'info', text: '顔が未読込のため、髪の浮き・埋まりは判定できません。' });
    return c;
  }
  const hf = ctx.hairF(hair);
  void hf;
  const pts = sampleVertices(hair.model, face.root, 20000); // hair vertices in the face's frame
  // skull proxy: ellipsoid fitted to the head
  const cy = ff.chinY + ff.headH * 0.5;
  const a = ff.headW / 2;
  const b = ff.headH / 2;
  const d = ff.headD / 2;
  const cx = ff.skullCx;
  const cz = ff.skullCz;
  const rs: number[] = [];
  const topY = ff.chinY + ff.headH * 0.45;
  for (let i = 0; i < pts.length; i += 3) {
    if (pts[i + 1] < topY) continue; // only the part of the hair that covers the skull
    const r = Math.sqrt(((pts[i] - cx) / a) ** 2 + ((pts[i + 1] - cy) / b) ** 2 + ((pts[i + 2] - cz) / d) ** 2);
    rs.push(r);
  }
  const msgs: FitMessage[] = [];
  if (rs.length < 20) {
    c.messages.push({ level: 'warn', text: '髪が頭の上部に見当たりません。位置がずれている可能性があります。' });
    c.status = 'adjust';
    return c;
  }
  const p10 = percentile(rs, 0.1);
  const p50 = percentile(rs, 0.5);
  c.metrics.rootRadius = p10;
  c.metrics.medianRadius = p50;
  let st: FitStatus = 'ok';
  const scale = face.root.matrixWorld.getMaxScaleOnAxis();
  if (p10 < 0.8) {
    st = 'adjust';
    msgs.push({ level: 'warn', text: `髪の一部が頭に埋まっています（頭の近似楕円の半径比 ${p10.toFixed(2)}、1.0が頭の表面）。髪を上げるか大きくしてください。` });
  } else if (p10 > 1.3) {
    st = 'adjust';
    msgs.push({ level: 'warn', text: `髪が頭から浮いています（根元の半径比 ${p10.toFixed(2)}）。髪を下げるか小さくしてください。` });
  } else msgs.push({ level: 'info', text: `髪の根元は頭の近似楕円の半径比 ${p10.toFixed(2)}（0.8〜1.3 が目安）。` });
  // vertical: hair top above the head top
  const topGap = (hairTopInFace(hair, face) - ff.box.max.y) / ff.headH;
  c.metrics.topGap = topGap;
  if (topGap < -0.05) {
    st = 'adjust';
    msgs.push({ level: 'warn', text: `髪の頭頂が顔の頭頂より ${(-topGap * 100).toFixed(1)}%（頭の高さ比）低く、地肌が出る可能性があります。` });
  } else if (topGap > 0.25) {
    st = 'adjust';
    msgs.push({ level: 'warn', text: `髪の頭頂が顔の頭頂より ${(topGap * 100).toFixed(0)}% 高く、浮いて見える可能性があります。` });
  }
  void scale;
  if (wd(ctx, hair.id, face.id)) {
    const grid = new PointGrid(sampleVertices(face.model, face.root, 40000), Math.max(0.004, ff.headH / 60));
    const dist: number[] = [];
    const hairPts = pts;
    const stride = Math.max(1, Math.floor(hairPts.length / 3 / 3000));
    for (let i = 0; i < hairPts.length; i += 3 * stride) {
      if (hairPts[i + 1] < topY) continue;
      const n = grid.nearest(hairPts[i], hairPts[i + 1], hairPts[i + 2], ff.headH * 0.4);
      dist.push(n.d);
    }
    const near = percentile(dist, 0.05);
    c.metrics.nearestFaceDistance = near;
    const tol = ff.headH * 0.04;
    msgs.push({ level: near > tol ? 'warn' : 'info', text: `詳細検査：髪の根元から顔の表面までの最短距離 ${mm(near * scale)}（頭の高さの ${((near / ff.headH) * 100).toFixed(1)}%）。` });
    if (near > tol) st = 'adjust';
    c.detailed = true;
  }
  c.status = st;
  c.messages = msgs;
  return c;
}

function hairTopInFace(hair: Part, face: Part): number {
  const pts = sampleVertices(hair.model, face.root, 8000);
  let m = -Infinity;
  for (let i = 1; i < pts.length; i += 3) m = Math.max(m, pts[i]);
  return m;
}

// ---- garment <-> body --------------------------------------------------------------------------

function checkGarmentBody(g: Part, body: Part | null, ctx: CheckContext): Connection {
  const c = conn('garment-body', g, body, `衣服「${g.name}」 ⇔ 身体`, ctx.detailed);
  const bf = ctx.bodyF;
  if (!body || !bf) {
    c.messages.push({ level: 'info', text: '身体が未読込のため判定できません。' });
    return c;
  }
  const msgs: FitMessage[] = [];
  const region = g.garment?.region ?? 'torso';
  const follow = g.garment?.rigMode === 'follow';
  const gf = ctx.garmentF(g);
  const bodyM = body.root.matrixWorld;
  // garment box in the BODY's frame
  const toBody = new THREE.Matrix4().copy(bodyM).invert().multiply(g.root.matrixWorld);
  const gBox = gf.box.clone().applyMatrix4(toBody);
  const R = bf.regions[region];
  const rs = R.getSize(new THREE.Vector3());
  const gs = gBox.getSize(new THREE.Vector3());
  const rc = R.getCenter(new THREE.Vector3());
  const gc = gBox.getCenter(new THREE.Vector3());
  let st: FitStatus = 'ok';
  // placement relative to the region
  const offX = Math.abs(gc.x - rc.x) / Math.max(rs.x, 1e-6);
  const offZ = Math.abs(gc.z - rc.z) / Math.max(rs.z, 1e-6);
  const offY = Math.abs(gc.y - rc.y) / Math.max(rs.y, 1e-6);
  c.metrics.offsetRatioX = offX;
  c.metrics.offsetRatioZ = offZ;
  c.metrics.offsetRatioY = offY;
  const bigOff = region === 'whole' ? 0.3 : 0.6;
  if (offX > 0.35 || offZ > 0.6 || offY > bigOff) {
    st = 'adjust';
    msgs.push({ level: 'warn', text: `${REGION_JA[region]}の中心から衣服の中心がずれています（左右 ${(offX * 100).toFixed(0)}%・前後 ${(offZ * 100).toFixed(0)}%・上下 ${(offY * 100).toFixed(0)}%）。装着部位または位置を確認してください。` });
  }
  const sizeRatio = region === 'leg' || region === 'arm' || region === 'whole' ? gs.y / Math.max(rs.y, 1e-6) : gs.x / Math.max(rs.x, 1e-6);
  c.metrics.sizeRatio = sizeRatio;
  if (sizeRatio < 0.5 || sizeRatio > 2.2) {
    st = 'adjust';
    msgs.push({ level: 'warn', text: `衣服の大きさが${REGION_JA[region]}の ${(sizeRatio * 100).toFixed(0)}% で、サイズが合っていない可能性があります。` });
  }
  if (follow && g.garment) {
    msgs.push({ level: 'info', text: `骨に追従中（${g.garment.rigInfo}）。` });
  }
  // already-run detailed result
  if (wd(ctx, g.id, body.id)) {
    const d = garmentBodyDetail(g, body, bf, follow);
    if (d) {
      c.metrics.penetrationRatio = d.pen;
      c.metrics.maxPenetration = d.maxDepth;
      c.metrics.contactRatio = d.contact;
      msgs.push(...d.messages);
      st = worst(st, d.status);
      c.detailed = true;
    }
  } else if (st === 'ok') msgs.push({ level: 'info', text: '位置・大きさの目安は問題ありません（頂点単位の貫通・浮きは「詳細検査」で確認できます）。' });
  c.status = st;
  c.messages = msgs;
  return c;
}

interface BodySample {
  pts: Float32Array;
  nrm: Float32Array;
}

function sampleBody(body: Part, max: number): BodySample {
  body.root.updateWorldMatrix(true, true);
  const pts: number[] = [];
  const nrm: number[] = [];
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  const meshes = meshesOf(body.model).filter((m) => m.visible);
  let total = 0;
  for (const m of meshes) total += m.geometry.attributes.position.count;
  const stride = Math.max(1, Math.ceil(total / max));
  for (const m of meshes) {
    let geo = m.geometry;
    if (!geo.attributes.normal) {
      geo = geo.clone();
      geo.computeVertexNormals();
    }
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    nm.getNormalMatrix(m.matrixWorld);
    const sk = m as THREE.SkinnedMesh;
    for (let i = 0; i < pos.count; i += stride) {
      if (sk.isSkinnedMesh) sk.getVertexPosition(i, v);
      else v.fromBufferAttribute(pos, i);
      v.applyMatrix4(m.matrixWorld);
      n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      pts.push(v.x, v.y, v.z);
      nrm.push(n.x, n.y, n.z);
    }
  }
  return { pts: new Float32Array(pts), nrm: new Float32Array(nrm) };
}

function garmentBodyDetail(g: Part, body: Part, bf: BodyFeatures, follow: boolean): { pen: number; maxDepth: number; contact: number; status: FitStatus; messages: FitMessage[] } | null {
  const bs = sampleBody(body, 60000);
  if (!bs.pts.length) return null;
  const cell = 0.02 * (bf.height / 1.5);
  const grid = new PointGrid(bs.pts, cell);
  const gp = sampleVertices(g.model, null, 6000);
  const near = 0.05 * (bf.height / 1.5);
  let nNear = 0;
  let nPen = 0;
  let nContact = 0;
  let maxDepth = 0;
  const gaps: number[] = [];
  const total = gp.length / 3;
  for (let i = 0; i < gp.length; i += 3) {
    const r = grid.nearest(gp[i], gp[i + 1], gp[i + 2], near);
    if (r.i < 0) continue;
    nNear++;
    const dx = gp[i] - bs.pts[r.i];
    const dy = gp[i + 1] - bs.pts[r.i + 1];
    const dz = gp[i + 2] - bs.pts[r.i + 2];
    const sd = dx * bs.nrm[r.i] + dy * bs.nrm[r.i + 1] + dz * bs.nrm[r.i + 2]; // signed: < 0 => under the body surface
    gaps.push(sd);
    if (sd < -0.002) {
      nPen++;
      maxDepth = Math.max(maxDepth, -sd);
    }
    if (Math.abs(sd) < 0.012) nContact++;
  }
  const messages: FitMessage[] = [];
  const penRatio = nNear ? nPen / nNear : 0;
  const contact = total ? nContact / total : 0;
  let status: FitStatus = 'ok';
  if (!nNear) {
    messages.push({ level: 'warn', text: `詳細検査：衣服が身体から ${cm(near)} 以内にありません（浮いているか、別の位置にあります）。` });
    return { pen: 0, maxDepth: 0, contact: 0, status: 'adjust', messages };
  }
  messages.push({ level: 'info', text: `詳細検査（衣服 ${total} 点を標本）：身体の近く ${nNear} 点のうち、表面の内側 ${(penRatio * 100).toFixed(1)}%（最大 ${mm(maxDepth)}）、表面から1.2cm以内 ${(contact * 100).toFixed(1)}%。` });
  if (penRatio > 0.12 || maxDepth > 0.03 * (bf.height / 1.5)) {
    status = 'adjust';
    messages.push({ level: 'warn', text: `身体への埋まり・貫通が目立ちます（${(penRatio * 100).toFixed(0)}% の点が表面の内側、最大 ${mm(maxDepth)}）。衣服を外側へ（大きく）してください。${follow ? '骨に追従中は位置調整できないため「骨に追従」を外してください。' : ''}` });
  }
  if (contact < 0.02 && g.garment?.region !== 'head') {
    status = 'adjust';
    messages.push({ level: 'warn', text: '身体に接する点がほとんどなく、浮いている可能性があります。' });
  }
  return { pen: penRatio, maxDepth, contact, status, messages };
}

// ---- garment <-> garment -----------------------------------------------------------------------

function checkGarmentGarment(a: Part, b: Part, ctx: CheckContext): Connection {
  const c = conn('garment-garment', a, b, `衣服「${a.name}」 ⇔ 「${b.name}」`, ctx.detailed);
  const fa = ctx.garmentF(a);
  const fb = ctx.garmentF(b);
  const ba = worldBox(fa.box, a.root.matrixWorld);
  const bb = worldBox(fb.box, b.root.matrixWorld);
  const inter = ba.clone().intersect(bb);
  if (inter.isEmpty()) {
    c.status = 'ok';
    c.messages.push({ level: 'info', text: '重なりはありません。' });
    return c;
  }
  const vol = (x: THREE.Box3) => {
    const s = x.getSize(new THREE.Vector3());
    return s.x * s.y * s.z;
  };
  const iou = vol(inter) / Math.max(1e-12, Math.min(vol(ba), vol(bb)));
  c.metrics.overlap = iou;
  const msgs: FitMessage[] = [];
  let st: FitStatus = 'ok';
  const sameRegion = a.garment?.region === b.garment?.region;
  if (iou > 0.85 && sameRegion) {
    st = 'adjust';
    msgs.push({ level: 'warn', text: `同じ部位（${REGION_JA[a.garment!.region]}）でほぼ同じ範囲に重なっています（重なり ${(iou * 100).toFixed(0)}%）。面がちらつく・貫通する可能性があります。どちらかを少し大きくしてください。` });
  } else msgs.push({ level: 'info', text: `範囲の重なり ${(iou * 100).toFixed(0)}%（重ね着として自然な範囲）。` });
  if (wd(ctx, a.id, b.id)) {
    const pa = sampleVertices(a.model, null, 4000);
    const grid = new PointGrid(sampleVertices(b.model, null, 20000), 0.006);
    let close = 0;
    let n = 0;
    for (let i = 0; i < pa.length; i += 3) {
      n++;
      if (grid.nearest(pa[i], pa[i + 1], pa[i + 2], 0.0008).i >= 0) close++;
    }
    const ratio = n ? close / n : 0;
    c.metrics.coplanarRatio = ratio;
    msgs.push({ level: ratio > 0.05 ? 'warn' : 'info', text: `詳細検査：ほぼ同一面（0.8mm以内）の点 ${(ratio * 100).toFixed(1)}%。` });
    if (ratio > 0.05) st = 'adjust';
    c.detailed = true;
  }
  c.status = st;
  c.messages = msgs;
  return c;
}

// ---- whole figure ------------------------------------------------------------------------------

function checkWhole(ctx: CheckContext): Connection {
  const c = conn('whole', null, null, '全身（サイズ比率・向き・配置）', ctx.detailed);
  const { body, face } = ctx;
  if (!body || !ctx.bodyF) {
    c.messages.push({ level: 'info', text: '身体が未読込のため、全体配置は判定できません。' });
    return c;
  }
  const msgs: FitMessage[] = [];
  let st: FitStatus = 'ok';
  const bbox = worldBox(ctx.bodyF.box, body.root.matrixWorld);
  const bodyH = bbox.max.y - bbox.min.y;
  c.metrics.bodyHeight = bodyH;
  if (bodyH < 0.3 || bodyH > 3.2) {
    st = 'adjust';
    msgs.push({ level: 'warn', text: `身体の高さが ${bodyH.toFixed(2)}m です。単位（m / cm / mm）の取り違えの可能性があります。` });
  } else msgs.push({ level: 'info', text: `身体の高さ ${bodyH.toFixed(2)}m。` });
  if (Math.abs(bbox.min.y) > 0.05 * bodyH) {
    msgs.push({ level: 'info', text: `足元が床（y=0）から ${mm(bbox.min.y)} ずれています。` });
  }
  const far = bbox.clone().expandByScalar(bodyH * 0.6);
  for (const p of ctx.parts) {
    if (p === body || !p.visible) continue;
    const f = p.type === 'face' ? ctx.faceF?.box : p.type === 'hair' ? ctx.hairF(p).box : p.type === 'garment' ? ctx.garmentF(p).box : null;
    if (!f) continue;
    const wb = worldBox(f, p.root.matrixWorld);
    if (!far.intersectsBox(wb)) {
      st = 'adjust';
      msgs.push({ level: 'warn', text: `「${p.name}」が身体から大きく離れています。` });
    }
    // facing direction: forward axis of the part in world
    const fwd = new THREE.Vector3(0, 0, 1).transformDirection(p.root.matrixWorld);
    const bfwd = new THREE.Vector3(0, 0, 1).transformDirection(body.root.matrixWorld);
    if (fwd.dot(bfwd) < 0.5 && p.type !== 'garment') {
      st = 'adjust';
      msgs.push({ level: 'warn', text: `「${p.name}」が身体と違う向きを向いています。向きを回してください。` });
    }
  }
  if (!face) msgs.push({ level: 'info', text: '顔が未読込です。' });
  c.status = st;
  c.messages = msgs;
  return c;
}
