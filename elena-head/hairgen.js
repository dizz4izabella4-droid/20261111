/* 髪の生成(ブラウザ版)。髪型アプリ(hair-studio/index.html)の毛の生成をそのまま移したもの(elena_hair.py と同じ内容)。
   HairGen.build(headPositions(Float32Array, GLBの座標), cfg(設定JSON or null=初期設定), {density, color})
   → {meshes:[{name, P(Float32 world), N, C(Uint8 rgb|null), I(Uint32), mat:'hair'|'scalp'|'tie'}], color, pivot}
   毛は頭の中心から外を向く帯としてポリゴン化(色・根元の暗さ・毛先の明るさは頂点カラー)。頭皮キャップ3枚と結び目リングも同じ式。 */
(function (root) {
'use strict';
const TAU = Math.PI * 2;
const sm = (a, b, x) => { x = Math.min(1, Math.max(0, (x - a) / (b - a))); return x * x * (3 - 2 * x); };
const dirA = (th, ph) => [-Math.cos(ph) * Math.sin(th), Math.cos(th), Math.sin(ph) * Math.sin(th)];
const rng = s => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const PIDS = ['base', 'bangs', 'side_left', 'side_right', 'back', 'nape', 'tie', 'ponytail', 'flyaways'];
const PRESETS = { auto: null, straight: [[0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1]], in: [[-.01, 0, 1], [-.03, 0, 1], [-.07, 0, .95], [-.13, 0, .9]], out: [[.02, 0, 1], [.05, 0, 1], [.1, 0, 1], [.17, 0, 1]], wave: [[.04, .02, 1], [0, -.03, 1], [-.04, .03, 1], [0, -.02, 1]], bulge: [[.03, 0, 1.3], [.07, 0, 1.7], [.05, 0, 1.4], [0, 0, 1]] };
const PRESET_KEYS = ['auto', 'straight', 'in', 'out', 'wave', 'bulge', 'custom'];
const GLOBALS = { len: [3.4, 1.5, 5, .05], tie: [1.35, .25, 2.3, .01], tph: [0, -1.6, 1.6, .02], vol: [1, .5, 1.6, .01], wave: [.8, 0, 3, .05], fly: [.6, 0, 2, .05], bl: [1.34, 1.1, 1.55, .01], bd: [1, 0, 2, .05], sl: [1.8, .8, 2.6, .05], sd: [1, 0, 2, .05], tw: [.15, .06, .32, .005], tilt: [.18, 0, .5, .01], nd: [2.2, 1.6, 2.6, .01], nw: [1.1, .4, 1.6, .01], ndn: [1, .3, 1, .05], bp: [.1, -.6, .6, .02], bs: [.45, 0, 1, .02], w: [.005, .002, .012, .0005], g: [90, 10, 200, 1] };
const Q_OPTIONS = [6000, 14000, 22000, 32000];
const newPart = id => ({ enabled: true, preset: 'auto', cp: [[0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1]], len: 1, dens: 1, thick: 1, vol: 1, wave: id === 'ponytail' ? 1 : 0, rotY: 0, pos: [0, 0, 0] });
const clampN = (v, a, b, d) => { v = +v; return Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d; };
function fixPart(p, id) {
  const d = newPart(id); p = p && typeof p === 'object' ? p : {};
  return { enabled: p.enabled !== false, preset: PRESET_KEYS.includes(p.preset) ? p.preset : 'auto',
    cp: Array.isArray(p.cp) && p.cp.length === 4 && p.cp.every(a => Array.isArray(a) && a.length === 3) ? p.cp.map(a => [clampN(a[0], -1, 1, 0), clampN(a[1], -1, 1, 0), clampN(a[2], .2, 3, 1)]) : d.cp,
    len: clampN(p.len, .05, 3, 1), dens: clampN(p.dens, 0, 3, 1), thick: clampN(p.thick, .2, 4, 1), vol: clampN(p.vol, 0, 3, 1), wave: clampN(p.wave, 0, 3, d.wave),
    rotY: clampN(p.rotY, -Math.PI, Math.PI, 0), pos: Array.isArray(p.pos) && p.pos.length === 3 ? p.pos.map(v => clampN(v, -2, 2, 0)) : [0, 0, 0] };
}
/* 設定JSON → {g, parts, seed, col}。髪型アプリの importCfg と同じ解釈(range入力の範囲・刻みへの丸めも同じ。ちょうど中間は上へ) */
function loadCfg(o) {
  o = o && typeof o === 'object' ? o : {};
  const G = o.globals || o, g = {};
  for (const k in GLOBALS) {
    const [dv, lo, hi, st] = GLOBALS[k]; let v = dv;
    if (G[k] !== undefined) { const x = parseFloat(G[k]); if (Number.isFinite(x)) v = x; }
    v = Math.min(hi, Math.max(lo, v)); const n = Math.floor(Math.round((v - lo) / st * 1e9) / 1e9 + .5); v = Math.min(hi, +(lo + n * st).toFixed(10));
    g[k] = v;
  }
  let q = 14000; if (G.q !== undefined && Number.isFinite(+G.q)) q = Q_OPTIONS.reduce((a, b) => Math.abs(b - G.q) < Math.abs(a - G.q) ? b : a);
  g.q = q;
  const col = typeof G.col === 'string' && /^#[0-9a-f]{6}$/i.test(G.col) ? G.col : '#3a2418';
  const seed = o.seed !== undefined ? (+o.seed | 0) : 7;
  const src = o.parts && typeof o.parts === 'object' ? o.parts : {};
  const parts = Object.fromEntries(PIDS.map(id => [id, fixPart(Object.assign(newPart(id), src[id] || {}), id)]));
  return { g, parts, seed, col };
}
const isCfg = o => o && typeof o === 'object' && (o.globals || o.parts || o.len !== undefined);
const hexRgb = h => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); const n = m ? parseInt(m[1], 16) : 0x3a2418; return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const lin = c => c <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4);

