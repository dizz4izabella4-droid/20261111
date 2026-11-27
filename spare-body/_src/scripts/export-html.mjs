// Reuse the production build and embed its assets in a single offline HTML.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
let html = readFileSync(join(root, 'index.html'), 'utf8');
const script = html.match(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/);
const style = html.match(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/);
if (!script || !style) throw new Error('先に npm run build を実行してください。');
const js = readFileSync(join(root, script[1]), 'utf8');
const css = readFileSync(join(root, style[1]), 'utf8');
const digest = createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).update(html).update(js).update(css).digest('hex');
const directory = join(root, 'releases');
const destination = join(directory, 'spare-body.html'), manifest = join(directory, 'spare-body-html.json');
if (existsSync(destination) && existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).sha256 === digest) {
  console.log(`変更なし：${destination}`);
  process.exit(0);
}
html = html.replace(script[0], '').replace(style[0], () => `<style>${css}</style>`);
html = html.replace('</body>', () => `<script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>\n</body>`);
mkdirSync(directory, { recursive: true });
writeFileSync(destination, html);
writeFileSync(manifest, JSON.stringify({ sha256: digest, bytes: Buffer.byteLength(html), format: 'spare-body-standalone-html-v1' }, null, 2));
console.log(`${destination} (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
