// Remove the previous build output (photo-bust/index.html and photo-bust/assets/).
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const out = fileURLToPath(new URL('../../', import.meta.url));
rmSync(out + 'assets', { recursive: true, force: true });
rmSync(out + 'index.html', { force: true });
