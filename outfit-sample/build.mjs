import fs from 'fs'; import {add,sub,mul,len,norm,lerp,vlerp,cross,dot,clamp,smooth,readGLB,accessor,writeGLB} from './lib.mjs';
const [,, bodyFile, dir] = process.argv;
const { parts, J } = JSON.parse(fs.readFileSync(dir + '/parts.json'));
const g = readGLB(bodyFile), prim = g.js.meshes[0].primitives[0];
const BP = accessor(g, prim.attributes.POSITION), BJ = accessor(g, prim.attributes.JOINTS_0), BW = accessor(g, prim.attributes.WEIGHTS_0);
const names = g.js.skins[0].joints.map(j => g.js.nodes[j].name), JI = n => { const i = names.indexOf(n); if (i < 0) throw new Error(n); return i; };
const lin = hex => [1,3,5].map(k => { const c = parseInt(hex.slice(k, k+2), 16)/255; return c <= 0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); });
const C = { ivory: lin('#d9ccb0'), gold: lin('#c29a45'), wine: lin('#7d2136'), green: lin('#235443'), lining: lin('#6a1f31') };
// body vertices usable for the fitted top
const pool = []; for (let i = 0; i < BP.length/3; i++) { let m = 0; for (let k = 1; k < 4; k++) if (BW[i*4+k] > BW[i*4+m]) m = k; const n = names[BJ[i*4+m]]; if (/^(hips|spine|chest|neck|upperarm)/.test(n) && BP[i*3+1] > 0.9) pool.push(i); }
const nearW = p => { let b = 1e9, bi = 0; for (const i of pool) { const d = (BP[i*3]-p[0])**2 + (BP[i*3+1]-p[1])**2 + (BP[i*3+2]-p[2])**2; if (d < b) { b = d; bi = i; } } const w = {}; for (let k = 0; k < 4; k++) if (BW[bi*4+k] > 0) w[names[BJ[bi*4+k]]] = (w[names[BJ[bi*4+k]]] || 0) + BW[bi*4+k]; return w; };
const mix = (a, b, t) => { const o = {}; for (const k in a) o[k] = (o[k] || 0) + a[k]*(1-t); for (const k in b) o[k] = (o[k] || 0) + b[k]*t; return o; };
const bod = parts.find(p => p.kind === 'bodice');
let bw = bod.pos.map(r => r.map(nearW));
for (let it = 0; it < 6; it++) bw = bw.map((r, j) => r.map((w, i) => { const nb = [r[(i+1)%r.length], r[(i+r.length-1)%r.length], bw[Math.max(0,j-1)][i], bw[Math.min(bw.length-1,j+1)][i]]; let o = mix(nb[0], nb[1], 0.5), q = mix(nb[2], nb[3], 0.5); return mix(w, mix(o, q, 0.5), 0.6); }));
const waistW = bw[bw.length-1];
const lowW = (x, y, th) => { const sl = smooth(-0.11, 0.11, x), sh = 0.45*smooth(0.46, 0.2, y); return { hips: 1-th, thigh_l: th*sl*(1-sh), thigh_r: th*(1-sl)*(1-sh), shin_l: th*sl*sh, shin_r: th*(1-sl)*sh }; };
const at = (grid, fj, fi, closed) => { const nv = grid.length, nu = grid[0].length, cr = (a,b,c,d,t) => [0,1,2].map(k => 0.5*(2*b[k] + (c[k]-a[k])*t + (2*a[k]-5*b[k]+4*c[k]-d[k])*t*t + (3*b[k]-a[k]-3*c[k]+d[k])*t*t*t));
  const ci = i => closed ? ((i%nu)+nu)%nu : clamp(i,0,nu-1), ext = (get, n, k) => k < 0 ? sub(mul(get(0),2), get(1)) : k > n-1 ? sub(mul(get(n-1),2), get(n-2)) : get(k);
  const j0 = Math.min(nv-2, Math.floor(fj)), tj = fj - j0, i0 = closed ? Math.floor(fi) : Math.min(nu-2, Math.floor(fi)), ti = fi - i0;
  const row = jj => { const col = i => closed ? grid[jj][ci(i)] : ext(k => grid[jj][k], nu, i); return cr(col(i0-1), col(i0), col(i0+1), col(i0+2), ti); };
  return cr(ext(row, nv, j0-1), row(j0), row(j0+1), ext(row, nv, j0+2), tj); };
