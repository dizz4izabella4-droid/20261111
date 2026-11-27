// Verify the actual upload/download UI and load the exported GLB in an independent Three.js scene.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { readFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'test-output');
mkdirSync(output, { recursive: true });
if (!existsSync(join(output, 'body_with_hands.glb'))) {
  execFileSync(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', 'tests/hand.test.ts'], { cwd: root, stdio: 'inherit' });
}
const exported = join(output, 'browser_export.glb');
const gameCode = `
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadCharacter } from '/character-helper.js';
export async function check(url = '/export-check.glb') {
  const character = await loadCharacter(url);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x141820);
  scene.add(character.root);
  const renderer = new THREE.WebGLRenderer({antialias: true}); renderer.setSize(900, 900);
  document.body.replaceChildren(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(35, 1, .01, 30); camera.position.set(2.2, 1.7, 3.2); camera.lookAt(0, .95, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x667080, 1));
  const light = new THREE.DirectionalLight(0xffffff, 2); light.position.set(1,3,2); scene.add(light);
  const room = new RoomEnvironment(); const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(room, .04); scene.environment = env.texture; scene.environmentIntensity = .85;
  room.dispose(); pmrem.dispose();
  scene.add(new THREE.GridHelper(4,40,0x707580,0x343b45));
  const hand = character.root.getObjectByName('hand_l');
  const finger = character.root.getObjectByName('index_pip_l');
  const fingerBefore = finger?.quaternion.clone();
  scene.updateMatrixWorld(true); const before = hand.getWorldPosition(new THREE.Vector3());
  character.update(.6); scene.updateMatrixWorld(true);
  const moved = before.distanceTo(hand.getWorldPosition(new THREE.Vector3()));
  let softnessPeak = 0;
  character.root.traverse(mesh => { if(mesh.morphTargetInfluences) softnessPeak = Math.max(softnessPeak, ...mesh.morphTargetInfluences.map(Math.abs)); });
  renderer.render(scene,camera);
  return {moved, fingerMoved: finger ? fingerBefore.angleTo(finger.quaternion) : 0, softnessPeak, tracks: character.action.getClip().tracks.length, duration: character.action.getClip().duration,
    name: character.action.getClip().name, once: character.action.loop === THREE.LoopOnce,
    metadata: character.root.userData.kugutsu};
}`;
function findChromium() {
  if (existsSync(chromium.executablePath())) return undefined;
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), process.platform === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright');
  for (const d of readdirSync(cache).filter((d) => d.startsWith('chromium')).sort().reverse()) {
    for (const c of ['chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', 'chrome-linux/chrome']) {
      const path = join(cache, d, c); if (existsSync(path)) return path;
    }
  }
}
const server = await createServer({ root, logLevel: 'error',
  optimizeDeps: { include: ['three', 'three/addons/loaders/GLTFLoader.js', 'three/addons/environments/RoomEnvironment.js'] },
  server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'game-export-check',
  resolveId(id) { if (['/character-helper.js', '/game-check.js'].includes(id)) return `\0${id}`; },
  load(id) {
    if (id === '\0/character-helper.js') return readFileSync(join(root, '../integration/three-character.js'), 'utf8');
    if (id === '\0/game-check.js') return gameCode;
  },
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (!['/export-check.glb', '/hand-check.glb'].includes(req.url)) return next();
      res.setHeader('Content-Type', 'model/gltf-binary'); res.end(readFileSync(req.url === '/hand-check.glb' ? join(output, 'browser_hands.glb') : exported));
    });
  },
}] });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ executablePath: findChromium(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(server.resolvedUrls.local[0]);
  await page.waitForFunction(() => window.__bust?.info().vertices > 0);
  const save = page.getByRole('button', { name: '体＋モーションを保存（GLB）', exact: true });
  if (!await save.isDisabled()) throw new Error('Export must be disabled before a motion is loaded');
  await page.locator('input[type=file][accept=".glb,model/gltf-binary"]').setInputFiles(join(root, 'public/samples/spare_body_male.glb'));
  await page.locator('input[type=file][accept=".json,application/json"]').first().setInputFiles(join(root, 'public/samples/sample_motion_pry.json'));
  await page.waitForFunction(() => document.querySelector('input[aria-label="再生位置"]').max === '179');
  await page.waitForFunction(() => window.__bust.info().softnessPeak > .001);
  await page.getByLabel('やわらかさを反映', { exact: true }).uncheck();
  if (await page.evaluate(() => window.__bust.info().softnessPeak) !== 0) throw new Error('Softness toggle did not reset deformation');
  await page.getByLabel('やわらかさを反映', { exact: true }).check();
  await page.getByLabel('動きの名前', { exact: true }).fill('web_game_motion');
  await page.getByLabel('速さ', { exact: true }).selectOption('2');
  await page.getByLabel('くり返す', { exact: true }).uncheck();
  await page.evaluate(() => window.__bust.setTime(.7));
  await page.screenshot({ path: join(output, 'export-ui.png') });
  const downloadPromise = page.waitForEvent('download');
  await save.click();
  const download = await downloadPromise;
  if (download.suggestedFilename() !== 'web_game_motion.glb') throw new Error('Wrong output filename');
  await download.saveAs(exported);
  if (statSync(exported).size < 100000) throw new Error('Exported model is unexpectedly small');
  const info = await page.evaluate(async () => (await import('/game-check.js')).check());
  if (info.duration !== 3 || info.name !== 'web_game_motion' || info.tracks < 30 || !info.once || info.moved < .01) throw new Error(JSON.stringify(info));
  if (!info.metadata.softnessBaked || info.softnessPeak < .001) throw new Error('Baked softness was not played in the game');
  if (errors.length) throw new Error(errors.join('\n'));
  await page.screenshot({ path: join(output, 'game-import-preview.png') });
  console.log('PASS: file upload → GLB download → separate Three.js scene → AnimationMixer playback');
  console.log(JSON.stringify(info));
  await page.goto(server.resolvedUrls.local[0]);
  await page.waitForFunction(() => window.__bust?.info().vertices > 0);
  const fingerFile = page.locator('input[type=file][accept=".json,application/json"]').nth(1);
  await fingerFile.setInputFiles(join(root, 'public/samples/sample_hand_left.json'));
  await page.getByText('この体には指の骨がありません', { exact: false }).waitFor();
  if (!await page.getByRole('button', { name: '体＋モーションを保存（GLB）', exact: true }).isDisabled()) throw new Error('Missing finger bones must block incomplete export');
  await fingerFile.setInputFiles(join(root, 'public/samples/sample_hand_right.json'));
  await page.locator('input[type=file][accept=".glb,model/gltf-binary"]').setInputFiles(join(output, 'body_with_hands.glb'));
  await page.getByText('指の骨に対応。', { exact: false }).first().waitFor();
  await page.getByLabel('左手の開始（秒）', { exact: true }).fill('0.3');
  await page.getByLabel('右手の開始（秒）', { exact: true }).fill('-0.2');
  await page.getByLabel('右手の手首の向きも反映', { exact: true }).check();
  await page.getByLabel('動きの名前', { exact: true }).fill('finger_import_test');
  await page.getByLabel('速さ', { exact: true }).selectOption('2');
  await page.getByLabel('くり返す', { exact: true }).uncheck();
  await page.evaluate(() => window.__bust.setTime(1.5));
  await page.screenshot({ path: join(output, 'hand-import-ui.png') });
  const handsDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '体＋モーションを保存（GLB）', exact: true }).click();
  await (await handsDownload).saveAs(join(output, 'browser_hands.glb'));
  const handInfo = await page.evaluate(async () => (await import('/game-check.js')).check('/hand-check.glb'));
  if (Math.abs(handInfo.duration - 3.15) > 1e-5 || handInfo.fingerMoved < .01 || handInfo.metadata.hands.length !== 2) throw new Error(JSON.stringify(handInfo));
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('PASS: left/right hand import, old body warning, body replacement, offsets, wrist option, hand-only GLB playback');
  console.log(JSON.stringify(handInfo));
} finally {
  await browser?.close();
  await server.close();
}
