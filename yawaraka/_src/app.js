import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

let INK = 0x3a3aa8;            // 線の色（キャラごとに変わる）

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeeece4);

const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
camera.position.set(0.6, 1.3, innerWidth > innerHeight ? 11.5 : 8.4);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.85, 0);
controls.enableDamping = true;
controls.minDistance = 3;
controls.maxDistance = 16;
controls.maxPolarAngle = Math.PI;   // 下からものぞける
controls.autoRotate = true;
controls.autoRotateSpeed = 1.2;

// ---- ライト（トゥーン調）
scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d4c8, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(3, 6, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -9; sun.shadow.camera.right = 9;
sun.shadow.camera.top = 9; sun.shadow.camera.bottom = -9;
sun.shadow.camera.far = 30;
sun.shadow.radius = 6;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
scene.add(sun);
const under = new THREE.DirectionalLight(0xffffff, 0.9);   // 下から見たとき用のやさしい光
under.position.set(0, -5, 1);
scene.add(under);

// トゥーン用グラデーション
const grad = new THREE.DataTexture(new Uint8Array([200, 232, 250, 255]), 4, 1, THREE.RedFormat);
grad.minFilter = grad.magFilter = THREE.NearestFilter;
grad.needsUpdate = true;
let bodyMat, inkMat;

// 法線方向に押し出す裏面アウトライン
function outlineMat(th) {
  return new THREE.ShaderMaterial({
    uniforms: { th: { value: th }, col: { value: new THREE.Color(INK) } },
    vertexShader: `uniform float th; void main(){ vec3 p = position + normal * th; gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0); }`,
    fragmentShader: `uniform vec3 col; void main(){ gl_FragColor = vec4(col,1.0); }`,
    side: THREE.BackSide
  });
}
let outlines = [];
let lineOn = true;
function withOutline(mesh, th = 0.035) {
  const o = new THREE.Mesh(mesh.geometry, outlineMat(th));
  o.visible = lineOn;
  mesh.add(o);
  outlines.push(o);
  mesh.castShadow = true;
  return mesh;
}

// ---- キャラ全体
let cat = new THREE.Group();     // 床からの位置（ジャンプ・持ち上げ）
scene.add(cat);
let squish = null;                 // ぷにぷに変形用（キャラごとに作り直す）
let faceMask = null, itemAll = false;
const PROT = 0.6;
let colorBase = null, scorch = null, bodyCol = 0xffffff, itemCol = null;
let curKey = 'mebae', gs = { x: 1, y: 1, z: 1 }, flashT = -1;
let undoStack = [];
let ovD = null, bound = null, curInst = null;
const insts = [];
const ui = id => document.getElementById(id);
let current = null, body, bodyGeo, basePos, face, floorY = 0, lift = 0, pos;
let riders = [], faceVerts = [], faceCaps = [];

// 餅形の体を作る（底はぺたっと、すそはむにっと）
function makeBody(sh, colorFn) {
  const { A, B, C, FLOOR, flat, skirt, dome } = sh;
  const g = new THREE.SphereGeometry(1, 128, 96);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const rest = 1 + FLOOR;
    if (y < FLOOR) {
      const d = FLOOR - y;
      y = FLOOR - d * flat;
      const s = 1 + Math.sin(Math.min(d / rest, 1) * Math.PI * 0.5) * skirt;
      x *= s; z *= s;
    } else {
      const s = 1 + Math.sin(((y - FLOOR) / (1 - FLOOR)) * Math.PI) * dome;
      x *= s; z *= s;
    }
    p.setXYZ(i, x * A, y * B, z * C);
  }
  g.computeVertexNormals();
  const fy = FLOOR * B - (1 + FLOOR) * B * flat;
  {
    const col = new Float32Array(p.count * 3), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      if (colorFn) colorFn(p.getX(i), p.getY(i), p.getZ(i), fy, c); else c.setRGB(1, 1, 1);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  return { geo: g, floorY: fy };
}

// 体の表面に貼りつける（組み立て中は体が原点にあるのでそのままレイを当てる）
const _rc = new THREE.Raycaster();
function surf(from, dir) {
  _rc.set(from, dir);
  const h = _rc.intersectObject(body, false)[0];
  return { p: h.point.clone(), n: h.face.normal.clone() };
}
function onFront(x, y, lift = 0.02) {
  const { p, n } = surf(new THREE.Vector3(x, y, 5), new THREE.Vector3(0, 0, -1));
  return p.addScaledVector(n, lift);
}
function onTop(x, z) { return surf(new THREE.Vector3(x, 5, z), new THREE.Vector3(0, -1, 0)); }
function onBottom(x, z) { return surf(new THREE.Vector3(x, -5, z), new THREE.Vector3(0, 1, 0)); }

function strokeOnFace(pts2d, r, lift, closed = false) {
  // 線はほぼ全部が表面より上に出る、ぷっくりした立体にする（伸ばしても体に食い込んでガビガビにならない）
  const L = Math.max(lift, r * 0.8 + 0.014);
  const pts = pts2d.map(([x, y]) => onFront(x, y, L));
  const curve = new THREE.CatmullRomCurve3(pts, closed);
  const g = new THREE.TubeGeometry(curve, closed ? 80 : 56, r, 12, closed);
  const m = new THREE.Mesh(g, inkMat);
  if (!closed) [pts[0], pts[pts.length - 1]].forEach(p => {   // 端を丸く
    const s = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), inkMat);
    s.position.copy(p); m.add(s);
  });
  return m;
}

// ================= ぬおん（ねこ） =================
function buildNeko() {
  // 閉じ目：外側に下がる斜め線を重ねてペンの「シャシャッ」感
  for (const side of [-1, 1]) {
    const g = new THREE.Group();
    for (const s of [{ off: 0, r: 0.034 }, { off: 0.045, r: 0.022 }, { off: -0.04, r: 0.018 }]) {
      const x0 = side * 0.30, y0 = 0.30 + s.off;
      const x1 = side * 0.78, y1 = 0.02 + s.off * 0.6;
      g.add(strokeOnFace([[x0, y0], [(x0 + x1) / 2, (y0 + y1) / 2 + 0.03], [x1, y1]], s.r, 0.015));
    }
    face.add(g);
  }
  // ω口
  const w = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    w.push([-0.13 + t * 0.26, 0.23 - Math.abs(Math.sin(t * Math.PI * 2)) * 0.075]);
  }
  const mouthN = strokeOnFace(w, 0.02, 0.015);
  face.add(mouthN);
  // うれしい用：口角がほんの少し上がったω
  const ws = w.map(([x, y]) => [x, y + 0.03 * Math.pow(Math.abs(x) / 0.13, 2)]);
  const mouthS = strokeOnFace(ws, 0.02, 0.015);
  mouthS.visible = false; face.add(mouthS);

  // 耳
  for (const side of [-1, 1]) {
    const shape = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      shape.push(new THREE.Vector2(Math.max(0.36 * Math.pow(1 - t, 0.9) + 0.03 * Math.sin(t * Math.PI), 0.001), t * 0.62));
    }
    const g = new THREE.LatheGeometry(shape, 40);
    g.scale(1, 1, 0.6);
    const m = withOutline(new THREE.Mesh(g, bodyMat), 0.03);
    m.castShadow = false;
    m.position.set(side * 0.9, 0.5, 0.05);
    m.rotation.set(-0.08, 0, -side * 0.42);
    squish.add(m);
  }

  // 肉球（おなか側・横からは見えない）
  const padMat = new THREE.MeshToonMaterial({ color: 0xffadc0, gradientMap: grad });
  const pads = new THREE.Group();
  const bean = (x, z, r) => {
    const { p, n } = onBottom(x, z);
    const m = withOutline(new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), padMat), 0.008 / r);
    m.castShadow = false;
    m.scale.set(r, r * 0.12, r * 0.85);
    m.position.copy(p).addScaledVector(n, -r * 0.12 + 0.004);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), n);
    pads.add(m);
  };
  for (const [fx, fz] of [[-0.62, 0.42], [0.62, 0.42], [-0.62, -0.5], [0.62, -0.5]]) {
    bean(fx, fz, 0.19);
    for (const deg of [-52, -18, 18, 52]) {
      const a = deg * Math.PI / 180;
      bean(fx + Math.sin(a) * 0.27, fz + Math.cos(a) * 0.27, deg % 52 === 0 ? 0.075 : 0.085);
    }
  }
  squish.add(pads);
  return { mouths: [mouthN, mouthS] };
}

// ================= 植え替えできるもの =================
const tm = c => new THREE.MeshToonMaterial({ color: c, gradientMap: grad });
function blob(parent, rx, ry, rz, color, x = 0, y = 0, z = 0, rot = [0, 0, 0], th = 0.026) {
  const g = new THREE.SphereGeometry(1, 28, 18); g.scale(rx, ry, rz);
  const m = withOutline(new THREE.Mesh(g, tm(color)), th);
  m.position.set(x, y, z); m.rotation.set(rot[0], rot[1], rot[2]);
  parent.add(m); return m;
}
function lathe(parent, pts, color, x = 0, y = 0, z = 0, th = 0.022) {
  const g = new THREE.LatheGeometry(pts.map(([r, h]) => new THREE.Vector2(r, h)), 40);
  const m = withOutline(new THREE.Mesh(g, tm(color)), th);
  m.position.set(x, y, z); parent.add(m); return m;
}
function cone(parent, r, h, color, x, y, z, rot = [0, 0, 0]) {
  const g = new THREE.ConeGeometry(r, h, 16, 1); g.translate(0, h / 2, 0);
  const m = withOutline(new THREE.Mesh(g, tm(color)), 0.016);
  m.position.set(x, y, z); m.rotation.set(rot[0], rot[1], rot[2]); parent.add(m); return m;
}
function extr(parent, shape, depth, bevel, color, x = 0, y = 0, z = 0) {
  let g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 18 });
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-3); g.computeVertexNormals(); g.translate(0, 0, -depth / 2);
  const m = withOutline(new THREE.Mesh(g, tm(color)), 0.026);
  m.position.set(x, y, z); parent.add(m); return m;
}
const PLANTS = {
  grass: { main: 0xc5e3c8, h: 0.3, grab: 0.14, make(head) {
    const mat = tm(0xc5e3c8), leaves = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      const lg = new THREE.SphereGeometry(1, 32, 20); lg.scale(0.3, 0.075, 0.2); lg.translate(side * 0.28, 0, 0);
      pivot.add(withOutline(new THREE.Mesh(lg, mat), 0.028));
      pivot.userData.side = side; pivot.rotation.z = side * 0.28;
      head.add(pivot); leaves.push(pivot);
    }
    return { leaves };
  } },
  tulip: { main: 0xee6f86, h: 0.36, grab: 0.2, gy: 0.16, make(h) {
    blob(h, 0.17, 0.22, 0.17, 0xee6f86, 0, 0.17, 0);
    blob(h, 0.08, 0.2, 0.06, 0xee6f86, -0.1, 0.17, 0.04, [0, 0, 0.28]);
    blob(h, 0.08, 0.2, 0.06, 0xee6f86, 0.1, 0.17, 0.04, [0, 0, -0.28]);
  } },
  daisy: { main: 0xffffff, h: 0.42, grab: 0.24, gy: 0.16, make(h) {
    const f = new THREE.Group(); f.position.y = 0.16; f.rotation.x = -0.5; h.add(f);
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Group(); p.rotation.z = i * Math.PI / 4; f.add(p);
      blob(p, 0.075, 0.16, 0.035, 0xffffff, 0, 0.17, 0, [0, 0, 0], 0.02);
    }
    blob(f, 0.11, 0.11, 0.07, 0xf2c744, 0, 0, 0.03);
  } },
  mushroom: { main: 0xe5584f, h: 0.16, grab: 0.28, gy: 0.14, make(h) {
    blob(h, 0.1, 0.16, 0.1, 0xf4ecd8, 0, 0.02, 0);
    blob(h, 0.3, 0.2, 0.3, 0xe5584f, 0, 0.14, 0);
    for (const [a, t] of [[0.3, 0.7], [2.0, 0.8], [3.6, 0.65], [4.8, 0.85], [1.1, 0.25]]) {
      blob(h, 0.06, 0.035, 0.06, 0xffffff, 0.3 * Math.sin(t) * Math.cos(a) * 0.96, 0.14 + 0.2 * Math.cos(t) * 0.96, 0.3 * Math.sin(t) * Math.sin(a) * 0.96, [0, 0, 0], 0.012);
    }
  } },
  star: { main: 0xffd34e, h: 0.42, grab: 0.26, gy: 0.18, make(h) {
    const sh = new THREE.Shape();
    for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.11 : 0.25, a = Math.PI / 2 + i * Math.PI / 5; const x = Math.cos(a) * r, y = Math.sin(a) * r; i ? sh.lineTo(x, y) : sh.moveTo(x, y); }
    sh.closePath();
    extr(h, sh, 0.06, 0.03, 0xffd34e, 0, 0.18, 0);
  } },
  flag: { main: 0xe86a5e, h: 0.6, grab: 0.2, gx: 0.2, gy: 0.14, make(h) {
    const sh = new THREE.Shape(); sh.moveTo(0, 0.28); sh.lineTo(0.46, 0.2); sh.lineTo(0.46, 0.0); sh.lineTo(0, 0.0); sh.closePath();
    extr(h, sh, 0.03, 0.02, 0xe86a5e, 0.02, -0.03, 0);
    blob(h, 0.05, 0.05, 0.05, 0xfff6d8, 0, 0.0, 0, [0, 0, 0], 0.02);
  } },
  heart: { main: 0xff7a98, h: 0.4, grab: 0.24, gy: 0.18, make(h) {
    const sh = new THREE.Shape();
    for (let i = 0; i <= 48; i++) { const t = i / 48 * Math.PI * 2; const x = 16 * Math.pow(Math.sin(t), 3) * 0.0135, y = (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * 0.0135; i ? sh.lineTo(x, y) : sh.moveTo(x, y); }
    extr(h, sh, 0.07, 0.03, 0xff7a98, 0, 0.17, 0);
  } },
  sakura: { main: 0xffc2d4, h: 0.36, grab: 0.28, gy: 0.18, make(h) {
    const cols = [0xffc2d4, 0xffc2d4, 0xffc2d4];
    [[0, 0.22, 0], [-0.15, 0.12, 0.03], [0.15, 0.13, -0.02], [-0.07, 0.3, -0.05], [0.09, 0.32, 0.05], [0.0, 0.1, 0.12]].forEach(([x, y, z], i) => blob(h, 0.13, 0.12, 0.13, cols[i % 3], x, y, z, [0, 0, 0], 0.022));
  } },
  leek: { main: 0x8cc87a, h: 0.12, grab: 0.22, gy: 0.28, make(h) {
    blob(h, 0.075, 0.12, 0.065, 0xf4f1e6, 0, 0.0, 0);
    blob(h, 0.05, 0.3, 0.04, 0x8cc87a, -0.06, 0.28, 0, [0, 0, 0.22]);
    blob(h, 0.05, 0.36, 0.04, 0x8cc87a, 0.01, 0.34, 0.02, [0, 0, -0.05]);
    blob(h, 0.05, 0.27, 0.04, 0x8cc87a, 0.09, 0.25, -0.01, [0, 0, -0.3]);
  } },
  // ---- 帽子・かざり
  tophat: { main: 0x2b2b33, nostem: true, h: 0.0, grab: 0.3, gy: 0.2, make(h) {
    lathe(h, [[0, -0.05], [0.34, -0.05], [0.36, -0.03], [0.34, 0.0], [0.2, 0.02], [0.19, 0.3], [0.17, 0.34], [0, 0.35]], 0x2b2b33);
    lathe(h, [[0.19, 0.03], [0.205, 0.035], [0.205, 0.11], [0.19, 0.115]], 0xc0392b, 0, 0, 0, 0.012);
  } },
  party: { main: 0xff8fb1, nostem: true, h: 0.0, grab: 0.28, gy: 0.2, make(h) {
    lathe(h, [[0, 0.52], [0.04, 0.46], [0.21, 0.0], [0.23, -0.04], [0, -0.04]], 0xff8fb1);
    blob(h, 0.07, 0.07, 0.07, 0xffe36e, 0, 0.53, 0, [0, 0, 0], 0.018);
  } },
  crown: { main: 0xf2c744, nostem: true, h: 0.0, grab: 0.28, gy: 0.15, make(h) {
    lathe(h, [[0.2, -0.04], [0.26, -0.04], [0.27, -0.02], [0.27, 0.1], [0.26, 0.12], [0.2, 0.12], [0.19, 0.1], [0.19, -0.02]], 0xf2c744);
    for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; cone(h, 0.055, 0.17, 0xf2c744, Math.cos(a) * 0.23, 0.1, Math.sin(a) * 0.23); }
    blob(h, 0.04, 0.04, 0.04, 0xe5584f, 0, 0.04, 0.27, [0, 0, 0], 0.012);
  } },
  beanie: { main: 0x5aa9e6, nostem: true, h: 0.0, grab: 0.3, gy: 0.14, make(h) {
    blob(h, 0.3, 0.24, 0.3, 0x5aa9e6, 0, 0.06, 0);
    lathe(h, [[0.27, -0.05], [0.32, -0.05], [0.33, -0.02], [0.33, 0.07], [0.32, 0.1], [0.27, 0.1]], 0xf4f1e6);
    blob(h, 0.08, 0.08, 0.08, 0xf4f1e6, 0, 0.32, 0, [0, 0, 0], 0.018);
  } },
  straw: { main: 0xe8cf8a, nostem: true, h: 0.0, grab: 0.34, gy: 0.1, make(h) {
    lathe(h, [[0, -0.03], [0.52, -0.03], [0.54, -0.005], [0.5, 0.02], [0.22, 0.04], [0.2, 0.15], [0.15, 0.2], [0, 0.21]], 0xe8cf8a);
    lathe(h, [[0.205, 0.04], [0.215, 0.045], [0.215, 0.09], [0.205, 0.095]], 0xd9534f, 0, 0, 0, 0.01);
  } },
  chef: { main: 0xffffff, nostem: true, h: 0.0, grab: 0.3, gy: 0.22, make(h) {
    lathe(h, [[0, -0.05], [0.2, -0.05], [0.21, -0.03], [0.21, 0.15], [0, 0.15]], 0xffffff);
    [[-0.12, 0.3, 0], [0.12, 0.3, 0], [0, 0.34, 0.1], [0, 0.34, -0.1], [0, 0.4, 0]].forEach(([x, y, z]) => blob(h, 0.15, 0.14, 0.15, 0xffffff, x, y, z, [0, 0, 0], 0.02));
  } },
  bow: { main: 0xff6b9a, nostem: true, h: 0.0, grab: 0.26, gy: 0.08, make(h) {
    blob(h, 0.17, 0.1, 0.05, 0xff6b9a, -0.16, 0.06, 0, [0, 0, 0.3], 0.02);
    blob(h, 0.17, 0.1, 0.05, 0xff6b9a, 0.16, 0.06, 0, [0, 0, -0.3], 0.02);
    blob(h, 0.07, 0.07, 0.06, 0xff6b9a, 0, 0.05, 0.01, [0, 0, 0], 0.02);
  } },
};

