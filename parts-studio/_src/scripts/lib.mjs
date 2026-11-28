// Shared helpers for the headless-Chromium scripts (e2e, shots).
import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Playwright's own Chromium if installed; otherwise any cached Playwright Chromium. */
export function findChromium() {
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

export async function launch() {
  return chromium.launch({
    executablePath: findChromium(),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
}
