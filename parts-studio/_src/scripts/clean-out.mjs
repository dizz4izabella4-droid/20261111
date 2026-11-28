// Remove the previous build output (parts-studio/index.html and parts-studio/assets/).
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const out = fileURLToPath(new URL('../../', import.meta.url));
rmSync(out + 'assets', { recursive: true, force: true });
rmSync(out + 'index.html', { force: true });