// ================= んちょめちょぽ（芽の生えたおもち） =================
function buildMebae() {
  // 目：たて長の楕円、ふちは茶色・中はピーチ
  const fillMat = new THREE.MeshBasicMaterial({ color: 0xf0c6a4, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const openEyes = [], closedEyes = [];
  for (const cx of [-0.43, 0.43]) {
    const cy = 0.42, rx = 0.095, ry = 0.135;
    const ring = [];
    for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2; ring.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); }
    const ringMesh = strokeOnFace(ring, 0.027, 0.034, true);
    face.add(ringMesh); openEyes.push(ringMesh);
    // 中の色：体の曲面にぴったり沿う楕円メッシュ（上の方も沈まない）
    const RINGS = 10, SEG = 48, verts = [], idx = [];
    const dome = k => 0.024 + 0.016 * Math.sqrt(Math.max(1 - k * k, 0));   // 中央が少しふくらんだ厚み
    verts.push(...onFront(cx, cy, dome(0)).toArray());
    for (let r = 1; r <= RINGS; r++) {
      const k = r / RINGS;
      for (let i = 0; i < SEG; i++) {
        const a = i / SEG * Math.PI * 2;
        verts.push(...onFront(cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k, dome(k)).toArray());
      }
    }
    for (let i = 0; i < SEG; i++) idx.push(0, 1 + i, 1 + (i + 1) % SEG);
    for (let r = 1; r < RINGS; r++) {
      const o0 = 1 + (r - 1) * SEG, o1 = 1 + r * SEG;
      for (let i = 0; i < SEG; i++) {
        const j = (i + 1) % SEG;
        idx.push(o0 + i, o1 + i, o1 + j, o0 + i, o1 + j, o0 + j);
      }
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    fg.setIndex(idx);
    const fill = new THREE.Mesh(fg, fillMat);
    fill.userData.deform = true;   // ふちと同じく頂点ごとに伸びる
    face.add(fill); openEyes.push(fill);
    // 閉じた目（すやすや用）：下向きにまるい「︶」
    const shut = strokeOnFace([[cx - 0.1, cy + 0.005], [cx - 0.05, cy - 0.032], [cx, cy - 0.045], [cx + 0.05, cy - 0.032], [cx + 0.1, cy + 0.005]], 0.026, 0.02);
    shut.visible = false;
    face.add(shut); closedEyes.push(shut);
  }
  // 口：ちょんと短い線
  const mouthN = strokeOnFace([[-0.055, 0.305], [0, 0.305], [0.055, 0.305]], 0.02, 0.018);   // まっすぐ
  face.add(mouthN);
  // うれしい用：両はしがほんの少しだけ上がる
  const mouthS = strokeOnFace([[-0.06, 0.322], [-0.03, 0.305], [0, 0.3], [0.03, 0.305], [0.06, 0.322]], 0.02, 0.018);
  mouthS.visible = false; face.add(mouthS);

  // 芽（植え替えできる）：根もとのグループ(sprout)は体のこの場所に固定。中身(plant)を差し替える
  const top = onTop(0, 0.05);
  const sprout = new THREE.Group();
  sprout.position.copy(top.p);
  squish.add(sprout);

  let plant = null, stem, stemBase, head, grabBall, leaves = [], JUNC = new THREE.Vector3(), stemH = 0.3, kindNow = 'grass';
  const sp = { held: false, off: new THREE.Vector3(), vel: new THREE.Vector3(), inv: new THREE.Matrix4(),
               startW: new THREE.Vector3(), plane: new THREE.Plane(), bend: new THREE.Vector3(), active: false,
               mode: 'on', t: 0, fvel: new THREE.Vector3(), spin: new THREE.Vector3() };
  const MAX = 0.6;
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  function setPlant(k) {
    if (plant) { sprout.remove(plant); plant.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    const def = PLANTS[k]; kindNow = k;
    plant = new THREE.Group(); sprout.add(plant);
    stemH = def.h;
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.08, 0), new THREE.Vector3(0.01, stemH * 0.4, 0), new THREE.Vector3(0, stemH, 0)]);
    stem = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.032, 10, false), inkMat);
    plant.add(stem);
    stemBase = Float32Array.from(stem.geometry.attributes.position.array);
    JUNC.set(0, stemH, 0);
    head = new THREE.Group(); head.position.copy(JUNC); plant.add(head);
    const built = def.make(head);
    head.traverse(o => { if (o.isMesh && o.material.isMeshToonMaterial && o.material.color.getHex() === def.main) o.material.userData.main = true; });
    stem.visible = !def.nostem;
    leaves = (built && built.leaves) || [];
    grabBall = new THREE.Mesh(new THREE.SphereGeometry(def.grab, 16, 12), hitMat);
    grabBall.position.set(def.gx || 0, def.gy || 0, 0);
    head.add(grabBall);
    plant.traverse(o => { o.frustumCulled = false; });
    sw.f = 0; sw.fv = 0;
    if (itemCol !== null) tintMain(itemCol, itemAll);
  }
  function tintMain(hex, all) { head.traverse(o => { if (o.isMesh && o.material.isMeshToonMaterial) { const m = o.material; if (m.userData.orig === undefined) m.userData.orig = m.color.getHex(); m.color.setHex(all || m.userData.main ? hex : m.userData.orig); } }); }
  function applyStretch(o) {
    // 茎：根元は動かず、上へいくほど大きく動く（先端＝つまんだ所が指についてくる）
    const A = stem.geometry.attributes.position.array;
    for (let j = 0; j < A.length; j += 3) {
      const t = THREE.MathUtils.clamp((stemBase[j + 1] + 0.08) / (stemH + 0.08), 0, 1);
      const w = t * t * (3 - 2 * t);
      A[j] = stemBase[j] + o.x * w; A[j + 1] = stemBase[j + 1] + o.y * w; A[j + 2] = stemBase[j + 2] + o.z * w;
    }
    stem.geometry.attributes.position.needsUpdate = true;
    stem.geometry.computeVertexNormals();
    head.position.copy(JUNC).add(o);       // 頭（葉・花など）と判定はつけ根ごと移動
  }
  function pluck(dirW) {
    applyStretch(new THREE.Vector3());
    sp.held = false; sp.active = false; sp.off.set(0, 0, 0); sp.vel.set(0, 0, 0); sp.bend.set(0, 0, 0);
    scene.attach(sprout);                                    // 茎ごと体から抜ける
    sp.mode = 'fly'; sp.t = 0;
    const d = dirW.lengthSq() > 1e-6 ? dirW.clone().normalize() : new THREE.Vector3(0, 1, 0);
    sp.fvel.copy(d).multiplyScalar(0.6).add(new THREE.Vector3(0, 2.2, 0));   // 上にぽんっと少しだけ
    sp.spin.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 8);
  }

  // 芽はゆれに少し遅れてゆらゆら
  const sw = { a: 0, v: 0, b: 0, bv: 0, f: 0, fv: 0 };
  setPlant('grass');
  return {
    mouths: [mouthN, mouthS],
    get root() { return sprout; },
    get leafMeshes() { return sp.mode === 'on' ? [grabBall] : []; },
    tint: tintMain,
    clear() { sp.held = false; sp.active = false; sp.off.set(0, 0, 0); sp.vel.set(0, 0, 0); if (sprout.parent) sprout.parent.remove(sprout); sp.mode = 'empty'; },
    get plantKind() { return sp.mode === 'empty' || sp.mode === 'fly' ? null : kindNow; },
    setEyesClosed(v) {
      if (closedEyes[0].visible === v) return;
      openEyes.forEach(m => m.visible = !v);
      closedEyes.forEach(m => m.visible = v);
    },
    dispose() { if (sprout.parent === scene) scene.remove(sprout); },
    // 好きなものを、抜けた穴（または今の草の場所）に挿す
    plant(k) {
      sp.held = false; sp.active = false; sp.off.set(0, 0, 0); sp.vel.set(0, 0, 0); sp.bend.set(0, 0, 0);
      if (sprout.parent) sprout.parent.remove(sprout);
      const r = riders.find(q => q.o === sprout);
      squish.add(sprout);
      if (r) sprout.position.fromArray(r.base); else sprout.position.copy(top.p);
      sprout.rotation.set(0, 0, 0);
      setPlant(k);
      sprout.scale.setScalar(0.001);
      sp.mode = 'grow'; sp.t = 0;
      sfx.sprout();
    },
    leafGrab(hit) {
      sp.held = true; sp.active = true;
      sp.inv.copy(sprout.matrixWorld).invert();                   // つかんだ瞬間の向きで固定
      sp.startW.copy(hit.point); sp.startOff = sp.off.clone();
      sp.vel.set(0, 0, 0);
      sp.plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()).negate(), hit.point);
      return true;
    },
    leafDrag(ray) {
      const p = ray.intersectPlane(sp.plane, new THREE.Vector3());
      if (!p) return;
      sp.bend.copy(p).sub(sp.startW);
      const o = p.clone().applyMatrix4(sp.inv).sub(sp.startW.clone().applyMatrix4(sp.inv)).add(sp.startOff);
      const L = o.length();
      if (L > 0) o.multiplyScalar(MAX * Math.tanh(L / MAX) / L);
      sp.off.copy(o);
      // 最大まで伸ばしたら、茎ごとぷちっと抜ける
      if (L > MAX * 1.5) {
        const dir = sp.bend.clone();
        pluck(dir);
        sw.fv += 8;
        spring.sqV += 3; spring.sxV += (Math.random() - 0.5) * 2;   // 体も反動でぷるん
        onPlucked();
        return { L: 0, plucked: true };
      }
      return { L: o.length(), plucked: false };
    },
    leafRelease() { sp.held = false; sp.bend.set(0, 0, 0); return sp.off.length(); },
    update(dt, st) {
      sp.t += dt;
      if (sp.mode === 'empty') return;
      if (sp.mode === 'fly') {
        // 上に少し飛んで、すぐしぼんで消える（あとは好きなものを挿す）
        if (sprout.parent === scene) {
          sp.fvel.y -= 6 * dt;
          sprout.position.addScaledVector(sp.fvel, dt);
          sprout.rotation.x += sp.spin.x * dt; sprout.rotation.y += sp.spin.y * dt; sprout.rotation.z += sp.spin.z * dt;
          if (sp.t > 0.25) sprout.scale.setScalar(Math.max(1 - (sp.t - 0.25) / 0.3, 0.001));
          if (sp.t > 0.55) { scene.remove(sprout); sp.mode = 'empty'; }
        }
        return;
      }
      if (sp.mode === 'grow') {
        const sc = 1 - Math.exp(-6 * sp.t) * Math.cos(11 * sp.t);     // にょきっ
        sprout.scale.setScalar(Math.max(sc, 0.001));
        if (sp.t >= 0.9) { sprout.scale.setScalar(1); sp.mode = 'on'; sw.fv += 3; }
      }
      // のびよ〜ん（離したら行きすぎながら戻る）
      if (sp.active) {
        if (!sp.held) {
          const acc = sp.off.clone().multiplyScalar(-160).addScaledVector(sp.vel, -6);
          sp.vel.addScaledVector(acc, dt); sp.off.addScaledVector(sp.vel, dt);
        }
        applyStretch(sp.off);
        if (!sp.held && sp.off.length() < 0.002 && sp.vel.length() < 0.01) { applyStretch(new THREE.Vector3()); sp.active = false; sp.off.set(0, 0, 0); }
      }
      const k = 60, d = 3.2;
      const tgtA = -st.shx * 3.0 - st.pullX * 0.5, tgtB = st.shz * 3.0;
      sw.v += (-k * (sw.a - tgtA) - d * sw.v) * dt; sw.a += sw.v * dt;
      sw.bv += (-k * (sw.b - tgtB) - d * sw.bv) * dt; sw.b += sw.bv * dt;
      const tgtF = (st.sy - 1) * -2.2 + st.vy * -0.05;     // 伸び縮み・ジャンプでぱたぱた
      sw.fv += (-90 * (sw.f - tgtF) - 4 * sw.fv) * dt; sw.f += sw.fv * dt;
      sprout.rotation.z = THREE.MathUtils.clamp(sw.a, -0.8, 0.8);
      sprout.rotation.x = THREE.MathUtils.clamp(sw.b, -0.8, 0.8);
      if (leaves.length) for (const l of leaves) l.rotation.z = l.userData.side * (0.28 + THREE.MathUtils.clamp(sw.f, -0.5, 0.6));
      else head.rotation.z = THREE.MathUtils.clamp(sw.f, -0.5, 0.6) * 0.35;
    },
    kickLeaves(v) { sw.fv += v; sw.v += (Math.random() - 0.5) * v * 0.6; },
  };
}



