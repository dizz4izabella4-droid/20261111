// CORE 単体テスト: node final-stop/_test/core.test.mjs
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, '..', 'index.html'), 'utf8');
const m = /\/\*@TESTABLE\*\/([\s\S]*?)\/\*@END_TESTABLE\*\//.exec(html);
if (!m) throw new Error('TESTABLE 区間が見つかりません');
const ctx = vm.createContext({ Math, Object, Date });
vm.runInContext(m[1], ctx);
const { CONFIG, CORE, MATCH } = vm.runInContext('({CONFIG,CORE,MATCH})', ctx);
let fail = 0, total = 0;
const ok = (c, msg) => { total++; if (!c) { fail++; console.log('  NG:', msg); } };
const log = s => console.log(s);
const mulberry32 = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const NONE = () => ({ swipe: null, tap: false, button: null });

function run(core, dt, maxSec, inputFn, stop) {
  const evs = []; let t = 0;
  for (; t < maxSec; t += dt) { const e = core.step(dt, inputFn(core.state, t)); for (const x of e) evs.push(x); if (stop && stop(core.state)) break; }
  return { evs, t };
}

// 1. 窓が開いて0.3s後に必ずスワイプ → 3回でPULLOVER、CHASEが24〜30sに収まる
log('1. 自動プレイ（窓で0.3s後にスワイプ）');
{
  const c = CORE.create(CONFIG, { seed: 1 }); const bot = s => c.bot(s, { skip: false, replay: false });
  const r = run(c, 1 / 60, 600, s => bot(s), s => s.sub === 'END');
  const ph = r.evs.filter(e => e.type === 'phase'); const pull = ph.find(e => e.to === 'PULLOVER'), chase = ph.find(e => e.to === 'CHASE');
  const dur = pull.at - chase.at; log('   CHASE ' + dur.toFixed(2) + 's, END到達 ' + c.state.sub);
  ok(c.state.sub === 'END', 'ENDに届く'); ok(dur >= 24 && dur <= 30, 'CHASEが24〜30s: ' + dur.toFixed(2));
  ok(r.evs.filter(e => e.type === 'hit').length === 3, 'HITがちょうど3回');
  ok(!r.evs.some(e => e.type === 'stuck'), 'stuckなし');
}

// 2. 乱数入力 seed 1〜3000
log('2. 乱数入力 3000本');
{
  let bad = 0, notEnd = 0;
  for (let seed = 1; seed <= 3000; seed++) {
    const rnd = mulberry32(seed), c = CORE.create(CONFIG, { seed });
    try {
      let t = 0; const dt = 1 / 30; let started = false;
      for (; t < 900 && c.state.sub !== 'END'; t += dt) {
        const r = rnd(), inp = NONE();
        if (!started) { inp.button = 'start'; started = true; }
        else if (r < 0.10) inp.swipe = { dir: rnd() < 0.5 ? -1 : 1 };
        else if (r < 0.18) inp.tap = true;
        else if (r < 0.22) inp.button = ['ram', 'siren', 'lights', 'next', 'again'][Math.floor(rnd() * 5)];
        const e = c.step(dt, inp);
        if (e.some(x => x.type === 'stuck')) { bad++; break; }
        if (c.state.sub === 'TITLE' && t > 0.5) { bad++; break; }
      }
      if (c.state.sub !== 'END') notEnd++;
    } catch (err) { bad++; console.log('  例外 seed', seed, err.message); }
  }
  log('   異常 ' + bad + ' / ENDに届かない ' + notEnd); ok(bad === 0, '例外・stuckなし'); ok(notEnd === 0, '全てENDに届く');
}

// 3. 入力なし
log('3. 入力なし（startだけ）');
{
  const c = CORE.create(CONFIG, { seed: 1 }); let started = false;
  const r = run(c, 1 / 30, 900, s => { if (!started) { started = true; return { swipe: null, tap: false, button: 'start' }; } return NONE(); }, s => s.sub === 'END');
  const ph = r.evs.filter(e => e.type === 'phase'); const pull = ph.find(e => e.to === 'PULLOVER'), chase = ph.find(e => e.to === 'CHASE');
  log('   CHASE ' + (pull.at - chase.at).toFixed(1) + 's, 全体 ' + r.t.toFixed(0) + 's, ' + c.state.sub);
  ok(c.state.sub === 'END', 'ENDに届く'); ok(r.t < 420, '420s以内');
  const t150 = r.evs.find(e => e.type === 'hit'); ok(t150 && t150.at - chase.at >= 150 - 1, '最初のHITは救済(150s)以降');
  ok(!r.evs.some(e => e.type === 'stuck'), 'stuckなし');
}

