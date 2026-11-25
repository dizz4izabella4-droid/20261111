// Remove the previous build output (photo-tex/index.html and photo-tex/assets/).
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const out = fileURLToPath(new URL('../../', import.meta.url));
rmSync(out + 'assets', { recursive: true, force: true });
rmSync(out + 'index.html', { force: true });