// ---- 表面バインド：顔や耳を「体の表面のどこにいるか」で覚えて、体が伸びてもその場所に貼りつけ続ける
const KNN = 4;
let baseNrm, baseR, elevMax, hash, shapeN;
function prepSurface(sh) {
  shapeN = { A: sh.A, B: sh.B, C: sh.C };
  baseNrm = Float32Array.from(bodyGeo.attributes.normal.array);
  const n = basePos.length / 3;
  // 体の「この方向ならここまでは体の外側」という殻（めり込み防止用）
  baseR = new Float32Array(n);
  elevMax = new Float32Array(90).fill(0);
  for (let i = 0; i < n; i++) {
    const x = basePos[i * 3] / sh.A, y = basePos[i * 3 + 1] / sh.B, z = basePos[i * 3 + 2] / sh.C;
    const r = Math.hypot(x, y, z); baseR[i] = r;
    const b = Math.min(89, Math.max(0, Math.floor((Math.asin(THREE.MathUtils.clamp(y / r, -1, 1)) / Math.PI + 0.5) * 90)));
    elevMax[b] = Math.max(elevMax[b], r);
  }
  // 近傍探索用ハッシュ
  hash = new Map();
  for (let i = 0; i < n; i++) {
    const k = cellKey(basePos[i * 3], basePos[i * 3 + 1], basePos[i * 3 + 2]);
    (hash.get(k) || hash.set(k, []).get(k)).push(i);
  }
}
const CELL = 0.1;
function cellKey(x, y, z) { return (Math.floor(x / CELL) + 512) * 1048576 + (Math.floor(y / CELL) + 512) * 1024 + (Math.floor(z / CELL) + 512); }
function nearest(x, y, z) {
  for (let R = 1; R <= 6; R++) {
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL), cz = Math.floor(z / CELL);
    const found = [];
    for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) for (let k = -R; k <= R; k++) {
      const arr = hash.get((cx + i + 512) * 1048576 + (cy + j + 512) * 1024 + (cz + k + 512));
      if (arr) for (const v of arr) {
        const dx = basePos[v * 3] - x, dy = basePos[v * 3 + 1] - y, dz = basePos[v * 3 + 2] - z;
        found.push([dx * dx + dy * dy + dz * dz, v]);
      }
    }
    if (found.length >= KNN) { found.sort((a, b) => a[0] - b[0]); return found.slice(0, KNN); }
  }
  return null;
}
// 点の配列（xyz並び）をバインド
function bindPoints(pts) {
  const n = pts.length / 3;
  const idx = new Int32Array(n * KNN), wt = new Float32Array(n * KNN), h = new Float32Array(n), n0 = new Float32Array(n * 3);
  const anc = new Float32Array(n * 3), ar = new Float32Array(n), mk = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    const x = pts[p * 3], y = pts[p * 3 + 1], z = pts[p * 3 + 2];
    const nb = nearest(x, y, z);
    let sw = 0, px = 0, py = 0, pz = 0, nx = 0, ny = 0, nz = 0;
    nb.forEach(([d2, v], k) => { const w = 1 / (d2 + 1e-3); sw += w; idx[p * KNN + k] = v; wt[p * KNN + k] = w; });
    for (let k = 0; k < KNN; k++) {
      const v = idx[p * KNN + k], w = (wt[p * KNN + k] /= sw);
      px += basePos[v * 3] * w; py += basePos[v * 3 + 1] * w; pz += basePos[v * 3 + 2] * w;
      nx += baseNrm[v * 3] * w; ny += baseNrm[v * 3 + 1] * w; nz += baseNrm[v * 3 + 2] * w;
    }
    for (let k = 0; k < KNN; k++) mk[p] += wt[p * KNN + k] * (faceMask ? faceMask[idx[p * KNN + k]] : 0);
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    n0[p * 3] = nx; n0[p * 3 + 1] = ny; n0[p * 3 + 2] = nz;
    const hh = (x - px) * nx + (y - py) * ny + (z - pz) * nz;
    h[p] = hh;
    // 表面上の足場（点から法線方向に表面へ下ろした位置）
    const ax = x - nx * hh, ay = y - ny * hh, az = z - nz * hh;
    anc[p * 3] = ax; anc[p * 3 + 1] = ay; anc[p * 3 + 2] = az;
    ar[p] = Math.hypot(ax / shapeN.A, ay / shapeN.B, az / shapeN.C);
  }
  return { n, idx, wt, h, n0, anc, ar, mk };
}
// 足場を体と同じ式で動かし、そこから「今の法線方向」に元の高さぶん浮かせる → 体と一緒になめらかに伸びる
function evalBind(b, base, out, withNormal = true) {
  const N = bodyGeo.attributes.normal.array;
  for (let p = 0; p < b.n; p++) {
    const j = p * 3;
    const d = deformPoint(b.anc[j], b.anc[j + 1], b.anc[j + 2], b.ar[p], b.mk[p]);
    let x = d[0] - b.anc[j], y = d[1] - b.anc[j + 1], z = d[2] - b.anc[j + 2];   // 足場の移動量
    if (withNormal) {
      let nx = 0, ny = 0, nz = 0;
      for (let k = 0; k < KNN; k++) {
        const v = b.idx[p * KNN + k] * 3, w = b.wt[p * KNN + k];
        nx += N[v] * w; ny += N[v + 1] * w; nz += N[v + 2] * w;
      }
      const nl = Math.hypot(nx, ny, nz) || 1, hh = b.h[p];
      x += (nx / nl - b.n0[j]) * hh; y += (ny / nl - b.n0[j + 1]) * hh; z += (nz / nl - b.n0[j + 2]) * hh;
      // 表面にもぐらないように：体の表面から最低限うかせる（目や口が消えない）
      if (hh > 0.004) {
        const PP = bodyGeo.attributes.position.array, ex = base[j] + x, ey = base[j + 1] + y, ez = base[j + 2] + z;
        let sd = 0;
        for (let k = 0; k < KNN; k++) { const v = b.idx[p * KNN + k] * 3, w = b.wt[p * KNN + k]; sd += w * ((ex - PP[v]) * N[v] + (ey - PP[v + 1]) * N[v + 1] + (ez - PP[v + 2]) * N[v + 2]); }
        const want = 0.8 * hh;
        if (sd < want) { const d = (want - sd) / nl; x += nx * d; y += ny * d; z += nz * d; }
      }
    }
    out[j] = base[j] + x; out[j + 1] = base[j + 1] + y; out[j + 2] = base[j + 2] + z;
  }
}
const _tmp3 = new Float32Array(3);

// 体の変形を「なめらかな関数」として共通化（体の頂点も顔パーツも同じ式で動かす → ずれない）
const DF = { ox: 0, oy: 0, oz: 0, gx: 0, gy: 0, gz: 0, sig2: 1, sideK: 0, shell: 1 };
const _d = [0, 0, 0];
function deformPoint(bx, by, bz, rBase, mask = 0) {
  const dx = bx - DF.gx, dy = by - DF.gy, dz = bz - DF.gz, d2 = dx * dx + dy * dy + dz * dz;
  const plant = Math.min(Math.max((by - floorY) / 0.35, 0), 1);              // 底は床にくっついたまま
  const front = Math.min(Math.max(bz / shapeN.C, 0), 1);                     // 横に引くと正面（顔）を少し広めに
  const w = Math.max(Math.exp(-d2 / DF.sig2), Math.exp(-d2 / (DF.sig2 * 1.8)) * 0.35 * DF.sideK * front) * plant * (1 - PROT * mask);
  let x = bx + DF.ox * w, y = by + DF.oy * w, z = bz + DF.oz * w;
  if (w > 1e-4) {
    // めり込み防止：元の体の殻より内側に入った点は外へ押し戻す
    const xn = x / shapeN.A, yn = y / shapeN.B, zn = z / shapeN.C, r = Math.hypot(xn, yn, zn) || 1e-6;
    const bin = Math.min(89, Math.max(0, Math.floor((Math.asin(THREE.MathUtils.clamp(yn / r, -1, 1)) / Math.PI + 0.5) * 90)));
    const rMin = Math.min(elevMax[bin], rBase * 1.2) * 0.985 * DF.shell;
    if (r < rMin) { const k = rMin / r; x *= k; y *= k; z *= k; }
    // 床より下には絶対に出さない（輪郭線のぶんも少しすき間をあける）
    const minY = floorY + 0.04 * Math.min(w * 3, 1);
    if (y < minY) y = minY;
  }
  _d[0] = x; _d[1] = y; _d[2] = z;
  return _d;
}

const CHARS = {
  neko: {
    name: 'ぬおん',
    brow: { x: 0.07, tilt: 0, y0: 0.42, y1: 0.5 },
    ink: 0x3a3aa8, inkCss: '#3a3aa8', body: 0xfbf8ef, grad: [200, 232, 250, 255],
    shape: { A: 1.45, B: 0.98, C: 1.15, FLOOR: -0.45, flat: 0.32, skirt: 0.16, dome: 0.035 },
    build: buildNeko,
  },
  mebae: {
    name: 'んちょめちょぽ',
    brow: { x: 0.07, tilt: 0, y0: 0.54, y1: 0.62 },
    ink: 0x5b3a2e, inkCss: '#5b3a2e', body: 0xffffff, grad: [190, 228, 250, 255],
    shape: { A: 1.42, B: 1.15, C: 1.25, FLOOR: -0.3, flat: 0.3, skirt: 0.1, dome: 0.05 },
    // 色えんぴつっぽいグラデーション：上・正面は明るいクリーム、下と左はグレージュ
    color(x, y, z, fy, c) {
      const h = THREE.MathUtils.clamp((y - fy) / 1.75, 0, 1);
      const front = Math.max(z / 1.25, 0);
      const left = Math.max(-x / 1.42, 0);
      const t = THREE.MathUtils.clamp(0.15 + h * 0.75 + front * 0.35 - left * 0.25, 0, 1);
      c.setRGB(0.66, 0.6, 0.53).lerp(new THREE.Color(0.96, 0.945, 0.88), t);
    },
    build: buildMebae,
  },
};

function buildCharacter(key, opts = {}) {
  const c = CHARS[key] || CHARS.neko;
  if (!curInst) { curInst = { cat }; insts.push(curInst); }
  if (current && current.rt && current.rt.dispose) current.rt.dispose();
  current = c; curKey = key;
  undoStack = []; gs = { x: 1, y: 1, z: 1 }; flashT = -1;
  // 状態リセット
  pull.active = pull.held = false; pull.off.set(0, 0, 0); pull.vel.set(0, 0, 0); pullLift = 0;
  jump.phase = 'idle'; jump.y = 0; jump.vy = 0;
  for (const k in spring) spring[k] = 0;
  controls.enabled = true;
  leafDrag = false;
  if (squish) { cat.remove(squish); squish.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
  outlines = outlines.filter(attached);

  // 色
  INK = c.ink;
  grad.image.data.set(c.grad); grad.needsUpdate = true;
  bodyMat = new THREE.MeshToonMaterial({ color: c.body, gradientMap: grad, vertexColors: true });
  inkMat = new THREE.MeshBasicMaterial({ color: c.ink, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });

  // 組み立て（シーンに入れる前に原点で作る）
  squish = new THREE.Group();
  squish.matrixAutoUpdate = false;
  const made = makeBody(c.shape, c.color);
  bodyGeo = made.geo; floorY = made.floorY;
  colorBase = Float32Array.from(bodyGeo.attributes.color.array); scorch = new Float32Array(bodyGeo.attributes.position.count);
  bodyCol = c.body; itemCol = null;
  body = withOutline(new THREE.Mesh(bodyGeo, bodyMat), 0.04);
  body.receiveShadow = false; body.userData.inst = curInst;
  squish.add(body);
  face = new THREE.Group();
  squish.add(face);
  current.rt = c.build() || {};
  // 眉間のシワ（ぷんぷん用）：短い線2本、ふだんは隠しておく
  {
    const b = c.brow, brows = [];
    for (const side of [-1, 1]) {
      const m = strokeOnFace([[side * b.x, b.y0], [side * (b.x - b.tilt), b.y1]], 0.02, 0.016);
      m.visible = false; face.add(m); brows.push(m);
    }
    const [mN, mS] = current.rt.mouths;
    current.rt.setSmile = v => { if (mS.visible !== v) { mS.visible = v; mN.visible = !v; } };
    current.rt.setBrow = v => { if (brows[0].visible !== v) brows.forEach(m => m.visible = v); };
  }

  basePos = Float32Array.from(bodyGeo.attributes.position.array);
  pos = bodyGeo.attributes.position;
  ovD = new Float32Array(basePos.length);

  // 耳・芽・肉球・顔は「体の表面の場所」にバインドして、伸びても表面に貼りついたままにする
  prepSurface(c.shape);
  squish.updateMatrixWorld(true);
  riders = []; faceVerts = []; faceCaps = [];
  {   // 顔のパーツ（目・口・鼻）の近くの体は、引っぱっても形をたもつ
    const pts = [];
    face.traverse(o => {
      if (!o.isMesh) return;
      if (o.geometry.type === 'TubeGeometry' || o.userData.deform) { const a = o.geometry.attributes.position.array; for (let i = 0; i < a.length; i += 24) pts.push(a[i], a[i + 1], a[i + 2]); }
      else pts.push(o.position.x, o.position.y, o.position.z);
    });
    const n = basePos.length / 3, R2 = 2 * 0.26 * 0.26;
    faceMask = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = basePos[i * 3], y = basePos[i * 3 + 1], z = basePos[i * 3 + 2];
      let m = 0;
      for (let q = 0; q < pts.length; q += 3) { const dx = x - pts[q], dy = y - pts[q + 1], dz = z - pts[q + 2], d2 = dx * dx + dy * dy + dz * dz; if (d2 < 0.9) { const e = Math.exp(-d2 / R2); if (e > m) m = e; } }
      faceMask[i] = Math.min(1, m * 1.4);
    }
  }
  for (const o of squish.children.filter(x => x !== body && x !== face)) {
    const ctr = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
    riders.push({ o, base: Float32Array.from([o.position.x, o.position.y, o.position.z]), ctr: ctr.toArray(), bind: bindPoints(ctr.toArray()) });
  }
  face.traverse(o => {
    if (!o.isMesh) return;
    if (o.geometry.type === 'TubeGeometry' || o.userData.deform) {
      const base = Float32Array.from(o.geometry.attributes.position.array);
      faceVerts.push({ attr: o.geometry.attributes.position, base, bind: bindPoints(base) });
    } else {
      const base = Float32Array.from(o.position.toArray());
      faceCaps.push({ o, base, bind: bindPoints(base) });
    }
  });

  squish.traverse(o => { o.frustumCulled = false; });
  bodyGeo.computeBoundingSphere();
  lift = -floorY + 0.006;
  cat.add(squish);
  cat.position.y = lift;
  if (!opts.keep) controls.target.y = lift + (c.shape.B - lift) * 0.5 - 0.4;
  computeBound();

  applyCharUI(c, key);
  if (typeof anim !== 'undefined' && anim.on) controls.enabled = false;
  try { localStorage.setItem('mochi-char', key); } catch (e) {}
  syncInst();
}
for (const k in CHARS) document.getElementById('ch-' + k).onclick = () => { if (CHARS[k] !== current) { buildCharacter(k); sfx.poke(); spring.sqV = -3; } };

