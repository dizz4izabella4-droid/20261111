// monster-core.js  ゲーム組み込み用モンスター生成コア
// 規約: Y-up / 1unit=1m / 前方=+Z / 左右=±X / 単一 SkinnedMesh + 単一 Skeleton
// ボーン名: wing_L / wingtip_L, wing_R / wingtip_R（翼がある場合）, root, spine_0(尾)…spine_N-1(頭), hip_L0/knee_L0, hip_R0/knee_R0 …
// クリップ名: Idle, Walk, Attack, Hit, Die
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const CLIPS = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Die', 'Roar'];
export const GENRES = {
  beast:  { attack: 'bite', tail: [0.6, 1.2], label: '獣',   spine: [5, 7], len: [1.4, 2.2], thick: [0.28, 0.42], legs: [4, 4], legLen: [0.6, 0.9], horns: [0, 2], eyes: [2, 2], hue: [0.02, 0.12] },
  insect: { attack: 'rush', tail: [0, 0.2], label: '虫',   spine: [4, 6], len: [0.9, 1.5], thick: [0.18, 0.3],  legs: [6, 6], legLen: [0.5, 0.8], horns: [0, 2], eyes: [2, 4], hue: [0.2, 0.4] },
  drake:  { attack: 'slam', tail: [1.4, 2.4], label: '竜',   spine: [7, 9], len: [2.2, 3.4], thick: [0.3, 0.5],   legs: [2, 4], legLen: [0.8, 1.2], horns: [2, 4], eyes: [2, 2], hue: [0.5, 0.75] },
  biped:  { attack: 'slam', tail: [0.4, 0.9], label: '二足', spine: [5, 6], len: [1.2, 1.8], thick: [0.3, 0.45],  legs: [2, 2], legLen: [0.8, 1.1], horns: [0, 2], eyes: [2, 3], hue: [0.75, 0.95] },
};
export const DETAIL = { low: { S: 8, ring: 2, seg: 6 }, mid: { S: 12, ring: 3, seg: 8 }, high: { S: 24, ring: 5, seg: 14 } }; // ポリゴン数の段階
export const ELEMENTS = ['無', '炎', '氷', '雷', '毒', '闇'];
const EYE = { 無: 0x120a14, 炎: 0xff5a2a, 氷: 0x6ad8ff, 雷: 0xffe34a, 毒: 0x9bff4a, 闇: 0xb04aff };
const WEAK = { 無: '雷', 炎: '氷', 氷: '炎', 雷: '毒', 毒: '炎', 闇: '雷' };

export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const lerp = (r, rand) => r[0] + (r[1] - r[0]) * rand();
const ri = (r, rand) => Math.round(lerp(r, rand));

// ---- 仕様生成（同じ seed/genre/tier なら同じ結果）----
export function makeSpec(seed, genre = 'beast', tier = 1, over = {}) {
  const g = GENRES[genre], r = rng(seed * 7919 + tier);
  const spec = {
    seed, genre, tier,
    spineN: ri(g.spine, r), length: lerp(g.len, r), thick: lerp(g.thick, r),
    legs: ri(g.legs, r), legLen: lerp(g.legLen, r),
    horns: ri(g.horns, r), eyes: ri(g.eyes, r), spikes: r() < 0.5 ? ri([3, 7], r) : 0,
    hue: lerp(g.hue, r), sat: 0.35 + r() * 0.4,
    attack: genre === 'drake' ? (rng(seed * 29 + 3)() < 0.5 ? 'tail' : 'slam') : g.attack, detail: 'mid', tail: lerp(g.tail, rng(seed * 23 + 11)),
    stripe: rng(seed * 13 + 1)() < 0.5,
    spots: rng(seed * 19 + 7)() < 0.4,
    wings: genre === 'drake' ? 1 : (rng(seed * 17 + 3)() < 0.15 ? 1 : 0),
  };
  const s = 0.75 + tier * 0.15; // ティアが上がると大きく
  spec.length *= s; spec.thick *= s; spec.legLen *= s; spec.tail *= s;
  Object.assign(spec, over);
  const r2 = rng(seed * 31 + 5), t = tier;
  const element = ELEMENTS[Math.floor(r2() * ELEMENTS.length)];
  spec.stats = {
    tier: t, element, weakness: WEAK[element],
    hp: Math.round(30 * Math.pow(t, 1.7) * (0.8 + r2() * 0.4)),
    atk: Math.round(5 * Math.pow(t, 1.4) * (0.8 + r2() * 0.4)),
    def: Math.round(3 * Math.pow(t, 1.3) * (0.8 + r2() * 0.4)),
    speed: +(1 + r2() * 1.2).toFixed(2),
  };
  return spec;
}

