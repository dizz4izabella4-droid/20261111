// Package the existing production build as one offline HTML; no rebuild or CDN required.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
let html = readFileSync(join(root, 'index.html'), 'utf8');
const script = html.match(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/);
const style = html.match(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/);
if (!script || !style) throw new Error('Build not found. Run npm run build first.');
const js = readFileSync(join(root, script[1]), 'utf8');
const css = readFileSync(join(root, style[1]), 'utf8');
const bodies = ['spare_body_male.glb', 'spare_body_female.glb'].map((name) => [`samples/${name}`, readFileSync(join(root, 'samples', name)).toString('base64')]);
const digest = createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).update(html).update(js).update(css).update(JSON.stringify(bodies)).digest('hex');
const directory = join(root, 'releases');
const destination = join(directory, 'kugutsu.html'), manifest = join(directory, 'kugutsu-html.json');
if (existsSync(destination) && existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).sha256 === digest) {
  console.log(`Unchanged: ${destination}`);
  process.exit(0);
}
const embedded = `
// Only the app's built-in sample URLs are handled here; user-selected files use File APIs.
const embeddedBodies = new Map(${JSON.stringify(bodies)}.map(([path, data]) => [new URL(path, location.href).href, data]));
const originalFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href).href;
  const data = embeddedBodies.get(url);
  if (data && (!options?.method || options.method.toUpperCase() === 'GET')) {
    const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    return Promise.resolve(new Response(bytes, {headers: {'Content-Type': 'model/gltf-binary'}}));
  }
  return originalFetch(input, options);
};
`;
html = html.replace(script[0], '').replace(style[0], () => `<style>${css}</style>`);
html = html.replace('</body>', () => `<script type="module">${(embedded + '\n' + js).replace(/<\/script/gi, '<\\/script')}</script>\n</body>`);
mkdirSync(directory, { recursive: true });
writeFileSync(destination, html);
writeFileSync(manifest, JSON.stringify({ sha256: digest, bytes: Buffer.byteLength(html), format: 'kugutsu-standalone-html-v1' }, null, 2));
console.log(`${destination} (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB)`);