// 4. 窓を必ず逃す → 2回目のMISSでram、3回目で窓2.1s
log('4. 窓を逃し続ける');
{
  const c = CORE.create(CONFIG, { seed: 1 }); let started = false; const evs = [];
  const lens = [];
  for (let t = 0; t < 80; t += 1 / 60) { const e = c.step(1 / 60, !started ? (started = true, { button: 'start' }) : NONE()); for (const x of e) { evs.push(x); if (x.type === 'window') lens.push(x.len); } }
  const miss = evs.filter(e => e.type === 'miss'); const ram = evs.find(e => e.type === 'ram');
  ok(miss.length >= 3, 'MISSが3回以上'); ok(ram && ram.at > miss[1].at - 0.01 && ram.at < miss[2].at, '2回目のMISSでramが出る');
  ok(lens[0] === 1.4 && lens[1] === 1.4 && lens[2] === 1.4 && lens[3] === 2.1, '4つ目の窓が2.1s（3連続MISS後）: ' + lens.slice(0, 5).join(','));
}

// 5. 窓が開く前のスワイプ
log('5. 先行入力とふらつき');
function openTime(c) { let t = 0; const s = c.state; let started = false; for (; t < 60; t += 1 / 120) { c.step(1 / 120, !started ? (started = true, { button: 'start' }) : NONE()); if (s.sub === 'APPROACH' && s.t + 1e-9 >= s.dur - 0.5) return; } }
for (const [before, expectHit] of [[0.10, true], [0.20, false]]) {
  const c = CORE.create(CONFIG, { seed: 1 }); openTime(c); const s = c.state;
  // APPROACH の残りが before になるまで進める
  while (s.dur - s.t > before + 1e-6) c.step(1 / 120, NONE());
  const evs = c.step(1 / 120, { swipe: { dir: 1 } }); let all = [...evs]; const m0 = s.misses;
  for (let k = 0; k < 120 * 3; k++) all.push(...c.step(1 / 120, NONE()));
  const hit = all.some(e => e.type === 'hit');
  log('   開く ' + before + 's前 → ' + (hit ? 'HIT' : '空振り') + ' miss=' + s.misses);
  if (expectHit) ok(hit && s.misses === m0, before + 's前は先行入力でHIT');
  else ok(all.some(e => e.type === 'whiff') && s.misses === m0 + (all.some(e => e.type === 'miss') ? 1 : 0) && !all.some(e => e.type === 'hit' && e.at < s.simTime - 0), before + 's前はふらつき（先行入力でない）');
}

// 6. 遷移直後のボタン連打
log('6. 遷移直後の連打');
{
  const c = CORE.create(CONFIG, { seed: 1 }); const s = c.state; const w = CORE.create(CONFIG, { seed: 1 });
  c.step(1 / 60, { button: 'start' });
  // EVENTまで進める
  const target = 'EVENT'; c.warp(target); ok(s.sub === 'EVENT', 'EVENTへ');
  for (let k = 0; k < 20; k++) c.step(1 / 120, { tap: true, button: 'next' });           // 0.166s分の連打
  ok(s.sub === 'EVENT', 'EVENT直後0.4sは連打が無視される: ' + s.sub);
  for (let k = 0; k < 40; k++) c.step(1 / 60, NONE());                                  // 0.4s経過
  c.step(1 / 60, { tap: true });
  ok(s.sub === 'PREVIEW', '0.4s経過後はタップが通る: ' + s.sub);
  c.step(1 / 60, { tap: true }); ok(s.sub === 'PREVIEW', 'PREVIEW直後(CMDは同一フェーズ)でも状態が飛ばない or 次へ進む: ' + s.sub);
}