function build(Ppos, cfgObj, opt) {
  opt = opt || {};
  const density = opt.density || 0.3;
  const { g, parts, seed } = loadCfg(cfgObj);
  const col = opt.color || loadCfg(cfgObj).col;
  /* 頭の形の表(髪型アプリの loadHead/buildTab と同じ) */
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < Ppos.length; i += 3) for (let c = 0; c < 3; c++) { const v = Ppos[i + c]; if (v < mn[c]) mn[c] = v; if (v > mx[c]) mx[c] = v; }
  const h = mx[1] - mn[1], s = 2.97 / h, C = [0, mn[1] + .556 * h, mn[2] + .46 * (mx[2] - mn[2])];
  const pivot = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
  const TNT = 64, TNP = 128, TAB = new Float32Array(TNT * TNP);
  for (let i = 0; i < Ppos.length; i += 3) {
    const x = (Ppos[i] - C[0]) * s, y = (Ppos[i + 1] - C[1]) * s, z = (Ppos[i + 2] - C[2]) * s, r = Math.hypot(x, y, z); if (r < 1e-6) continue;
    const th = Math.round(Math.acos(y / r) / Math.PI * (TNT - 1)); let ph = Math.atan2(z, -x); if (ph < 0) ph += TAU; const k = th * TNP + Math.round(ph / TAU * TNP) % TNP; if (r > TAB[k]) TAB[k] = r;
  }
  for (let it = 0; it < 60; it++) { let miss = 0; for (let a = 0; a < TNT; a++) for (let b = 0; b < TNP; b++) { const k = a * TNP + b; if (TAB[k] > 0) continue; miss++; let sum = 0, n = 0;
    for (const [da, db] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { const aa = a + da; if (aa < 0 || aa >= TNT) continue; const v = TAB[aa * TNP + (b + db + TNP) % TNP]; if (v > 0) { sum += v; n++; } } if (n) TAB[k] = sum / n; } if (!miss) break; }
  { const O = TAB.slice(); for (let a = 0; a < TNT; a++) for (let b = 0; b < TNP; b++) TAB[a * TNP + b] = .25 * O[a * TNP + (b + TNP - 1) % TNP] + .5 * O[a * TNP + b] + .25 * O[a * TNP + (b + 1) % TNP]; }
  function surf(d) {
    const l = Math.hypot(d[0], d[1], d[2]) || 1, y = Math.max(-1, Math.min(1, d[1] / l));
    const th = Math.acos(y) / Math.PI * (TNT - 1); let ph = Math.atan2(d[2], -d[0]); if (ph < 0) ph += TAU; ph = ph / TAU * TNP;
    const t0 = Math.min(TNT - 2, th | 0), ft = th - t0, p0 = Math.min(TNP - 1, ph | 0), fp = ph - p0, p1 = (p0 + 1) % TNP, G2 = (a, b) => TAB[a * TNP + b];
    const R = (G2(t0, p0) * (1 - fp) + G2(t0, p1) * fp) * (1 - ft) + (G2(t0 + 1, p0) * (1 - fp) + G2(t0 + 1, p1) * fp) * ft;
    return [d[0] / l * R, d[1] / l * R, d[2] / l * R];
  }
  function keepOut(p) { const l = Math.hypot(p[0], p[1], p[2]) || 1, d = [p[0] / l, p[1] / l, p[2] / l]; if (d[1] < -.45) return p;
    const sf = surf(d), R = Math.hypot(sf[0], sf[1], sf[2]) * 1.04; return l < R ? [d[0] * R, d[1] * R, d[2] * R] : p; }
  const PP = (th, ph, rad) => { const sf = surf(dirA(th, ph)); return [sf[0] * rad, sf[1] * rad, sf[2] * rad]; };
  const dFront = ph => Math.abs(((ph - Math.PI / 2 + 3 * Math.PI) % TAU) - Math.PI);
  const regionOf = (th, d) => th > 1.55 ? 'nape' : d >= 2 ? 'back' : 'base';
  const limF = (d, nd, nw) => 1 + .55 * sm(.2, 1.6, d) + Math.max(0, nd - 1.55) * sm(Math.PI - nw, Math.PI - nw * .35, d);
  function areaR(name, nd, nw) { let a = 0; const NP = 120, NT = 60, tm = Math.max(1.55, nd);
    for (let i = 0; i < NP; i++) { const d = dFront((i + .5) / NP * TAU), lim = limF(d, nd, nw); for (let j = 0; j < NT; j++) { const th = (j + .5) / NT * tm; if (th <= lim && regionOf(th, d) === name) a += Math.sin(th) * (tm / NT) * (TAU / NP); } } return a; }
  function profile(p) { const cp = p.preset === 'custom' ? p.cp : PRESETS[p.preset]; if (!cp) return null; const P = [[0, 0, 1], ...cp];
    return u => { const t = Math.min(.9999, Math.max(0, u)) * 4, i = t | 0, f = t - i, gg = k => P[Math.max(0, Math.min(4, k))], r = [0, 0, 0];
      for (let c = 0; c < 3; c++) { const a = gg(i - 1)[c], b = gg(i)[c], d = gg(i + 1)[c], e = gg(i + 2)[c]; r[c] = .5 * (2 * b + (-a + d) * f + (2 * a - 5 * b + 4 * d - e) * f * f + (-a + 3 * b - 3 * d + e) * f * f * f); }
      r[2] = Math.max(.2, r[2]); return r; }; }
  const KC = 36;
  function clump(r, band) { const k = (r() * KC) | 0, ka = k * 2.39996, kr = Math.sqrt((k + .5) / KC), a = r() * TAU, rr = Math.sqrt(r());
    const ox = band * (.55 * kr * Math.cos(ka) + .45 * rr * Math.cos(a)), oz = band * (.55 * kr * Math.sin(ka) + .45 * rr * Math.sin(a)); return [ox, oz, Math.min(1, Math.hypot(ox, oz) / band)]; }
  const tieA = g.tie, td = dirA(tieA, 1.5 * Math.PI + g.tph), hl = Math.hypot(td[0], td[2]) || 1;
  const X = { S0: g.q, L: g.len, td, tp: surf(td).map(v => v * 1.06), band: g.tw, tilt: g.tilt + .5 * Math.max(0, 1 - tieA / 1.35), hx: td[0] / hl, hz: td[2] / hl,
    vol: g.vol, wav: g.wave, fly: g.fly, nd: g.nd, nw: g.nw, ndn: g.ndn, bl: g.bl, bd: g.bd, bp: g.bp, bs: g.bs, sl: g.sl, sd: g.sd };
  const widthMul = Math.min(2.5, Math.sqrt(1 / Math.max(density, 1e-3)));
  const hc = hexRgb(col), tip = hc.map((v, i) => v * 1.25 * .88 + [1, .95, .85][i] * .12);
  const out = [];
  /* 1パーツ = 毛の帯をまとめた1メッシュ(髪型アプリの makeGeo に相当) */
  function makeGeo(id, T, M, gen, wmul) {
    T = Math.min(T, 40000); if (T < 1) return;
    const keep = Math.max(1, Math.round(T * density)), sel = new Uint8Array(T);
    if (keep >= T) sel.fill(1); else for (let k = 0; k < keep; k++) sel[Math.round(k * (T - 1) / Math.max(1, keep - 1))] = 1;
    const n = sel.reduce((a, b) => a + b, 0), V = n * M * 2;
    const P = new Float32Array(V * 3), N = new Float32Array(V * 3), Cc = new Uint8Array(V * 3), I = new Uint32Array(n * (M - 1) * 6);
    const pts = new Float32Array(M * 3), wp = new Float32Array(M); let si = 0;
    for (let s_ = 0; s_ < T; s_++) {
      wp.fill(1); const [outer, rnd] = gen(s_, pts, wp); if (!sel[s_]) continue;
      for (let i = 0; i < M; i++) {
        const a0 = Math.max(i - 1, 0) * 3, a1 = Math.min(i + 1, M - 1) * 3;
        let tx = pts[a1] - pts[a0], ty = pts[a1 + 1] - pts[a0 + 1], tz = pts[a1 + 2] - pts[a0 + 2]; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
        const px = pts[i * 3], py = pts[i * 3 + 1], pz = pts[i * 3 + 2], pl = Math.hypot(px, py, pz) || 1, vx = px / pl, vy = py / pl, vz = pz / pl;
        let rx = ty * vz - tz * vy, ry = tz * vx - tx * vz, rz = tx * vy - ty * vx; const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
        const u = i / (M - 1), w = g.w * widthMul * (1 - .8 * sm(.62, 1, u)) * (.75 + .5 * rnd) * wp[i] * wmul;
        /* 色: 髪型アプリのシェーダーの地の色 */
        const f = .8 + .4 * ((rnd * 13.7) % 1), ao = (.3 + .7 * outer) * (.6 + .4 * sm(0, .35, u));
        const rgb = [0, 1, 2].map(c => { let b = hc[c] * f; b = b * .5 + (b - b * .5) * sm(0, .3, u); b = b + (tip[c] - b) * (.55 * sm(.7, 1, u)); b *= .55 + .45 * ao; return Math.round(lin(Math.min(1, Math.max(0, b))) * 255); });
        for (let k = 0; k < 2; k++) {
          const v = (si * M + i) * 2 + k, o = v * 3, sg = k ? 1 : -1;
          P[o] = px + rx * w * sg; P[o + 1] = py + ry * w * sg; P[o + 2] = pz + rz * w * sg; N[o] = vx; N[o + 1] = vy; N[o + 2] = vz;
          Cc[o] = rgb[0]; Cc[o + 1] = rgb[1]; Cc[o + 2] = rgb[2];
        }
        if (i < M - 1) { const b = (si * M + i) * 2, t = (si * (M - 1) + i) * 6; I[t] = b; I[t + 1] = b + 1; I[t + 2] = b + 2; I[t + 3] = b + 1; I[t + 4] = b + 3; I[t + 5] = b + 2; }
      }
      si++;
    }
    out.push({ name: 'hair_' + id, id, P, N, C: Cc, I, mat: 'hair', strands: n });
  }
  function genScalp(name, p) { const Ab = areaR('base', 1.55, 1) + areaR('back', 1.55, 1), T = Math.round(X.S0 / Ab * areaR(name, X.nd, X.nw) * p.dens * (name === 'nape' ? X.ndn : 1));
    if (T < 1) return; const PA = 24, r = rng(seed + PIDS.indexOf(name) * 101), thMax = Math.max(1.55, X.nd), qE = Math.min(1, p.len), vol = X.vol * p.vol;
    makeGeo(name, T, PA + 1, (s_, pts) => { let th, ph, d, n = 0;
      do { ph = r() * TAU; th = Math.acos(1 - r() * (1 - Math.cos(thMax))); d = dFront(ph); } while ((th > limF(d, X.nd, X.nw) || regionOf(th, d) !== name) && ++n < 300);
      const d0 = dirA(th, ph), [ox, oz, mag] = clump(r, X.band), rnd = r();
      for (let i = 0; i <= PA; i++) { const q = i / PA * qE; let x = d0[0] + (td[0] - d0[0]) * q, y = d0[1] + (td[1] - d0[1]) * q, z = d0[2] + (td[2] - d0[2]) * q; const m = Math.hypot(x, y, z) || 1; x /= m; y /= m; z /= m;
        const sf = surf([x, y, z]), rad = 1.012 + .048 * q * q + (.03 + .045 * vol) * Math.sin(Math.PI * q), c = q * q * q;
        pts[i * 3] = sf[0] * rad + ox * c; pts[i * 3 + 1] = sf[1] * rad; pts[i * 3 + 2] = sf[2] * rad + oz * c; }
      return [.4 + .6 * mag, rnd]; }, p.thick); }
  function genPony(p) { const T = Math.round(X.S0 * 1.2 * p.dens); if (T < 1) return; const PT = 40, r = rng(seed + 777), prof = profile(p), L = X.L * p.len, wv = X.wav * p.wave, { tp, hx, hz, tilt } = X;
    makeGeo('ponytail', T, PT + 1, (s_, pts, wp) => { const [ox, oz, mag] = clump(r, X.band), rnd = r(), Ls = L * (1 - .2 * r() * r()), A = .05 * wv * (.6 + .8 * r()), p2 = 5 * ox / X.band + r() * .7;
      for (let j = 0; j <= PT; j++) { const u = j / PT, f = 1 + .9 * Math.sin(Math.PI * u) + .6 * u, w = sm(0, .3, u) * A, e = 1 - (1 - u) * (1 - u);
        let x = tp[0] + hx * tilt * Ls * e + ox * f + w * Math.sin(u * Ls * 1.8 + p2), y = tp[1] - Ls * u, z = tp[2] + hz * tilt * Ls * e + oz * f + w * .6 * Math.cos(u * Ls * 1.5 + p2);
        if (prof) { const o = prof(u); x += (hx * o[0] - hz * o[1]) * Ls; z += (hz * o[0] + hx * o[1]) * Ls; wp[j] = o[2]; }
        pts[j * 3] = x; pts[j * 3 + 1] = y; pts[j * 3 + 2] = z; }
      return [.4 + .6 * mag, rnd]; }, p.thick); }
  function genBangs(p) { const T = Math.round(X.S0 * .1 * X.bd * p.dens); if (T < 1) return; const M = 36, r = rng(seed + 99), pt = X.bp, prof = profile(p);
    makeGeo('bangs', T, M, (s_, pts, wp) => { const rnd = r(), lock = (r() * 14) | 0; let dph = ((lock + r() * .8) / 14 - .5) * 1.7 + pt; if (Math.abs(dph - pt) < .04) dph += dph < pt ? -.04 : .04;
      const ph0 = Math.PI / 2 + dph, th0 = .3 + r() * .5, thE = th0 + (X.bl - .15 * Math.abs(dph - pt) / .85 + (r() - .5) * .08 - th0) * p.len;
      for (let i = 0; i < M; i++) { const q = i / (M - 1), a = PP(th0 + (thE - th0) * q, ph0 + dph * X.bs * q * q + .015 * Math.sin(q * 7 + lock), 1.05 + .035 * Math.sqrt(q) + (p.vol - 1) * .06 * Math.sin(Math.PI * q));
        if (prof) { const o = prof(q); a[2] += o[0] * .8 * q; a[0] += o[1] * .8 * q; wp[i] = o[2]; } a[0] += p.wave * .03 * Math.sin(q * 9 + lock) * q;
        pts[i * 3] = a[0]; pts[i * 3 + 1] = a[1]; pts[i * 3 + 2] = a[2]; }
      return [.9, rnd]; }, p.thick); }
  function genSide(side, p) { const T = Math.round(X.S0 * .05 * X.sd * p.dens); if (T < 1) return; const M = 36, SN = 14, TN = M - SN, r = rng(seed + (side > 0 ? 211 : 223)), prof = profile(p);
    makeGeo(side > 0 ? 'side_left' : 'side_right', T, M, (s_, pts, wp) => { const rnd = r(), lock = (r() * 4) | 0, ph0 = Math.PI / 2 + side * (.95 + .06 * lock + .05 * r()), ph1 = Math.PI / 2 + side * (1.12 + .05 * lock + .04 * r()), th0 = .85 + r() * .2, th1 = 1.4;
      const Ls = X.sl * p.len * (.85 + .3 * r()), jx = (r() - .5) * .05, jz = (r() - .5) * .04;
      for (let i = 0; i < SN; i++) { const q = i / (SN - 1), a = PP(th0 + (th1 - th0) * q, ph0 + (ph1 - ph0) * q, 1.04 + .03 * q + (p.vol - 1) * .05 * Math.sin(Math.PI * q)); pts[i * 3] = a[0]; pts[i * 3 + 1] = a[1]; pts[i * 3 + 2] = a[2]; }
      const bp = PP(th1, ph1, 1.07);
      for (let j = 1; j <= TN; j++) { const u = j / TN, k = SN + j - 1; let a = [bp[0] + jx * (.4 + u) + side * .03 * Math.sin(Math.PI * u * .9) + p.wave * .04 * u * Math.sin(u * Ls * 3 + lock), bp[1] - Ls * u, bp[2] + .05 * u + jz * (.4 + u) + .015 * Math.sin(u * 9 + lock)];
        if (prof) { const o = prof(u); a[0] += side * o[0] * Ls; a[2] += o[1] * Ls; wp[k] = o[2]; }
        a = keepOut(a); pts[k * 3] = a[0]; pts[k * 3 + 1] = a[1]; pts[k * 3 + 2] = a[2]; }
      return [.85, rnd]; }, p.thick); }
  function genFly(p) { const T = Math.round(X.S0 * .015 * X.fly * p.dens); if (T < 1) return; const M = 14, r = rng(seed + 555);
    makeGeo('flyaways', T, M, (s_, pts, wp) => { let th, ph, n = 0; do { ph = r() * TAU; th = Math.acos(1 - r() * (1 - Math.cos(1.5))); } while (th > limF(dFront(ph), 1.55, 1) && ++n < 50);
      const d0 = dirA(th, ph), qE = (.08 + .22 * r()) * Math.min(p.len, 2), lift = .04 + .1 * r(), cu = (r() - .5) * .1, ph2 = r() * 6.3;
      for (let j = 0; j < M; j++) { const u = j / (M - 1), q = u * qE; let x = d0[0] + (td[0] - d0[0]) * q, y = d0[1] + (td[1] - d0[1]) * q, z = d0[2] + (td[2] - d0[2]) * q; const m = Math.hypot(x, y, z) || 1; x /= m; y /= m; z /= m;
        const sf = surf([x, y, z]), rad = 1.012 + .048 * q * q + (.03 + .045 * X.vol) * Math.sin(Math.PI * q) + .025 + lift * u * u, wob = cu * u * Math.sin(u * 5 + ph2);
        pts[j * 3] = sf[0] * rad - z * wob; pts[j * 3 + 1] = sf[1] * rad; pts[j * 3 + 2] = sf[2] * rad + x * wob; wp[j] = .7 * (1 - .7 * u); }
      return [1, r()]; }, p.thick); }
  const GEN = { base: p => genScalp('base', p), back: p => genScalp('back', p), nape: p => genScalp('nape', p), bangs: genBangs, side_left: p => genSide(1, p), side_right: p => genSide(-1, p), ponytail: genPony, flyaways: genFly };
  const PIV = id => id === 'ponytail' || id === 'tie' ? X.tp : id === 'bangs' ? surf(dirA(.45, Math.PI / 2)) : id === 'side_left' ? surf(dirA(1, Math.PI / 2 + 1)) : id === 'side_right' ? surf(dirA(1, Math.PI / 2 - 1)) : [0, 0, 0];
  for (const id of PIDS) {
    const p = parts[id]; if (id === 'tie' || !p.enabled) continue;
    const before = out.length; GEN[id](p); if (out.length === before) continue;
    const m = out[out.length - 1];
    if (p.rotY || p.pos.some(v => v)) {      /* パーツの向き・位置(髪型アプリの applyXf: ピボットまわりにY回転 + 平行移動) */
      const pv = PIV(id), c = Math.cos(p.rotY), s2 = Math.sin(p.rotY);
      const rot = (a, o) => { const x = a[o], z = a[o + 2]; a[o] = c * x + s2 * z; a[o + 2] = -s2 * x + c * z; };
      const ofs = [pv[0] - (c * pv[0] + s2 * pv[2]) + p.pos[0], p.pos[1], pv[2] - (-s2 * pv[0] + c * pv[2]) + p.pos[2]];
      for (let o = 0; o < m.P.length; o += 3) { rot(m.P, o); m.P[o] += ofs[0]; m.P[o + 1] += ofs[1]; m.P[o + 2] += ofs[2]; rot(m.N, o); }
    }
  }
  /* 頭皮キャップ(capA/capB/うなじ)と結び目 */
  const fitPts = P => { for (let o = 0; o < P.length; o += 3) { const sf = surf([P[o], P[o + 1], P[o + 2]]); P[o] = sf[0] * 1.004; P[o + 1] = sf[1] * 1.004; P[o + 2] = sf[2] * 1.004; } };
  const caps = [[1.004, 128, 48, Math.PI / 2 + .55, TAU - 1.1, 0, 1.0], [1.004, 128, 64, Math.PI / 2 + 1.4, TAU - 2.8, 0, 1.52], [1.004, 96, 48, 1.5 * Math.PI - X.nw, 2 * X.nw, 1.45, Math.max(.1, X.nd - 1.45 + .02)]];
  caps.forEach((a, k) => { const geo = new THREE.SphereGeometry(...a); const P = geo.attributes.position.array.slice(); fitPts(P);
    out.push({ name: 'hair_scalp_' + k, P, N: null, C: null, I: new Uint32Array(geo.index.array), mat: 'scalp' }); geo.dispose(); });
  if (parts.tie.enabled) { const p = parts.tie, geo = new THREE.TorusGeometry(1, .03, 24, 64), R2 = (X.band * 1.45 + .02) * p.vol;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(X.hx * 2 * X.tilt, -1, X.hz * 2 * X.tilt).normalize());
    const M4 = new THREE.Matrix4().compose(new THREE.Vector3(X.tp[0] + p.pos[0], X.tp[1] - .06 + p.pos[1], X.tp[2] - .02 + p.pos[2]), q, new THREE.Vector3(R2, R2, R2 * p.thick));
    geo.applyMatrix4(M4); out.push({ name: 'hair_tie', P: geo.attributes.position.array.slice(), N: null, C: null, I: new Uint32Array(geo.index.array), mat: 'tie' }); geo.dispose(); }
  /* 髪の空間 → GLBの座標(m) */
  for (const m of out) {
    for (let o = 0; o < m.P.length; o += 3) { m.P[o] = m.P[o] / s + C[0]; m.P[o + 1] = m.P[o + 1] / s + C[1]; m.P[o + 2] = m.P[o + 2] / s + C[2]; }
    if (!m.N) { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(m.P, 3)); geo.setIndex(new THREE.BufferAttribute(m.I, 1)); geo.computeVertexNormals(); m.N = geo.attributes.normal.array; }
  }
  return { meshes: out, color: col, pivot, tris: out.filter(m => m.mat === 'hair').reduce((a, m) => a + m.I.length / 3, 0) };
}

