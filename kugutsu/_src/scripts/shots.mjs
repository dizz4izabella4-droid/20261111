// Fixed-view screenshots (SPEC 13.2).
//   npm run shots -- [--project projects/default.json] [--milestone M1] [--preset standard] [--ui] [--built]
// --built serves the production build (photo-tex/index.html + assets/) instead of the dev server.
// Loads the app (Vite dev server, local only) in headless Chromium via Playwright, loads the
// project file, and saves 4 fixed views (front, 3/4 front-left, left side, back) to
// ../screenshots/<milestone>/. Camera distance, target and lighting are fixed in src/viewer.ts.
import { createServer, preview } from 'vite';
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const projectPath = resolve(process.cwd(), opt('project', join(root, 'projects/default.json')));
const milestone = opt('milestone', 'M1');
const presetOverride = opt('preset', null);
const withUi = args.includes('--ui');
const withCloseups = false;
const withSkeleton = args.includes('--skeleton');
const motionTimes = (opt('motion', '') || '').split(',').filter(Boolean).map(Number);
const size = Number(opt('size', '900'));
const outDir = resolve(root, '..', 'screenshots', milestone);
mkdirSync(outDir, { recursive: true });

const project = JSON.parse(readFileSync(projectPath, 'utf8'));
if (presetOverride) project.preset = presetOverride;

/** Playwright's own Chromium if installed; otherwise any cached Playwright headless shell. */
function findChromium() {
  try {
    const p = chromium.executablePath();
    if (p && existsSync(p)) return undefined;
  } catch {}
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), process.platform === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright');
  if (!existsSync(cache)) return undefined;
  const dirs = readdirSync(cache).filter((d) => d.startsWith('chromium')).sort().reverse();
  for (const d of dirs) {
    for (const c of [
      'chrome-headless-shell-mac-arm64/chrome-headless-shell',
      'chrome-headless-shell-linux64/chrome-headless-shell',
      'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
      'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      'chrome-linux/chrome',
    ]) {
      const p = join(cache, d, c);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

const built = args.includes('--built');
let server;
if (built) {
  server = await preview({ root, logLevel: 'error', preview: { port: 0, host: '127.0.0.1' } });
} else {
  server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1' } });
  await server.listen();
}
const url = server.resolvedUrls.local[0];
const executablePath = findChromium();
const browser = await chromium.launch({
  executablePath,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const external = [];
  page.on('request', (r) => {
    if (!r.url().startsWith(url) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url());
  });
  await page.goto(url + '?shots=1');
  await page.waitForFunction(() => !!window.__bust, null, { timeout: 30000 });
  await page.evaluate((p) => window.__bust.loadProject(p), project);
  await page.waitForTimeout(400);
  if (withSkeleton) await page.evaluate(() => window.__bust.setSkeleton(true));
  const views = [
    ['front', '01_front'],
    ['threeQuarterLeft', '02_threequarter_front_left'],
    ['left', '03_left'],
    ['back', '04_back'],
  ];
  for (const [view, file] of views) {
    await page.evaluate((v) => window.__bust.setView(v), view);
    await page.locator('#c').screenshot({ path: join(outDir, `${file}.png`) });
  }
  if (motionTimes.length) {
    // sample motion: front and 3/4 views at the given times (seconds)
    await page.evaluate((kind) => window.__bust.loadDemoMotion(kind), opt('sample', 'dash'));
    for (const t of motionTimes) {
      await page.evaluate((tt) => window.__bust.setTime(tt), t);
      for (const [view, file] of [['front', 'front'], ['threeQuarterLeft', 'threequarter']]) {
        await page.evaluate((v) => window.__bust.setView(v), view);
        await page.locator('#c').screenshot({ path: join(outDir, `motion_t${t.toFixed(2)}_${file}.png`) });
      }
    }
  }
  const info = await page.evaluate(() => window.__bust.info());
  if (withCloseups) {
    // inspection close-ups: left nipple with the 4 mm minimum diameter, wireframe on
    await page.evaluate(() => window.__bust.closeup('LM_nipple_L', 0.045, true, 0.004));
    await page.locator('#c').screenshot({ path: join(outDir, '06_nipple4mm_wire_closeup.png') });
    await page.evaluate(() => window.__bust.closeup('LM_nipple_L', 0.045, false, 0.004));
    await page.locator('#c').screenshot({ path: join(outDir, '07_nipple4mm_closeup.png') });
    await page.evaluate((p) => window.__bust.loadProject(p), project);
    await page.waitForTimeout(400);
  }
  if (withUi) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.evaluate(() => document.body.classList.remove('shots'));
    await page.evaluate((v) => window.__bust.setView(v), 'threeQuarterLeft');
    await page.screenshot({ path: join(outDir, '05_ui.png') });
    if (project.photos?.length) {
      await page.evaluate(() => window.__bust.setMode('photo'));
      await page.waitForTimeout(300);
      await page.evaluate(() => window.__bust.drawPhoto());
      await page.screenshot({ path: join(outDir, '08_photo_landmarks.png') });
      await page.evaluate(() => window.__bust.setMode('3d'));
    }
  }
  console.log(`saved to ${outDir}`);
  console.log(`preset=${project.preset ?? '(default)'} vertices=${info.vertices} triangles=${info.triangles}`);
  if (info.warnings.length) console.log('model warnings:', info.warnings.join(' / '));
  if (external.length) {
    console.error('NON-LOCAL REQUESTS:', external);
    failed = true;
  }
  if (errors.length) {
    console.error('PAGE ERRORS:', errors);
    failed = true;
  }
} finally {
  await browser.close();
  await (server.close ? server.close() : new Promise((r) => server.httpServer.close(r)));
}
process.exit(failed ? 1 : 0);
