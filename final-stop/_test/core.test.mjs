// CORE 単体テスト: node final-stop/_test/core.test.mjs
import fs from 'node:fs'; import vm from 'node:vm'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, '..', 'index.html'), 'utf8');
const m = /\/\*@TESTABLE\*\/([\s\S]*?)\/\*@END_TESTABLE\*\//.exec(html);
if (!m) throw new Error('TESTABLE 区間が見つかりません');
const ctx = vm.createContext({ Math, Object, Date });
vm.runInContext(m[1], ctx);
const { CONFIG, CORE } = vm.runInContext('({CONFIG,CORE})', ctx);
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
        else if (r < 0.42) inp.voice = true;                                   // 声（5s以内に必ず入る確率）
        const e = c.step(dt, inp);
        if (e.some(x => x.type === 'stuck')) { bad++; break; }
        if (c.state.sub === 'TITLE' && t > 0.5) { bad++; break; }
      }
      if (c.state.sub !== 'END') notEnd++;
    } catch (err) { bad++; console.log('  例外 seed', seed, err.message); }
  }
  log('   異常 ' + bad + ' / ENDに届かない ' + notEnd); ok(bad === 0, '例外・stuckなし'); ok(notEnd === 0, '全てENDに届く');
}

// 3. 入力なし：追跡は救済で進み、命令で声が出ないので撃たれてタイトルに戻る
log('3. 入力なし（startだけ）');
{
  const c = CORE.create(CONFIG, { seed: 1 }); let started = false;
  const r = run(c, 1 / 30, 900, s => { if (!started) { started = true; return { swipe: null, tap: false, button: 'start' }; } return NONE(); }, s => false);
  const subs = r.evs.filter(e => e.type === 'sub').map(e => e.sub);
  const ph = r.evs.filter(e => e.type === 'phase'); const pull = ph.find(e => e.to === 'PULLOVER'), chase = ph.find(e => e.to === 'CHASE');
  const dead = subs.indexOf('DEAD'), ti = subs.indexOf('TITLE', dead);
  log('   CHASE ' + (pull.at - chase.at).toFixed(1) + 's, DEAD→TITLE ' + (dead >= 0 && ti > dead));
  ok(dead >= 0, '声が出ないとDEADへ'); ok(ti > dead, 'DEADの後TITLEへ戻る');
  const t150 = r.evs.find(e => e.type === 'hit'); ok(t150 && t150.at - chase.at >= 150 - 1, '最初のHITは救済(150s)以降');
  ok(!r.evs.some(e => e.type === 'stuck'), 'stuckなし');
  ok(r.evs.some(e => e.type === 'shot') && r.evs.some(e => e.type === 'dead'), 'shotとdeadが出る');
}

// 3b. 声が入れば進み、入らなければ5秒で撃たれる。DEADはタップで早く戻れる
log('3b. YOURTURN と DEAD');
{
  const toYT = () => { const c = CORE.create(CONFIG, { seed: 1 }); c.warp('PREVIEW0'); let n = 0; while (c.state.sub !== 'YOURTURN' && n++ < 3000) c.step(1 / 60, { tap: c.state.sub === 'PREVIEW' }); return c; };
  let c = toYT(); let d = 0; while (c.state.sub === 'YOURTURN' && d < 10) { c.step(1 / 60, { tap: true, button: 'next' }); d += 1 / 60; }
  ok(c.state.sub === 'DEAD' && Math.abs(d - CONFIG.YOURTURN) < 0.1, 'タップ・NEXTでは進まず' + CONFIG.YOURTURN + 's後にDEAD: ' + d.toFixed(2) + ' ' + c.state.sub);
  c = toYT(); for (let k = 0; k < 30; k++) c.step(1 / 60, NONE()); c.step(1 / 60, { voice: true }); ok(c.state.sub === 'REACT', '声が入ればREACTへ: ' + c.state.sub);
  c = toYT(); d = 0; while (c.state.sub === 'YOURTURN' && d < 10) { c.step(1 / 60, NONE()); d += 1 / 60; }
  for (let k = 0; k < 40; k++) c.step(1 / 60, { tap: true }); ok(c.state.sub === 'DEAD', 'DEAD直後（2s未満）のタップでは戻らない: ' + c.state.sub);
  for (let k = 0; k < 100; k++) c.step(1 / 60, NONE()); c.step(1 / 60, { tap: true }); ok(c.state.sub === 'TITLE', '2s後のタップでTITLEへ: ' + c.state.sub);
  ok(c.state.hits === 0 && c.state.phase === 'TITLE', 'TITLEでは状態がリセットされている');
  c = toYT(); d = 0; while (c.state.sub !== 'TITLE' && d < 20) { c.step(1 / 60, NONE()); d += 1 / 60; }
  ok(c.state.sub === 'TITLE' && d < CONFIG.YOURTURN + CONFIG.DEAD + 0.5, '放置でも' + (CONFIG.YOURTURN + CONFIG.DEAD) + 's程度でTITLEへ: ' + d.toFixed(2));
  // ワンモア：途切れたら2sずつ延長（最大2回）。延長なら5s→7s→9s
  c = toYT(); d = 0; let kk = 0; while (c.state.sub === 'YOURTURN' && d < 20) { c.step(1 / 60, { more: kk === 270 }); kk++; d += 1 / 60; }
  ok(c.state.sub === 'DEAD' && d > 6.5 && d < 7.5, 'ワンモア1回で約7s: ' + d.toFixed(2));
  c = toYT(); d = 0; let sent = 0; while (c.state.sub === 'YOURTURN' && d < 20) { const kx = Math.round(d * 60), want = (kx === 270 || kx === 390 || kx === 510 || kx === 520); c.step(1 / 60, { more: want }); if (want) sent++; d += 1 / 60; }
  ok(c.state.sub === 'DEAD' && d > 8.5 && d < 9.6, 'ワンモアは最大2回（約9sで打ち切り）: ' + d.toFixed(2) + ' sent=' + sent);
  c = toYT(); for (let k = 0; k < 400; k++) c.step(1 / 60, { more: k === 120 }); ok(c.state.ytLimit === 7 || c.state.sub === 'DEAD', 'ytLimitが状態に出る');
  const w = CORE.create(CONFIG, { seed: 1 }); ok(w.warp('DEAD') && w.state.sub === 'DEAD', 'warp DEAD');
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
  for (const label of ['WINDOW', 'HIT1', 'HIT2', 'HIT3', 'MISS', 'PULLOVER', 'EVENT', 'PREVIEW0', 'REACT1', 'PREVIEW3', 'ARREST', 'END', 'DEAD']) {
    const c = CORE.create(CONFIG, { seed: 1 }); const okw = c.warp(label); const s = c.state;
    const good = okw && (/^HIT(\d)/.test(label) ? s.sub === 'HIT' && s.hits === +label[3] : label === 'WINDOW' ? s.sub === 'WINDOW' : label === 'MISS' ? s.sub === 'MISS' : /^(PREVIEW|REACT)\d$/.test(label) ? s.sub === label.slice(0, -1) && s.cmd.i === +label.slice(-1) : s.sub === label);
    ok(good, 'warp(' + label + ') → ' + s.sub + ' hits=' + s.hits);
  }
}

// 9. 凍結（定数）
ok(Object.isFrozen(CONFIG), 'CONFIGは凍結されている');
console.log(fail === 0 ? '\n全 ' + total + ' 項目 OK' : '\n失敗 ' + fail + ' / ' + total); process.exit(fail ? 1 : 0);