// 地面（影だけ受ける）
const ground = new THREE.Mesh(new THREE.CircleGeometry(14, 96), new THREE.ShadowMaterial({ opacity: 0.12 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// ---- UI
const spinBtn = document.getElementById('spin');
spinBtn.onclick = () => { controls.autoRotate = !controls.autoRotate; spinBtn.classList.toggle('on', controls.autoRotate); };
const lineBtn = document.getElementById('line');
lineBtn.onclick = () => { lineOn = !lineOn; outlines.forEach(o => o.visible = lineOn); pedOutlines.forEach(o => o.visible = lineOn); lineBtn.classList.toggle('on', lineOn); };


// ---- 効果音（Web Audio で合成）
const sfx = (() => {
  let ac = null, on = true, master, stretchOsc, stretchGain, stretchLfo;
  function ensure() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return ac; }
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
    master = ac.createGain(); master.gain.value = 0.55; master.connect(ac.destination);
    // 引っ張り中の「むにょ〜ん」
    stretchOsc = ac.createOscillator(); stretchOsc.type = 'triangle'; stretchOsc.frequency.value = 160;
    stretchLfo = ac.createOscillator(); stretchLfo.frequency.value = 7;
    const lfoAmt = ac.createGain(); lfoAmt.gain.value = 6;
    stretchLfo.connect(lfoAmt).connect(stretchOsc.frequency);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
    stretchGain = ac.createGain(); stretchGain.gain.value = 0;
    stretchOsc.connect(lp).connect(stretchGain).connect(master);
    stretchOsc.start(); stretchLfo.start();
    return ac;
  }
  function tone({ f0, f1, dur, type = 'sine', vol = 0.3, vib = 0, vibRate = 0 }) {
    if (!on || !ensure()) return;
    const t = ac.currentTime;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    if (vib) {
      const l = ac.createOscillator(), la = ac.createGain();
      l.frequency.value = vibRate; la.gain.setValueAtTime(vib, t); la.gain.exponentialRampToValueAtTime(0.01, t + dur);
      l.connect(la).connect(o.frequency); l.start(t); l.stop(t + dur);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  return {
    unlock: ensure,
    set enabled(v) { on = v; if (!v && stretchGain) stretchGain.gain.value = 0; },
    get enabled() { return on; },
    grab()  { tone({ f0: 520, f1: 260, dur: 0.09, vol: 0.28 }); },                     // ぷにっ
    boing(amount) {                                                                     // ぽよよ〜ん
      const base = 330 - Math.min(amount, 2) * 70;
      tone({ f0: base * 0.7, f1: base * 1.25, dur: 0.55 + amount * 0.2, vol: 0.32, vib: base * 0.22, vibRate: 11 });
    },
    poke()  { tone({ f0: 700, f1: 380, dur: 0.07, vol: 0.25 }); setTimeout(() => this.boing(0.4), 60); },
    hop()   { tone({ f0: 260, f1: 820, dur: 0.18, vol: 0.26 }); },                        // ぴょんっ
    thud(k) { tone({ f0: 120, f1: 55, dur: 0.22, vol: Math.min(0.25 + k * 0.08, 0.6) });     // どすっ（＋ぽよん）
              tone({ f0: 1200, f1: 600, dur: 0.05, type: 'triangle', vol: 0.05 });
              setTimeout(() => this.boing(0.3 + k * 0.08), 40); },
    pluck() { tone({ f0: 1400, f1: 500, dur: 0.06, type: 'triangle', vol: 0.3 });           // ぷちっ
              setTimeout(() => tone({ f0: 900, f1: 300, dur: 0.12, vol: 0.2 }), 30); },
    sprout(){ tone({ f0: 320, f1: 980, dur: 0.16, vol: 0.24 });                                // にょきっ
              setTimeout(() => tone({ f0: 700, f1: 1100, dur: 0.1, vol: 0.16 }), 120); },
    hopSoft() { tone({ f0: 420, f1: 640, dur: 0.09, vol: 0.1 }); },                         // ぴょっ
    plop()  { tone({ f0: 300, f1: 190, dur: 0.09, vol: 0.12 }); },                        // ぽよっ
    step(p) { tone({ f0: 360 * p, f1: 300 * p, dur: 0.07, vol: 0.1 }); },                 // とんっ
    whoosh(){ tone({ f0: 220, f1: 900, dur: 0.5, type: 'triangle', vol: 0.12, vib: 40, vibRate: 18 }); }, // ひゅるん
    melt()  { tone({ f0: 520, f1: 180, dur: 1.6, vol: 0.1, vib: 18, vibRate: 5 }); },     // ふにゃ〜
    pon()   { tone({ f0: 240, f1: 900, dur: 0.12, vol: 0.25 }); },                         // ぽんっ
    surprise() { tone({ f0: 500, f1: 1500, dur: 0.12, vol: 0.22 }); setTimeout(() => tone({ f0: 1300, f1: 1100, dur: 0.18, vol: 0.12, vib: 120, vibRate: 30 }), 110); }, // ビクッ
    bow()   { tone({ f0: 620, f1: 420, dur: 0.12, vol: 0.14 }); },                         // ぺこっ
    shake() { tone({ f0: 300, f1: 260, dur: 0.9, type: 'triangle', vol: 0.12, vib: 60, vibRate: 30 }); },   // ぶるるるっ
    puff()  { tone({ f0: 200, f1: 420, dur: 0.5, vol: 0.12 }); },                                           // ぷくーっ
    stomp() { tone({ f0: 160, f1: 80, dur: 0.1, vol: 0.28 }); },                                            // ドン
    deflate(){ tone({ f0: 700, f1: 200, dur: 0.8, type: 'triangle', vol: 0.08, vib: 30, vibRate: 22 }); },  // ぷしゅ〜
    yawn()  { tone({ f0: 260, f1: 520, dur: 1.3, vol: 0.09, vib: 10, vibRate: 5 }); },                     // ん〜〜
    land()  { tone({ f0: 140, f1: 70, dur: 0.16, vol: 0.4 }); tone({ f0: 900, f1: 500, dur: 0.05, type: 'triangle', vol: 0.06 }); }, // ぽふっ
    stretch(len, speed) {                                                               // 引っ張り中
      if (!ac || !stretchGain) return;
      const t = ac.currentTime;
      const v = on ? Math.min(speed * 0.08, 0.16) * Math.min(len * 1.5, 1) : 0;
      stretchGain.gain.setTargetAtTime(v, t, 0.05);
      stretchOsc.frequency.setTargetAtTime(150 + len * 110, t, 0.05);
    },
  };
})();
const sndBtn = document.getElementById('snd');
sndBtn.onclick = () => { sfx.unlock(); sfx.enabled = !sfx.enabled; sndBtn.classList.toggle('on', sfx.enabled); };

// ---- リサイズ & ループ
// 表示サイズが変わったら（読み込み直後に枠が広がる時も）すぐ合わせる
let cw = 0, ch = 0;
function resize() {
  const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
  if (w === cw && h === ch) return;
  cw = w; ch = h;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w / h < 1 ? Math.min(72, 35 / Math.pow(w / h, 0.85)) : 35;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
try { new ResizeObserver(resize).observe(canvas); } catch (e) {}
resize();

const clock = new THREE.Clock();

// ---- ぷにぷに物理（ばね）
// squash: 縦つぶれ量, sway: 横ゆれ(せん断), dent: 押されたへこみ
const spring = { sq: 0, sqV: 0, sx: 0, sxV: 0, sz: 0, szV: 0 };
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();

// 引っ張り：つかんだ点・引っ張り量(ローカル)・速度
const pull = { active: false, held: false, grab: new THREE.Vector3(), off: new THREE.Vector3(), vel: new THREE.Vector3(),
               plane: new THREE.Plane(), startW: new THREE.Vector3() };

function setNdc(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
}
let leafDrag = false, waitUp = false, pl = false;
const _tri = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], _bc = new THREE.Vector3();
// アイテムを、さわった体の表面の場所へ移して固定する
function placeItem() {
  const h = ray.intersectObject(body, false)[0]; if (!h) return;
  const r = riders.find(q => q.o === current.rt.root); if (!r) return;
  const f = h.face, P = pos.array, lp = body.worldToLocal(h.point.clone());
  [f.a, f.b, f.c].forEach((v, i) => _tri[i].set(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]));
  THREE.Triangle.getBarycoord(lp, _tri[0], _tri[1], _tri[2], _bc);
  const w = [_bc.x, _bc.y, _bc.z], idx = [f.a, f.b, f.c], b = [0, 0, 0];
  for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) b[k] += basePos[idx[i] * 3 + k] * w[i];
  r.base.set(b); r.ctr = b.slice(); r.bind = bindPoints(r.ctr);
  evalBind(r.bind, r.base, _tmp3, false); r.o.position.fromArray(_tmp3);
}
canvas.addEventListener('pointerdown', e => {
  if (anim.on || mode === 'camera') return;               // 鑑賞中・カメラモード中は引っぱらない
  setNdc(e);
  {   // 重なっている中から、さわった子を選ぶ
    const vis = insts.filter(i => i.cat.visible);
    if (vis.length > 1) { const hh = ray.intersectObjects(vis.map(i => i.body), false)[0]; if (hh && hh.object.userData.inst !== curInst) selectInst(hh.object.userData.inst); }
  }
  if (mode === 'place') {
    if (!current.rt.leafMeshes.length) { toast('No item to move · plant one first'); return; }
    if (!ray.intersectObject(body, false)[0]) return;
    pushUndo(); pl = true; controls.enabled = false; sfx.grab(); canvas.setPointerCapture(e.pointerId);
    placeItem(); return;
  }
  if (mode === 'move') {
    if (stageOn) { toast('Turn STAGE off to move'); return; }
    if (!ray.intersectObject(body, false)[0]) return;
    const p = ray.ray.intersectPlane(floorPlane, new THREE.Vector3()); if (!p) return;
    mv = { dx: cat.position.x - p.x, dz: cat.position.z - p.z };
    controls.enabled = false; sfx.grab(); canvas.setPointerCapture(e.pointerId);
    return;
  }
  // んちょめちょぽの葉っぱを先に判定
  const rt = current.rt;
  if (rt.leafMeshes) {
    const lh = ray.intersectObjects(rt.leafMeshes, false)[0];
    const bh = ray.intersectObject(body, false)[0];
    if (lh && (!bh || lh.distance <= bh.distance) && rt.leafGrab(lh)) {
      leafDrag = true;
      controls.enabled = false;
      sfx.grab();
      canvas.setPointerCapture(e.pointerId);
      return;
    }
  }
  const h = ray.intersectObject(body, false)[0];
  if (!h) return;
  // つかむ（伸びたままの所をもう一度つかんでもOK）
  const localHit = body.worldToLocal(h.point.clone());
  if (pull.active && !pull.held && localHit.distanceTo(pull.grab.clone().add(pull.off)) > 0.6) {   // 遠い場所をつかみなおしたら、焼いていない形は捨てる
    cancelPose();
  }
  pull.relax = false;
  if (!pull.active) pull.off.set(0, 0, 0);
  pull.grab.copy(localHit).sub(pull.off);
  pull.vel.set(0, 0, 0);
  pull.active = pull.held = true;
  sfx.grab();
  pull.n = h.face.normal.clone();
  pull.startW.copy(h.point);
  pull.startOff = pull.off.clone();
  pull.plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()).negate(), h.point);
  controls.enabled = false;     // 引っ張っている間は回転しない
  canvas.setPointerCapture(e.pointerId);
});
let leafPrev = 0, leafPrevT = 0;
canvas.addEventListener('pointermove', e => {
  if (pl) { setNdc(e); placeItem(); return; }
  if (mv) {
    setNdc(e); const p = ray.ray.intersectPlane(floorPlane, new THREE.Vector3());
    if (p) { cat.position.x = Math.max(-6.5, Math.min(6.5, p.x + mv.dx)); cat.position.z = Math.max(-5, Math.min(4, p.z + mv.dz)); }
    return;
  }
  if (leafDrag) {
    setNdc(e);
    const r = current.rt.leafDrag(ray.ray) || { L: leafPrev, plucked: false };
    if (r.plucked) {
      leafDrag = false; leafPrev = 0;
      waitUp = true;               // 指を離すまでは視点を動かさない
      sfx.stretch(0, 0);
      sfx.pluck();
      return;
    }
    const L = r.L;
    const now = performance.now() / 1000, dtm = Math.max(now - leafPrevT, 1e-3);
    sfx.stretch(L * 1.2, Math.abs(L - leafPrev) / dtm);
    leafPrev = L; leafPrevT = now;
    return;
  }
  if (!pull.held) return;
  setNdc(e);
  const p = ray.ray.intersectPlane(pull.plane, new THREE.Vector3());
  if (!p) return;
  const a = body.worldToLocal(pull.startW.clone()), b = body.worldToLocal(p);
  const o = b.sub(a).add(pull.startOff);
  // 伸びすぎない（ゴムっぽく頭打ち）
  const L = o.length(), MAX = o.y > 0 ? 2.2 : 1.4;
  if (L > 0) o.multiplyScalar((MAX * Math.tanh(L / MAX)) / L);
  pull.off.copy(o);
});
function release() {
  if (pl) { pl = false; controls.enabled = true; sfx.boing(0.3); return; }
  if (mv) { mv = null; controls.enabled = true; return; }
  if (waitUp) { waitUp = false; controls.enabled = true; return; }
  if (leafDrag) {
    leafDrag = false;
    controls.enabled = true;
    sfx.stretch(0, 0);
    const L = current.rt.leafRelease();
    sfx.boing(0.3 + L * 0.8);
    current.rt.kickLeaves(4 + L * 10);
    return;
  }
  if (!pull.held) return;
  pull.held = false;
  controls.enabled = true;
  sfx.stretch(0, 0);
  sfx.boing(pull.off.length());
  pull.wasLifted = pull.off.y > 0.25;
  // 離した瞬間にぷるんっ
  spring.sqV += 2 + pull.off.length() * 3;
  spring.sxV += pull.off.x * 2.5;
  spring.szV += pull.off.z * 2.5;
}
addEventListener('pointerup', release);
addEventListener('pointercancel', release);

