// End-to-end check of the browser analysis path (Web Worker) on the production build:
//   node scripts/e2e-analysis.mjs --project test-output/C/project.json [--built]
// Loads the project's photo and landmarks (patches removed), presses 「分析する」, waits for the patch,
// prints the elapsed time and any page errors / non-local requests.
import { createServer, preview } from 'vite';
import { chromium } from 'playwright';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const project = JSON.parse(readFileSync(resolve(process.cwd(), opt('project', 'test-output/C/project.json')), 'utf8'));
project.patches = [];
const built = args.includes('--built');

function findChromium() {
  try {
    if (existsSync(chromium.executablePath())) return undefined;
  } catch {}
  const cache = join(homedir(), process.platform === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright');
  for (const d of readdirSync(cache).filter((x) => x.startsWith('chromium')).sort().reverse()) {
    const p = join(cache, d, 'chrome-headless-shell-mac-arm64/chrome-headless-shell');
    if (existsSync(p)) return p;
  }
  return undefined;
}

const server = built
  ? await preview({ root, logLevel: 'error', preview: { port: 0, host: '127.0.0.1' } })
  : await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1' } });
if (!built) await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let code = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  const external = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('request', (r) => {
    if (!r.url().startsWith(url) && !/^(data|blob):/.test(r.url())) external.push(r.url());
  });
  await page.goto(url);
  await page.waitForFunction(() => !!window.__bust);
  if (built) {
    // the built site has no test-output/: inline the photo as a data URL
    const png = readFileSync(resolve(root, project.photos[0].src));
    project.photos[0].src = 'data:image/png;base64,' + png.toString('base64');
  }
  await page.evaluate((p) => window.__bust.loadProject(p), project);
  const t0 = Date.now();
  await page.getByRole('button', { name: '分析する' }).click();
  await page.waitForFunction(() => document.querySelector('.patchlist')?.textContent?.includes('パーツ 1'), null, { timeout: 120000 });
  const msg = await page.evaluate(() => [...document.querySelectorAll('#panel .note')].map((e) => e.textContent).find((t) => t?.includes('分析が終わりました')));
  console.log(`analysis finished in the browser: ${(Date.now() - t0) / 1000}s (${msg})`);
  if (errors.length) {
    console.error('PAGE ERRORS', errors);
    code = 1;
  }
  if (external.length) {
    console.error('NON-LOCAL REQUESTS', external);
    code = 1;
  }
} finally {
  await browser.close();
  await (server.close ? server.close() : new Promise((r) => server.httpServer.close(r)));
}
process.exit(code);