// 7. dt違いでも同じ結果（入力なし）
log('7. dt 1/30 と 1/144');
{
  const mk = dt => { const c = CORE.create(CONFIG, { seed: 7 }); let st = false; const evs = []; for (let t = 0; t < 120; t += dt) { for (const e of c.step(dt, !st ? (st = true, { button: 'start' }) : NONE())) evs.push(e); } return evs; };
  const a = mk(1 / 30), b = mk(1 / 144);
  const n = Math.min(a.length, b.length), cmp = (x, y) => x.type === y.type && Math.abs(x.at - y.at) < 1e-9 && (x.sub || '') === (y.sub || '');
  let same = true, firstDiff = -1; for (let i = 0; i < n; i++) if (!cmp(a[i], b[i])) { same = false; firstDiff = i; break; }
  log('   イベント数 ' + a.length + ' / ' + b.length + (same ? ' 一致' : ' 不一致@' + firstDiff));
  ok(same && Math.abs(a.length - b.length) <= 2, '同じ並びと時刻（1/120s単位）');
}

// 8. warp
log('8. warp');
{
  for (const label of ['WINDOW', 'HIT1', 'HIT2', 'HIT3', 'MISS', 'PULLOVER', 'EVENT', 'PREVIEW0', 'REACT1', 'PREVIEW3', 'ARREST', 'END']) {
    const c = CORE.create(CONFIG, { seed: 1 }); const okw = c.warp(label); const s = c.state;
    const good = okw && (/^HIT(\d)/.test(label) ? s.sub === 'HIT' && s.hits === +label[3] : label === 'WINDOW' ? s.sub === 'WINDOW' : label === 'MISS' ? s.sub === 'MISS' : /^(PREVIEW|REACT)\d$/.test(label) ? s.sub === label.slice(0, -1) && s.cmd.i === +label.slice(-1) : s.sub === label);
    ok(good, 'warp(' + label + ') → ' + s.sub + ' hits=' + s.hits);
  }
}

// 9. 音声入力：一致判定と待ち時間
log('9. 音声入力');
{
  const T = CONFIG.CMDS.map(c => c.text), min = CONFIG.MATCH_MIN, P = (i, h) => MATCH.pass(T[i], h, min);
  ok(P(0, 'police show me your hands'), '命令1：全文');
  ok(P(0, 'show me your hands'), '命令1：Policeが欠けても通る');
  ok(!P(0, 'hands up'), '命令1：hands だけでは通らない');
  ok(P(1, 'turn off the engine'), '命令2：全文');
  ok(P(1, 'turn of the engine'), '命令2：offの聞き間違い（of）でも通る');
  ok(P(2, 'step out of the vehicle'), '命令3：全文');
  ok(P(2, 'step out of the vehicles'), '命令3：複数形');
  ok(P(3, 'get on the ground'), '命令4：全文');
  ok(P(3, 'get on the grounds'), '命令4：複数形');
  ok(!P(3, 'hello world'), '無関係な文は通らない');
  ok(!P(1, ''), '空は通らない');
  ok(!P(1, 'step out of the vehicle'), '別の命令は通らない');
  // YOURTURN の待ち時間：mic なし=3.0s、mic あり=4.5s。どちらも見張り(5s)より短い
  const meas = micOn => {
    const c = CORE.create(CONFIG, { seed: 1 }); c.warp('PREVIEW0');
    let n = 0; while (c.state.sub !== 'YOURTURN' && n++ < 3000) c.step(1 / 60, { tap: c.state.sub === 'PREVIEW', mic: micOn });
    let stuck = false, d = 0; while (c.state.sub === 'YOURTURN' && d < 10) { const e = c.step(1 / 60, { mic: micOn }); d += 1 / 60; if (e.some(x => x.type === 'stuck')) stuck = true; }
    return { d, stuck };
  };
  const a = meas(false), b = meas(true);
  log('   mic無し ' + a.d.toFixed(2) + 's / mic有り ' + b.d.toFixed(2) + 's');
  ok(Math.abs(a.d - CONFIG.YOURTURN) < 0.1, 'mic無し：3.0s');
  ok(Math.abs(b.d - CONFIG.YOURTURN_MIC) < 0.1, 'mic有り：4.5s');
  ok(!a.stuck && !b.stuck, '見張りは発動しない');
}

// 10. 凍結（定数）
ok(Object.isFrozen(CONFIG), 'CONFIGは凍結されている');
console.log(fail === 0 ? '\n全 ' + total + ' 項目 OK' : '\n失敗 ' + fail + ' / ' + total); process.exit(fail ? 1 : 0);
