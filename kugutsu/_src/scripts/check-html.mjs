import { chromium } from 'playwright';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'test-output');
mkdirSync(output, { recursive: true });
if (!existsSync(join(output, 'body_with_hands.glb'))) {
  execFileSync(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', 'tests/hand.test.ts'], { cwd: root, stdio: 'inherit' });
}
let executablePath;
if (!existsSync(chromium.executablePath())) {
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), process.platform === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright');
  for (const directory of readdirSync(cache).filter((x) => x.startsWith('chromium')).sort().reverse()) {
    for (const candidate of ['chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', 'chrome-linux/chrome']) {
      const path = join(cache, directory, candidate);
      if (existsSync(path)) { executablePath = path; break; }
    }
    if (executablePath) break;
  }
}
const browser = await chromium.launch({ executablePath, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
  const errors = [], external = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route(/^https?:\/\//, (route) => { external.push(route.request().url()); return route.abort(); });
  await page.goto(pathToFileURL(join(root, '../releases/kugutsu.html')).href);
  await page.waitForFunction(() => window.__bust?.info().vertices > 0);
  await page.getByRole('button', { name: 'サンプル：女性', exact: true }).click();
  await page.getByText('サンプル（女性）：骨', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'サンプル：男性', exact: true }).click();
  await page.getByText('サンプル（男性）：骨', { exact: false }).waitFor();
  await page.locator('input[type=file][accept=".json,application/json"]').nth(1).setInputFiles(join(root, 'public/samples/sample_hand_left.json'));
  await page.getByText('この体には指の骨がありません', { exact: false }).waitFor();
  await page.locator('input[type=file][accept=".glb,model/gltf-binary"]').setInputFiles(join(output, 'body_with_hands.glb'));
  await page.getByText('指の骨に対応。', { exact: false }).waitFor();
  await page.getByLabel('動きの名前', { exact: true }).fill('offline_motion');
  const promise = page.waitForEvent('download');
  await page.getByRole('button', { name: '体＋モーションを保存（GLB）', exact: true }).click();
  const download = await promise;
  if (download.suggestedFilename() !== 'offline_motion.glb') throw new Error('Unexpected download name');
  await download.saveAs(join(output, 'standalone_export.glb'));
  await page.screenshot({ path: join(output, 'standalone-ui.png') });
  if (errors.length || external.length) throw new Error(JSON.stringify({ errors, external }));
  console.log('PASS: file:// HTML, offline startup, male/female samples, hand/body imports, GLB download; zero network requests');
} finally {
  await browser.close();
}