const ticks = (n, bands) => { let t = Array.from({ length: n }, (_, i) => i/(n-1)); for (const [a, b] of bands) for (const e of [a, b]) if (e > 0.001 && e < 0.999) { t = t.filter(x => x === 0 || x === 1 || Math.abs(x-e) > 0.006); t.push(e-0.0012, e+0.0012); } return t.sort((a, b) => a-b); };
const mats = [ { name: 'cloth_double', doubleSided: true, pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 0.88 } }, { name: 'cloth_single', pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 0.88 } }, { name: 'trim_gold', doubleSided: true, pbrMetallicRoughness: { metallicFactor: 0.65, roughnessFactor: 0.42 } } ];
const base = g.js.materials.length; g.js.materials.push(...mats);
let bin = g.bin.subarray(0, g.js.buffers[0].byteLength); const chunks = [bin]; let off = bin.length;
const push = (arr, type, ct, target, minmax) => { const pad = (4 - off%4)%4; if (pad) { chunks.push(Buffer.alloc(pad)); off += pad; } const b = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength); chunks.push(b);
  g.js.bufferViews.push({ buffer: 0, byteOffset: off, byteLength: b.length, target }); off += b.length; const n = { SCALAR:1, VEC3:3, VEC4:4 }[type], a = { bufferView: g.js.bufferViews.length-1, componentType: ct, count: arr.length/n, type };
  if (minmax) { a.min = [0,1,2].map(k => { let m = Infinity; for (let i = k; i < arr.length; i += 3) m = Math.min(m, arr[i]); return m; }); a.max = [0,1,2].map(k => { let m = -Infinity; for (let i = k; i < arr.length; i += 3) m = Math.max(m, arr[i]); return m; }); }
  g.js.accessors.push(a); return g.js.accessors.length-1; };
let totalTri = 0, totalVert = 0; const report = [];
function emit(name, prims) { const out = []; let nt = 0, nv = 0; for (const p of prims) { const n = p.P.length, P = new Float32Array(n*3), N = new Float32Array(n*3), Co = new Float32Array(n*3), Jn = new Uint16Array(n*4), W = new Float32Array(n*4), MD = new Float32Array(n);
    p.P.forEach((q, i) => { P.set(q, i*3); N.set(p.N[i], i*3); Co.set(p.C[i], i*3); MD[i] = p.MD[i];
      const e = Object.entries(p.W[i]).filter(e => e[1] > 1e-4).sort((a, b) => b[1]-a[1]).slice(0, 4), s = e.reduce((t, x) => t + x[1], 0); e.forEach(([k, v], c) => { Jn[i*4+c] = JI(k); W[i*4+c] = v/s; }); });
    out.push({ attributes: { POSITION: push(P,'VEC3',5126,34962,true), NORMAL: push(N,'VEC3',5126,34962), COLOR_0: push(Co,'VEC3',5126,34962), JOINTS_0: push(Jn,'VEC4',5123,34962), WEIGHTS_0: push(W,'VEC4',5126,34962), _MAX_DISTANCE: push(MD,'SCALAR',5126,34962) }, indices: push(Uint16Array.from(p.I),'SCALAR',5123,34963), material: base + p.mat });
    nt += p.I.length/3; nv += n; }
  g.js.meshes.push({ name, primitives: out }); g.js.nodes.push({ name, mesh: g.js.meshes.length-1, skin: 0 }); g.js.scenes[0].nodes.push(g.js.nodes.length-1); totalTri += nt; totalVert += nv; report.push([name, nv, nt]); }
