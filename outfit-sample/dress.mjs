import fs from 'fs'; import {add,sub,mul,len,norm,lerp,vlerp,cross,dot,clamp,smooth,readGLB,accessor,writeGLB,Field,simulate,gridTris} from './lib.mjs';
const [,, bodyFile, outDir] = process.argv;
const body = readGLB(bodyFile), prim = body.js.meshes[0].primitives[0];
const BP = accessor(body, prim.attributes.POSITION), BI = accessor(body, prim.indices), BJ = accessor(body, prim.attributes.JOINTS_0), BW = accessor(body, prim.attributes.WEIGHTS_0);
const V = i => [BP[i*3], BP[i*3+1], BP[i*3+2]];
const bodyTris = []; for (let t = 0; t < BI.length; t += 3) bodyTris.push([V(BI[t]), V(BI[t+1]), V(BI[t+2])]);
const jointNames = body.js.skins[0].joints.map(j => body.js.nodes[j].name);
const parent = {}; body.js.nodes.forEach((n, i) => (n.children || []).forEach(c => parent[c] = i));
const world = i => { const t = body.js.nodes[i].translation || [0,0,0]; return parent[i] === undefined ? t : add(world(parent[i]), t); };
const J = {}; body.js.skins[0].joints.forEach(j => J[body.js.nodes[j].name] = world(j));
const field = new Field([-0.75,-0.04,-0.85], [0.75,1.62,0.6], 0.006, 0.036);
console.log('body field', field.addSolid(bodyTris));
const bodyOnly = field.clone(), stats = {}, parts = [];
const TAU = Math.PI * 2, t0 = Date.now(), say = (k, s) => { stats[k] = s; console.log(k, JSON.stringify(s), ((Date.now()-t0)/1000).toFixed(0)+'s'); };
const escape = (p, m = 0.012) => { let q = p.slice(); const g = [0,0,0]; for (let k = 0; k < 40; k++) { const d = field.at(...q, g); if (d >= m) break; const L = len(g); q = add(q, L > 1e-6 ? mul(g, Math.max(0.002, m - d)/L) : [0, 0.003, 0]); } return q; };
const layer = (pos, closed, thick = 0.004) => field.splat(gridTris(pos, closed), thick);
const ringLen = (r, closed) => r.reduce((s, p, i) => s + ((closed || i + 1 < r.length) ? len(sub(r[(i+1)%r.length], p)) : 0), 0);
const pushOut = (p, dir, m = 0.012, f = field) => { let q = p.slice(); for (let k = 0; k < 200 && f.at(...q) < m; k++) q = add(q, mul(dir, 0.003)); return q; };