document.getElementById('poke').onclick = () => {
  sfx.poke();
  spring.sqV -= 4.5;
  spring.sxV += (Math.random() - 0.5) * 3;
  spring.szV += (Math.random() - 0.5) * 2;
};

// ---- ジャンプ
const jump = { phase: 'idle', t: 0, y: 0, vy: 0 };
let pullLift = 0, shake = 0;
function doJump() {
  if (jump.phase !== 'idle' || pull.held) return;
  sfx.unlock();
  jump.phase = 'crouch'; jump.t = 0;
}
document.getElementById('jump').onclick = doJump;
addEventListener('keydown', e => { if (e.code === 'Space' && !anim.on) { e.preventDefault(); doJump(); } });

// 着地の衝撃リング
const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 64),
  new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0, depthWrite: false }));
ring.rotation.x = -Math.PI / 2; ring.position.y = 0.005;
scene.add(ring);
let ringT = -1;


// 進んでいるのが分かるように、紙のドットみたいな床（鑑賞モードだけ表示）
const DOT = 0.6;
const dotFloor = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(110,100,90,0.45)';
  x.beginPath(); x.arc(32, 32, 3.2, 0, Math.PI * 2); x.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const SIZE = 48;
  tex.repeat.set(SIZE / DOT, SIZE / DOT);
  tex.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.002;
  m.visible = false;
  scene.add(m);
  return m;
})();

// ---- アニメーション鑑賞モード（視点固定）
const anim = { on: false, kind: 'hop', phase: 'crouch', pt: 0, y: 0, vy: 0, x: 0, lean: 0, saved: null, sq: 0 };
const HOP = { crouch: 0.13, air: 0.48, rest: 0.08, h: 0.38, step: 0.65 };
HOP.g = 8 * HOP.h / (HOP.air * HOP.air);
const animBtn = document.getElementById('animBtn'), animIcon = document.getElementById('animIcon');
let animPos = { x: 0, z: 0 };
function setAnim(on) {
  anim.on = on; applyStage();
  document.body.classList.toggle('anim', on);
  animBtn.classList.toggle('on', on);
  animIcon.innerHTML = on ? '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>' : '<path d="M8 5.5v13l10.5-6.5z"/>';
  if (on) {
    sfx.unlock();
    // 引っ張り中などは解除
    release(); animPos = { x: cat.position.x, z: cat.position.z };
    anim.saved = { pos: camera.position.clone(), target: controls.target.clone(), auto: controls.autoRotate };
    controls.autoRotate = false;
    controls.enabled = false;
    dotFloor.visible = true;
    resetAnimMotion(); anim.x = 0; anim.lean = 0; anim.vx = 0; anim.camX = 0; anim.sq = 0; anim.sh = 0; anim.shV = 0; anim.shx = 0; anim.shxV = 0; anim.yaw = anim.kind === 'hop' ? Math.PI / 2 : FACE;
  } else {
    cat.position.x = animPos.x; cat.position.z = animPos.z;
    cat.rotation.set(0, 0, 0);
    dotFloor.visible = false;
    ground.position.x = 0;
    sun.position.set(3, 6, 4); sun.target.position.set(0, 0, 0); sun.target.updateMatrixWorld();
    anim.y = 0; anim.sq = 0; anim.dy = 0; anim.sh = 0; anim.shV = 0; anim.shx = 0; anim.shxV = 0; anim.spin = 0; anim.puff = 0;
    clearFx();
    if (current.rt.setEyesClosed) current.rt.setEyesClosed(false);
    current.rt.setBrow(false);
    current.rt.setSmile(false);
    if (anim.saved) {
      camera.position.copy(anim.saved.pos);
      controls.target.copy(anim.saved.target);
      controls.autoRotate = anim.saved.auto;
    }
    controls.enabled = true;
  }
}
animBtn.onclick = () => setAnim(!anim.on);
document.querySelectorAll('.anims .chip').forEach(b => b.onclick = () => {
  anim.kind = b.dataset.anim;
  resetAnimMotion();
  document.querySelectorAll('.anims .chip').forEach(x => x.classList.toggle('on', x === b));
});

// ぴょんぴょん移動：軽く跳ねながら円をえがいて前へ進む
// ---- 鑑賞モードの動きいろいろ
const FACE = Math.atan2(6.4, 6.6);                  // カメラの方を向く角度
const ease = u => u * u * (3 - 2 * u);
function startAir(h, air) { const g = 8 * h / (air * air); anim.g = g; anim.vy = g * air / 2; anim.y = Math.max(anim.y, 0); }
function stepAir(dt) {                               // 着地したら true
  anim.vy -= anim.g * dt; anim.y += anim.vy * dt;
  if (anim.y <= 0 && anim.vy < 0) { anim.y = 0; anim.vy = 0; return true; }
  return false;
}
function setPhase(p) { anim.phase = p; anim.pt = 0; }

// ① ぴょんぴょん移動
function animHop(dt, o) {
  o.yawT = Math.PI / 2;
  if (anim.phase === 'crouch') {
    const k = Math.min(anim.pt / HOP.crouch, 1);
    o.sqT = -0.17 * Math.sin(k * Math.PI * 0.5);
    o.shT = -0.08;
    if (k >= 1) {
      setPhase('air'); startAir(HOP.h, HOP.air);
      spring.sqV += 6.5; spring.szV -= 1.0;
      sfx.hopSoft();
    }
  } else if (anim.phase === 'air') {
    const u = Math.min(anim.pt / HOP.air, 1);
    o.sqT = THREE.MathUtils.clamp(anim.vy * 0.022, -0.06, 0.12);
    o.shT = 0.16 * (1 - u) - 0.05 * u;
    o.vxT = HOP.step / HOP.air;
    if (stepAir(dt)) {
      setPhase('land');
      spring.sqV -= 5; spring.szV += 2.4; spring.sxV += (Math.random() - 0.5) * 1.2;
      sfx.plop();
    }
  } else {
    o.sqT = -0.06;
    if (anim.pt >= HOP.rest) setPhase('crouch');
  }
  if (anim.phase !== 'air') o.vxT = HOP.step * 0.08;
}

// ② ゆらゆらダンス：こっちを向いて、左右にぷるんぷるん＋小さく弾む
function animDance(dt, o) {
  const T = 0.52;
  const n = Math.floor(anim.pt / T), u = (anim.pt % T) / T;
  if (n !== anim.beat) {
    anim.beat = n;
    spring.sqV -= 2.8;
    spring.sxV += (n % 2 ? 1 : -1) * 2.2;
    sfx.step(n % 4 === 3 ? 1.5 : n % 2 ? 1.2 : 1);
  }
  const side = n % 2 ? 1 : -1;
  anim.y = 0.1 * Math.sin(Math.PI * u);
  o.sqT = -0.05 + 0.07 * Math.sin(Math.PI * u);
  o.shxT = 0.17 * side * Math.sin(Math.PI * Math.min(u * 1.4, 1));     // 体を左右にくねっ
  o.yawT = FACE + 0.32 * side;
}

// ③ くるりんジャンプ：小さく2回ぴょこぴょこ → ためて → 大ジャンプでくるっと1回転
function animSpin(dt, o) {
  o.yawT = FACE;
  switch (anim.phase) {
    case 'crouch': {                                   // 小ジャンプ前のため
      o.sqT = -0.1;
      if (anim.pt >= 0.1) { setPhase('small'); startAir(0.16, 0.3); spring.sqV += 4; sfx.hopSoft(); }
      break;
    }
    case 'small': {
      o.sqT = THREE.MathUtils.clamp(anim.vy * 0.03, -0.04, 0.08);
      if (stepAir(dt)) {
        spring.sqV -= 3; sfx.plop();
        anim.n = (anim.n || 0) + 1;
        setPhase(anim.n >= 2 ? 'big-crouch' : 'crouch');
      }
      break;
    }
    case 'big-crouch': {                               // ぐぐっとためる
      const k = Math.min(anim.pt / 0.3, 1);
      o.sqT = -0.26 * ease(k);
      o.shxT = -0.05 * ease(k);
      if (k >= 1) { setPhase('big'); startAir(0.95, 0.8); spring.sqV += 8; sfx.whoosh(); }
      break;
    }
    case 'big': {                                      // くるりん
      const u = Math.min(anim.pt / 0.8, 1);
      anim.spin = Math.PI * 2 * ease(u);
      o.sqT = THREE.MathUtils.clamp(anim.vy * 0.02, -0.06, 0.14);
      if (stepAir(dt)) {
        anim.spin = 0;
        setPhase('rest');
        spring.sqV -= 7; spring.sxV += (Math.random() - 0.5) * 2; spring.szV += (Math.random() - 0.5) * 2;
        sfx.plop(); setTimeout(() => sfx.boing(0.5), 50);
      }
      break;
    }
    default: {                                         // 余韻
      o.sqT = -0.04;
      if (anim.pt >= 0.8) { anim.n = 0; setPhase('crouch'); }
    }
  }
}

// ④ とろ〜ん：ゆっくりとろけて平べったく → ぽんっと元にもどる
function animMelt(dt, o) {
  o.yawT = FACE;
  switch (anim.phase) {
    case 'crouch':                                      // （開始・ループのはじまり）
      setPhase('melt'); sfx.melt();
      // fallthrough
    case 'melt': {
      const k = Math.min(anim.pt / 1.8, 1);
      o.sqT = -0.5 * ease(k);
      o.shxT = 0.04 * Math.sin(anim.pt * 3.2) * k;      // とろけながらゆらゆら
      if (k >= 1) setPhase('hold');
      break;
    }
    case 'hold': {
      o.sqT = -0.5 + 0.03 * Math.sin(anim.pt * Math.PI * 2 / 0.9);
      o.shxT = 0.04 * Math.sin((anim.pt + 1.8) * 3.2);
      if (anim.pt >= 0.9) {
        setPhase('pop'); startAir(0.28, 0.42);
        spring.sqV += 9; sfx.pon();
      }
      break;
    }
    case 'pop': {
      o.sqT = THREE.MathUtils.clamp(anim.vy * 0.03, -0.05, 0.12);
      if (stepAir(dt)) { setPhase('rest'); spring.sqV -= 4; spring.sxV += (Math.random() - 0.5) * 1.5; sfx.plop(); }
      break;
    }
    default: {
      o.sqT = 0;
      if (anim.pt >= 1.3) setPhase('crouch');
    }
  }
}

// ---- 「！」「Z」「？」などの記号（キャラの線の色で）
const fxList = [];
function textSprite(ch) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.font = 'bold 104px "Hiragino Maru Gothic ProN", "Rounded Mplus 1c", system-ui, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  if (ch === '💢') {
    // 怒りマーク：4つのカーブが中央に向かってふくらむ形（赤＋白ふち）
    const arcs = () => {
      x.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const cx = 64 + sx * 38, cy = 64 + sy * 38, toC = Math.atan2(-sy, -sx);
        x.moveTo(cx + Math.cos(toC - 0.8) * 30, cy + Math.sin(toC - 0.8) * 30);
        x.arc(cx, cy, 30, toC - 0.8, toC + 0.8);
      }
    };
    x.lineCap = 'round';
    x.lineWidth = 24; x.strokeStyle = '#fbfaf5'; arcs(); x.stroke();
    x.lineWidth = 12; x.strokeStyle = '#e5484d'; arcs(); x.stroke();
  } else {
    x.lineWidth = 14; x.strokeStyle = '#fbfaf5'; x.lineJoin = 'round';
    x.strokeText(ch, 64, 70);
    x.fillStyle = current.inkCss; x.fillText(ch, 64, 70);
  }
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.renderOrder = 10;
  return sp;
}
function spawnFx(ch, { size = 0.55, life = 1.2, vel = [0, 0, 0], side = 0.75, up = 0.35, wobble = 0 } = {}) {
  const sp = textSprite(ch);
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
  const top = cat.position.y + current.shape.B * 1.05;
  sp.position.set(cat.position.x, top + up, cat.position.z).addScaledVector(right, side);
  sp.scale.setScalar(0.001);
  scene.add(sp);
  fxList.push({ sp, t: 0, life, size, vel: new THREE.Vector3(...vel), wobble, base: sp.position.clone() });
}
function clearFx() { while (fxList.length) { const f = fxList.pop(); scene.remove(f.sp); f.sp.material.map.dispose(); f.sp.material.dispose(); } }
function updateFx(dt) {
  for (let i = fxList.length - 1; i >= 0; i--) {
    const f = fxList[i];
    f.t += dt;
    const u = f.t / f.life;
    // ぽんっと出てきて（少し行きすぎ）、最後はふわっと消える
    const pop = f.t < 0.25 ? 1 - Math.exp(-14 * f.t) * Math.cos(16 * f.t) : 1;
    f.sp.scale.setScalar(Math.max(f.size * pop * (1 + u * 0.3), 0.001));
    f.base.addScaledVector(f.vel, dt);
    f.sp.position.copy(f.base);
    if (f.wobble) f.sp.position.x += Math.sin(f.t * 3) * f.wobble;
    f.sp.material.opacity = u > 0.7 ? Math.max(1 - (u - 0.7) / 0.3, 0) : 1;
    if (u >= 1) { scene.remove(f.sp); f.sp.material.map.dispose(); f.sp.material.dispose(); fxList.splice(i, 1); }
  }
}

