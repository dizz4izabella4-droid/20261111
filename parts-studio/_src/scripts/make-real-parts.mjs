// Produce REAL part files by running the four existing apps (no model is made up here):
//   face.glb      : the head GLB embedded in the 顔 app (elena-head/index.html)
//   body.glb      : the スペアボディ sample body GLB kept in the repository (kugutsu/samples)
//   garment*.glb  : 仕立て屋 driven headlessly: it fits a preset outfit to that body and exports its GLB
//   hair.glb      : 髪型 (hair-studio) driven headlessly. The app has no GLB export, so its strand
//                   geometry is baked here exactly as its vertex shader widens the ribbons.
// Output: _src/test-output/parts/  (git-ignored).   Needs network for the three.js r128 CDN used by hair-studio.
//   node scripts/make-real-parts.mjs [--body path/to/body.glb] [--density 0.08]
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './lib.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '../../..');
const out = resolve(here, '../test-output/parts');
mkdirSync(out, { recursive: true });
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf('--' + n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const bodySrc = resolve(opt('body', join(repo, 'kugutsu/samples/spare_body_female.glb')));
const density = Number(opt('density', '0.08'));

// 1. face
const html = readFileSync(join(repo, 'elena-head/index.html'), 'utf8');
const m = /ELENA_GLB_B64="([A-Za-z0-9+/=]+)"/.exec(html);
if (!m) throw new Error('elena-head/index.html has no embedded GLB');
writeFileSync(join(out, 'face.glb'), Buffer.from(m[1], 'base64'));
// 2. body
copyFileSync(bodySrc, join(out, 'body.glb'));
console.log('face.glb / body.glb written');

// tiny static server for the repository root
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary' };
const server = createServer((req, res) => {
  const p = join(repo, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(repo) || !existsSync(p) || statSync(p).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' });
  createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await launch();
try {
  // 3. garments from 仕立て屋
  for (const [preset, file] of [['魔術師', 'garment.glb'], ['踊り子', 'garment2.glb']]) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
    const page = await ctx.newPage();
    await page.goto(base + '/shitateya/index.html');
    await page.waitForTimeout(3500);
    await page.setInputFiles('#open-body', bodySrc);
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: preset }).click();
    await page.waitForTimeout(2000);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.locator('#export').click()]);
    await dl.saveAs(join(out, file));
    console.log(file, 'from 仕立て屋 preset', preset);
    await ctx.close();
  }
  // 4. hair from 髪型 (baked)
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.goto(base + '/hair-studio/index.html');
  await page.waitForTimeout(5000);
  await page.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/exporters/GLTFExporter.js' });
  const b64 = await page.evaluate(async (dens) => {
    for (const k of Object.keys(CFG.parts)) CFG.parts[k].dens = dens;
    rebuild();
    await new Promise((r) => setTimeout(r, 1500));
    const g = new THREE.Group();
    g.name = 'hair';
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a2418, roughness: 0.55, side: THREE.DoubleSide, name: 'hair_brown' });
    const names = ['bangs', 'base', 'side_left', 'side_right', 'back', 'nape', 'ponytail', 'flyaways'];
    let n = 0;
    scene.children.forEach((c) => {
      if (!(c.isMesh && c.material === hairMat)) return;
      const geo = c.geometry;
      const pos = geo.attributes.position, tang = geo.attributes.tang, side = geo.attributes.side, info = geo.attributes.info;
      const P = new Float32Array(pos.count * 3), N = new Float32Array(pos.count * 3);
      const t = new THREE.Vector3(), V = new THREE.Vector3(), R = new THREE.Vector3(), p0 = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        p0.fromBufferAttribute(pos, i);
        t.fromBufferAttribute(tang, i).normalize();
        V.copy(p0).normalize(); // ribbons face outward from the head centre
        R.crossVectors(t, V).normalize();
        const tp = 1 - 0.8 * THREE.MathUtils.smoothstep(info.getX(i), 0.62, 1);
        const w = 0.005 * tp * (0.75 + 0.5 * info.getZ(i)) * side.getX(i); // the shader's own width formula
        P.set([p0.x + R.x * w, p0.y + R.y * w, p0.z + R.z * w], i * 3);
        N.set([V.x, V.y, V.z], i * 3);
      }
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.BufferAttribute(P, 3));
      bg.setAttribute('normal', new THREE.BufferAttribute(N, 3));
      if (geo.index) bg.setIndex(geo.index);
      const mesh = new THREE.Mesh(bg, mat);
      mesh.name = 'hair_' + (names[n] || n);
      n++;
      g.add(mesh);
    });
    const buf = await new Promise((res, rej) => new THREE.GLTFExporter().parse(g, res, { binary: true }, rej));
    const u8 = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(s);
  }, density);
  writeFileSync(join(out, 'hair.glb'), Buffer.from(b64, 'base64'));
  console.log('hair.glb from 髪型 (strand density', density + ')');
} finally {
  await browser.close();
  server.close();
}
console.log('done ->', out);