for (const part of parts) {
  const k = part.kind, nvS = part.pos.length, nuS = part.pos[0].length, closed = part.closed;
  let rows = [], cols = [], color = () => C.ivory, step = 1, mat = 0, lining = null, wfn, md = () => 0;
  if (k === 'bodice') { rows = [[0, 0.075]]; color = t => t < 0.075 ? C.gold : C.ivory; wfn = (p, t, u, j, i) => bw[j][i]; }
  if (k === 'skirt') { rows = [[0.875, 0.895], [0.925, 0.975]]; color = t => t > 0.925 && t < 0.975 ? C.gold : t > 0.875 && t < 0.895 ? C.wine : C.ivory; wfn = (p, t, u, j, i) => mix(waistW[i % nuS], lowW(p[0], p[1], 0.8*smooth(0.08, 0.5, t)), smooth(0, 0.18, t)); md = t => 0.14*smooth(0.12, 1, t); }
  if (k === 'sash') { rows = [[0, 0.14], [0.86, 1]]; color = t => t < 0.14 || t > 0.86 ? C.gold : C.wine; wfn = (p, t, u, j, i) => waistW[i % nuS]; }
  if (k === 'tail') { rows = [[0.86, 0.95]]; color = t => t > 0.86 && t < 0.95 ? C.gold : C.wine; const idx = +part.name.match(/\d+$/)[0]; wfn = (p, t) => mix(waistW[idx], lowW(p[0], p[1], 0.6*smooth(0.2, 0.9, t)), smooth(0, 0.3, t)); md = t => 0.1*smooth(0.05, 1, t); }
  if (k === 'sleeve') { rows = [[0.875, 0.895], [0.925, 0.985]]; color = t => t > 0.925 && t < 0.985 ? C.gold : t > 0.875 && t < 0.895 ? C.wine : C.ivory; const Ls = part.L1 + len(sub(part.H, part.E)), s_ = part.side;
    wfn = (p, t) => { const s = t*Ls, fore = smooth(part.L1-0.07, part.L1+0.07, s), ch = 0.45*(1 - smooth(0.0, 0.11, s)); return { chest: ch, ['upperarm_'+s_]: (1-fore)*(1-ch), ['forearm_'+s_]: fore*(1-ch) }; }; md = t => 0.09*smooth(0.35, 1, t); }
  if (k === 'cape') { rows = [[0.935, 0.985]]; cols = [[0.022, 0.978]]; mat = 1; lining = C.lining; color = (t, u) => (t > 0.935 && t < 0.985) || u < 0.022 || u > 0.978 ? C.gold : C.green; md = t => 0.25*smooth(0.1, 1, t); }
  if (k === 'hood') { rows = [[0.84, 0.95]]; cols = []; mat = 1; lining = C.lining; color = t => t > 0.84 && t < 0.95 ? C.gold : C.green; wfn = () => ({ chest: 1 }); md = t => 0.03*t; }
  if (k === 'cape' ) wfn = (p, t) => { const x = p[0], y = p[1], sh = 0.3*smooth(0.09, 0.15, Math.abs(x))*(1 - smooth(0.02, 0.22, t)); const up = { chest: 1-sh, [x > 0 ? 'upperarm_l' : 'upperarm_r']: sh };
    const mid = mix({ spine: 1 }, up, smooth(0.99, 1.13, y)), low = lowW(x, y, 0.35*smooth(0.75, 0.35, y)); return mix(low, mid, smooth(0.82, 1.02, y)); };
  if (k === 'trim') { color = () => C.gold; mat = 2; wfn = p => ({ chest: 1 - 0.25*smooth(0.09, 0.15, Math.abs(p[0])), [p[0] > 0 ? 'upperarm_l' : 'upperarm_r']: 0.25*smooth(0.09, 0.15, Math.abs(p[0])) }); }
  const tr = k === 'trim', tj = tr ? Array.from({ length: nvS }, (_, i) => i/(nvS-1)) : ticks(nvS, rows);
  const ti = tr || !cols.length ? Array.from({ length: closed ? nuS : nuS }, (_, i) => closed ? i/nuS : i/(nuS-1)) : ticks(nuS, cols);
  const nv = tj.length, nu = ti.length, P = [], grid = [];
  tj.forEach((t, j) => { grid.push([]); ti.forEach((u, i) => { const fj = t*(nvS-1), fi = closed ? u*nuS : u*(nuS-1); const p = tr ? part.pos[j][i] : at(part.pos, fj, fi, closed); grid[j].push(p); P.push(p); }); });
  const N = P.map(() => [0,0,0]), I = [];
  for (let j = 0; j+1 < nv; j++) for (let i = 0; i < (closed ? nu : nu-1); i++) { const a = j*nu+i, b = (j+1)*nu+i, c = (j+1)*nu+(i+1)%nu, d = j*nu+(i+1)%nu; I.push(a,b,c, a,c,d); }
  for (let t = 0; t < I.length; t += 3) { const [a,b,c] = [I[t], I[t+1], I[t+2]], n = cross(sub(P[b], P[a]), sub(P[c], P[a])); for (const v of [a,b,c]) N[v] = add(N[v], n); }
  let s = 0; for (let j = 0; j < nv; j++) { const cen = (k === 'sleeve' || tr) ? mul(grid[j].reduce(add, [0,0,0]), 1/nu) : k === 'hood' ? [0, 1.0, 0.06] : null; for (let i = 0; i < nu; i++) { const p = grid[j][i], c = cen || [0, p[1], k === 'tail' ? 0 : 0]; s += dot(N[j*nu+i], sub(p, c)); } }
  if (s < 0) { for (let t = 0; t < I.length; t += 3) [I[t+1], I[t+2]] = [I[t+2], I[t+1]]; for (let v = 0; v < N.length; v++) N[v] = mul(N[v], -1); }
  const Nn = N.map(norm), Co = [], W = [], MD = [];
  tj.forEach((t, j) => ti.forEach((u, i) => { Co.push(color(t, u)); const jr = Math.round(t*(nvS-1)), ir = closed ? Math.round(u*nuS) % nuS : Math.round(u*(nuS-1)); W.push(k === 'bodice' ? bw[jr][ir] : wfn(grid[j][i], t, u, jr, ir)); MD.push(md(t)); }));
  const prims = [{ P, N: Nn, C: Co, W, MD, I, mat }];
  if (lining) { const I2 = []; for (let t = 0; t < I.length; t += 3) I2.push(I[t], I[t+2], I[t+1]); prims.push({ P: P.map((p, i) => sub(p, mul(Nn[i], 0.0022))), N: Nn.map(n => mul(n, -1)), C: tj.flatMap(t => ti.map(u => { const c = color(t, u); return c === C.gold ? C.gold : lining; })), W, MD, I: I2, mat }); }
  emit(part.name.replace(/tail(\d+)/, 'tail_$1'), prims);
}
g.js.buffers[0].byteLength = off; g.js.asset.generator = 'spare-body + outfit sample';
writeGLB(dir + '/spare_body_dressed.glb', g.js, Buffer.concat(chunks));
console.log(report); console.log('outfit vertices', totalVert, 'triangles', totalTri, 'bytes', fs.statSync(dir + '/spare_body_dressed.glb').size);