// ===== 1. bodice (fitted) =====
const NU = 96, bodice = [];
{ const NV = 24, O0 = 1.12, WAIST = 0.99;
  for (let j = 0; j < NV; j++) { const v = j / (NV - 1), row = [];
    for (let i = 0; i < NU; i++) { const th = i / NU * TAU, hd = [Math.sin(th), 0, Math.cos(th)];
      const neck = [0.068*Math.sin(th), 1.252 - 0.062*Math.pow(Math.max(0, Math.cos(th)), 3), -0.012 + 0.062*Math.cos(th)];
      let o, d; if (v < 0.5) { o = [0, O0, 0]; const k = v / 0.5; d = norm(vlerp(norm(sub(neck, o)), hd, Math.pow(k, 1.15))); } else { o = [0, lerp(O0, WAIST, (v-0.5)/0.5), 0]; d = hd; }
      let r = 0.02; while (r < 0.3 && bodyOnly.at(...add(o, mul(d, r))) < 0.0075) r += 0.0015;
      let p = add(o, mul(d, r)); const lim = lerp(0.135, 0.166, smooth(1.09, 1.17, p[1])); if (Math.abs(p[0]) > lim) { const k = lim / Math.abs(p[0]); p = [p[0]*k, p[1], p[2]*(0.35 + 0.65*k)]; }
      row.push(p); }
    bodice.push(row); }
  for (let j = 1; j < NV; j++) { // bridge hollows: convex hull of each ring in plan view
    const pts = bodice[j].map(p => [p[0], p[2]]).sort((a, b) => a[0]-b[0] || a[1]-b[1]), cr = (o,a,b) => (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
    const half = s => { const h = []; for (const q of s) { while (h.length > 1 && cr(h[h.length-2], h[h.length-1], q) <= 0) h.pop(); h.push(q); } h.pop(); return h; };
    const hull = [...half(pts), ...half([...pts].reverse())];
    bodice[j] = bodice[j].map(p => { const r = Math.hypot(p[0], p[2]), dx = p[0]/r, dz = p[2]/r; let best = r;
      for (let e = 0; e < hull.length; e++) { const a = hull[e], b = hull[(e+1)%hull.length], ex = b[0]-a[0], ez = b[1]-a[1], den = dx*ez - dz*ex; if (Math.abs(den) < 1e-12) continue; const t = (a[0]*ez - a[1]*ex)/den, u = (a[0]*dz - a[1]*dx)/den; if (u >= -1e-6 && u <= 1+1e-6 && t > best) best = t; }
      const k = lerp(r, best, smooth(0.08, 0.35, j/(NV-1))) / r; return [p[0]*k, p[1], p[2]*k]; }); }
  for (let it = 0; it < 6; it++) { const src = bodice.map(r => r.map(p => p.slice()));
    for (let j = 1; j < NV-1; j++) for (let i = 0; i < NU; i++) { const a = [src[j-1][i], src[j+1][i], src[j][(i+1)%NU], src[j][(i+NU-1)%NU]]; let p = [0,0,0]; a.forEach(q => p = add(p, mul(q, 0.25))); p = vlerp(src[j][i], p, 0.6);
      const g = [0,0,0], d = bodyOnly.at(...p, g); if (d < 0.0068) p = add(p, mul(norm(g), 0.0068 - d)); bodice[j][i] = p; } }
  layer(bodice, true, 0.003);
  parts.push({ name: 'cloth_bodice', kind: 'bodice', pos: bodice, closed: true }); say('bodice', { verts: NU*NV, waistCm: +(ringLen(bodice[NV-1], true)*100).toFixed(1) }); }

// ===== 2. skirt =====
{ const NV = 40, waist = bodice[bodice.length-1], L = 0.95, wc = ringLen(waist, true), HEM = 3.0, N = 13;
  const pos = [], h = [], v = [];
  for (let j = 0; j < NV; j++) { const t = j/(NV-1), C = lerp(wc, HEM, Math.pow(t, 0.8)), Rm = 0.19 + 0.2*t, k = smooth(0, 0.3, t), y = lerp(waist[0][1], 0.07, t);
    const ring = a => waist.map((w, i) => { const th = i/NU*TAU, rw = Math.hypot(w[0], w[2]), r = lerp(rw, Rm*(1 + a*k*Math.sin(N*th + 0.6)), k); return [r*Math.sin(th), y, r*Math.cos(th)*lerp(1, 0.94, k)]; });
    let lo = 0, hi = 0.3; for (let s = 0; s < 30; s++) { const a = (lo+hi)/2; if (ringLen(ring(a), true) < C) lo = a; else hi = a; }
    const r = j === 0 ? waist.map(p => p.slice()) : ring(lo).map(p => pushOut(p, norm([p[0], 0, p[2]])));
    pos.push(r); const r0 = ringLen(waist, true);
    h.push(waist.map((w, i) => lerp(len(sub(waist[(i+1)%NU], w)), C/NU, smooth(0, 0.18, t)))); v.push(new Array(NU).fill(L/(NV-1))); }
  const res = simulate(field, { nu: NU, nv: NV, closed: true, pos, h, v, pinned: j => j === 0 }, { stretch: 2e-8, shear: 3e-5, bend: 6e-3, mass: 0.6, frames: 220, sub: 20, margin: 0.006 });
  layer(res.pos, true); parts.push({ name: 'cloth_skirt', kind: 'skirt', pos: res.pos, closed: true }); say('skirt', res.stats); }

// ===== 3. sash =====
{ const NV = 7, band = [];
  for (let j = 0; j < NV; j++) { const t = j/(NV-1), y = lerp(1.028, 0.958, t), row = [];
    for (let i = 0; i < NU; i++) { const th = i/NU*TAU, d = [Math.sin(th), 0, Math.cos(th)]; let r = 0.158; while (r > 0.03 && field.at(r*d[0], y, r*d[2]) > 0.004) r -= 0.001; row.push([r, y, th]); } band.push(row); }
  for (let it = 0; it < 12; it++) for (const row of band) { const s = row.map(q => q[0]); row.forEach((q, i) => q[0] = Math.max(s[i], (s[(i+1)%NU] + s[(i+NU-1)%NU])/2)); }
  for (let i = 0; i < NU; i++) { const m = Math.max(...band.map(r => r[i][0])); band.forEach((r, j) => r[i][0] = lerp(r[i][0], m, 0.35) + 0.002 + 0.0022*Math.sin(j*2.1)*Math.sin(j === 0 || j === NV-1 ? 0 : 1.6)); }
  const bp = band.map(r => r.map(([r_, y, th]) => [r_*Math.sin(th), y + 0.004*Math.sin(th*2), r_*Math.cos(th)]));
  layer(bp, true, 0.003); parts.push({ name: 'cloth_sash', kind: 'sash', pos: bp, closed: true });
  for (const [idx, L, wid, out] of [[9, 0.50, 0.062, 0.010], [15, 0.40, 0.055, 0.018]]) { const NVt = 26, NUt = 6, base = bp[NV-2][idx], th = idx/NU*TAU, d = [Math.sin(th), 0, Math.cos(th)], side = [Math.cos(th), 0, -Math.sin(th)];
    const pos = [], h = [], v = []; for (let j = 0; j < NVt; j++) { const t = j/(NVt-1); pos.push([]); h.push([]); v.push([]);
      for (let i = 0; i < NUt; i++) { const u = i/(NUt-1) - 0.5, w = wid*lerp(0.7, 1.25, t); let p = add(add(base, mul(side, u*w)), add(mul(d, out + 0.18*t*L), [0, -L*t*0.95, 0])); pos[j].push(j < 2 ? add(add(base, mul(side, u*w)), add(mul(d, 0.008 + out*0.3*j), [0, -L*t, 0])) : pushOut(p, d)); h[j].push(w/(NUt-1)); v[j].push(L/(NVt-1)); } }
    const res = simulate(field, { nu: NUt, nv: NVt, closed: false, pos, h, v, pinned: j => j < 2 }, { stretch: 2e-8, shear: 1e-5, bend: 4e-3, mass: 0.05, frames: 160, sub: 20, margin: 0.005 });
    layer(res.pos, false, 0.003); parts.push({ name: 'cloth_sash_tail' + idx, kind: 'tail', pos: res.pos, closed: false }); say('tail' + idx, res.stats); } }

// ===== 4. sleeves =====
for (const [side, sg] of [['l', 1], ['r', -1]]) { const NUs = 40, NV = 34, S = J['upperarm_'+side], E = J['forearm_'+side], H = J['hand_'+side];
  const d1 = norm(sub(E, S)), d2 = norm(sub(H, E)), L1 = len(sub(E, S)), L2 = len(sub(H, E));
  const path = s => s < L1 ? { c: add(S, mul(d1, s)), t: norm(vlerp(d1, d2, smooth(L1-0.06, L1, s)*0.5)) } : { c: add(E, mul(d2, s - L1)), t: norm(vlerp(d1, d2, 0.5 + smooth(L1, L1+0.06, s)*0.5)) };
  const frame = t => { const e2 = norm(sub([0,0,1], mul(t, t[2]))); let e1 = norm(cross(t, e2)); if (e1[0]*sg < 0) e1 = mul(e1, -1); return [e1, e2]; };
  const armR = s => { const { c, t } = path(s), [e1, e2] = frame(t), rs = []; for (const a of [-1.2, -0.6, 0, 0.6, 1.2, 1.57, -1.57]) { const d = add(mul(e1, Math.cos(a)), mul(e2, Math.sin(a))); let r = 0.005; while (r < 0.09 && bodyOnly.at(...add(c, mul(d, r))) < 0) r += 0.001; rs.push(r); } rs.sort((a, b) => a-b); return rs[rs.length>>1]; };
  const pos = [], h = [], v = [], Ls = L1 + L2 + 0.0, FIT = 5;
  const longDir = i => { const a = i/NUs*TAU, w = Math.max(0, Math.cos(a - 4.15)); return w*w*w; }; // back-inner side hangs longer
  for (let j = 0; j < NV; j++) { const t = j/(NV-1); pos.push([]); h.push([]); v.push([]);
    for (let i = 0; i < NUs; i++) { const a = i/NUs*TAU, s0 = -0.012 + 0.062*Math.pow((1 - Math.cos(a))/2, 1.5);
      const ext = 0.24*longDir(i), s = lerp(s0, Ls + 0.012 + ext*smooth(0.55, 1, t), t), sArm = Math.min(s, Ls + 0.03), { c, t: tg } = path(sArm), [e1, e2] = frame(tg);
      const ra = armR(Math.min(s, Ls - 0.02)), fit = ra + 0.0095, C = lerp(TAU*fit, 0.34, smooth(0.14, 0.45, t)) + 0.44*Math.pow(smooth(0.45, 1, t), 1.4), R = C/TAU;
      const d = add(mul(e1, Math.cos(a)), mul(e2, Math.sin(a))), k = smooth(0.15, 0.5, t), off = add(mul(e1, (R-fit)*0.45*k), [0, -(R-fit)*0.45*k, -(R-fit)*0.15*k]);
      let rr = R; if (j < FIT + 3) { let q = 0.004; while (q < ra + 0.032 && bodyOnly.at(...add(c, mul(d, q))) < 0.0095) q += 0.001; rr = j < FIT ? Math.max(q, fit*0.9) : Math.max(R, lerp(q, R, (j - FIT + 1)/4)); }
      let p = add(add(c, off), mul(d, rr)); if (s > sArm) p = add(p, [0, -(s - sArm), 0]);
      if (j >= FIT) p = escape(p, 0.012);
      pos[j].push(p); h[j].push(Math.max(C, TAU*0.03)/NUs); } }
  for (let j = 0; j < NV; j++) for (let i = 0; i < NUs; i++) { const a = i/NUs*TAU, s0 = -0.012 + 0.062*Math.pow((1 - Math.cos(a))/2, 1.5), total = Ls + 0.012 - s0 + 0.24*longDir(i); v[j].push(total/(NV-1)); }
  for (let j = 0; j < FIT; j++) { pos[j].forEach((p, i) => h[j][i] = len(sub(pos[j][(i+1)%NUs], p))); }
  const res = simulate(field, { nu: NUs, nv: NV, closed: true, pos, h, v, pinned: j => j < FIT }, { stretch: 2e-8, shear: 2e-5, bend: 1.2e-3, mass: 0.16, frames: 220, sub: 24, margin: 0.006 });
  for (let it = 0; it < 3; it++) { const src = res.pos.map(r => r.slice()); for (let j = FIT-1; j < NV-1; j++) for (let i = 0; i < NUs; i++) { const a = [src[j-1][i], src[j+1][i], src[j][(i+1)%NUs], src[j][(i+NUs-1)%NUs]].reduce(add, [0,0,0]); const q = vlerp(src[j][i], mul(a, 0.25), 0.55); res.pos[j][i] = j < FIT ? q : escape(q, 0.0055); } }
  layer(res.pos, true, 0.009); parts.push({ name: 'cloth_sleeve_' + side, kind: 'sleeve', side, pos: res.pos, closed: true, L1, S, E, H }); say('sleeve_'+side, res.stats); }

// ===== 5. cape and hood =====
const spline = (pts, u) => { const n = pts.length - 1, k = Math.min(n-1, Math.floor(u*n)), t = u*n - k, p = i => pts[clamp(i, 0, n)];
  return [0,1,2].map(c => { const a = p(k-1)[c], b = p(k)[c], d = p(k+1)[c], e = p(k+2)[c]; return 0.5*(2*b + (-a+d)*t + (2*a-5*b+4*d-e)*t*t + (-a+3*b-3*d+e)*t*t*t); }); };
const drop = (x, z, from, m) => { let y = from; while (y > 0.9 && field.at(x, y, z) > m) y -= 0.001; return [x, y, z]; };
let capePins;
{ const NUc = 48, NV = 44, ctrl = [[0.128,0,0.050],[0.142,0,0.000],[0.118,0,-0.048],[0.062,0,-0.080],[0,0,-0.090],[-0.062,0,-0.080],[-0.118,0,-0.048],[-0.142,0,0.000],[-0.128,0,0.050]];
  capePins = Array.from({ length: NUc }, (_, i) => { const p = spline(ctrl, i/(NUc-1)); return drop(p[0], p[2], 1.285, 0.011); });
  for (let it = 0; it < 4; it++) capePins = capePins.map((p, i) => i === 0 || i === NUc-1 ? p : [p[0], Math.max(p[1], (capePins[i-1][1] + capePins[i+1][1])/2), p[2]]);
  const pos = [], h = [], v = [], L = 1.13, W1 = 1.75, w0 = ringLen(capePins, false);
  for (let j = 0; j < NV; j++) { const t = j/(NV-1), W = lerp(w0, W1, Math.pow(t, 0.85));
    const ring = k => capePins.map((P, i) => { const u = i/(NUc-1), b = lerp(95, 265, u)*Math.PI/180, d = [Math.sin(b), 0, Math.cos(b)], s = t*L, r = k*(1 + 0.07*smooth(0.1, 0.5, t)*Math.sin(u*TAU*7)); return add(P, add(mul(d, r), [0, -s*0.82 + 0.0, 0])); });
    let lo = 0, hi = 1.2; for (let s = 0; s < 30; s++) { const k = (lo+hi)/2; if (ringLen(ring(k), false) < W) lo = k; else hi = k; }
    const r = j === 0 ? capePins.map(p => p.slice()) : ring(Math.max(lo, 0.34*Math.sqrt(t))).map((p, i) => { const b = lerp(95, 265, i/(NUc-1))*Math.PI/180; return escape(p, 0.014); });
    pos.push(r); h.push(capePins.map((p, i) => i+1 < NUc ? lerp(len(sub(capePins[i+1], p)), W/(NUc-1), smooth(0, 0.25, t)) : 0)); v.push(new Array(NUc).fill(L/(NV-1))); }
  const res = simulate(field, { nu: NUc, nv: NV, closed: false, pos, h, v, pinned: j => j === 0 }, { stretch: 2e-8, shear: 3e-5, bend: 1e-2, mass: 0.9, frames: 300, sub: 20, margin: 0.0075, vmax: 0.9 });
  layer(res.pos, false, 0.005); parts.push({ name: 'cloth_cape', kind: 'cape', pos: res.pos, closed: false }); say('cape', res.stats); }
{ const NUh = 37, NV = 17, cape = parts.find(p => p.kind === 'cape').pos, CN = cape.length, CU = cape[0].length;
  const cp = (u, t) => { const fi = clamp(u, 0, 1)*(CU-1), fj = clamp(t, 0, 1)*(CN-1), i = Math.min(CU-2, Math.floor(fi)), j = Math.min(CN-2, Math.floor(fj)); return vlerp(vlerp(cape[j][i], cape[j][i+1], fi-i), vlerp(cape[j+1][i], cape[j+1][i+1], fi-i), fj-j); };
  const raw = (uc, tc) => { const p = cp(uc, tc), tu = sub(cp(uc+0.03, tc), cp(uc-0.03, tc)), tv = sub(cp(uc, tc+0.04), cp(uc, Math.max(0, tc-0.04))); let n = norm(cross(tu, tv)); if (dot(n, [p[0], 0.25, p[2]]) < 0) n = mul(n, -1); return { p, n }; };
  let pos = [];
  for (let j = 0; j < NV; j++) { const t = j/(NV-1); pos.push(Array.from({ length: NUh }, (_, i) => { const u = i/(NUh-1), m = Math.sin(Math.PI*u), uc = lerp(0.17, 0.83, u), depth = 0.045 + 0.235*Math.pow(m, 2.6), { p, n } = raw(uc, t*depth);
      const lift = 0.006 + Math.pow(m, 0.7)*(0.050*Math.pow(Math.sin(Math.PI*Math.min(1, t*0.92)), 0.8) + 0.011*Math.sin(t*Math.PI*3)*t*(1-t)*4*0.5) + 0.008*t;
      return add(p, mul(norm(add(n, [0, 0.35, 0])), j === 0 ? 0.004 : lift)); })); }
  for (let it = 0; it < 2; it++) pos = pos.map((r, j) => r.map((p, i) => j === 0 || j === NV-1 || i === 0 || i === NUh-1 ? p : mul([pos[j-1][i], pos[j+1][i], r[i-1], r[i+1], p, p, p, p].reduce(add, [0,0,0]), 1/8)));
  const mir = pos.map(r => r.map((p, i) => { const q = r[NUh-1-i]; return [(p[0] - q[0])/2, (p[1] + q[1])/2, (p[2] + q[2])/2]; }));
  pos = mir.map((r, j) => r.map(p => j === 0 ? p : escape(p, 0.0065)));
  layer(pos, false, 0.004); parts.push({ name: 'cloth_hood', kind: 'hood', pos, closed: false }); say('hood', { verts: NUh*NV, shaped: true }); }

// ===== 6. collar cord, front chain, brooches (solid trim) =====
const tube = (path, r, n = 8) => path.map((p, j) => { const t = norm(sub(path[Math.min(j+1, path.length-1)], path[Math.max(j-1, 0)])), e1 = norm(cross(t, [0.01,1,0.02])), e2 = cross(t, e1); return Array.from({ length: n }, (_, i) => add(p, add(mul(e1, Math.cos(i/n*TAU)*r), mul(e2, Math.sin(i/n*TAU)*r)))); });
{ parts.push({ name: 'cloth_cape_collar', kind: 'trim', pos: tube(capePins, 0.0065), closed: true });
  const a = capePins[0], b = capePins[capePins.length-1];
  const chain = Array.from({ length: 33 }, (_, k) => { const t = k/32, p = vlerp(a, b, t); p[1] -= 0.045*Math.sin(Math.PI*t); let z = 0.3; while (z > 0 && field.at(p[0], p[1], z) > 0.007) z -= 0.001; const q = [p[0], p[1], Math.max(z, lerp(p[2], p[2], t))]; return q; });
  chain[0] = a; chain[32] = b; for (let it = 0; it < 3; it++) for (let k = 1; k < 32; k++) chain[k][2] = Math.max(chain[k][2], (chain[k-1][2] + chain[k+1][2])/2);
  parts.push({ name: 'cloth_cape_cord', kind: 'trim', pos: tube(chain, 0.0032), closed: true });
  for (const [k, c] of [[0, a], [1, b]]) { const nrm = norm([c[0]*1.2, 0.45, 0.8]), e1 = norm(cross(nrm, [0,1,0])), e2 = cross(nrm, e1), prof = [[0.0005,0.012],[0.007,0.0115],[0.012,0.008],[0.017,0.0095],[0.021,0.005],[0.021,-0.004]];
    parts.push({ name: 'cloth_cape_brooch' + k, kind: 'trim', closed: true, pos: prof.map(([r, d]) => Array.from({ length: 20 }, (_, i) => add(add(c, mul(nrm, d)), add(mul(e1, Math.cos(i/20*TAU)*r), mul(e2, Math.sin(i/20*TAU)*r))))) }); } }
fs.writeFileSync(outDir + '/parts.json', JSON.stringify({ parts, stats, J }));
fs.writeFileSync(outDir + '/field.bin', Buffer.from(bodyOnly.d.buffer));
