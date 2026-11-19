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
  const ph = r.evs.filter(e => e.type === 'phase'); const pull = ph.find(e => e.to === 'PULLOVER'), chase = r.evs.find(e => e.type === 'sub' && e.sub === 'INTRO'), opn = r.evs.find(e => e.type === 'sub' && e.sub === 'OPEN_PARK');
  const dur = pull.at - chase.at; log('   CHASE ' + dur.toFixed(2) + 's, END到達 ' + c.state.sub);
  ok(c.state.sub === 'END', 'ENDに届く'); ok(dur >= 24 && dur <= 30, 'INTRO以降が24〜30s: ' + dur.toFixed(2)); ok(chase.at - opn.at > 18 && chase.at - opn.at < 40, '開始演出が18〜40s: ' + (chase.at - opn.at).toFixed(2));
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
  const ph = r.evs.filter(e => e.type === 'phase'); const pull = ph.find(e => e.to === 'PULLOVER'), chase = r.evs.find(e => e.type === 'sub' && e.sub === 'INTRO'), opn = r.evs.find(e => e.type === 'sub' && e.sub === 'OPEN_PARK');
  const dead = subs.indexOf('DEAD'), ti = subs.indexOf('TITLE', dead);
  log('   CHASE ' + (pull.at - chase.at).toFixed(1) + 's, DEAD→TITLE ' + (dead >= 0 && ti > dead));
  ok(dead >= 0, '声が出ないとDEADへ'); ok(ti > dead, 'DEADの後TITLEへ戻る');
  const t150 = r.evs.find(e => e.type === 'hit'); log('   firstHIT ' + (t150&&(t150.at-chase.at).toFixed(1))); ok(t150 && t150.at - chase.at >= 150 - 1, '最初のHITは救済(150s)以降');
  ok(!r.evs.some(e => e.type === 'stuck'), 'stuckなし');
  ok(r.evs.some(e => e.type === 'shot') && r.evs.some(e => e.type === 'dead'), 'shotとdeadが出る');
}

// 3b. 声が入れば進み、入らなければ5秒で撃たれる。DEADはタップで早く戻れる
log('3b. YOURTURN と DEAD');
{
  const toYT = () => { const c = CORE.create(CONFIG, { seed: 1 }); c.warp('PREVIEW0'); let n = 0; while (c.state.sub !== 'YOURTURN' && n++ < 3000) c.step(1 / 60, { tap: c.state.sub === 'PREVIEW', said: c.state.sub === 'SPEAK' }); return c; };
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
  ok(c.state.sub === 'DEAD' && Math.abs(d - (CONFIG.YOURTURN + CONFIG.MORE_EXTRA)) < 0.5, 'ワンモア1回で制限+2s: ' + d.toFixed(2));
  c = toYT(); d = 0; let sent = 0; while (c.state.sub === 'YOURTURN' && d < 20) { const kx = Math.round(d * 60), want = (kx === 270 || kx === 390 || kx === 510 || kx === 520); c.step(1 / 60, { more: want }); if (want) sent++; d += 1 / 60; }
  ok(c.state.sub === 'DEAD' && Math.abs(d - (CONFIG.YOURTURN + CONFIG.MORE_EXTRA * CONFIG.MORE_MAX)) < 0.6, 'ワンモアは最大2回で打ち切り: ' + d.toFixed(2) + ' sent=' + sent);
  c = toYT(); for (let k = 0; k < 400; k++) c.step(1 / 60, { more: k === 120 }); ok(c.state.ytLimit === CONFIG.YOURTURN + CONFIG.MORE_EXTRA || c.state.sub === 'DEAD', 'ytLimitが状態に出る');
  const w = CORE.create(CONFIG, { seed: 1 }); ok(w.warp('DEAD') && w.state.sub === 'DEAD', 'warp DEAD');
}

// 4. ズレたタップを続ける → 空振りが数えられ、2回でram、3連続で許容が広がる（時間切れのMISSはもう無い）
log('4. ズレたタップを続ける（時間切れなし）');
{
  const c = CORE.create(CONFIG, { seed: 1 }); let started = false; const evs = [];
  for (let t = 0; t < 120; t += 1 / 60) {
    const st = c.state; let inp = NONE();
    if (!started) { started = true; inp = { button: 'start' }; }
    else if ((st.sub === 'WINDOW' || st.sub === 'APPROACH') && Math.abs(st.sx - st.px) > CONFIG.ALIGN_RESCUE * 1.3) inp = { tap: true };
    for (const x of c.step(1 / 60, inp)) evs.push(x);
  }
  const miss = evs.filter(e => e.type === 'miss'); const ram = evs.find(e => e.type === 'ram');
  ok(miss.length >= 3, '空振りMISSが3回以上'); ok(ram && ram.at > miss[0].at - 0.01 && ram.at < miss[2].at, '2回目のMISSでramが出る');
  ok(!evs.some(e => e.type === 'window'), '窓の合図（window）は出さない');
  ok(['WINDOW', 'APPROACH', 'LUNGE', 'RECOVER'].includes(c.state.sub), '時間切れでMISSへ落ちない');
}

