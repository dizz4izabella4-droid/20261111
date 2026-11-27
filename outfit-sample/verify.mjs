// reload the exported GLB and check it: skin data, body untouched, body areas not covered by cloth
import fs from 'fs'; import {readGLB,accessor,sub,cross,dot,norm} from './lib.mjs';
const [,, bodyFile, outFile] = process.argv; const a = readGLB(bodyFile), b = readGLB(outFile);
for (let i = 0; i < a.js.accessors.length; i++) { const x = accessor(a, i), y = accessor(b, i); if (x.length !== y.length || x.some((v, k) => v !== y[k])) throw new Error('body data changed ' + i); }
console.log('original body accessors unchanged:', a.js.accessors.length, '| nodes kept:', JSON.stringify(a.js.nodes.slice(1)) === JSON.stringify(b.js.nodes.slice(1, a.js.nodes.length)));
let tris = [], badW = 0, badJ = 0, nan = 0, tv = 0, tt = 0;
for (const m of b.js.meshes.slice(1)) for (const p of m.primitives) { const P = accessor(b, p.attributes.POSITION), I = accessor(b, p.indices), W = accessor(b, p.attributes.WEIGHTS_0), J = accessor(b, p.attributes.JOINTS_0);
  tv += P.length/3; tt += I.length/3; P.forEach(v => { if (!Number.isFinite(v)) nan++; });
  for (let v = 0; v < P.length/3; v++) { const s = W[v*4]+W[v*4+1]+W[v*4+2]+W[v*4+3]; if (Math.abs(s-1) > 1e-3) badW++; for (let k = 0; k < 4; k++) if (J[v*4+k] >= b.js.skins[0].joints.length) badJ++; }
  const V = i => [P[i*3], P[i*3+1], P[i*3+2]]; for (let t = 0; t < I.length; t += 3) tris.push([V(I[t]), V(I[t+1]), V(I[t+2])]); }
console.log({ outfitVerts: tv, outfitTris: tt, badWeights: badW, badJoints: badJ, nan });
const prim = a.js.meshes[0].primitives[0], P = accessor(a, prim.attributes.POSITION), N = accessor(a, prim.attributes.NORMAL), J = accessor(a, prim.attributes.JOINTS_0), W = accessor(a, prim.attributes.WEIGHTS_0);
const names = a.js.skins[0].joints.map(j => a.js.nodes[j].name);
const boxes = tris.map(t => ({ t, lo: [0,1,2].map(k => Math.min(t[0][k], t[1][k], t[2][k])), hi: [0,1,2].map(k => Math.max(t[0][k], t[1][k], t[2][k])) }));
const hit = (o, d, tr) => { const e1 = sub(tr[1], tr[0]), e2 = sub(tr[2], tr[0]), p = cross(d, e2), det = dot(e1, p); if (Math.abs(det) < 1e-12) return false; const s = sub(o, tr[0]), u = dot(s, p)/det; if (u < 0 || u > 1) return false; const q = cross(s, e1), v = dot(d, q)/det; if (v < 0 || u+v > 1) return false; return dot(e2, q)/det > 0; };
const res = {};
for (let i = 0; i < P.length/3; i++) { let m = 0; for (let k = 1; k < 4; k++) if (W[i*4+k] > W[i*4+m]) m = k; const n = names[J[i*4+m]].replace(/_[lr]$/, ''), y = P[i*3+1];
  if (!/^(hips|spine|chest|upperarm|forearm|thigh|shin)$/.test(n) || y < 0.14 || y > 1.15) continue; if (n === 'forearm' && y < 0.86) continue;
  const o = [P[i*3], y, P[i*3+2]], d = norm([N[i*3], N[i*3+1], N[i*3+2]]);
  const lo = [0,1,2].map(k => Math.min(o[k], o[k]+d[k]*1.2)), hi = [0,1,2].map(k => Math.max(o[k], o[k]+d[k]*1.2));
  let c = false; for (const bx of boxes) { if (bx.hi[0] < lo[0] || bx.lo[0] > hi[0] || bx.hi[1] < lo[1] || bx.lo[1] > hi[1] || bx.hi[2] < lo[2] || bx.lo[2] > hi[2]) continue; if (hit(o, d, bx.t)) { c = true; break; } }
  res[n] = res[n] || [0, 0]; res[n][0]++; if (!c) res[n][1]++; }
console.log('body vertices checked / not covered along normal:', res);
