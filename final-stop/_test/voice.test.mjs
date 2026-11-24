// Simulated iOS speech events: node final-stop/_test/voice.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const html = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
const begin = html.indexOf('  const VOICE = {'), end = html.indexOf('  VOICE.init();', begin);
assert.ok(begin >= 0 && end > begin, 'VOICE section');

let clock = 1000, nextId = 0, muted = 0, kicked = 0;
const timers = new Map(), spoken = [];
const advance = ms => {
  const until = clock + ms;
  for (;;) {
    const due = [...timers].filter(([, task]) => task.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
    if (!due) break;
    clock = due[1].at; timers.delete(due[0]); due[1].fn();
  }
  clock = until;
};
const synthesis = {
  speaking: false, pending: false,
  getVoices: () => [], addEventListener: () => {}, resume: () => {},
  speak(u) { spoken.push(u); this.speaking = true; },
  cancel() { this.speaking = false; this.pending = false; }
};
const audio = {
  mute() { muted++; }, kick() { kicked++; }, radioOff() {}, radioOn() {}
};
const context = vm.createContext({
  window: { speechSynthesis: synthesis }, speechSynthesis: synthesis,
  SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
  AUDIO: audio, MICV: { ready: false, virtual: false }, navigator: {},
  localStorage: { getItem: () => null }, performance: { now: () => clock },
  setTimeout(fn, ms) { const id = ++nextId; timers.set(id, { at: clock + ms, fn }); return id; },
  clearTimeout(id) { timers.delete(id); }
});
const voice = vm.runInContext(html.slice(begin, end + '  VOICE.init();'.length) + '\nVOICE', context);

// A slow but healthy utterance must not be cut at an estimated duration.
let ended = 0;
voice.speak('Police! Show me your hands!', null, () => ended++);
assert.equal(spoken.length, 1, 'first LISTEN starts in the tap');
spoken.at(-1).onstart(); advance(5000);
assert.equal(ended, 0, 'waits for the actual end');
spoken.at(-1).onend();
assert.equal(ended, 1);
assert.equal(voice.isTalking(), false);

// iOS may omit onstart entirely, while the utterance itself is healthy.
synthesis.speaking = false;
voice.speak('Step out of the vehicle!', null, () => ended++);
const noStart = spoken.at(-1); advance(2200);
assert.equal(spoken.at(-1), noStart, 'missing onstart does not cancel a healthy voice');
noStart.onend(); assert.equal(ended, 2);

// A premature onend retries once; callbacks from the cancelled voice are ignored.
synthesis.speaking = false;
voice.speak('強盗事件発生。容疑者は赤いセダンで北へ逃走中。', 'quietja', () => ended++);
const first = spoken.at(-1); first.onstart(); advance(100); first.onend();
advance(220); assert.notEqual(spoken.at(-1), first, 'early cut retried');
first.onerror(); first.onend(); assert.equal(ended, 2, 'stale completion ignored');
spoken.at(-1).onstart(); advance(2300); spoken.at(-1).onend();
assert.equal(ended, 3, 'completed once after retry');

// Cancelling a queued replacement cannot start it after the user moves on.
synthesis.speaking = true;
const count = spoken.length;
voice.speak('Turn off the engine!', null, () => ended++);
voice.cancel(false); advance(1000);
assert.equal(spoken.length, count, 'cancelled request stays cancelled');
assert.equal(ended, 3);

// The opening radio stays separate from WebAudio even when its voice ends.
synthesis.speaking = false;
const before = { muted, kicked };
voice.speak('全ユニットへ。', 'quietja', () => ended++);
spoken.at(-1).onstart(); advance(1300); spoken.at(-1).onend();
assert.equal(ended, 4);
assert.equal(muted, before.muted);
assert.equal(kicked, before.kicked);

console.log('VOICE: slow end, missing start, interrupted voice, cancellation, quiet radio OK');