// 5. 窓が開く前のスワイプ
log('5. 真正面でタップ＝突撃、ズレていれば空振り');
function toWindow(seed) { const c = CORE.create(CONFIG, { seed }); let started = false; for (let k = 0; k < 120 * 80; k++) { c.step(1 / 120, !started ? (started = true, { button: 'start' }) : NONE()); if (c.state.sub === 'WINDOW' && c.state.window.t > 0.05) return c; } return null; }
for (const wantAligned of [true, false]) {
  let done = false;
  for (let seed = 1; seed <= 6 && !done; seed++) {
    const c = toWindow(seed); if (!c) continue; const s = c.state;
    // 目的の状態（真正面 / 大きくズレ）になるまで待つ
    let found = false;
    while (s.sub === 'WINDOW') {
      const off = Math.abs(s.sx - s.px);
      if (wantAligned ? off < CONFIG.ALIGN * 0.8 : off > CONFIG.ALIGN * 1.6) { found = true; break; }
      c.step(1 / 120, NONE());
    }
    if (!found) continue;
    const m0 = s.misses; const all = [...c.step(1 / 120, { tap: true })];
    for (let k = 0; k < 120 * 3; k++) all.push(...c.step(1 / 120, NONE()));
    const hit = all.some(e => e.type === 'hit'), whiff = all.some(e => e.type === 'whiff');
    log('   ' + (wantAligned ? '真正面' : 'ズレ') + ' → ' + (hit ? 'HIT' : whiff ? '空振り' : '-'));
    ok(wantAligned ? (hit && !whiff) : (whiff && !hit || (!hit && all.some(e => e.type === 'miss'))), wantAligned ? '真正面のタップでHIT' : 'ズレたタップはHITしない（空振り）');
    done = true;
  }
  ok(done, (wantAligned ? '真正面' : 'ズレ') + 'の場面を作れた');
}
// 追跡中の swipe 入力は無視される
{
  const c = toWindow(1); const s = c.state; const h0 = s.hits; let all = [];
  for (let k = 0; k < 120 * 6; k++) all.push(...c.step(1 / 120, { swipe: { dir: 1 } }));
  ok(!all.some(e => e.type === 'hit') && s.hits === h0, 'フリック（swipe）では突撃しない');
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
  ok(s.sub === 'COACH', '0.4s経過後はタップが通る（停車後はまず相棒のひと言 COACH）: ' + s.sub);
  c.step(1 / 60, { tap: true }); ok(s.sub === 'COACH', 'COACH中のタップでは飛ばない（声が終わるまで待つ）: ' + s.sub);
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
  for (const label of ['WINDOW', 'HIT1', 'HIT2', 'HIT3', 'PULLOVER', 'EVENT', 'PREVIEW0', 'REACT1', 'PREVIEW3', 'ARREST', 'END', 'DEAD']) {
    const c = CORE.create(CONFIG, { seed: 1 }); const okw = c.warp(label); const s = c.state;
    const good = okw && (/^HIT(\d)/.test(label) ? s.sub === 'HIT' && s.hits === +label[3] : label === 'WINDOW' ? s.sub === 'WINDOW' : label === 'MISS' ? s.sub === 'MISS' : /^(PREVIEW|REACT)\d$/.test(label) ? s.sub === label.slice(0, -1) && s.cmd.i === +label.slice(-1) : s.sub === label);
    ok(good, 'warp(' + label + ') → ' + s.sub + ' hits=' + s.hits);
  }
}

// 9. 凍結（定数）
ok(Object.isFrozen(CONFIG), 'CONFIGは凍結されている');
console.log(fail === 0 ? '\n全 ' + total + ' 項目 OK' : '\n失敗 ' + fail + ' / ' + total); process.exit(fail ? 1 : 0);

// 開始演出：サイレンを押さなくても先へ進む／押すと追いつきへ
log('9. 開始演出');
{
  const mk = () => CORE.create(CONFIG, { seed: 1 });
  let c = mk(); let subs = []; let t = 0, started = false;
  for (; t < 60 && c.state.sub !== 'INTRO'; t += 1 / 60) { const e = c.step(1 / 60, !started ? (started = true, { button: 'start' }) : NONE()); for (const x of e) if (x.type === 'sub') subs.push(x.sub); }
  ok(c.state.sub === 'INTRO' && subs.join() === 'OPEN_PARK,OPEN_GO,OPEN_SIREN,OPEN_CATCH,INTRO', '押さなくても自動で追いつく: ' + subs.join('>') + ' ' + t.toFixed(1) + 's');
  ok(c.state.siren !== 'OFF', '押さなかった場合は自動でサイレンが鳴る');
  c = mk(); started = false; subs = []; let pressed = 0, tp = 0;
  for (t = 0; t < 60 && c.state.sub !== 'INTRO'; t += 1 / 60) { const inp = !started ? (started = true, { button: 'start' }) : (c.state.sub === 'OPEN_SIREN' && c.state.t > 1 && !pressed ? (pressed = 1, tp = t, { button: 'siren' }) : NONE()); for (const x of c.step(1 / 60, inp)) if (x.type === 'sub') subs.push(x.sub); }
  ok(pressed && t - tp < CONFIG.OPEN.CATCH + 0.6, 'サイレンを押すと約' + CONFIG.OPEN.CATCH + 's後にINTRO: ' + (t - tp).toFixed(2));
  // 駐車中は自車が動かず、赤い車が右から来る
  c = mk(); c.step(1 / 60, { button: 'start' }); for (let k = 0; k < 60; k++) c.step(1 / 60, NONE()); const sp = c.state;
  ok(c.state.sub === 'OPEN_PARK' && sp.speed === 0 && sp.px === 0 && sp.sx > 1, '駐車中：自車は停止、赤い車は右から横切る: sx=' + sp.sx.toFixed(2));
}
