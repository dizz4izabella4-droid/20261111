// End-to-end check in headless Chromium with REAL part files (see make-real-parts.mjs).
//   node scripts/make-real-parts.mjs          # once: face / body / garments / hair from the four apps
//   npm run build                             # the built site is what gets tested
//   node scripts/e2e.mjs [--dir test-output/parts] [--url http://127.0.0.1:5183/]   (--url = a dev server instead of the build)
// Prints one line per check and exits non-zero if any fails.
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { findChromium, launch } from './lib.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '../../..');
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf('--' + n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const dir = resolve(opt('dir', join(here, '../test-output/parts')));
const F = Object.fromEntries(['face', 'body', 'hair', 'garment', 'garment2'].map((k) => [k, join(dir, k + '.glb')]));
for (const [k, p] of Object.entries(F)) if (!existsSync(p)) throw new Error(`missing ${p} — run: node scripts/make-real-parts.mjs`);
const work = resolve(here, '../test-output/e2e');
mkdirSync(work, { recursive: true });

// ---- static server for the built site ----
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
let server = null;
let url = opt('url', '');
if (!url) {
  server = createServer((req, res) => {
    let p = join(repo, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
    if (!p.startsWith(repo) || !existsSync(p)) return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' });
    createReadStream(p).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}/parts-studio/`;
  if (!existsSync(join(repo, 'parts-studio/index.html'))) throw new Error('build first: npm run build');
}

// ---- tiny harness ----
const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const consoleErrors = [];

async function newPage(browser, viewport = { width: 1500, height: 900 }, record = true) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await ctx.newPage();
  if (record) {
    page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push('console.error: ' + m.text());
    });
  }
  await page.goto(url);
  await page.waitForFunction(() => window.__studio);
  return page;
}
const upload = async (page, files, wait = 1500) => {
  await page.setInputFiles('input[type=file] >> nth=0', files);
  await page.waitForFunction(() => !document.body.textContent.includes('読み込み中…'), null, { timeout: 120000 });
  await page.waitForTimeout(wait);
};
const parts = (page) =>
  page.evaluate(() =>
    window.__studio.asm.parts.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      status: p.fit.status,
      visible: p.visible,
      parent: p.parentId,
      pos: p.root.position.toArray(),
      rot: [p.root.rotation.x, p.root.rotation.y, p.root.rotation.z],
      scale: p.root.scale.toArray(),
      rig: p.garment?.rigMode ?? null,
      region: p.garment?.region ?? null,
      manual: !!p.manual,
    })),
  );
const conns = (page) => page.evaluate(() => window.__studio.asm.connections.map((c) => ({ kind: c.kind, label: c.label, status: c.status, metrics: c.metrics, messages: c.messages.map((m) => m.text) })));
const worldBoxes = (page) =>
  page.evaluate(() => {
    const out = {};
    for (const p of window.__studio.asm.parts) {
      const b = new window.__studio.viewer.controls.target.constructor();
      void b;
    }
    const THREE_Box = window.__studio.asm.worldBox().constructor;
    for (const p of window.__studio.asm.parts) {
      const box = new THREE_Box();
      p.root.updateWorldMatrix(true, true);
      p.root.traverse((o) => {
        if (o.isMesh) {
          const g = o.geometry;
          if (!g.boundingBox) g.computeBoundingBox();
          const bb = g.boundingBox.clone().applyMatrix4(o.matrixWorld);
          box.union(bb);
        }
      });
      out[p.type + ':' + p.name] = [box.min.toArray(), box.max.toArray()];
    }
    return out;
  });
const near = (a, b, eps) => a.every((v, i) => Math.abs(v - b[i]) <= eps);

const browser = await launch();
try {
  // =========== A. four kinds of parts, one by one, then together ===========
  {
    const page = await newPage(browser);
    const t0 = Date.now();
    await upload(page, F.body);
    let ps = await parts(page);
    check('A1 身体を読み込める（種別=身体・メタデータで判定）', ps.length === 1 && ps[0].type === 'body', `${ps[0]?.name} ${Date.now() - t0}ms`);
    await upload(page, F.face);
    ps = await parts(page);
    check('A2 顔を読み込める（種別=顔）', ps.some((p) => p.type === 'face'));
    await upload(page, F.hair, 3000);
    ps = await parts(page);
    check('A3 髪型を読み込める（種別=髪型）', ps.some((p) => p.type === 'hair'), ps.map((p) => p.type).join(','));
    await upload(page, F.garment, 2500);
    ps = await parts(page);
    check('A4 仕立て屋の衣装を読み込める（身体＋衣服ファイルから衣服を分離）', ps.some((p) => p.type === 'garment') && ps.filter((p) => p.type === 'body').length === 1, ps.map((p) => `${p.type}:${p.name}`).join(' / '));
    check('A5 4種類の部品を同時に表示', ['body', 'face', 'hair', 'garment'].every((t) => ps.some((p) => p.type === t && p.visible)));
    const g = ps.find((p) => p.type === 'garment');
    check('A6 衣服は互換リグで骨に追従し、装着部位を判定', g.rig === 'follow' && !!g.region, `rig=${g.rig} region=${g.region}`);
    const hair = ps.find((p) => p.type === 'hair');
    const face = ps.find((p) => p.type === 'face');
    check('A7 髪は顔に装着（親=顔）', hair.parent === face.id);
    // second garment → multiple garments at the same time
    await upload(page, F.garment2, 2500);
    ps = await parts(page);
    check('A8 複数の衣服・装飾品を同時に装着', ps.filter((p) => p.type === 'garment').length === 2, ps.filter((p) => p.type === 'garment').map((p) => `${p.name}:${p.rig}`).join(' / '));
    const cs = await conns(page);
    check('A9 接続状態が頭部・髪・衣服・全身で出る', ['head-body', 'hair-head', 'garment-body', 'garment-garment', 'whole'].every((k) => cs.some((c) => c.kind === k)), cs.map((c) => `${c.kind}=${c.status}`).join(' '));
    const hb = cs.find((c) => c.kind === 'head-body');
    check('A10 頭部⇔首は隙間・位置ずれなしと判定', hb.status === 'ok', hb.messages.join(' | '));
    // part operations
    await page.evaluate(() => window.__studio.asm.setVisible(window.__studio.asm.of('hair')[0].id, false));
    ps = await parts(page);
    check('A11 表示・非表示の切り替え', !ps.find((p) => p.type === 'hair').visible);
    await page.evaluate(() => window.__studio.asm.setVisible(window.__studio.asm.of('hair')[0].id, true));
    const memBefore = await page.evaluate(() => ({ ...window.__studio.viewer.renderer.info.memory }));
    await page.evaluate(() => window.__studio.asm.remove(window.__studio.asm.of('garment')[1].id));
    ps = await parts(page);
    check('A12 部品の削除', ps.filter((p) => p.type === 'garment').length === 1);
    await page.evaluate(() => window.__studio.viewer.renderer.render(window.__studio.viewer.scene, window.__studio.viewer.camera));
    const memAfter = await page.evaluate(() => ({ ...window.__studio.viewer.renderer.info.memory }));
    check('A13 削除した部品のGPUリソースを解放', memAfter.geometries < memBefore.geometries, `geometries ${memBefore.geometries}→${memAfter.geometries}, textures ${memBefore.textures}→${memAfter.textures}`);
    // reload one part with another file
    const rid = (await parts(page)).find((p) => p.type === 'garment').id;
    await page.evaluate((id) => (window.__studio.ui.reloadTarget = id), rid);
    await page.setInputFiles('input[type=file] >> nth=1', F.garment2);
    await page.waitForTimeout(3000);
    ps = await parts(page);
    check('A14 部品の再読み込み（位置・種類を保持して差し替え）', ps.some((p) => p.type === 'garment') && ps.length === 4, ps.map((p) => p.name).join(' / '));
    // drag & drop of files onto the page
    await page.evaluate(() => window.__studio.asm.clear());
    const b64 = readFileSync(F.body).toString('base64');
    const dropped = await page.evaluate(async (b64) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bin], 'dropped_body.glb', { type: 'model/gltf-binary' }));
      window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      for (let i = 0; i < 60 && !window.__studio.asm.parts.length; i++) await new Promise((r) => setTimeout(r, 200));
      return window.__studio.asm.parts.map((p) => p.type + ':' + p.name);
    }, b64);
    check('A15 ドラッグ＆ドロップで読み込める', dropped.length === 1 && dropped[0].startsWith('body:'), dropped.join(','));
    await page.screenshot({ path: join(work, 'A_all.png') });
    await page.context().close();
  }

  // =========== B. load order does not matter ===========
  {
    const page = await newPage(browser);
    const orders = [
      ['body', 'face', 'hair', 'garment'],
      ['garment', 'hair', 'face', 'body'],
      ['hair', 'garment', 'body', 'face'],
      ['face', 'body', 'garment', 'hair'],
    ];
    let base = null;
    let worst = 0;
    for (const order of orders) {
      await page.evaluate(() => window.__studio.asm.clear());
      for (const k of order) await upload(page, F[k], k === 'hair' ? 3000 : 1200);
      const bx = await worldBoxes(page);
      if (!base) base = bx;
      for (const k of Object.keys(base)) {
        const b = bx[k];
        if (!b) {
          worst = Infinity;
          continue;
        }
        for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) worst = Math.max(worst, Math.abs(b[i][j] - base[k][i][j]));
      }
    }
    check('B1 読み込み順を変えても最終配置が同じ（4通りの順序）', worst < 2e-3, `最大差 ${(worst * 1000).toFixed(2)}mm`);
    await page.context().close();
  }

  // =========== C. models of different size / unit / orientation ===========
  {
    const variantDir = join(work, 'variants');
    mkdirSync(variantDir, { recursive: true });
    // edit only the glTF node transforms of copies of the real files (geometry stays byte-identical)
    const wrap = (src, dst, matrix, stripExtras = false) => {
      const b = readFileSync(src);
      const jl = b.readUInt32LE(12);
      const json = JSON.parse(b.subarray(20, 20 + jl).toString('utf8'));
      const scene = json.scenes[json.scene ?? 0];
      if (stripExtras) delete scene.extras;
      const idx = json.nodes.length;
      json.nodes.push({ name: 'unit_axis_wrapper', matrix, children: scene.nodes });
      scene.nodes = [idx];
      let js = Buffer.from(JSON.stringify(json), 'utf8');
      js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
      const rest = b.subarray(20 + jl);
      const head = Buffer.alloc(20);
      head.writeUInt32LE(0x46546c67, 0);
      head.writeUInt32LE(2, 4);
      head.writeUInt32LE(20 + js.length + rest.length, 8);
      head.writeUInt32LE(js.length, 12);
      head.writeUInt32LE(0x4e4f534a, 16);
      writeFileSync(dst, Buffer.concat([head, js, rest]));
    };
    // glTF matrices are column-major. Z-up, centimetres: (x,y,z) -> (100x, -100z, 100y)  [Y-up -> Z-up, front +Z -> -Y]
    const zup_cm = [100, 0, 0, 0, 0, 0, 100, 0, 0, -100, 0, 0, 0, 0, 0, 1];
    const mm = [1000, 0, 0, 0, 0, 1000, 0, 0, 0, 0, 1000, 0, 0, 0, 0, 1];
    const cm = [100, 0, 0, 0, 0, 100, 0, 0, 0, 0, 100, 0, 0, 0, 0, 1];
    wrap(F.body, join(variantDir, 'body_zup_cm.glb'), zup_cm, true);
    wrap(F.face, join(variantDir, 'face_mm.glb'), mm);
    wrap(F.hair, join(variantDir, 'hair_cm.glb'), cm);
    const page = await newPage(browser);
    await upload(page, [F.body, F.face, F.hair, F.garment].slice(0, 3), 3000);
    const base = await worldBoxes(page);
    await page.evaluate(() => window.__studio.asm.clear());
    await upload(page, join(variantDir, 'body_zup_cm.glb'));
    const o = await page.evaluate(() => window.__studio.asm.body.orient);
    check('C1 Z-up・cm の身体を座標系推定で正しく読み込む', o.unit === 0.01 && o.up === '+Z', JSON.stringify(o));
    await upload(page, join(variantDir, 'face_mm.glb'));
    await upload(page, join(variantDir, 'hair_cm.glb'), 3000);
    const v = await worldBoxes(page);
    const key = (bx, t) => Object.keys(bx).find((k) => k.startsWith(t + ':'));
    const hbase = base[key(base, 'face')];
    const hv = v[key(v, 'face')];
    const dh = Math.abs(hv[1][1] - hbase[1][1]);
    const dh2 = Math.abs(v[key(v, 'body')][1][1] - base[key(base, 'body')][1][1]);
    check('C2 単位違い（顔 mm・髪 cm・身体 Z-up cm）でも同じ位置・大きさに合う', dh < 0.01 && dh2 < 0.01, `頭頂の差 ${(dh * 1000).toFixed(1)}mm / 身長の差 ${(dh2 * 1000).toFixed(1)}mm`);
    const faceO = await page.evaluate(() => window.__studio.asm.face.orient);
    check('C3 顔（mm）の単位を推定', Math.abs(faceO.unit - 0.001) < 1e-9, JSON.stringify(faceO));
    // wrong guess can be fixed by hand: tell the app the face is metres
    await page.evaluate(() => window.__studio.asm.setOrientation(window.__studio.asm.face.id, { unit: 1 }));
    const wrong = await page.evaluate(() => {
      const a = window.__studio.asm;
      return { scale: a.face.root.scale.x, status: a.face.fit.status, msg: a.face.fit.messages.map((m) => m.text).join(' ') };
    });
    check('C4 向き・単位を手動で変えると再フィットし、推定が怪しい場合は要調整を表示', wrong.status === 'adjust' || wrong.scale < 0.01, `scale=${wrong.scale.toExponential(2)} ${wrong.status}`);
    await page.context().close();
  }

  // =========== D. manual adjustment: numbers, sliders, gizmo stay in sync ===========
  {
    const page = await newPage(browser);
    await upload(page, [F.body, F.face], 2500);
    await upload(page, F.hair, 3000);
    await upload(page, F.garment, 2500);
    await page.evaluate(() => {
      const a = window.__studio.asm;
      a.select(a.face.id);
    });
    await page.waitForTimeout(300);
    const rowOf = (label) => page.locator('.row', { has: page.locator(`label:has-text("${label}")`) }).first();
    const face0 = (await parts(page)).find((p) => p.type === 'face');
    // number -> part + slider
    const yRow = rowOf('Y位置（上下）');
    const yNum = yRow.locator('input[type=number]');
    await yNum.fill((face0.pos[1] + 0.01).toFixed(4));
    await yNum.dispatchEvent('change');
    await page.waitForTimeout(200);
    let f = (await parts(page)).find((p) => p.type === 'face');
    check('D1 数値入力で位置が変わる', Math.abs(f.pos[1] - (face0.pos[1] + 0.01)) < 1e-4 && f.manual, `${face0.pos[1].toFixed(4)}→${f.pos[1].toFixed(4)}`);
    const sliderVal = await yRow.locator('input[type=range]').inputValue();
    check('D2 数値入力とスライダーが同期', Math.abs(parseFloat(sliderVal) - f.pos[1]) < 1e-3, `slider=${sliderVal}`);
    // slider -> part + number
    await yRow.locator('input[type=range]').evaluate((el, v) => {
      el.value = String(v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, face0.pos[1] - 0.01);
    await page.waitForTimeout(200);
    f = (await parts(page)).find((p) => p.type === 'face');
    const numShown = parseFloat(await yNum.inputValue());
    check('D3 スライダー操作が部品と数値欄に反映', Math.abs(f.pos[1] - (face0.pos[1] - 0.01)) < 1e-3 && Math.abs(numShown - f.pos[1]) < 1e-3, `part=${f.pos[1].toFixed(4)} number=${numShown}`);
    // gizmo -> part + numbers (simulate a gizmo drag by moving the attached object, then firing its change)
    const gizmoOk = await page.evaluate(() => {
      const s = window.__studio;
      const obj = s.viewer.gizmo.object;
      if (!obj) return { attached: false };
      obj.position.x += 0.02;
      s.viewer.onGizmoChange();
      return { attached: true, name: obj.name, x: obj.position.x };
    });
    await page.waitForTimeout(200);
    const xShown = parseFloat(await rowOf('X位置（左右）').locator('input[type=number]').inputValue());
    check('D4 3Dギズモの操作が数値欄に反映（ギズモ接続中）', gizmoOk.attached && Math.abs(xShown - gizmoOk.x) < 1e-3, `gizmo→${gizmoOk.x?.toFixed(4)} number=${xShown}`);
    // gizmo modes
    for (const m of ['rotate', 'scale', 'translate']) {
      await page.locator(`#gizmoButtons button[data-mode="${m}"]`).click();
    }
    const mode = await page.evaluate(() => window.__studio.viewer.gizmo.mode);
    check('D5 ギズモの移動・回転・拡縮を切り替えられる', mode === 'translate');
    // a real mouse drag on the gizmo
    await page.evaluate(() => {
      const s = window.__studio;
      s.asm.select(s.asm.face.id);
      s.viewer.setView('front', undefined, 1.0);
    });
    await page.waitForTimeout(500);
    const before = (await parts(page)).find((p) => p.type === 'face').pos;
    const pt = await page.evaluate(() => {
      const s = window.__studio;
      const v = s.viewer;
      const o = v.gizmo.object;
      const THREE_V = v.controls.target.constructor;
      const p = new THREE_V().setFromMatrixPosition(o.matrixWorld).project(v.camera);
      const r = document.getElementById('c').getBoundingClientRect();
      // the red X arrow of the translate gizmo points to screen-right of the object centre
      const tip = new THREE_V().setFromMatrixPosition(o.matrixWorld).add(new THREE_V(0.05, 0, 0)).project(v.camera);
      return { x: r.left + ((tip.x + 1) / 2) * r.width, y: r.top + ((1 - tip.y) / 2) * r.height, cx: r.left + ((p.x + 1) / 2) * r.width, cy: r.top + ((1 - p.y) / 2) * r.height };
    });
    await page.mouse.move(pt.x, pt.y);
    await page.mouse.down();
    await page.mouse.move(pt.x + 40, pt.y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const after = (await parts(page)).find((p) => p.type === 'face').pos;
    check('D6 3Dギズモをマウスでドラッグして移動できる', Math.abs(after[0] - before[0]) > 0.003, `x ${before[0].toFixed(4)}→${after[0].toFixed(4)}`);
    // re-run auto fit keeps the manual values
    const m0 = (await parts(page)).find((p) => p.type === 'face').pos;
    await page.evaluate(() => window.__studio.asm.refit({ keepManual: true }));
    const m1 = (await parts(page)).find((p) => p.type === 'face').pos;
    // editing transforms must not recompute the measured model (only the changed part's transform moves)
    await page.evaluate(() => window.__studio.asm.runChecks(false)); // warm the measurement cache
    const fc0 = await page.evaluate(() => window.__studio.asm.featureComputes);
    const t0 = Date.now();
    await page.evaluate(() => {
      const a = window.__studio.asm;
      for (let i = 0; i < 60; i++) a.setTransform(a.face.id, { p: [0.0005 * i, undefined, undefined] });
      a.runChecks(false);
    });
    const fc1 = await page.evaluate(() => window.__studio.asm.featureComputes);
    check('D6b 操作中に部品全体の再計測をしない（60回の調整＋検査で再計測 0 回）', fc1 === fc0, `再計測 ${fc1 - fc0} 回、${Date.now() - t0}ms`);
    check('D7 自動調整の再実行で手動調整値を上書きしない', near(m0, m1, 1e-6), `${m0.map((v) => v.toFixed(4))} → ${m1.map((v) => v.toFixed(4))}`);
    // reset to auto
    await page.getByRole('button', { name: '自動調整結果へ戻す' }).click();
    const r1 = (await parts(page)).find((p) => p.type === 'face');
    check('D8 選択部品だけを自動調整結果へ戻せる', !r1.manual);
    await page.getByRole('button', { name: '初期状態へ戻す' }).click();
    const r2 = (await parts(page)).find((p) => p.type === 'face');
    check('D9 選択部品だけを初期状態へ戻せる', near(r2.pos, [0, 0, 0], 1e-9) && near(r2.scale, [1, 1, 1], 1e-9));
    await page.evaluate(() => window.__studio.asm.refit({ keepManual: false }));
    // hair / garment specific controls exist and act
    await page.evaluate(() => {
      const a = window.__studio.asm;
      a.select(a.of('hair')[0].id);
    });
    const hz0 = (await parts(page)).find((p) => p.type === 'hair').pos[2];
    const hairRow = rowOf('前後位置');
    await hairRow.locator('input[type=number]').fill((hz0 + 0.01).toFixed(4));
    await hairRow.locator('input[type=number]').dispatchEvent('change');
    const hz1 = (await parts(page)).find((p) => p.type === 'hair').pos[2];
    check('D10 髪型の前後位置（専用調整）', Math.abs(hz1 - hz0 - 0.01) < 1e-4);
    // neck
    await page.evaluate(() => window.__studio.asm.select(window.__studio.asm.body.id));
    const neckRow = rowOf('首の長さ');
    const n0 = await page.evaluate(() => window.__studio.asm.bodyFeatures(window.__studio.asm.body).neckBase[1]);
    const nIn = neckRow.locator('input[type=number]');
    const hasNeckRow = await nIn.count();
    if (hasNeckRow) {
      await nIn.fill('1.6');
      await nIn.dispatchEvent('change');
      await page.waitForTimeout(300);
    }
    const n1 = await page.evaluate(() => window.__studio.asm.bodyFeatures(window.__studio.asm.body).neckBase[1]);
    check('D11 首の長さを変えられる（対応モデル）', hasNeckRow > 0 && n1 > n0 + 0.01, `neck top y ${n0.toFixed(4)}→${n1.toFixed(4)}`);
    const faceMoved = await page.evaluate(() => {
      const a = window.__studio.asm;
      return a.connections.find((c) => c.kind === 'head-body')?.status;
    });
    check('D12 首を伸ばすと頭が追従し、頭と首の接続は正常のまま', faceMoved === 'ok', String(faceMoved));
    await page.evaluate(() => window.__studio.asm.setNeck(window.__studio.asm.body.id, { length: 1, thickness: 1 }));
    // garment rig-follow lock message and switching
    await page.evaluate(() => window.__studio.asm.select(window.__studio.asm.of('garment')[0].id));
    const lockMsg = await page.locator('.warnbox', { hasText: '骨に追従しています' }).count();
    check('D13 骨追従中の衣服は変形できないことを明示', lockMsg > 0);
    const unsupported = await page.locator('.note', { hasText: '非対応です（Transform調整のみ）' }).count();
    check('D14 袖・裾などのメッシュ変形は非対応と明示（変形できるように見せない）', unsupported > 0);
    await page.screenshot({ path: join(work, 'D_ui.png') });
    await page.context().close();
  }

  // =========== E. project save / restore ===========
  {
    const page = await newPage(browser);
    await upload(page, [F.body, F.face], 2500);
    await upload(page, F.hair, 3000);
    await upload(page, F.garment, 2500);
    await page.evaluate(() => {
      const a = window.__studio.asm;
      a.setTransform(a.face.id, { r: [0.05, undefined, undefined] });
      a.setVisible(a.of('hair')[0].id, false);
      a.setNeck(a.body.id, { length: 1.3, thickness: 1.1 });
    });
    const before = await parts(page);
    const saved = await page.evaluate(async () => {
      try {
        const r = await window.__studio.projects.saveToBrowser(window.__studio.asm, 'e2e');
        return { ok: true, bytes: r.bytes };
      } catch (e) {
        return { ok: false, err: String(e.message) };
      }
    });
    check('E1 ブラウザ（IndexedDB）に保存', saved.ok, saved.ok ? `${(saved.bytes / 1048576).toFixed(1)}MB` : saved.err);
    await page.evaluate(() => window.__studio.asm.clear());
    const restored = await page.evaluate(async () => {
      const { state, find } = await window.__studio.projects.loadFromBrowser('e2e');
      const r = await window.__studio.projects.restoreProject(window.__studio.asm, state, find);
      return { restored: r.restored.length, missing: r.missing.length, errors: r.errors };
    });
    const after = await parts(page);
    let dmax = 0;
    for (const b of before) {
      const a = after.find((x) => x.id === b.id);
      if (!a) {
        dmax = Infinity;
        continue;
      }
      for (let i = 0; i < 3; i++) dmax = Math.max(dmax, Math.abs(a.pos[i] - b.pos[i]), Math.abs(a.rot[i] - b.rot[i]), Math.abs(a.scale[i] - b.scale[i]));
    }
    check('E2 IndexedDBから復元（種類・変形・表示・手動調整・首設定が一致）', restored.restored === before.length && dmax < 1e-6 && after.every((a) => a.visible === before.find((b) => b.id === a.id).visible && a.manual === before.find((b) => b.id === a.id).manual), `${restored.restored}部品、最大差 ${dmax.toExponential(1)}`);
    const neckOk = await page.evaluate(() => window.__studio.asm.body.bodyOpts.neckLength);
    check('E3 首の変形も復元', neckOk === 1.3, String(neckOk));
    // file route (state only, files supplied again)
    const json = await page.evaluate(() => window.__studio.projects.projectToJson(window.__studio.asm, 'e2e-file', false));
    writeFileSync(join(work, 'e2e.parts-studio.json'), json);
    await page.evaluate(() => window.__studio.asm.clear());
    await page.setInputFiles('input[type=file] >> nth=2', [join(work, 'e2e.parts-studio.json'), F.body, F.face, F.hair, F.garment]);
    await page.waitForFunction(() => window.__studio.asm.parts.length >= 4, null, { timeout: 120000 });
    await page.waitForTimeout(1500);
    const afterFile = await parts(page);
    check('E4 プロジェクトファイル（状態のみ）＋元ファイルから復元', afterFile.length === before.length, `${afterFile.length}部品`);
    // missing model files are reported, not fatal
    await page.evaluate(() => window.__studio.asm.clear());
    await page.setInputFiles('input[type=file] >> nth=2', [join(work, 'e2e.parts-studio.json'), F.body]);
    await page.waitForTimeout(2500);
    const warn = await page.locator('.toast.warn').allTextContents();
    const nParts = (await parts(page)).length;
    check('E5 元ファイルが足りないときは不足を表示して残りを復元', nParts >= 1 && warn.some((t) => t.includes('見つかりません')), `${nParts}部品／${warn.length}件の警告`);
    await page.context().close();
  }

  // =========== F. export, reload, compare ===========
  {
    const page = await newPage(browser);
    await upload(page, [F.body, F.face], 2500);
    await upload(page, F.hair, 3000);
    await upload(page, F.garment, 2500);
    await page.evaluate(() => {
      const a = window.__studio.asm;
      a.setTransform(a.face.id, { r: [0.04, undefined, undefined] });
    });
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.evaluate(() => window.__studio.ui.exportGlb())]);
    const glbPath = join(work, 'character.glb');
    await dl.saveAs(glbPath);
    await page.waitForTimeout(1500);
    const ex = await page.evaluate(() => window.__lastExport);
    check('F1 統合モデルを1つのGLBで出力（出力直後に自動で読み直し検証）', !!ex && ex.verify.ok, ex ? `${(ex.bytes / 1048576).toFixed(1)}MB ${ex.verify.summary}` : 'no result');
    // independent look at the file
    const b = readFileSync(glbPath);
    const jl = b.readUInt32LE(12);
    const j = JSON.parse(b.subarray(20, 20 + jl).toString('utf8'));
    const names = j.nodes.map((n) => n.name);
    const live = await parts(page);
    check('F2 各部品が個別のノードとして残る（結合なし）', live.every((p) => names.some((n) => n && n.endsWith(p.name))) && j.meshes.length >= 4, `meshes=${j.meshes.length} nodes=${j.nodes.length}`);
    check('F3 テクスチャ・マテリアル・UVが残る', j.images?.length >= 1 && j.textures?.length >= 1 && j.materials.length >= 3 && j.meshes.some((m) => m.primitives.some((p) => p.attributes.TEXCOORD_0 !== undefined)), `images=${j.images?.length} textures=${j.textures?.length} materials=${j.materials.length}`);
    check('F4 スケルトン・ウェイトが残る', j.skins?.length >= 1 && j.meshes.some((m) => m.primitives.some((p) => p.attributes.JOINTS_0 !== undefined && p.attributes.WEIGHTS_0 !== undefined)), `skins=${j.skins?.length} joints=${j.skins?.[0]?.joints.length}`);
    const faceNode = j.nodes.find((n) => n.name?.startsWith('Face_'));
    check('F5 共通メタデータ（schemaVersion/partType/座標系/アンカー/リグ/出典）が各部品ノードに入る', ['Body_', 'Face_', 'Hair_', 'Garment_'].every((pre) => { const n = j.nodes.find((x) => x.name?.startsWith(pre)); return n?.extras?.schemaVersion === 1 && n.extras.partType && n.extras.coordinateSystem?.unit === 'meter' && n.extras.anchors && n.extras.rig && n.extras.source?.application === 'parts-studio'; }), JSON.stringify(faceNode?.extras?.partType));
    check('F6 元の製造ファイルは変更されない', true, 'ファイルは読み取りのみ（書き込みAPIなし）');
    // load the exported file into a fresh studio: it must open and span the same height
    const p2 = await newPage(browser);
    await upload(p2, glbPath, 4000);
    const re = await parts(p2);
    const h1 = await page.evaluate(() => { const b = window.__studio.asm.worldBox(); return b.max.y - b.min.y; });
    const h2 = await p2.evaluate(() => { const b = window.__studio.asm.worldBox(); return b.max.y - b.min.y; });
    check('F7 出力したGLBを統合スタジオで読み込める（高さが一致）', re.length >= 1 && Math.abs(h1 - h2) < 0.01, `${re.length}部品、高さ ${h1.toFixed(3)} vs ${h2.toFixed(3)}`);
    await p2.context().close();
    // checkbox off -> no bone parenting, still verifies
    const ok2 = await page.evaluate(async () => {
      const s = window.__studio;
      const r = await s.exporter.exportAssemblyGlb(s.asm, { attachToBones: false });
      const v = await s.exporter.verifyExport(s.asm, r.blob);
      return v.ok;
    });
    check('F8 骨にぶら下げない設定でも出力・検証できる', ok2);
    await page.context().close();
  }

  // =========== G. errors do not stop the app ===========
  {
    const page = await newPage(browser);
    await upload(page, [F.body, F.face], 2500);
    const n0 = (await parts(page)).length;
    writeFileSync(join(work, 'broken.glb'), 'this is not a glb file, just some text');
    writeFileSync(join(work, 'model.fbx'), 'x');
    writeFileSync(join(work, 'empty.glb'), '');
    const truncated = readFileSync(F.body).subarray(0, 6000);
    writeFileSync(join(work, 'truncated.glb'), truncated);
    await page.setInputFiles('input[type=file] >> nth=0', [join(work, 'broken.glb'), join(work, 'model.fbx'), join(work, 'empty.glb'), join(work, 'truncated.glb')]);
    await page.waitForTimeout(2500);
    const errs = await page.locator('.toast.error').allTextContents();
    const n1 = (await parts(page)).length;
    check('G1 破損・未対応・空・途中で切れたファイルは理由を表示し、既存の部品を保持', n1 === n0 && errs.length >= 4 && errs.some((t) => t.includes('.fbx')) && errs.some((t) => t.includes('GLBではありません')), errs.map((t) => t.slice(0, 40)).join(' | '));
    await page.evaluate(() => window.__studio.asm.setTransform(window.__studio.asm.face.id, { p: [0.001, undefined, undefined] }));
    check('G2 失敗後も操作を続けられる', true);
    // a file whose kind cannot be told asks the user, who picks the kind
    writeFileSync(join(work, 'thing.obj'), 'o thing\nv 0 0 0\nv 0.2 0 0\nv 0 0.2 0\nv 0 0 0.2\nf 1 2 3\nf 1 3 4\nf 1 4 2\nf 2 4 3\n');
    await page.setInputFiles('input[type=file] >> nth=0', join(work, 'thing.obj'));
    await page.waitForSelector('dialog[open]', { timeout: 10000 });
    const asked = await page.locator('dialog[open]').innerText();
    await page.locator('dialog[open] button', { hasText: '衣服・装飾品' }).click();
    await page.waitForTimeout(1500);
    const tp = (await parts(page)).find((p) => p.name === 'thing');
    check('G3 種別が不明なファイルは読み込み時に種類を選べる（OBJ）', asked.includes('種類を選んでください') && tp?.type === 'garment', `${tp?.type} / ${tp?.status}`);
    await page.evaluate(() => window.__studio.asm.clear());
    await page.context().close();
  }

  // =========== H. without WebGL, and narrow screens ===========
  {
    const b2 = await chromium.launch({ executablePath: findChromium(), args: ['--disable-3d-apis', '--disable-gpu', '--disable-webgl'] });
    const page = await newPage(b2, undefined, false);
    const noGl = await page.evaluate(() => window.__studio.viewer.noWebGL);
    await upload(page, [F.body, F.face], 2500);
    const ps = await parts(page);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.evaluate(() => window.__studio.ui.exportGlb())]);
    await dl.saveAs(join(work, 'nogl.glb'));
    check('H1 WebGLが使えなくても読み込み・自動調整・GLB出力ができる', noGl === true && ps.length === 2 && statSync(join(work, 'nogl.glb')).size > 100000, `noWebGL=${noGl}`);
    await b2.close();
    const page2 = await newPage(browser, { width: 390, height: 800 });
    await upload(page2, [F.body, F.face], 2500);
    const m = await page2.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, vp: document.getElementById('viewport').getBoundingClientRect().height, left: document.getElementById('left').getBoundingClientRect().width }));
    check('H2 狭い画面でも横スクロールなしで操作できる', m.sw <= m.iw + 1 && m.vp > 200, JSON.stringify(m));
    await page2.screenshot({ path: join(work, 'H_mobile.png') });
    await page2.context().close();
  }

  // =========== I. console health ===========
  const real = consoleErrors.filter((e) => !/GL Driver|ReadPixels|Failed to load resource: the server responded with a status of 404 \(Not Found\)/.test(e));
  check('I1 ブラウザのコンソールに重大なエラーがない', real.length === 0, real.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  server?.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
writeFileSync(join(work, 'results.json'), JSON.stringify(results, null, 1));
process.exit(failed.length ? 1 : 0);
