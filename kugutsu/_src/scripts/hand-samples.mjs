// Reuse the actual hand-mocap exporter for integration fixtures; no AI-generated captures.
import { readFileSync, writeFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const source = process.argv[2] || join(homedir(), 'Documents/ChatGPT/ゲーム制作/hand-mocap/hand_mocap_tool.html');
const html = readFileSync(source, 'utf8');
const script = html.match(/<script id="handCore">([\s\S]*?)<\/script>/)?.[1];
if (!script) throw new Error('handCore not found');
const core = runInNewContext(`${script}\nHandCore`, {}, { timeout: 5000 });
const samples = core.demo(), base = core.resample(samples);
base.rest = core.makeRest(samples.filter((s) => s.f).map((s) => s.f));
const clip = core.rebuild(base, { smooth: .45 });
for (const [hand, side] of [['Left', 'left'], ['Right', 'right']]) {
  const data = core.exportClip(clip, hand, { source: 'hand-mocap sample', synthetic: true });
  writeFileSync(fileURLToPath(new URL(`../public/samples/sample_hand_${side}.json`, import.meta.url)), JSON.stringify(data));
}
console.log('Created left/right hand samples using the hand-mocap exporter');