// ⑤ びっくり：ビクッと縦にのびて小さく跳ねて、ぷるぷる震える
function animSurprise(dt, o) {
  o.yawT = FACE;
  switch (anim.phase) {
    case 'crouch': {                                    // ぼーっと待つ
      o.sqT = -0.03 + 0.02 * Math.sin(anim.pt * 3);
      if (anim.pt >= 1.1) {
        setPhase('jump'); startAir(0.24, 0.3);
        spring.sqV += 10;
        spawnFx('！', { size: 0.6, life: 1.4, up: 0.45, side: 0.8 });
        sfx.surprise();
      }
      break;
    }
    case 'jump': {
      o.sqT = 0.16;                                     // ピーンとのびる
      o.shxT = 0.035 * Math.sin(anim.pt * 70);          // ぷるぷる
      if (anim.y > 0 || anim.vy > 0) { if (stepAir(dt)) { spring.sqV -= 4; sfx.plop(); } }
      if (anim.pt >= 0.7) setPhase('calm');
      break;
    }
    default: {                                          // ほっとして元に戻る
      const k = Math.min(anim.pt / 0.6, 1);
      o.sqT = 0.16 * (1 - ease(k)) - 0.05 * Math.sin(Math.PI * k);
      o.shxT = 0.035 * Math.sin(anim.pt * 70) * (1 - k);
      if (anim.pt >= 1.4) setPhase('crouch');
    }
  }
}

// ⑥ おじぎ：ぺこっと上の方を前に倒して、ぽよんと戻る
function animBow(dt, o) {
  o.yawT = FACE;
  switch (anim.phase) {
    case 'crouch': {
      o.sqT = 0;
      if (anim.pt >= 0.7) { setPhase('bow'); sfx.bow(); }
      break;
    }
    case 'bow': {
      const k = Math.min(anim.pt / 0.45, 1);
      o.shT = 0.3 * ease(k);
      o.sqT = -0.12 * ease(k);
      if (anim.pt >= 0.45 + 0.55) { setPhase('rise'); spring.szV -= 2.5; spring.sqV += 3; }
      break;
    }
    case 'rise': {
      o.shT = 0; o.sqT = 0.03;
      if (anim.pt >= 1.2) setPhase('crouch');
      break;
    }
    default: setPhase('crouch');
  }
}

// ⑦ すやすや：ゆっくり深呼吸しながらうとうと、Z が浮かぶ
function animSleep(dt, o) {
  o.yawT = FACE;
  const T = 2.8;
  o.sqT = -0.13 + 0.07 * Math.sin(anim.pt * Math.PI * 2 / T);
  o.shxT = 0.035 * Math.sin(anim.pt * 0.8);             // ゆら〜り
  o.shT = 0.03 + 0.02 * Math.sin(anim.pt * Math.PI * 2 / T);
  const n = Math.floor((anim.pt + 0.4) / (T / 2));
  if (n !== anim.beat) {
    anim.beat = n;
    if (n % 2 === 0) spawnFx(n % 4 === 0 ? 'Z' : 'z', { size: n % 4 === 0 ? 0.42 : 0.3, life: 2.4, vel: [0.12, 0.32, 0], up: 0.15, side: 0.65, wobble: 0.06 });
  }
}

// ⑧ きょろきょろ：左を見て、右を見て、首をかしげて「？」
function animLook(dt, o) {
  const steps = [
    { yaw: 0.65, tilt: 0, dur: 0.95 },
    { yaw: -0.65, tilt: 0, dur: 0.95 },
    { yaw: 0, tilt: 0.14, dur: 1.5, q: true },
  ];
  const i = anim.n % steps.length, st = steps[i];
  if (anim.phase === 'crouch') {                         // 向きを変えるたびに、ぷにっ
    anim.phase = 'look'; spring.sqV -= 2.4; spring.sxV += (st.yaw >= 0 ? -1 : 1) * 1.2;
    sfx.step(1.3 + i * 0.15);
    if (st.q) spawnFx('？', { size: 0.5, life: 1.3, up: 0.4, side: 0.75 });
  }
  o.yawT = FACE + st.yaw;
  o.shxT = st.tilt;
  o.sqT = -0.02;
  if (anim.pt >= st.dur) { anim.n++; setPhase('crouch'); }
}


// ⑨ うれしい：こっちを向いてぴょこぴょこ弾んで、♡がふわふわ
function animHappy(dt, o) {
  o.yawT = FACE;
  if (anim.phase === 'crouch') {
    o.sqT = -0.1;
    if (anim.pt >= 0.07) {
      setPhase('air'); startAir(0.2, 0.28); spring.sqV += 5;
      anim.n++;
      sfx.step(1.6 + (anim.n % 3) * 0.25);
      if (anim.n % 2 === 0) spawnFx('♡', { size: 0.42, life: 1.6, vel: [0, 0.45, 0], up: 0.1, side: (anim.n % 4 === 0 ? 1 : -1) * (0.7 + Math.random() * 0.2), wobble: 0.05 });
    }
  } else if (anim.phase === 'air') {
    o.sqT = THREE.MathUtils.clamp(anim.vy * 0.03, -0.05, 0.1);
    o.shxT = 0.1 * (anim.n % 2 ? 1 : -1);
    o.yawT = FACE + 0.15 * (anim.n % 2 ? 1 : -1);
    if (stepAir(dt)) { setPhase('land'); spring.sqV -= 3.5; spring.sxV += (anim.n % 2 ? -1 : 1) * 1.5; }
  } else {
    o.sqT = -0.06;
    if (anim.pt >= 0.05) setPhase('crouch');
  }
}

// ⑩ ぶるぶる：犬が水をはらうみたいに、ぶるるるっと体をふる
function animShake(dt, o) {
  o.yawT = FACE;
  if (anim.phase === 'crouch') {
    o.sqT = -0.02;
    anim.spin = 0;
    if (anim.pt >= 1.0) { setPhase('shake'); sfx.shake(); spring.sqV -= 2; }
  } else if (anim.phase === 'shake') {
    const k = Math.min(anim.pt / 0.95, 1), amp = Math.sin(Math.PI * Math.min(k * 1.6, 1)) * (1 - k * 0.6);
    anim.spin = 0.38 * amp * Math.sin(anim.pt * 30);               // ぐりぐりっと左右にねじる
    o.shxT = 0.12 * amp * Math.sin(anim.pt * 30 + 1.2);            // 上の方は少し遅れてぶるん
    o.sqT = -0.05 * amp;
    if (k >= 1) { anim.spin = 0; setPhase('after'); spring.sqV += 4; spring.sxV += 2; }
  } else {
    o.sqT = 0;
    if (anim.pt >= 0.8) setPhase('crouch');
  }
}

// ⑪ ぷんぷん：ぷくーっとふくらんで、ドンドン足ぶみ → ぷしゅ〜としぼむ
function animAngry(dt, o) {
  o.yawT = FACE;
  let puffT = 0;
  switch (anim.phase) {
    case 'crouch': {                                       // ぷくーっ
      const k = Math.min(anim.pt / 0.6, 1);
      puffT = 0.14 * ease(k); o.sqT = 0.04 * ease(k);
      if (anim.pt === dt || anim.pt < dt * 1.01) sfx.puff();
      if (k >= 1) { setPhase('stomp'); anim.n = 0; }
      break;
    }
    case 'stomp': {                                        // ドンドン
      puffT = 0.14;
      if (anim.y <= 0 && anim.vy === 0) {
        if (anim.pt >= 0.12) {
          if (anim.n >= 4) { setPhase('deflate'); sfx.deflate(); break; }
          startAir(0.1, 0.2); anim.n++; anim.pt = 0;
        }
      } else if (stepAir(dt)) {
        spring.sqV -= 4.5; spring.sxV += (anim.n % 2 ? 1 : -1) * 2;
        anim.pt = 0;
        sfx.stomp();
        if (anim.n === 1 || anim.n === 3) spawnFx('💢', { size: 0.5, life: 1.0, up: 0.45, side: anim.n === 1 ? 0.8 : -0.8 });
      }
      o.shxT = 0.08 * (anim.n % 2 ? 1 : -1);
      o.sqT = 0.03;
      break;
    }
    case 'deflate': {                                      // ぷしゅ〜
      const k = Math.min(anim.pt / 0.9, 1);
      puffT = 0.14 * (1 - ease(k)); o.sqT = -0.12 * Math.sin(Math.PI * k);
      o.shxT = 0.03 * Math.sin(anim.pt * 25) * (1 - k);
      if (anim.pt >= 1.6) setPhase('crouch');
      break;
    }
  }
  anim.puff += (puffT - anim.puff) * (1 - Math.exp(-dt * 10));
}

// ⑫ のび〜：ゆっくり上にの〜びて、ぷるぷる → ぽふっと戻る
function animStretch(dt, o) {
  o.yawT = FACE;
  switch (anim.phase) {
    case 'crouch': {
      o.sqT = -0.06;
      if (anim.pt >= 0.6) { setPhase('up'); sfx.yawn(); }
      break;
    }
    case 'up': {
      const k = Math.min(anim.pt / 1.3, 1);
      o.sqT = 0.42 * ease(k);
      o.shxT = 0.05 * Math.sin(anim.pt * 2.2) * k;
      if (k >= 1) setPhase('hold');
      break;
    }
    case 'hold': {
      o.sqT = 0.42 + 0.015 * Math.sin(anim.pt * 40);       // ぷるぷる
      o.shxT = 0.05 * Math.sin((anim.pt + 1.3) * 2.2);
      if (anim.pt >= 0.7) { setPhase('flop'); spring.sqV -= 7; sfx.plop(); setTimeout(() => sfx.boing(0.6), 40); }
      break;
    }
    default: {
      o.sqT = -0.04;
      if (anim.pt >= 1.3) setPhase('crouch');
    }
  }
}

const ANIMS = { happy: animHappy, shake: animShake, angry: animAngry, stretch: animStretch, hop: animHop, dance: animDance, spin: animSpin, melt: animMelt, surprise: animSurprise, bow: animBow, sleep: animSleep, look: animLook };
function resetAnimMotion() {
  clearFx();
  anim.puff = 0;
  anim.phase = 'crouch'; anim.pt = 0; anim.y = 0; anim.vy = 0; anim.beat = -1; anim.n = 0; anim.spin = 0;
}

function updateAnim(dt) {
  anim.pt += dt;
  const o = { sqT: 0, shT: 0, shxT: 0, yawT: FACE, vxT: 0 };
  ANIMS[anim.kind](dt, o);
  updateFx(dt);
  if (current.rt.setEyesClosed) current.rt.setEyesClosed(anim.kind === 'sleep');
  current.rt.setBrow(anim.kind === 'angry' && anim.phase !== 'deflate');
  current.rt.setSmile(anim.kind === 'happy');

  // つぶれ・のび：目標をなめらかに追いかける（カクッとしない）
  anim.sq += (o.sqT - anim.sq) * (1 - Math.exp(-dt * 16));
  // 上の方のたわみ（前後・左右）はばねでぷるんと
  anim.shV += (-58 * (anim.sh - o.shT) - 3.2 * anim.shV) * dt; anim.sh += anim.shV * dt;
  anim.shxV += (-58 * (anim.shx - o.shxT) - 3.2 * anim.shxV) * dt; anim.shx += anim.shxV * dt;
  // 向き：なめらかに回る（最短方向）
  let dYaw = o.yawT - anim.yaw; dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
  anim.yaw += dYaw * (1 - Math.exp(-dt * 8));
  // 前へ進む速さ
  anim.vx += (o.vxT - anim.vx) * (1 - Math.exp(-dt * 35));
  anim.x += anim.vx * dt;

  cat.rotation.order = 'YXZ';
  cat.rotation.y = anim.yaw + anim.spin;
  // 全体の傾きはほんの少しだけ（前後たわみのおまけ）
  anim.lean += (anim.sh * 0.35 - anim.lean) * (1 - Math.exp(-dt * 20));
  cat.rotation.x = anim.lean;
  // 傾けても床にめり込まないよう、前傾は前のふち・後傾は後ろのふちを支点にして回す
  const th = anim.lean, e = Math.sign(th) * 1.15, l = lift;
  anim.dy = -l + l * Math.cos(th) + e * Math.sin(th);
  const fwd = e - e * Math.cos(th) + l * Math.sin(th);
  cat.position.x = anim.x + Math.sin(cat.rotation.y) * fwd;
  cat.position.z = Math.cos(cat.rotation.y) * fwd;

  // カメラはキャラを真ん中に、斜め前・少し上からなめらかについていく（跳ねても揺れないよう床基準）
  anim.camX += (anim.x - anim.camX) * (1 - Math.exp(-dt * 6));
  controls.target.set(anim.camX, 0.6, 0);
  camera.position.set(anim.camX + 6.4, 3.6, 6.6);
  camera.lookAt(controls.target);
  // 影と床もいっしょに
  sun.position.set(anim.camX + 3, 6, 4); sun.target.position.set(anim.camX, 0, 0); sun.target.updateMatrixWorld();
  ground.position.x = anim.camX;
  dotFloor.position.x = Math.floor(anim.camX / DOT) * DOT;
}