/* 顔のGLB(ArrayBuffer)の後ろに髪を足したGLBを作る(顔のBINの中身は変えない。elena_hair.assemble と同じ形)。
   adj: 髪 dx,dy,dz(mm) scale tilt(°) / 肌 skin_bright skin_red */
function assemble(faceBuf, hair, adj) {
  adj = adj || {};
  const dv = new DataView(faceBuf); let off = 12, J = null, BIN = new Uint8Array(0);
  while (off < faceBuf.byteLength) { const len = dv.getUint32(off, true), ty = dv.getUint32(off + 4, true), body = new Uint8Array(faceBuf, off + 8, len);
    if (ty === 0x4E4F534A) J = JSON.parse(new TextDecoder().decode(body)); else if (ty === 0x004E4942) BIN = body; off += 8 + len; }
  const parts = [BIN]; let blen = BIN.length;
  const add = (arr, comp, type, target, minmax, normalized) => {
    const pad = (4 - blen % 4) % 4; if (pad) { parts.push(new Uint8Array(pad)); blen += pad; }
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength); parts.push(bytes);
    J.bufferViews.push(Object.assign({ buffer: 0, byteOffset: blen, byteLength: bytes.length }, target ? { target } : {})); blen += bytes.length;
    const n = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type], a = { bufferView: J.bufferViews.length - 1, byteOffset: 0, componentType: comp, count: arr.length / n, type };
    if (normalized) a.normalized = true;
    if (minmax) { const mn = Array(n).fill(Infinity), mx = Array(n).fill(-Infinity); for (let i = 0; i < arr.length; i++) { const c = i % n; if (arr[i] < mn[c]) mn[c] = arr[i]; if (arr[i] > mx[c]) mx[c] = arr[i]; } a.min = mn; a.max = mx; }
    J.accessors.push(a); return J.accessors.length - 1; };
  J.accessors = J.accessors || []; J.bufferViews = J.bufferViews || []; J.materials = J.materials || []; J.meshes = J.meshes || []; J.nodes = J.nodes || [];
  const nFace = J.materials.length;
  if ('skin_bright' in adj || 'skin_red' in adj) { const b = adj.skin_bright ?? 1, r = adj.skin_red ?? 0;
    for (let i = 0; i < nFace; i++) { const m = J.materials[i]; m.pbrMetallicRoughness = m.pbrMetallicRoughness || {}; m.pbrMetallicRoughness.baseColorFactor = [b * (1 + r), b, b * (1 - r), 1]; } }
  if (hair) {
    const hc = hexRgb(hair.color).map(lin), cap = hexRgb(hair.color).map(v => lin(v * .3));
    const MAT = { hair: J.materials.length, scalp: J.materials.length + 1, tie: J.materials.length + 2 };
    J.materials.push({ name: 'hair', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: .55 }, doubleSided: true },
      { name: 'hair_scalp', pbrMetallicRoughness: { baseColorFactor: [...cap, 1], metallicFactor: 0, roughnessFactor: .8 }, doubleSided: true },
      { name: 'hair_tie', pbrMetallicRoughness: { baseColorFactor: [lin(.165), lin(.165), lin(.2), 1], metallicFactor: 0, roughnessFactor: .5 } });
    const kids = [];
    for (const m of hair.meshes) {
      const attrs = { POSITION: add(m.P, 5126, 'VEC3', 34962, true), NORMAL: add(m.N, 5126, 'VEC3', 34962) };
      if (m.C) { const c4 = new Uint8Array(m.C.length / 3 * 4); for (let i = 0, j = 0; i < m.C.length; i += 3, j += 4) { c4[j] = m.C[i]; c4[j + 1] = m.C[i + 1]; c4[j + 2] = m.C[i + 2]; c4[j + 3] = 255; } attrs.COLOR_0 = add(c4, 5121, 'VEC4', 34962, false, true); }
      const ai = add(m.I, 5125, 'SCALAR', 34963, true);
      J.meshes.push({ name: m.name, primitives: [{ attributes: attrs, indices: ai, mode: 4, material: MAT[m.mat] }] }); J.nodes.push({ name: m.name, mesh: J.meshes.length - 1 }); kids.push(J.nodes.length - 1);
    }
    const hn = { name: 'Hair', children: kids };
    const M = hairMatrix(hair.pivot, adj); if (M) hn.matrix = M;
    J.nodes.push(hn); const sc = J.scenes[J.scene || 0]; sc.nodes = sc.nodes.filter(i => !kids.includes(i)).concat([J.nodes.length - 1]);
  }
  J.buffers = [{ byteLength: blen }];
  J.asset = Object.assign({}, J.asset, { generator: ((J.asset || {}).generator || 'elena-head') + ' + 顔作成ツール' });
  let js = new TextEncoder().encode(JSON.stringify(J)); const jpad = (4 - js.length % 4) % 4; if (jpad) { const t = new Uint8Array(js.length + jpad); t.set(js); t.fill(32, js.length); js = t; }
  const bpad = (4 - blen % 4) % 4, total = 12 + 8 + js.length + 8 + blen + bpad;
  const outb = new Uint8Array(total), odv = new DataView(outb.buffer);
  odv.setUint32(0, 0x46546C67, true); odv.setUint32(4, 2, true); odv.setUint32(8, total, true);
  odv.setUint32(12, js.length, true); odv.setUint32(16, 0x4E4F534A, true); outb.set(js, 20);
  let o = 20 + js.length; odv.setUint32(o, blen + bpad, true); odv.setUint32(o + 4, 0x004E4942, true); o += 8;
  for (const p of parts) { outb.set(p, o); o += p.length; }
  return outb.buffer;
}
/* 髪の調整: 頭の中心 pivot のまわりで 大きさ→前後の傾き(X軸)→平行移動(mm)。列優先16要素。変化なしなら null */
function hairMatrix(pv, a) {
  const dx = (a.dx || 0) / 1000, dy = (a.dy || 0) / 1000, dz = (a.dz || 0) / 1000, sc = a.scale ?? 1, t = (a.tilt || 0) * Math.PI / 180;
  if (!dx && !dy && !dz && sc === 1 && !t) return null;
  const c = Math.cos(t), s = Math.sin(t), R = [[sc, 0, 0], [0, sc * c, -sc * s], [0, sc * s, sc * c]];
  const T = [0, 1, 2].map(i => pv[i] + [dx, dy, dz][i] - (R[i][0] * pv[0] + R[i][1] * pv[1] + R[i][2] * pv[2]));
  return [R[0][0], R[1][0], R[2][0], 0, R[0][1], R[1][1], R[2][1], 0, R[0][2], R[1][2], R[2][2], 0, T[0], T[1], T[2], 1];
}
root.HairGen = { build, assemble, hairMatrix, loadCfg, isCfg, hexRgb, lin };
})(window);
