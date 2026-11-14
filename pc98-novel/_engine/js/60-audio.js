/* audio.js — BGM・効果音・環境音（Web Audio API）
 * 音源ファイルがあればそれを鳴らし、なければ合成音（PC-98ふうのFM/矩形波）で仮に鳴らす。失敗しても止めない。
 * Web Audio だけで鳴らすので、スマホのマナーモードでは鳴らない。 */
(function () {
  'use strict';
  var A = PN.audio = {};
  var ctx = null, master, gBgm, gSe, unlocked = false;
  var bufCache = {};
  var ch = { bgm: null, env: null };     /* 鳴っているもの {id, stop()} */
  var want = { bgm: null, env: null };   /* 鳴らしたいもの（解錠前の予約を含む） */

  function ensure() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain(); master.connect(ctx.destination);
      gBgm = ctx.createGain(); gBgm.connect(master);
      gSe = ctx.createGain(); gSe.connect(master);
      A.applyVolume();
    } catch (e) { PN.log('warn', '音を初期化できません: ' + e.message); ctx = null; }
    return ctx;
  }
  /* 最初の操作で音を解錠する（ブラウザの制限） */
  A.unlock = function () {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume().catch(function () {});
    if (!unlocked) { unlocked = true; ['bgm', 'env'].forEach(function (k) { if (want[k] && !ch[k]) start(k, want[k], 0.4); }); }
  };
  A.applyVolume = function () {
    if (!ctx) return;
    var c = PN.sys.config;
    gBgm.gain.value = Math.pow((c.volBgm || 0) / 100, 1.6) * 0.5;
    gSe.gain.value = Math.pow((c.volSe || 0) / 100, 1.6) * 0.6;
  };

  /* ---------- 音源ファイル ---------- */
  function loadFile(url) {
    if (bufCache[url]) return bufCache[url];
    return (bufCache[url] = fetch(url).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.arrayBuffer();
    }).then(function (ab) {
      return new Promise(function (res, rej) { ctx.decodeAudioData(ab, res, rej); });
    }));
  }

  /* ---------- 合成音 ---------- */
  var NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function freq(n) {
    var m = /^([A-G])([#b]?)(\d)$/.exec(n);
    if (!m) return 0;
    var s = NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (+m[3] + 1) * 12;
    return 440 * Math.pow(2, (s - 69) / 12);
  }
  function voice(out, t, f, dur, wave, vol) {
    var g = ctx.createGain(), o = ctx.createOscillator();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(Math.max(vol * 0.35, 0.0001), t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(out);
    if (wave === 'fm') {               /* 2オペレータFM */
      var mod = ctx.createOscillator(), mg = ctx.createGain();
      mod.frequency.value = f * 2; mg.gain.setValueAtTime(f * 2.2, t); mg.gain.exponentialRampToValueAtTime(f * 0.2 + 0.01, t + dur);
      mod.connect(mg); mg.connect(o.frequency); mod.start(t); mod.stop(t + dur + 0.05);
      o.type = 'sine';
    } else o.type = wave || 'square';
    o.frequency.value = f;
    o.connect(g); o.start(t); o.stop(t + dur + 0.05);
  }
  /* 仮BGMの譜面。tracks[].seq は 1拍を step 等分した並び（"-" は休み、"." は伸ばす） */
  var SYNTH_BGM = {
    mystery: { bpm: 66, step: 2, tracks: [
      { wave: 'fm', vol: 0.20, seq: 'A3 E4 A4 C5 B4 E4 G4 E4 | F3 C4 F4 A4 G4 C4 E4 C4 | D3 A3 D4 F4 E4 A3 C4 A3 | E3 B3 E4 G#4 B4 . E4 -' },
      { wave: 'triangle', vol: 0.22, seq: 'A2 . . . . . . . | F2 . . . . . . . | D2 . . . . . . . | E2 . . . . . E2 .' } ] },
    tension: { bpm: 132, step: 2, tracks: [
      { wave: 'square', vol: 0.10, seq: 'E2 E2 - E2 E2 - E2 G2 | E2 E2 - E2 E2 - F2 E2 | E2 E2 - E2 E2 - E2 G2 | A2 A2 - G2 G2 - F2 F2' },
      { wave: 'fm', vol: 0.16, seq: 'E4 . . . B4 . . . | C5 . . . B4 . . . | E4 . . . B4 . . . | D5 . C5 . B4 . F4 .' } ] },
    calm: { bpm: 76, step: 2, tracks: [
      { wave: 'fm', vol: 0.18, seq: 'C4 E4 G4 C5 G4 E4 G4 E4 | A3 C4 E4 A4 E4 C4 E4 C4 | F3 A3 C4 F4 C4 A3 C4 A3 | G3 B3 D4 G4 D4 B3 D4 B3' },
      { wave: 'triangle', vol: 0.20, seq: 'C3 . . . . . . . | A2 . . . . . . . | F2 . . . . . . . | G2 . . . . . . .' } ] },
    ending: { bpm: 84, step: 2, tracks: [
      { wave: 'fm', vol: 0.20, seq: 'E5 . D5 C5 . G4 C5 . | D5 . C5 B4 . G4 B4 . | C5 . B4 A4 . E4 A4 . | G4 . A4 B4 . D5 C5 .' },
      { wave: 'triangle', vol: 0.18, seq: 'C3 G3 C4 G3 C3 G3 C4 G3 | G2 D3 G3 D3 G2 D3 G3 D3 | A2 E3 A3 E3 A2 E3 A3 E3 | F2 C3 F3 C3 G2 D3 G3 D3' } ] }
  };
  function playSynthLoop(def, out) {
    var tracks = def.tracks.map(function (t) { return { wave: t.wave, vol: t.vol, seq: t.seq.replace(/\|/g, ' ').trim().split(/\s+/) }; });
    var stepDur = 60 / (def.bpm || 80) / (def.step || 2), len = Math.max.apply(null, tracks.map(function (t) { return t.seq.length; }));
    var pos = 0, next = ctx.currentTime + 0.08, alive = true;
    var timer = setInterval(function () {
      if (!alive) return;
      if (next < ctx.currentTime - 0.5) next = ctx.currentTime + 0.05;   /* 裏から戻ったとき */
      while (next < ctx.currentTime + 0.3) {
        tracks.forEach(function (t) {
          var n = t.seq[pos % t.seq.length];
          if (!n || n === '-' || n === '.') return;
          var hold = 1; while (t.seq[(pos + hold) % t.seq.length] === '.' && hold < t.seq.length) hold++;
          var f = freq(n); if (f) voice(out, next, f, stepDur * hold * 0.98, t.wave, t.vol);
        });
        pos = (pos + 1) % len; next += stepDur;
      }
    }, 100);
    return function () { alive = false; clearInterval(timer); };
  }
  /* 仮の環境音（色つきノイズ） */
  function playNoiseLoop(kind, out) {
    var n = ctx.sampleRate * 2, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0), last = 0;
    for (var i = 0; i < n; i++) { last = (last + (Math.random() * 2 - 1) * 0.08) * 0.985; d[i] = last * 3; }
    var src = ctx.createBufferSource(); src.buffer = b; src.loop = true;
    var f = ctx.createBiquadFilter(); f.type = kind === 'rain' ? 'highpass' : 'lowpass'; f.frequency.value = kind === 'rain' ? 1800 : kind === 'hum' ? 140 : 480;
    var g = ctx.createGain(); g.gain.value = kind === 'rain' ? 0.5 : 0.8;
    src.connect(f); f.connect(g); g.connect(out); src.start();
    return function () { try { src.stop(); } catch (e) {} };
  }
  /* 仮の効果音 */
  var SYNTH_SE = {
    click: function (t, o) { voice(o, t, 1200, 0.04, 'square', 0.12); },
    select: function (t, o) { voice(o, t, 880, 0.06, 'square', 0.14); voice(o, t + 0.06, 1320, 0.09, 'square', 0.14); },
    cancel: function (t, o) { voice(o, t, 440, 0.07, 'square', 0.14); voice(o, t + 0.06, 330, 0.1, 'square', 0.14); },
    get: function (t, o) { ['C5', 'E5', 'G5', 'C6'].forEach(function (n, i) { voice(o, t + i * 0.07, freq(n), 0.16, 'fm', 0.2); }); },
    save: function (t, o) { voice(o, t, 660, 0.08, 'triangle', 0.25); voice(o, t + 0.09, 990, 0.14, 'triangle', 0.25); },
    bell: function (t, o) { [0, 1.1, 2.2].forEach(function (d) { voice(o, t + d, 392, 1.6, 'fm', 0.3); voice(o, t + d, 784, 1.2, 'sine', 0.1); }); },
    step: function (t, o) { [0, 0.42, 0.84].forEach(function (d) { voice(o, t + d, 90, 0.09, 'triangle', 0.5); }); },
    door: function (t, o) { voice(o, t, 130, 0.25, 'sawtooth', 0.18); voice(o, t + 0.22, 70, 0.3, 'triangle', 0.5); },
    shock: function (t, o) { voice(o, t, 60, 0.5, 'sawtooth', 0.4); voice(o, t, 1900, 0.08, 'square', 0.15); },
    noise: function (t, o) { for (var i = 0; i < 10; i++) voice(o, t + i * 0.03, 200 + Math.random() * 3000, 0.04, 'square', 0.08); },
    piano: function (t, o) { ['E4', 'G4', 'C5'].forEach(function (n, i) { voice(o, t + i * 0.28, freq(n), 0.9, 'fm', 0.22); }); }
  };

  /* ---------- BGM・環境音 ---------- */
  function start(kind, id, fade) {
    var defs = PN.game.audio[kind === 'env' ? 'env' : 'bgm'] || {}, def = defs[id];
    if (!def || !ensure()) return;
    var g = ctx.createGain(), t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(def.volume === undefined ? 1 : def.volume, t + Math.max(fade, 0.02));
    g.connect(gBgm);
    var stopFn = null, me = { id: id, gain: g, stop: function (f) {
      var now = ctx.currentTime; f = Math.max(f || 0, 0.03);
      g.gain.cancelScheduledValues(now); g.gain.setValueAtTime(g.gain.value, now); g.gain.linearRampToValueAtTime(0.0001, now + f);
      me.dead = true;
      setTimeout(function () { if (stopFn) stopFn(); try { g.disconnect(); } catch (e) {} }, f * 1000 + 80);
    } };
    ch[kind] = me;
    function synth() {
      if (me.dead) return;
      var s = def.synth;
      if (!s) return;
      if (kind === 'env' || s === 'wind' || s === 'rain' || s === 'hum') stopFn = playNoiseLoop(s, g);
      else { var sd = typeof s === 'object' ? s : SYNTH_BGM[s]; if (sd) stopFn = playSynthLoop(sd, g); else PN.log('warn', '合成BGM "' + s + '" はありません'); }
    }
    if (def.file) {
      loadFile(def.file).then(function (buf) {
        if (me.dead) return;
        var src = ctx.createBufferSource(); src.buffer = buf; src.loop = def.loop !== false; src.connect(g); src.start();
        stopFn = function () { try { src.stop(); } catch (e) {} };
      }).catch(function () { PN.log('info', '音源なし（合成音で代用）: ' + def.file); synth(); });
    } else synth();
  }
  function play(kind, id, fade) {
    fade = fade === undefined ? 0.8 : fade / 1000;
    if (!id || id === 'stop' || id === 'none') id = null;
    if (want[kind] === id && (ch[kind] || !unlocked)) return;
    want[kind] = id;
    if (ch[kind]) { ch[kind].stop(fade); ch[kind] = null; }
    if (id && unlocked) start(kind, id, fade);
  }
  A.bgm = function (id, fade) { try { play('bgm', id, fade); } catch (e) { PN.log('warn', 'BGM: ' + e.message); } };
  A.env = function (id, fade) { try { play('env', id, fade); } catch (e) { PN.log('warn', '環境音: ' + e.message); } };
  A.stopAll = function (fade) { A.bgm(null, fade); A.env(null, fade); };

  /* ---------- 効果音 ---------- */
  A.se = function (id) {
    try {
      if (!unlocked || !ensure()) return;
      var def = (PN.game.audio.se || {})[id] || (SYNTH_SE[id] ? { synth: id } : null);
      if (!def) return;
      var syn = function () { var f = SYNTH_SE[def.synth]; if (f) f(ctx.currentTime + 0.01, gSe); };
      if (def.file) {
        loadFile(def.file).then(function (buf) { var s = ctx.createBufferSource(); s.buffer = buf; s.connect(gSe); s.start(); })
          .catch(function () { syn(); });
      } else syn();
    } catch (e) { PN.log('warn', 'SE: ' + e.message); }
  };
  A.synthNames = function () { return { bgm: Object.keys(SYNTH_BGM), se: Object.keys(SYNTH_SE), env: ['wind', 'rain', 'hum'] }; };
  /* 画面が裏へ回ったら音を止める */
  document.addEventListener('visibilitychange', function () {
    if (!ctx) return;
    if (document.hidden) ctx.suspend().catch(function () {}); else if (unlocked) ctx.resume().catch(function () {});
  });
})();