// ================= 台座・焼き付け・植え替え =================
const PH = 1.35;
const ped = new THREE.Group(); scene.add(ped);
const pedOutlines = [];
const pedLine = outlineMat(0.04);
{
  const prof = [[0, -PH], [2.3, -PH], [2.38, -PH + .04], [2.4, -PH + .1], [2.4, -PH + .2], [2.3, -PH + .26], [2.0, -PH + .3], [1.78, -PH + .36], [1.7, -PH + .5], [1.7, -.45], [1.78, -.34], [2.0, -.28], [2.2, -.22], [2.28, -.16], [2.3, -.1], [2.3, -.05], [2.26, -.01], [2.2, 0], [0, 0]]
    .map(([r, y]) => new THREE.Vector2(r * 0.84, y));
  const g = new THREE.LatheGeometry(prof, 96);
  const m = new THREE.Mesh(g, new THREE.MeshToonMaterial({ color: 0xe9e4d6, gradientMap: grad }));
  m.castShadow = m.receiveShadow = true; ped.add(m);
  const o = new THREE.Mesh(g, pedLine); o.visible = lineOn; ped.add(o); pedOutlines.push(o);
}
let stageOn = true;
function applyStage() {
  const on = stageOn && !anim.on;
  ped.visible = on; ground.position.y = on ? -PH : 0;
  ui('multi').style.display = stageOn ? 'none' : 'flex';
  ui('cnt').textContent = insts.length + ' / 6';
  for (const I of insts) I.cat.visible = !(on || anim.on) || I === curInst;
}
let stageBackup = null;
let toastT = 0;
function toast(msg) {
  const t = ui('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2200);
}
let onPlucked = () => {};

// 焼き付け：今の形を「元の形」にして、少し焼き色もつく（顔・耳・芽も貼りつけ直す）
const SCORCH = [0.62, 0.36, 0.14];
function applyScorch() {
  const C = bodyGeo.attributes.color.array;
  for (let i = 0; i < scorch.length; i++) { const k = scorch[i]; for (let j = 0; j < 3; j++) C[i * 3 + j] = colorBase[i * 3 + j] * (1 - k) + SCORCH[j] * k; }
  bodyGeo.attributes.color.needsUpdate = true;
}
const RET = { k: 140, d: 7, hold: true };
function rebind() {
  prepSurface(current.shape);
  for (const f of faceVerts) f.bind = bindPoints(f.base);
  for (const c of faceCaps) c.bind = bindPoints(c.base);
  for (const r of riders) r.bind = bindPoints(r.ctr);
}
function commitBases() {
  pos.array.set(basePos); pos.needsUpdate = true;
  bodyGeo.computeVertexNormals(); bodyGeo.computeBoundingSphere();
  faceVerts.forEach(f => { f.attr.array.set(f.base); f.attr.needsUpdate = true; });
  faceCaps.forEach(c => c.o.position.fromArray(c.base));
  riders.forEach(r => { if (r.o.parent === squish) r.o.position.fromArray(r.base); });
  rebind(); computeBound();
}
function snap() {
  return { base: basePos.slice(), fv: faceVerts.map(f => f.base.slice()), fc: faceCaps.map(c => c.base.slice()),
           rd: riders.map(r => ({ b: r.base.slice(), c: r.ctr.slice() })), gs: { ...gs }, sc: scorch.slice() };
}
function applySnap(s) {
  basePos.set(s.base);
  faceVerts.forEach((f, i) => f.base.set(s.fv[i]));
  faceCaps.forEach((c, i) => c.base.set(s.fc[i]));
  riders.forEach((r, i) => { r.base.set(s.rd[i].b); r.ctr = s.rd[i].c.slice(); });
  gs = { ...s.gs }; scorch.set(s.sc); applyScorch();
  commitBases();
}
function pushUndo() { undoStack.push(snap()); if (undoStack.length > 30) undoStack.shift(); updateButtons(); }
function updateButtons() { ui('undo').disabled = !undoStack.length; }
function commitPose(burn) {
  pushUndo();
  const hasPose = pull.active;
  const nb = hasPose ? Float32Array.from(pos.array) : basePos;
  if (hasPose) for (let i = 0; i < nb.length; i++) nb[i] -= ovD[i];
  for (let i = 0; i < scorch.length; i++) {      // 焼き色：のびた所ほどよく焼ける
    let a = burn ? 0.1 : 0;
    if (hasPose && burn) { const dx = nb[i * 3] - basePos[i * 3], dy = nb[i * 3 + 1] - basePos[i * 3 + 1], dz = nb[i * 3 + 2] - basePos[i * 3 + 2]; a += 0.25 * Math.min(Math.hypot(dx, dy, dz) / 0.7, 1); }
    scorch[i] = Math.min(0.9, scorch[i] + a);
  }
  applyScorch();
  if (hasPose) {
    const nfv = faceVerts.map(f => { const o = new Float32Array(f.base.length); evalBind(f.bind, f.base, o); return o; });
    const nfc = faceCaps.map(c => { const o = new Float32Array(3); evalBind(c.bind, c.base, o); return o; });
    const nrd = riders.map(r => { const o = new Float32Array(3); evalBind(r.bind, r.base, o, false); return o; });
    basePos.set(nb);
    faceVerts.forEach((f, i) => f.base.set(nfv[i]));
    faceCaps.forEach((c, i) => c.base.set(nfc[i]));
    riders.forEach((r, i) => { for (let k = 0; k < 3; k++) r.ctr[k] += nrd[i][k] - r.base[k]; r.base.set(nrd[i]); });
    pull.active = pull.held = false; pull.relax = false; pull.off.set(0, 0, 0); pull.vel.set(0, 0, 0); pull.prevOff = null; pullLift = 0;
    DF.ox = DF.oy = DF.oz = 0; DF.shell = 1;
    controls.enabled = true; sfx.stretch(0, 0);
    commitBases();
  }
  if (burn) { flashT = 0; sfx.thud(3); spring.sqV -= 2.5; toast(hasPose ? 'BAKED: this is the new base shape' : 'BAKED a little'); }
}
// まるごと のばす・ちぢめる（床を基準に）
function scaleShape(ax, ay, az) {
  if (anim.on) return;
  if (pull.active) commitPose(false);
  const nx = gs.x * ax, ny = gs.y * ay, nz = gs.z * az;
  const ok = v => v >= 0.55 && v <= 2.2;
  if (!ok(nx) || !ok(ny) || !ok(nz)) { toast('LIMIT'); return; }
  pushUndo();
  const T = a => { for (let i = 0; i < a.length; i += 3) { a[i] *= ax; a[i + 1] = floorY + (a[i + 1] - floorY) * ay; a[i + 2] *= az; } };
  T(basePos); faceVerts.forEach(f => T(f.base)); faceCaps.forEach(c => T(c.base)); riders.forEach(r => { T(r.base); T(r.ctr); });
  gs = { x: nx, y: ny, z: nz };
  commitBases();
  sfx.boing(0.5); spring.sqV += ay > 1 ? 2 : -2;
}
ui('bakeBtn').onclick = () => { if (!anim.on) commitPose(true); };
ui('relaxBtn').onclick = () => { if (pull.active && !pull.held) { pull.relax = true; sfx.boing(0.5); } };
ui('undo').onclick = () => { if (pull.active && !pull.held) { pull.relax = true; return; } if (pull.active || !undoStack.length) return; applySnap(undoStack.pop()); updateButtons(); sfx.poke(); };
ui('reset').onclick = () => { buildCharacter(curKey); sfx.poke(); spring.sqV = -3; toast('RESET'); };
ui('hp').onclick = () => scaleShape(1, 1.12, 1);
ui('hm').onclick = () => scaleShape(1, 1 / 1.12, 1);
ui('wp').onclick = () => scaleShape(1.12, 1, 1.12);
ui('wm').onclick = () => scaleShape(1 / 1.12, 1, 1 / 1.12);
ui('stage').onclick = () => {
  stageOn = !stageOn; ui('stage').classList.toggle('on', stageOn);
  if (stageOn) { stageBackup = insts.map(I => ({ I, x: I.cat.position.x, z: I.cat.position.z })); cat.position.x = cat.position.z = 0; }
  else { for (const b of stageBackup || []) { b.I.cat.position.x = b.x; b.I.cat.position.z = b.z; } toast('MULTI MODE: COPY to add more'); }
  applyStage();
};

// 植え替え
const PLANT_LIST = [['tophat', 'TOP HAT', '#2b2b33'], ['party', 'PARTY', '#ff8fb1'], ['crown', 'CROWN', '#f2c744'], ['beanie', 'BEANIE', '#5aa9e6'], ['straw', 'STRAW', '#e8cf8a'], ['chef', 'CHEF', '#ffffff'], ['bow', 'BOW', '#ff6b9a'],
  ['grass', 'GRASS', '#c5e3c8'], ['tulip', 'TULIP', '#ee6f86'], ['daisy', 'DAISY', '#ffffff'], ['mushroom', 'MUSHROOM', '#e5584f'],
  ['star', 'STAR', '#ffd34e'], ['flag', 'FLAG', '#e86a5e'], ['heart', 'HEART', '#ff7a98'], ['sakura', 'SAKURA', '#ffc2d4'], ['leek', 'LEEK', '#8cc87a']];
const tray = ui('tray');
for (const [k, label, col] of PLANT_LIST) {
  const b = document.createElement('button');
  b.innerHTML = '<i style="background:' + col + '"></i>' + label;
  b.onclick = () => { if (current.rt.plant) current.rt.plant(k); };
  tray.appendChild(b);
}
const PANELS = { shape: ['tShape', 'pShape'], item: ['plantBtn', 'tray'], color: ['colorBtn', 'pal'], more: ['tMore', 'pMore'] };
let panelNow = 'item';
function openPanel(n) { panelNow = n; for (const k in PANELS) { ui(PANELS[k][1]).classList.toggle('open', k === n); ui(PANELS[k][0]).classList.toggle('on', k === n); } }
function trayOpen(v) { if (v) openPanel('item'); else if (panelNow === 'item') openPanel(null); }
for (const k in PANELS) ui(PANELS[k][0]).onclick = () => openPanel(panelNow === k ? null : k);
openPanel(null);
onPlucked = () => { trayOpen(true); toast('Pulled out! Pick something to plant'); };
// ---- モード：のばす / カメラ
let mode = 'sculpt', spinSaved = true;
function setMode(m) {
  if (m === mode && ui('modeBtn').dataset.init) return;
  ui('modeBtn').dataset.init = '1';
  if (mode === 'camera') spinSaved = controls.autoRotate;
  mode = m;
  const cam = m === 'camera';
  controls.enableRotate = cam; controls.enablePan = false;
  controls.autoRotate = cam ? spinSaved : false; ui('spin').classList.toggle('on', controls.autoRotate);
  ui('modeBtn').classList.toggle('on', !cam); ui('modeBtn').textContent = { sculpt: 'STRETCH', place: 'PLACE', move: 'MOVE', camera: 'CAMERA' }[m];
  ui('hint').textContent = { sculpt: 'Pull the body, then press BAKE', place: 'Drag on the body to move the item', move: 'Drag a character to place it', camera: 'Drag to rotate · pinch to zoom' }[m];
  canvas.style.cursor = cam ? 'move' : 'grab';
}
ui('modeBtn').onclick = () => setMode({ sculpt: 'place', place: 'move', move: 'camera', camera: 'sculpt' }[mode]);
setMode('sculpt');

// ---- 戻るまでの時間
function setReturn(T) {
  RET.hold = T >= 4.15; T = Math.min(T, 4);
  RET.k = 140 * Math.pow(0.5 / T, 2); RET.d = 7 * (0.5 / T);
  ui('retv').textContent = RET.hold ? 'HOLD' : T.toFixed(2).replace(/0$/, '') + 's';
}
ui('ret').oninput = e => setReturn(parseFloat(e.target.value));
setReturn(4.2);

// ---- 色
const BODY_COLS = ['#ffffff', '#ffd6e0', '#d7f0d9', '#d4e6ff', '#ffe9a8'];
const ITEM_COLS = ['#e5584f', '#f2c744', '#5aa9e6', '#2b2b33'];
const pal = ui('pal');
function addSw(label, cols, fn, extra) {
  const row = document.createElement('div'); row.className = 'subrow'; pal.appendChild(row);
  const l = document.createElement('span'); l.className = 'lab'; l.textContent = label; row.appendChild(l);
  if (extra) row.appendChild(extra);
  for (const c of cols) {
    const b = document.createElement('button'); b.className = 'sw'; b.style.background = c; b.setAttribute('aria-label', label + ' ' + c);
    b.onclick = () => fn(c); row.appendChild(b);
  }
  // いちばん右：自由に色を選ぶ
  const pick = document.createElement('label'); pick.className = 'sw rainbow'; pick.title = 'custom';
  const inp = document.createElement('input'); inp.type = 'color'; inp.value = '#ff8800';
  inp.oninput = () => fn(inp.value);
  pick.appendChild(inp); row.appendChild(pick);
}
const applyItem = () => { if (itemCol !== null && current.rt.tint) current.rt.tint(itemCol, itemAll); };
addSw('BODY', BODY_COLS, c => { bodyCol = new THREE.Color(c).getHex(); bodyMat.color.set(bodyCol); });
{
  const all = document.createElement('button'); all.id = 'itemAll'; all.textContent = 'ALL'; all.title = 'recolor every part of the item';
  all.onclick = () => { itemAll = !itemAll; all.classList.toggle('on', itemAll); applyItem(); sfx.poke(); };
  addSw('ITEM', ITEM_COLS, c => { itemCol = new THREE.Color(c).getHex(); applyItem(); }, all);
}

// ================= 増量モード（ステージを消すと、コピーして好きに置ける） =================
const attached = o => { for (let p = o; p; p = p.parent) if (p === scene) return true; return false; };
function syncInst() {
  const I = curInst;
  I.cat = cat; I.squish = squish; I.body = body; I.bodyGeo = bodyGeo; I.basePos = basePos; I.pos = pos; I.face = face;
  I.faceVerts = faceVerts; I.faceCaps = faceCaps; I.riders = riders; I.baseNrm = baseNrm; I.baseR = baseR; I.elevMax = elevMax; I.hash = hash; I.shapeN = shapeN;
  I.colorBase = colorBase; I.scorch = scorch; I.faceMask = faceMask; I.bodyMat = bodyMat; I.inkMat = inkMat; I.floorY = floorY; I.lift = lift; I.gs = gs;
  I.current = current; I.rt = current.rt; I.bodyCol = bodyCol; I.itemCol = itemCol; I.itemAll = itemAll; I.key = curKey; I.undo = undoStack; I.ovD = ovD; I.bound = bound;
}
function loadState(I) {
  cat = I.cat; squish = I.squish; body = I.body; bodyGeo = I.bodyGeo; basePos = I.basePos; pos = I.pos; face = I.face;
  faceVerts = I.faceVerts; faceCaps = I.faceCaps; riders = I.riders; baseNrm = I.baseNrm; baseR = I.baseR; elevMax = I.elevMax; hash = I.hash; shapeN = I.shapeN;
  colorBase = I.colorBase; scorch = I.scorch; faceMask = I.faceMask; bodyMat = I.bodyMat; inkMat = I.inkMat; floorY = I.floorY; lift = I.lift; gs = I.gs;
  current = I.current; current.rt = I.rt; bodyCol = I.bodyCol; itemCol = I.itemCol; itemAll = I.itemAll; curKey = I.key; undoStack = I.undo; ovD = I.ovD; bound = I.bound; curInst = I;
}
function runOn(I, fn) {
  if (I === curInst) { fn(); return; }
  const prev = curInst; syncInst(); loadState(I);
  try { fn(); } finally { syncInst(); loadState(prev); }
}
function computeBound() {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < basePos.length; i += 3) {
    const x = basePos[i], y = basePos[i + 1], z = basePos[i + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  bound = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, cz: (z0 + z1) / 2, rx: Math.max((x1 - x0) / 2, 0.3), ry: Math.max((y1 - y0) / 2, 0.3), rz: Math.max((z1 - z0) / 2, 0.3) };
  if (curInst) curInst.bound = bound;
}
// 体・顔・芽をいまの状態（つまみ＋重なり）に合わせて作り直す
function refreshMesh(usePull) {
  if (!usePull) { DF.ox = DF.oy = DF.oz = 0; DF.shell = 1; }
  const P = pos.array, n = pos.count;
  for (let i = 0; i < n; i++) {
    const j = i * 3;
    if (usePull) { const d = deformPoint(basePos[j], basePos[j + 1], basePos[j + 2], baseR[i], faceMask[i]); P[j] = d[0] + ovD[j]; P[j + 1] = d[1] + ovD[j + 1]; P[j + 2] = d[2] + ovD[j + 2]; }
    else { P[j] = basePos[j] + ovD[j]; P[j + 1] = basePos[j + 1] + ovD[j + 1]; P[j + 2] = basePos[j + 2] + ovD[j + 2]; }
  }
  pos.needsUpdate = true;
  bodyGeo.computeVertexNormals(); bodyGeo.computeBoundingSphere();
  const addOv = (b, out, p) => {
    for (let k = 0; k < KNN; k++) { const v = b.idx[p * KNN + k] * 3, w = b.wt[p * KNN + k]; out[p * 3] += ovD[v] * w; out[p * 3 + 1] += ovD[v + 1] * w; out[p * 3 + 2] += ovD[v + 2] * w; }
  };
  for (const f of faceVerts) { evalBind(f.bind, f.base, f.attr.array); for (let p = 0; p < f.bind.n; p++) addOv(f.bind, f.attr.array, p); f.attr.needsUpdate = true; }
  for (const c of faceCaps) { evalBind(c.bind, c.base, _tmp3); addOv(c.bind, _tmp3, 0); c.o.position.fromArray(_tmp3); }
  for (const r of riders) { if (r.o.parent !== squish) continue; evalBind(r.bind, r.base, _tmp3, false); addOv(r.bind, _tmp3, 0); r.o.position.fromArray(_tmp3); }
}
// 重なったら、お互いにへこむ（ゆるい楕円どうしの押し合い）
function updateOverlaps(dt) {
  const vis = insts.filter(i => i.cat.visible);
  const kk = 1 - Math.exp(-dt * 14);
  for (const A of vis) {
    const others = [];
    for (const B of vis) if (B !== A) {
      const dx = A.cat.position.x - B.cat.position.x, dz = A.cat.position.z - B.cat.position.z;
      const R = Math.max(A.bound.rx, A.bound.rz) + Math.max(B.bound.rx, B.bound.rz);
      if (dx * dx + dz * dz < R * R) others.push(B);
    }
    if (!others.length && !A.ovAct) continue;
    const D = A.ovD, BP = A.basePos, FM = A.faceMask, n = BP.length / 3;
    const ax = A.cat.position.x, az = A.cat.position.z, al = A.lift;
    let mx = 0;
    for (let i = 0; i < n; i++) {
      const j = i * 3, wx = BP[j] + ax, wy = BP[j + 1] + al, wz = BP[j + 2] + az;
      let tx = 0, ty = 0, tz = 0;
      for (const B of others) {
        const bd = B.bound, cx = B.cat.position.x + bd.cx, cy = bd.cy + B.lift, cz = B.cat.position.z + bd.cz;
        let ux = (wx - cx) / bd.rx, uy = (wy - cy) / bd.ry, uz = (wz - cz) / bd.rz;
        const r2 = ux * ux + uy * uy + uz * uz;
        if (r2 >= 1) continue;
        let r = Math.sqrt(r2);
        if (r < 0.03) { ux = (ax - B.cat.position.x) || 1; uy = 0; uz = az - B.cat.position.z; const l = Math.hypot(ux, uz) || 1; ux /= l; uz /= l; r = 1; }
        ux /= r; uy /= r; uz /= r;
        tx += (cx + ux * bd.rx - wx) * 0.5; ty += (cy + uy * bd.ry - wy) * 0.5; tz += (cz + uz * bd.rz - wz) * 0.5;
      }
      const pr = 1 - PROT * FM[i];
      tx *= pr; ty *= pr; tz *= pr;
      if (wy + ty < 0.006) ty = 0.006 - wy;
      D[j] += (tx - D[j]) * kk; D[j + 1] += (ty - D[j + 1]) * kk; D[j + 2] += (tz - D[j + 2]) * kk;
      const m = Math.abs(D[j]) + Math.abs(D[j + 1]) + Math.abs(D[j + 2]); if (m > mx) mx = m;
    }
    if (mx > 1e-3) A.ovAct = true;
    else if (A.ovAct) { D.fill(0); A.ovAct = false; A.ovDirty = true; }
  }
}
function applyCharUI(c, key) {
  INK = c.ink; grad.image.data.set(c.grad); grad.needsUpdate = true;
  ring.material.color.set(c.ink); pedLine.uniforms.col.value.set(c.ink);
  ui('plantBtn').style.display = current.rt.plant ? '' : 'none'; if (!current.rt.plant) trayOpen(false);
  updateButtons();
  document.getElementById('cname').textContent = c.name;
  document.documentElement.style.setProperty('--ink', c.inkCss);
  for (const k in CHARS) document.getElementById('ch-' + k).classList.toggle('on', k === key);
}
function cancelPose() {
  if (!pull.active) return;
  pull.off.set(0, 0, 0); pull.vel.set(0, 0, 0); pull.active = pull.held = false; pull.relax = false; pullLift = 0;
  refreshMesh(false);
}
function selectInst(I) {
  if (I === curInst) return;
  cancelPose(); cat.position.y = lift;
  syncInst(); loadState(I);
  applyCharUI(current, curKey);
  jump.phase = 'idle'; jump.y = 0; for (const k in spring) spring[k] = 0;
  leafDrag = false; sfx.grab();
}
function copyActive() {
  if (insts.length >= 6) { toast('MAX 6'); return; }
  cancelPose();
  const s = snap();
  const src = { key: curKey, bodyCol, itemCol, itemAll, plant: current.rt.plantKind, px: cat.position.x };
  syncInst();
  cat = new THREE.Group(); scene.add(cat); squish = null; current = null;
  curInst = { cat }; insts.push(curInst);
  buildCharacter(src.key, { keep: true });
  applySnap(s);
  bodyCol = src.bodyCol; bodyMat.color.set(bodyCol); itemCol = src.itemCol; itemAll = src.itemAll;
  const rt = current.rt;
  if (rt.plant) { if (src.plant === null) rt.clear(); else rt.plant(src.plant); if (itemCol !== null) rt.tint(itemCol, itemAll); }
  const side = insts.length % 2 ? -1 : 1;
  cat.position.x = Math.max(-6, Math.min(6, src.px + side * 1.9)); cat.position.z = 0.3 * (insts.length - 2);
  undoStack = []; updateButtons();
  syncInst(); applyStage(); sfx.sprout(); toast('COPIED · use MOVE to place it');
}
function removeActive() {
  if (insts.length < 2) { toast('Last one stays'); return; }
  const I = curInst, idx = insts.indexOf(I), next = insts[idx ? idx - 1 : 1];
  cancelPose();
  if (current.rt.dispose) current.rt.dispose();
  scene.remove(cat); cat.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  insts.splice(idx, 1);
  loadState(next); applyCharUI(current, curKey); applyStage(); sfx.pluck();
}
ui('copyBtn').onclick = copyActive;
ui('delBtn').onclick = removeActive;
// 床の上でつかんで動かす
let mv = null;
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

let startKey = 'mebae';
try { startKey = localStorage.getItem('mochi-char') || 'mebae'; } catch (e) {}
buildCharacter(startKey);
let last = 0;
renderer.setAnimationLoop(() => {
  const t = clock.getElapsedTime();
  const dt = Math.min(t - last, 1 / 30); last = t;

  // ばね（やわらかめ・減衰ひかえめ＝ぷるぷる）
  const K = anim.on ? 85 : 90, D = anim.on ? 3.9 : 5.5;   // 鑑賞中はよりやわらかく
  for (const k of ['sq', 'sx', 'sz']) {
    const a = -K * spring[k] - D * spring[k + 'V'];
    spring[k + 'V'] += a * dt;
    spring[k] += spring[k + 'V'] * dt;
  }

  // 呼吸 + ばね
  // ジャンプ：ため → 跳ぶ → 着地でどすっ
  let jumpSq = 0;
  if (anim.on) updateAnim(dt);
  if (jump.phase === 'crouch') {
    jump.t += dt;
    const k = Math.min(jump.t / 0.16, 1);
    jumpSq = -0.28 * Math.sin(k * Math.PI * 0.5);           // ぐっとためる
    if (k >= 1) {
      jump.phase = 'air'; jump.vy = 5.2; jump.y = 0;
      spring.sq = -0.28 / 0.18 * 0.6; spring.sqV = 5;               // 縮んだ状態からビヨンと伸びる
      sfx.hop();
    }
  } else if (jump.phase === 'air') {
    jump.vy -= 14 * dt;
    jump.y += jump.vy * dt;
    jumpSq = Math.max(-0.1, Math.min(jump.vy * 0.025, 0.14)); // 上昇中は縦のび、落下中は少し縦のび
    if (jump.y <= 0 && jump.vy < 0) {
      const impact = -jump.vy;
      jump.y = 0; jump.phase = 'idle';
      spring.sqV -= impact * 1.6;                             // どすっとつぶれる
      spring.sxV += (Math.random() - 0.5) * impact * 1.2;     // ぷるぷる横ゆれ
      spring.szV += (Math.random() - 0.5) * impact * 0.8;
      shake = 0.06 + impact * 0.012;
      ringT = 0;
      sfx.thud(impact);
    }
  }
  const breath = jump.phase === 'idle' ? Math.sin(t * 1.8) * 0.018 : 0;
  const sy = 1 + (anim.on ? 0 : breath) + spring.sq * 0.18 + jumpSq + (anim.on ? anim.sq : 0);
  // つぶれ・のびすぎ防止（なめらかに頭打ちして、カクッと止まらない）
  const loR = anim.on ? (anim.kind === 'melt' ? 0.58 : 0.34) : 0.28, hiR = anim.on ? (anim.kind === 'stretch' ? 0.6 : 0.4) : 0.35, dsy = sy - 1;
  const syC = 1 + (dsy > 0 ? hiR * Math.tanh(dsy / hiR) : loR * Math.tanh(dsy / loR));         // つぶれ・のびすぎ防止
  const sxz = 1 / Math.sqrt(syC);
  const shx = 0.3 * Math.tanh((spring.sx * 0.12 + (anim.on ? anim.shx || 0 : 0)) / 0.3), shz = 0.3 * Math.tanh((spring.sz * 0.12 + (anim.on ? anim.sh || 0 : 0)) / 0.3);

  // 床を基準にスケール＋せん断（上ほど大きくゆれる）
  const m = new THREE.Matrix4();
  m.makeTranslation(0, floorY, 0);
  const PF = anim.on ? 1 + (anim.puff || 0) : 1;        // ぷくっとふくらむ（床基準で全体を大きく）
  const shear = new THREE.Matrix4().set(
    sxz * PF, shx * PF, 0, 0,
    0,   syC * PF, 0, 0,
    0,   shz * PF, sxz * PF, 0,
    0,   0,   0, 1);
  m.multiply(shear).multiply(new THREE.Matrix4().makeTranslation(0, -floorY, 0));
  squish.matrix.copy(m);
  squish.matrixWorldNeedsUpdate = true;
  if (current.rt.update) current.rt.update(dt, { shx, shz, sy: syC, vy: jump.phase === 'air' ? jump.vy : 0, pullX: pull.active ? pull.off.x : 0 });

  // 引っ張り：離したら行きすぎながら戻る
  if (pull.active) {
    if (!pull.held && (!RET.hold || pull.relax)) {
      const K2 = RET.k, D2 = RET.d;
      const acc = pull.off.clone().multiplyScalar(-K2).addScaledVector(pull.vel, -D2);
      pull.vel.addScaledVector(acc, dt);
      pull.off.addScaledVector(pull.vel, dt);
    }
    const lifted = Math.max(0, pull.off.y) * (RET.hold ? 0 : 0.5);          // 上に引くと体ごと持ち上がる
    pullLift = lifted;
    if (pull.held) {
      const prev = pull.prevOff || pull.off.clone();
      sfx.stretch(pull.off.length(), prev.distanceTo(pull.off) / Math.max(dt, 1e-3));
      pull.prevOff = pull.off.clone();
    } else {
      pull.prevOff = null;
      if (pull.wasLifted && pull.off.y < 0) { sfx.land(); pull.wasLifted = false; }
    }
    const o = pull.off.clone(); o.y -= lifted;
    const g = pull.grab;
    // つまんだ所は床より下へは行かない（離した後のはね返りでも）
    if (g.y + o.y < floorY + 0.06) o.y = floorY + 0.06 - g.y;
    const L = o.length();
    const sig = 0.42 + L * 0.25, sig2 = sig * sig;
    DF.ox = o.x; DF.oy = o.y; DF.oz = o.z; DF.gx = g.x; DF.gy = g.y; DF.gz = g.z;
    DF.sig2 = sig2; DF.sideK = Math.min(Math.abs(o.x) / (L + 1e-6), 1);
    { const n = pull.n; const inw = n ? THREE.MathUtils.clamp(-(o.x * n.x + o.y * n.y + o.z * n.z) / (L + 1e-6), 0, 1) : 0; DF.shell = 1 - 0.8 * inw; }   // 押しこむときは凹ませてよい
    refreshMesh(true);
    if (!pull.held && pull.off.length() < 0.002 && pull.vel.length() < 0.01) {
      pullLift = 0; pull.active = false; pull.relax = false;
      refreshMesh(false);
    }
  }

  if (flashT >= 0) {
    flashT += dt; const k = Math.max(0, 1 - flashT / 0.6);
    bodyMat.color.set(bodyCol).lerp(new THREE.Color(0xffa561), k * 0.7);
    if (flashT > 0.6) { flashT = -1; bodyMat.color.set(bodyCol); }
  }
  cat.position.y = lift + pullLift + jump.y + (anim.on ? anim.y + (anim.dy || 0) : 0);
  if (insts.length > 1 && !anim.on && !stageOn) {
    updateOverlaps(dt);
    for (const I of insts) {
      if (!I.cat.visible) continue;
      if (I !== curInst) { I.cat.position.y = I.lift; I.rt.update && I.rt.update(dt, { shx: 0, shz: 0, sy: 1, vy: 0, pullX: 0 }); }
      if (I.ovAct || I.ovDirty) { I.ovDirty = false; if (I === curInst) { if (!pull.active) refreshMesh(false); } else runOn(I, () => refreshMesh(false)); }
    }
  }

  // 衝撃リング
  if (ringT >= 0) {
    ringT += dt;
    const k = ringT / 0.45;
    ring.scale.setScalar(1.3 + k * 0.5);
    ring.material.opacity = 0.25 * (1 - k);
    if (k >= 1) { ringT = -1; ring.material.opacity = 0; }
  }

  resize();
  controls.update();
  // 着地でカメラを少しゆらす
  let sh = null;
  if (shake > 0.001) {
    sh = new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5), 0).multiplyScalar(shake);
    camera.position.add(sh);
    shake *= Math.pow(0.0005, dt);   // すぐ収まる
  }
  renderer.render(scene, camera);
  if (sh) camera.position.sub(sh);
});