// ---- メッシュ・骨格生成 ----
export function buildMonster(spec) {
  const N = spec.spineN, L = spec.length, rand = rng(spec.seed + 99);
  // 足先が地面に付く高さに胴体を置く（最も太い位置の脚基準）
  const pairsN = Math.floor(spec.legs / 2);
  const legK = (p) => Math.min(N - 2, Math.max(1, Math.round((pairsN === 1 ? 0.5 : 0.18 + (0.55 * p) / (pairsN - 1)) * (N - 1))));
  let rrMax = 0; for (let p = 0; p < pairsN; p++) rrMax = Math.max(rrMax, radiusAt(legK(p) / (N - 1)));
  const bodyY = spec.legLen + 0.14 * spec.thick + 0.2 * rrMax;
  const zs = Array.from({ length: N }, (_, i) => -L / 2 + (L * i) / (N - 1));
  const dz = L / (N - 1);

  // ボーン
  const root = new THREE.Bone(); root.name = 'root';
  const bones = [root], spine = [];
  let parent = root;
  for (let i = 0; i < N; i++) {
    const b = new THREE.Bone(); b.name = `spine_${i}`;
    b.position.set(0, i === 0 ? bodyY : 0, i === 0 ? zs[0] : dz);
    parent.add(b); bones.push(b); spine.push(b); parent = b;
  }
  // 尻尾: spine_0 の末端につく独立チェーン（揺らしても脚の付け根は動かない）
  const tailBones = [], TN = 5, tailLen = Math.max(0, spec.tail || 0);
  if (tailLen > 0.05) {
    let tp = spine[0];
    for (let i = 0; i < TN; i++) {
      const b = new THREE.Bone(); b.name = `tail_${i}`; b.position.set(0, 0, i === 0 ? 0 : -tailLen / TN);
      tp.add(b); bones.push(b); tailBones.push(b); tp = b;
    }
  }
  const legBones = [];
  const pairs = Math.floor(spec.legs / 2);
  for (let p = 0; p < pairs; p++) {
    const t = pairs === 1 ? 0.5 : 0.18 + (0.55 * p) / (pairs - 1);
    const k = Math.min(N - 2, Math.max(1, Math.round(t * (N - 1))));
    for (const side of [-1, 1]) {
      const sn = side < 0 ? 'L' : 'R', rr = radiusAt(k / (N - 1));
      const hip = new THREE.Bone(); hip.name = `hip_${sn}${p}`;
      hip.position.set(side * rr * 0.8, -rr * 0.2, 0);
      const knee = new THREE.Bone(); knee.name = `knee_${sn}${p}`;
      knee.position.set(0, -spec.legLen * 0.5, 0);
      hip.add(knee); spine[k].add(hip); bones.push(hip, knee);
      legBones.push({ hip, knee, k, side, p, z: zs[k], x: side * rr * 0.8, y: bodyY - rr * 0.2 });
    }
  }

  // 翼ボーン（胴体の前寄りの背中）
  const wings = [];
  if (spec.wings) {
    const k = Math.max(1, Math.min(N - 2, Math.round(0.62 * (N - 1)))), rr = radiusAt(k / (N - 1));
    for (const side of [-1, 1]) {
      const b = new THREE.Bone(); b.name = `wing_${side < 0 ? 'L' : 'R'}`;
      b.position.set(side * rr * 0.5, rr * 0.8, 0);
      const span = Math.max(spec.thick * 3, L * 0.5);
      const tip = new THREE.Bone(); tip.name = `wingtip_${side < 0 ? 'L' : 'R'}`;
      tip.position.set(side * span * 0.5, 0, 0); b.add(tip);
      spine[k].add(b); bones.push(b, tip);
      wings.push({ bone: b, tip, side, span, x: side * rr * 0.5, y: bodyY + rr * 0.8, z: zs[k], k });
    }
  }

  // 半径プロファイル（尾 細い → 胴 太い → 頭 やや細い）
  function radiusAt(t) {
    const body = Math.sin(Math.PI * Math.min(1, Math.max(0, 0.08 + t * 0.84)));
    return spec.thick * (0.25 + 0.75 * Math.pow(body, 0.7)) * (t > 0.82 ? 0.85 : 1);
  }
  const color = new THREE.Color().setHSL(spec.hue, spec.sat, 0.45);
  const dark = new THREE.Color().setHSL(spec.hue, spec.sat, 0.28);
  const spotCol = new THREE.Color().setHSL(spec.hue + 0.08, spec.sat, 0.62);
  const band = new THREE.Color().setHSL(spec.hue + 0.04, spec.sat, 0.33);
  const geos = [];
  const bindPart = (geo, boneIdx, col) => {
    let g = geo.index ? geo.toNonIndexed() : geo;
    g.deleteAttribute('uv');
    const n = g.attributes.position.count;
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { si[i * 4] = boneIdx; sw[i * 4] = 1; c.set([col.r, col.g, col.b], i * 3); }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    geos.push(g);
  };
  const idx = (b) => bones.indexOf(b);

  // 胴体チューブ（隣り合う背骨ボーンへ滑らかにウェイト）
  const DT = DETAIL[spec.detail] || DETAIL.mid, sg = DT.seg;
  { const M = N * DT.ring, S = DT.S, pos = [], si = [], sw = [], col = [], ind = [];
    for (let m = 0; m <= M; m++) {
      const t = m / M, f = t * (N - 1), i0 = Math.min(N - 2, Math.floor(f)), w1 = f - i0;
      const z = -L / 2 + L * t, r = radiusAt(t);
      for (let s = 0; s <= S; s++) {
        const a = (s / S) * Math.PI * 2;
        pos.push(Math.cos(a) * r, bodyY + Math.sin(a) * r * 0.9, z);
        si.push(idx(spine[i0]), idx(spine[i0 + 1]), 0, 0); sw.push(1 - w1, w1, 0, 0);
        const spot = spec.spots && !spec.stripe && Math.sin(m * 1.7 + s * 0.9) * Math.sin(s * 2.3 - m * 0.6) > 0.75;
        const c = Math.sin(a) < -0.2 ? dark : spot ? spotCol : (spec.stripe && m % 4 < 2 ? band : color); col.push(c.r, c.g, c.b);
      }
    }
    for (let m = 0; m < M; m++) for (let s = 0; s < S; s++) {
      const a = m * (S + 1) + s, b = a + S + 1;
      ind.push(a, a + 1, b, a + 1, b + 1, b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(ind); g.computeVertexNormals();
    geos.push(g.toNonIndexed());
  }

  // 尻尾チューブ（胴体の後端から細く伸びる）
  if (tailBones.length) {
    const R = TN * 3, S = DT.S, r0 = radiusAt(0), pos = [], si = [], sw = [], col = [], ind = [];
    for (let r = 0; r <= R; r++) {
      const t = r / R, f = t * TN, i0 = Math.min(TN - 2, Math.floor(f)), w1 = Math.min(1, f - i0);
      const z = zs[0] - tailLen * t, rad = Math.max(0.02, r0 * (1 - 0.93 * t));
      for (let k = 0; k <= S; k++) {
        const a = (k / S) * Math.PI * 2;
        pos.push(Math.cos(a) * rad, bodyY + Math.sin(a) * rad * 0.9, z);
        si.push(idx(tailBones[i0]), idx(tailBones[i0 + 1]), 0, 0); sw.push(1 - w1, w1, 0, 0);
        const c = Math.sin(a) < -0.2 ? dark : color; col.push(c.r, c.g, c.b);
      }
    }
    for (let r = 0; r < R; r++) for (let k = 0; k < S; k++) { const a = r * (S + 1) + k, b = a + S + 1; ind.push(a, b, a + 1, a + 1, b, b + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(ind); g.computeVertexNormals(); geos.push(g.toNonIndexed());
  }

  // 脚（上腿＋下腿を円錐台で）
  for (const lb of legBones) {
    const w = spec.thick * 0.28, h = spec.legLen * 0.5;
    const mk = (y0, r0, r1, bone) => {
      const g = new THREE.CylinderGeometry(r1, r0, h, sg, 1, false);
      g.translate(lb.x, y0 - h / 2, lb.z); bindPart(g, idx(bone), dark);
    };
    mk(lb.y, w, w * 0.75, lb.hip);
    mk(lb.y - h, w * 0.75, w * 0.5, lb.knee);
    const foot = new THREE.SphereGeometry(w * 0.7, sg, Math.max(4, sg - 2)); foot.translate(lb.x, lb.y - h * 2 + w * 0.2, lb.z);
    bindPart(foot, idx(lb.knee), color);
  }

  // 頭部パーツ（目・角）と背中のトゲ
  const head = spine[N - 1], headZ = zs[N - 1], hr = radiusAt(1);
  for (let e = 0; e < spec.eyes; e++) {
    const side = e % 2 ? 1 : -1, row = Math.floor(e / 2);
    const x = side * hr * 0.55, y = bodyY + hr * (0.35 + row * 0.25), z = headZ - hr * (0.2 + row * 0.35);
    const w = new THREE.SphereGeometry(hr * 0.22, sg, Math.max(4, sg - 2)); w.translate(x, y, z + hr * 0.3);
    bindPart(w, idx(head), new THREE.Color(0xf4f0e0));
    const p = new THREE.SphereGeometry(hr * 0.11, Math.max(5, sg - 2), 4); p.translate(x * 1.02, y, z + hr * 0.46);
    bindPart(p, idx(head), new THREE.Color(EYE[spec.stats.element] ?? 0x120a14));
  }
  for (let h = 0; h < spec.horns; h++) {
    const side = h % 2 ? 1 : -1, row = Math.floor(h / 2), len = hr * (1.1 + rand() * 0.8);
    const g = new THREE.ConeGeometry(hr * 0.16, len, 6);
    g.rotateZ(-side * 0.5); g.translate(side * hr * 0.55, bodyY + hr * 1.0 + len * 0.3, headZ - hr * 0.6 - row * hr * 0.5);
    bindPart(g, idx(head), new THREE.Color(0xe8dcc0));
  }
  for (let s = 0; s < spec.spikes; s++) {
    const t = 0.25 + (0.6 * s) / Math.max(1, spec.spikes - 1), k = Math.min(N - 2, Math.round(t * (N - 1))), r = radiusAt(t);
    const g = new THREE.ConeGeometry(r * 0.22, r * 0.8, 5); g.translate(0, bodyY + r * 1.1, zs[k]);
    bindPart(g, idx(spine[k]), dark);
  }

  for (const w of wings) { // 翼膜（両面・1ボーンで羽ばたき）
    const span = Math.max(spec.thick * 3, L * 0.5), a = w.side;
    const P = (x, y, z) => [w.x + a * x, w.y + y, w.z + z];
    const v = [P(0, 0, hr * 0.5), P(0, 0, -hr * 1.2), P(span, 0.05, -hr * 0.2), P(span * 0.62, 0, -hr * 1.9), P(span * 0.3, 0.02, -hr * 1.5)];
    const tri = [[0, 2, 3], [0, 3, 4], [0, 4, 1]], pos = [];
    for (const t of tri) { for (const i of t) pos.push(...v[i]); for (const i of [...t].reverse()) pos.push(...v[i]); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    bindPart(g, idx(w.bone), band);
    const gg = geos[geos.length - 1], P3 = gg.attributes.position, SI = gg.attributes.skinIndex, SW = gg.attributes.skinWeight;
    for (let i = 0; i < P3.count; i++) { // 先端ほど tip ボーンへ（しなり）
      const r = Math.min(1, Math.abs(P3.getX(i) - w.x) / span), t = Math.min(1, Math.max(0, (r - 0.3) / 0.6)), wt = t * t * (3 - 2 * t);
      SI.setXYZW(i, idx(w.bone), idx(w.tip), 0, 0); SW.setXYZW(i, 1 - wt, wt, 0, 0);
    }
  }
  const geometry = mergeVertices(mergeGeometries(geos)); // 法線は各パーツのものを保持（面取りされない）
  geometry.computeBoundingBox();
  const size = new THREE.Vector3(); geometry.boundingBox.getSize(size);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05, name: 'MonsterSkin' });
  const mesh = new THREE.SkinnedMesh(geometry, material); mesh.name = 'MonsterMesh';
  const group = new THREE.Group(); group.name = 'Monster';
  group.add(mesh, root);
  group.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  mesh.bind(skeleton);
  const bounds = { size: size.toArray().map((v) => +v.toFixed(3)), capsuleRadius: +(Math.max(size.x, spec.thick * 2) / 2).toFixed(3), height: +size.y.toFixed(3), tris: Math.round(geometry.index.count / 3) };
  group.userData = { generator: 'monster-smith', spec: JSON.parse(JSON.stringify(spec)), stats: spec.stats, bounds, clips: CLIPS };
  return { group, mesh, skeleton, bones, spine, legBones, bodyY, bounds, wings, tail: tailBones };
}

// ---- 手続きアニメーション（キーフレームに焼き込み = GLBにそのまま出せる）----
export function buildClips(m) {
  const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
  const q = (axis, a) => axis === 'e' ? new THREE.Quaternion().setFromEuler(new THREE.Euler(a[0], a[1], a[2])) : new THREE.Quaternion().setFromAxisAngle(axis, a); // 'e' = オイラー角[x,y,z]
  const flat = (qs) => qs.flatMap((x) => x.toArray());
  const frames = (dur, fps = 20) => Array.from({ length: Math.round(dur * fps) + 1 }, (_, i) => Math.min(dur, i / fps));
  const N = m.spine.length, TAU = Math.PI * 2;
  const clip = (name, dur, fn, loop = true) => {
    const times = frames(dur), tracks = {};
    const rot = (bone, axis, f) => { (tracks[bone.name + '.quaternion'] ||= { times, vals: [] }).vals.push(q(axis, f)); };
    const pos = (bone, v) => { (tracks[bone.name + '.position'] ||= { times, vals: [] }).vals.push(v); };
    // 全ボーンに全フレームを必ず書く（足りない分は0回転）
    for (const t of times) {
      const set = { rot: [], pos: [] };
      fn(t / dur, t, { rot: (b, ax, f) => set.rot.push([b, ax, f]), pos: (b, v) => set.pos.push([b, v]) });
      const used = new Set();
      for (const [b, ax, f] of set.rot) { if (used.has(b)) continue; used.add(b); rot(b, ax, f); }
      for (const b of m.bones) if (!used.has(b) && b.name !== 'root') rot(b, X, 0);
      for (const [b, v] of set.pos) pos(b, v);
      if (!set.pos.length) pos(m.bones[0], m.bones[0].position.clone());
    }
    const list = Object.entries(tracks).map(([n, tr]) => n.endsWith('.quaternion')
      ? new THREE.QuaternionKeyframeTrack(n, tr.times, flat(tr.vals))
      : new THREE.VectorKeyframeTrack(n, tr.times, tr.vals.flatMap((v) => v.toArray())));
    const c = new THREE.AnimationClip(name, dur, list);
    c.userData = { loop };
    return c;
  };
  const wingsDo = (o, f, tf = f * 0.5) => m.wings.forEach((w) => { o.rot(w.bone, Z, w.side * f); o.rot(w.tip, Z, w.side * tf); });
  const legs = m.legBones, spine = m.spine, root = m.bones[0], base = root.position.clone();
  const gait = (leg) => ((leg.p % 2) + (leg.side > 0 ? 1 : 0)) % 2 * Math.PI; // 対角歩容

  const legIK = (o, l, dy, dz) => { // 付け根基準の足先目標 (dy, dz) に2ボーンIKで合わせる
    const h = m.group.userData.spec.legLen * 0.5;
    const d = Math.min(2 * h - 1e-3, Math.max(0.15 * h, Math.hypot(dy, dz)));
    const a = Math.acos(d / (2 * h)), dir = Math.atan2(-dz, -dy);
    o.rot(l.hip, X, dir - a); o.rot(l.knee, X, 2 * a);
  };
  const kmax = Math.max(...legs.map((l) => l.k)); // 脚の付け根より前の骨だけ前傾させる（足が浮かないように）
  const pitchFree = (o, total) => { const n = N - 1 - kmax; spine.forEach((b, i) => o.rot(b, X, i > kmax ? total / n : 0)); };
  const spineE = (o, fn) => spine.forEach((b, i) => o.rot(b, 'e', fn(i, i > kmax, N - 1 - kmax))); // 骨ごとにオイラー角 [x,y,z]
  const tailE = (o, f) => m.tail.forEach((b, i) => o.rot(b, 'e', f(i, m.tail.length))); // 尻尾の各関節 [x(ピッチ),y(ヨー),z]
  const sm = (x) => Math.sin(Math.min(1, Math.max(0, x)) * Math.PI / 2), mix = (a, b, x) => a + (b - a) * Math.min(1, Math.max(0, x));
  const plant = (o, rdy, rdz) => { // 足を地面に付けたまま、胴体を (rdy, rdz) だけ動かす
    const sp = m.group.userData.spec;
    legs.forEach((l) => legIK(o, l, 0.14 * sp.thick - (l.y + rdy + CR), -rdz));
    o.pos(root, new THREE.Vector3(base.x, base.y + rdy + CR, base.z + rdz));
  };
  const L0 = m.group.userData.spec.legLen, CR = -0.1 * L0; // 常に膝を少し曲げた姿勢（足先の届く範囲に余裕を作り、接地足を直線上で動かす）

  // 待機: 呼吸で胸が沈み、頭がゆっくり周囲を見回し、尻尾が揺れる
  const Idle = clip('Idle', 2.4, (u, t, o) => {
    const br = Math.sin(u * TAU);
    wingsDo(o, 0.15 + br * 0.1, 0.1 + Math.sin(u * TAU - 0.9) * 0.15);
    spineE(o, (i, free, n) => [free ? Math.sin(u * TAU - i * 0.4) * 0.09 / n : 0, free ? Math.sin(u * TAU) * 0.22 / n : 0, 0]); // 脚の付け根より前の骨だけ動かす
    plant(o, -0.012 * L0 * (0.5 + 0.5 * br), 0);
    tailE(o, (i) => [0.02, Math.sin(u * TAU - i * 0.9) * 0.12, 0]);
  });

  // 歩行・走行: 2ボーンIKで足を接地させ、胴の上下・背骨のうねり・前傾を重ねる
  const gaitClip = (name, dur, P) => {
    // 接地中の足が地面に対して止まる移動速度 (m/s)。ゲーム側の移動速度にそのまま使える
    const ud = m.group.userData; ud.locomotion = { ...(ud.locomotion || {}), [name]: +((2 * P.stride * m.group.userData.spec.legLen) / (P.duty * dur)).toFixed(3) };
    return gaitClip2(name, dur, P);
  };
  const gaitClip2 = (name, dur, P) => clip(name, dur, (u, t, o) => {
    const sp = m.group.userData.spec;
    const bob = CR - (P.crouch || 0) * sp.legLen - P.bob * sp.legLen * (0.5 - 0.5 * Math.cos(u * TAU * 2));
    wingsDo(o, 0.1 + Math.sin(u * TAU * P.wf) * P.wa, 0.05 + Math.sin(u * TAU * P.wf - 0.9) * P.wa * 1.3);
    spineE(o, (i, free, n) => [free ? P.lean / n : 0, free ? Math.sin(u * TAU - i * 0.5) * P.sw * 2 / n : 0, 0]); // 首振りは脚より前の骨だけ（付け根が横に振れて足が滑るのを防ぐ）
    legs.forEach((l) => {
      const v = (u + gait(l) / TAU) % 1, stride = sp.legLen * P.stride;
      const dz = v < P.duty ? stride * (1 - (2 * v) / P.duty) : stride * (-1 + (2 * (v - P.duty)) / (1 - P.duty));
      const lift = v < P.duty ? 0 : Math.sin(((v - P.duty) / (1 - P.duty)) * Math.PI) * sp.legLen * P.lift;
      legIK(o, l, 0.14 * sp.thick - (l.y + bob) + lift, dz);
    });
    o.pos(root, new THREE.Vector3(base.x, base.y + bob, base.z));
    tailE(o, (i) => [P.lean * 0.2, Math.sin(u * TAU - i * 0.8) * P.tw, 0]);
  });
  const Walk = gaitClip('Walk', 1, { stride: 0.22, lift: 0.22, duty: 0.6, bob: 0.02, tw: 0.2, sw: 0.09, lean: 0, wf: 2, wa: 0.3 });
  const Run = gaitClip('Run', 0.6, { stride: 0.32, lift: 0.35, duty: 0.45, bob: 0.05, crouch: 0.05, tw: 0.3, sw: 0.14, lean: 0.35, wf: 3, wa: 0.45 });
  const Attack = clip('Attack', 0.8, (u, t, o) => {
    // 攻撃スタイル: bite=噛みつき(獣) / rush=体当たり(虫) / slam=振り下ろし(竜・二足)
    const sp = m.group.userData.spec, L = sp.legLen, sm = (x) => Math.sin(Math.min(1, Math.max(0, x)) * Math.PI / 2), lerp = (a, b, x) => a + (b - a) * Math.min(1, Math.max(0, x));
    let pitch, rdz, rdy, wing, tailFn = (i) => [0.12, Math.sin(u * TAU * 2 - i * 0.9) * 0.5, 0];
    if (sp.attack === 'rush') {
      pitch = u < 0.3 ? -0.25 * sm(u / 0.3) : 0.4 * (1 - (u - 0.3) / 0.7);
      rdz = u < 0.3 ? -0.12 * L * sm(u / 0.3) : u < 0.55 ? lerp(-0.12 * L, 0.45 * L, (u - 0.3) / 0.25) : lerp(0.45 * L, 0, (u - 0.55) / 0.45);
      rdy = -0.12 * L * (u < 0.3 ? sm(u / 0.3) : Math.max(0, 1 - (u - 0.3) / 0.4));
      wing = Math.sin(u * TAU * 3) * 0.7;
    } else if (sp.attack === 'tail' && m.tail.length) { // 尻尾払い: 尻尾を引き絞って横に薙ぎ払う
      const yawAt = (x) => x < 0.35 ? -0.9 * sm(x / 0.35) : x < 0.55 ? lerp(-0.9, 1.3, (x - 0.35) / 0.2) : 1.3 * (1 - sm((x - 0.55) / 0.45));
      pitch = -0.2 * sm(u / 0.35) * (1 - sm((u - 0.35) / 0.2)) + 0.15 * sm((u - 0.35) / 0.2) * (1 - sm((u - 0.55) / 0.45));
      rdz = 0; rdy = -0.06 * L * Math.sin(Math.min(1, u) * Math.PI);
      wing = u < 0.35 ? 0.6 * sm(u / 0.35) : 0.6 * (1 - sm((u - 0.35) / 0.4));
      tailFn = (i) => [0.1, yawAt(u - i * 0.025) * 0.3, 0];
    } else if (sp.attack === 'slam' || sp.attack === 'tail') {
      pitch = u < 0.4 ? -0.7 * sm(u / 0.4) : u < 0.6 ? lerp(-0.7, 1.6, (u - 0.4) / 0.2) : 1.6 * Math.pow(1 - (u - 0.6) / 0.4, 2);
      rdz = 0.2 * L * sm((u - 0.4) / 0.2) * (1 - Math.max(0, (u - 0.6) / 0.4));
      rdy = -0.08 * L * Math.sin(Math.min(1, Math.max(0, (u - 0.4) / 0.4)) * Math.PI);
      wing = u < 0.4 ? 0.8 * sm(u / 0.4) : lerp(0.8, -0.6, (u - 0.4) / 0.2) * (1 - Math.max(0, (u - 0.6) / 0.4));
    } else { // bite
      const lunge = u < 0.35 ? -0.3 * (u / 0.35) : 0.6 * Math.cos(((u - 0.35) / 0.65) * Math.PI / 2) * (1 - (u - 0.35) / 0.65) * 1.6;
      pitch = lunge * 1.5; rdz = Math.max(0, lunge) * 0.4; rdy = -Math.sin(Math.min(1, u / 0.7) * Math.PI) * 0.1 * L;
      wing = Math.sin(u * TAU * 2) * 0.8;
    }
    wingsDo(o, wing, wing * 0.8);
    tailE(o, tailFn);
    pitchFree(o, pitch);
    legs.forEach((l) => legIK(o, l, 0.14 * sp.thick - (l.y + rdy + CR), -rdz)); // 足は地面に付けたまま体だけ沈む・踏み込む
    o.pos(root, new THREE.Vector3(base.x, base.y + rdy + CR, base.z + rdz));
  }, false);
  // 被弾: のけぞって後ろへ押され、首を振る（足は踏ん張ったまま）
  const Hit = clip('Hit', 0.45, (u, t, o) => {
    const f = Math.sin(u * Math.PI);
    wingsDo(o, 0.3 + f * 0.6);
    spineE(o, (i, free, n) => [free ? -f * 0.7 / n : 0, free ? Math.sin(u * TAU * 2) * 0.25 * f / n : 0, 0]);
    plant(o, -0.05 * L0 * f, -0.18 * L0 * f);
    tailE(o, (i) => [0.25 * f, Math.sin(u * TAU * 2 - i) * 0.3 * f, 0]);
  }, false);

  // やられ: よろけて → 崩れ落ち → 横倒しで脚を投げ出す
  const Die = clip('Die', 1.4, (u, t, o) => {
    const e = 1 - Math.pow(1 - sm((u - 0.15) / 0.85), 3), st = u < 0.15 ? sm(u / 0.15) : 1 - sm((u - 0.15) / 0.3);
    wingsDo(o, -e * 0.8, -e * 0.5);
    tailE(o, (i) => [-e * 0.25, Math.sin(u * TAU * 2 - i) * 0.25 * (1 - e), 0]);
    o.rot(spine[0], 'e', [0, 0, e * 1.35]);
    spine.slice(1).forEach((b, i) => o.rot(b, 'e', [(i + 1) > kmax ? (-0.5 * st + 0.35 * e) / (N - 1 - kmax) : 0, 0, 0]));
    legs.forEach((l) => { o.rot(l.hip, 'e', [0, 0, -l.side * e * 0.9]); o.rot(l.knee, X, e * 0.5); });
    o.pos(root, new THREE.Vector3(base.x, base.y - e * (m.bodyY - m.group.userData.spec.thick * 0.6), base.z - 0.1 * L0 * st));
  }, false);

  // 咆哮（登場演出）: 体を反らして翼を広げ、震えながら吠える
  const Roar = clip('Roar', 1.8, (u, t, o) => {
    const env = u < 0.3 ? sm(u / 0.3) : u < 0.75 ? 1 : 1 - sm((u - 0.75) / 0.25);
    wingsDo(o, 0.9 * env + Math.sin(u * TAU * 6) * 0.1 * env, 0.7 * env);
    spineE(o, (i, free, n) => [free ? -0.9 * env / n : 0, free ? Math.sin(u * TAU * 5) * 0.2 * env / n : 0, 0]);
    plant(o, -0.05 * L0 * env, -0.12 * L0 * env);
    tailE(o, (i) => [0.22 * env, Math.sin(u * TAU * 3 - i) * 0.2 * env, 0]);
  }, false);
  return [Idle, Walk, Run, Attack, Hit, Die, Roar];
}
