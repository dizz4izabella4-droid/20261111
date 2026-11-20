/* engine.js — シナリオ命令の実行。命令は PN.engine.register(名前, 関数) で足せる。
 * 関数の戻り値: なし=次へ ／ Promise=終わるまで待つ ／ {jump:"移動先"} ／ {ret:true} ／ 'stop'（進行を止める） */
(function () {
  'use strict';
  var E = PN.engine = { auto: false, skip: false, ctrl: false };
  var H = {}, gen = 0, waiter = null, playing = false, needAuto = false;
  var R, B;

  E.register = function (type, fn) { H[type] = fn; };
  E.commandNames = function () { return Object.keys(H); };
  E.playing = function () { return playing; };
  E.canSave = function () { return playing && !!waiter && (waiter.kind === 'text' || waiter.kind === 'choice'); };
  E.waiting = function () { return waiter ? waiter.kind : null; };
  E.currentChoice = function () { return waiter && waiter.kind === 'choice' ? waiter : null; };

  function scenes() { return PN.game.scenario.scenes; }
  function skipping(read) { return (E.ctrl || E.skip) && (read || PN.sys.config.skipUnread); }
  E.setAuto = function (on) { E.auto = !!on; if (on) E.skip = false; PN.emit('mode'); if (waiter && waiter.kick) waiter.kick(); };
  E.setSkip = function (on) { E.skip = !!on; if (on) E.auto = false; PN.emit('mode'); if (waiter && waiter.kick) waiter.kick(); };
  E.setCtrl = function (on) { if (E.ctrl === !!on) return; E.ctrl = !!on; if (waiter && waiter.kick) waiter.kick(); };

  /* 移動先へ入る（到達条件を確かめ、満たさなければ fallback へ） */
  function enter(str) {
    var S = PN.state, t = B.gate(PN.scenario.parseTarget(str, S.scene)), sc = scenes()[t.scene];
    if (!sc) { PN.log('error', '移動先のシーン "' + t.scene + '" がありません'); return false; }
    S.scene = t.scene;
    S.index = t.label ? (sc.labels[t.label] || 0) : 0;
    if (!t.label) needAuto = true;
    return true;
  }
  function loop(my) {
    var sync = 0;
    function next() {
      while (my === gen) {
        var S = PN.state, sc = scenes()[S.scene];
        if (S.index >= sc.commands.length) {
          if (S.stack.length) { var r = S.stack.pop(); S.scene = r.scene; S.index = r.index; continue; }
          PN.log('warn', 'シーン "' + S.scene + '" の終わりに着きました（END 扱い）');
          return E.toTitle();
        }
        var cmd = sc.commands[S.index], h = H[cmd.type], res;
        R.devLabel();
        if (!h) PN.log('error', S.scene + ' [' + (S.index + 1) + ']: 命令 "' + cmd.type + '" は実行できません');
        else {
          try { res = h(cmd); } catch (e) { PN.log('error', S.scene + ' [' + (S.index + 1) + '] ' + cmd.type + ': ' + e.message); res = undefined; }
        }
        if (res && typeof res.then === 'function') {
          sync = 0;
          res.then(function (v) { if (my === gen && after(v)) next(); }, function (e) { PN.log('error', cmd.type + ': ' + (e && e.message)); if (my === gen && after()) next(); });
          return;
        }
        if (++sync > 20000) { PN.log('error', '命令が止まらずに回り続けています（JUMP の循環？）: ' + S.scene); return E.toTitle(); }
        if (!after(res)) return;
      }
    }
    function after(res) {
      var S = PN.state;
      if (res === 'stop') return false;
      if (res && res.ret) {
        if (S.stack.length) { var r = S.stack.pop(); S.scene = r.scene; S.index = r.index; }
        else { PN.log('warn', 'RETURN: 戻り先がありません'); S.index++; }
      } else if (res && res.jump !== undefined) { if (!enter(res.jump)) S.index++; }
      else S.index++;
      return true;
    }
    next();
  }
  function cancel() {
    if (waiter && waiter.cancel) waiter.cancel();
    waiter = null;
    if (PN.text) PN.text.clear();
    R.hideChoices(); R.showNext(false);
    E.auto = false; E.skip = false; PN.emit('mode');
  }
  function begin() {
    playing = true; PN.playClock.start();
    R.showMessage(true);
    gen++; loop(gen);
  }

  /* ---------- 開始・ロード・タイトル ---------- */
  E.startNew = function () {
    PN.screens.closeAll(); cancel();
    PN.state = PN.newState();
    R.reset(); R.setName('');
    PN.audio.stopAll(600);
    var st = PN.state.scene; PN.state.scene = null;
    enter(st);
    PN.log('info', 'ゲーム開始: ' + PN.state.scene);
    begin();
  };
  E.loadData = function (d) {
    var err = PN.checkSave(d);
    if (err) { PN.screens.message('このデータは読み込めません。\n' + err, { err: true }); return false; }
    PN.screens.closeAll(); cancel();
    PN.playClock.stop();
    PN.state = PN.stateFromSave(d);
    R.restore();
    PN.audio.bgm(PN.state.view.bgm, 400); PN.audio.env(PN.state.view.env, 400);
    needAuto = false;
    PN.log('info', 'ロード: ' + PN.state.scene + ' [' + (PN.state.index + 1) + ']');
    begin();
    return true;
  };
  E.toTitle = function () {
    gen++; cancel();
    if (playing) PN.playClock.stop();
    playing = false;
    PN.state = null;
    PN.screens.closeAll();
    R.reset(); R.showMessage(false);
    var g = PN.game.config;
    R.drawBg(g.titleBg || null);
    PN.audio.env(null, 500); PN.audio.bgm(g.titleBgm || null, 800);
    PN.screens.open('title');
  };
  E.quickSave = function () {
    if (!E.canSave()) { R.notice('今はセーブできません'); return Promise.resolve(false); }
    return PN.save.write('quick').then(function () { PN.audio.se('save'); R.notice('クイックセーブしました'); return true; })
      .catch(function (e) { R.notice('セーブに失敗しました', true); PN.log('error', 'Q.SAVE: ' + (e && e.message)); return false; });
  };
  E.quickLoad = function () {
    return PN.save.read('quick').then(function (d) {
      if (!d) { R.notice('クイックセーブがありません'); return false; }
      return PN.screens.confirm('クイックセーブをロードしますか？').then(function (ok) { return ok ? E.loadData(d) : false; });
    });
  };
  function autosave() { needAuto = false; PN.save.write('auto').catch(function (e) { PN.log('warn', 'オートセーブ失敗: ' + (e && e.message)); }); }

  /* ---------- 入力から呼ばれる ---------- */
  E.advance = function () { if (playing && !PN.screens.isOpen() && waiter && waiter.advance) waiter.advance(); };
  /* 開発者モード用 */
  E.jumpTo = function (target) {
    PN.screens.closeAll();
    if (!PN.state) { PN.state = PN.newState(); R.reset(); }
    cancel();
    PN.state.stack = [];
    var t = PN.scenario.parseTarget(target, PN.state.scene), sc = scenes()[t.scene];
    if (!sc) return;
    PN.state.scene = t.scene; PN.state.index = t.label ? (sc.labels[t.label] || 0) : 0;
    PN.log('info', '開発者: ' + target + ' へ移動');
    if (!playing) begin(); else { gen++; loop(gen); }
  };
  E.forceChoice = function (i) { var w = E.currentChoice(); if (w) { PN.screens.closeAll(); w.pick(i); } };
  E.forceEnding = function (id) { PN.screens.closeAll(); if (!PN.state) PN.state = PN.newState(); cancel(); gen++; reachEnding(PN.ending.def(id)); };

  function speaker(sp) {
    if (!sp) return { name: '', color: '' };
    var c = PN.game.characters[sp];
    return c ? { name: c.name || sp, color: c.color || '' } : { name: sp, color: '' };
  }
  function fill(text) { return String(text).replace(/\{\{([\w.-]+)\}\}/g, function (m, k) { var v = PN.state.flags[k]; return v === undefined ? '' : v; }); }
  function reachEnding(d) {
    if (waiter && waiter.cancel) waiter.cancel();
    waiter = null;
    var first = !PN.sys.endings[d.id];
    PN.ending.record(d.id);
    if (playing) PN.playClock.stop();
    playing = false;
    R.hideChoices(); R.showMessage(false);
    if (d.bgm !== undefined) PN.audio.bgm(d.bgm, 800);
    PN.audio.se('get');
    PN.screens.open('ending', { def: d, first: first }).then(function () { E.toTitle(); });
  }

  /* ---------- 命令 ---------- */
  E.init = function () {
    R = PN.render; B = PN.branch;

    E.register('TEXT', function (cmd) {
      return new Promise(function (resolve) {
        var S = PN.state, sp = speaker(cmd.speaker), text = fill(cmd.text);
        var key = S.scene + ':' + S.index, read = !!PN.sys.read[key], done = false, timer = 0;
        R.setName(sp.name, sp.color);
        PN.backlog.push(sp.name, text);
        if (needAuto) autosave();
        if (E.skip && !read && !PN.sys.config.skipUnread) { E.skip = false; PN.emit('mode'); R.notice('未読のためスキップを止めました'); }
        var o = PN.textOptions();
        if (cmd.fx) o.fx = cmd.fx;
        if (skipping(read)) o.mode = 'INSTANT';
        R.showNext(false);
        waiter = {
          kind: 'text',
          advance: function () { if (!done) PN.text.complete(); else finish(); },
          kick: function () {
            if (E.skip && !read && !PN.sys.config.skipUnread) { E.skip = false; PN.emit('mode'); R.notice('未読のためスキップできません'); return; }
            if (!done && skipping(read)) PN.text.complete(); else if (done) schedule();
          },
          cancel: function () { clearTimeout(timer); }
        };
        PN.text.show(text, o, function () {
          done = true;
          if (!read) { PN.sys.read[key] = 1; PN.save.saveRead(); }
          R.showNext(true); schedule();
        });
        function schedule() {
          clearTimeout(timer);
          if (skipping(read)) timer = setTimeout(finish, 45);
          else if (E.auto) timer = setTimeout(finish, PN.sys.config.autoMs + text.length * 25);
        }
        function finish() {
          clearTimeout(timer);
          if (PN.screens.isOpen()) { timer = setTimeout(finish, 300); return; }
          waiter = null; R.showNext(false);
          resolve();
        }
      });
    });

    E.register('CHOICE', function (cmd) {
      return new Promise(function (resolve) {
        var S = PN.state, pos = { scene: S.scene, index: S.index };
        function chosen(k) { return S.history.some(function (h) { return h.scene === pos.scene && h.index === pos.index && h.opt === k; }); }
        var list = [];
        cmd.options.forEach(function (o, k) {
          if (o.if !== undefined && !B.test(o.if)) return;
          if (o.once && chosen(k)) return;
          list.push({ text: fill(o.text), index: k });
        });
        if (!list.length) {   /* すべて隠れた: 進行不能にしないため、そのまま次へ */
          PN.log('warn', S.scene + ' [' + (S.index + 1) + ']: 出せる選択肢がないので次へ進みます');
          return resolve();
        }
        if (E.skip) { E.skip = false; PN.emit('mode'); }
        autosave();
        waiter = { kind: 'choice', cmd: cmd, pick: pick, advance: null };
        R.showChoices(list, cmd.prompt ? fill(cmd.prompt) : '', pick);
        function pick(k) {
          var o = cmd.options[k];
          if (!o) return;
          R.hideChoices(); waiter = null;
          PN.audio.se('select');
          B.setFlags(o.setFlag, o.addFlag);
          [].concat(o.info || []).forEach(function (id) { PN.information.get(id); });
          S.history.push({ scene: pos.scene, index: pos.index, id: cmd.id || null, opt: k, optId: o.id || null, text: o.text, correct: o.correct === undefined ? null : !!o.correct, at: PN.playClock.now() });
          PN.backlog.push('', fill(o.text), 'choice');
          resolve(o.next !== undefined ? { jump: o.next } : undefined);
        }
      });
    });

    E.register('STATUS', function (cmd) {
      var st = cmd.clear ? {} : PN.state.view.status;
      ['date', 'place', 'chapter'].forEach(function (k) { if (cmd[k] !== undefined) st[k] = cmd[k]; });
      PN.state.view.status = st; R.setStatus(st);
    });
    E.register('BG', function (cmd) {
      var ms = cmd.fade || 0;
      if (!ms || skipping(true) || PN.state.view.fx.black) { R.setBg(cmd.id); return; }
      return PN.fx.run('fadeout', { ms: ms / 2 }).then(function () { R.setBg(cmd.id); return PN.fx.run('fadein', { ms: ms / 2 }); });
    });
    E.register('CHARACTER', function (cmd) {
      var v = PN.state.view;
      v.chars[cmd.id] = { expr: cmd.expr, pos: cmd.pos };
      if (v.order.indexOf(cmd.id) < 0) v.order.push(cmd.id);
      R.showChar(cmd.id, cmd.expr, cmd.pos);
    });
    E.register('HIDE_CHARACTER', function (cmd) {
      var v = PN.state.view;
      if (cmd.id === 'all') { v.chars = {}; v.order = []; }
      else { delete v.chars[cmd.id]; v.order = v.order.filter(function (x) { return x !== cmd.id; }); }
      R.hideChar(cmd.id);
    });
    E.register('BGM', function (cmd) {
      var id = (cmd.stop || !cmd.id || cmd.id === 'stop') ? null : cmd.id;
      if (cmd.channel === 'env') { PN.state.view.env = id; PN.audio.env(id, cmd.fade); }
      else { PN.state.view.bgm = id; PN.audio.bgm(id, cmd.fade); }
    });
    E.register('SE', function (cmd) { if (!skipping(true)) PN.audio.se(cmd.id); });
    E.register('FLAG', function (cmd) { B.setFlags(cmd.set, cmd.add); });
    E.register('IF', function (cmd) {
      var ok = B.test(cmd.cond);
      if (ok && cmd.then !== undefined) return { jump: cmd.then };
      if (!ok && cmd.else !== undefined) return { jump: cmd.else };
    });
    E.register('JUMP', function (cmd) { return { jump: cmd.to }; });
    E.register('CALL', function (cmd) { PN.state.stack.push({ scene: PN.state.scene, index: PN.state.index + 1 }); return { jump: cmd.to }; });
    E.register('RETURN', function () { return { ret: true }; });
    E.register('LABEL', function () {});
    E.register('WAIT', function (cmd) {
      if (skipping(true) || !(cmd.ms > 0)) return;
      return new Promise(function (resolve) {
        var timer = setTimeout(fin, cmd.ms);
        function fin() { clearTimeout(timer); if (waiter && waiter.kind === 'wait') waiter = null; resolve(); }
        waiter = { kind: 'wait', advance: cmd.skippable === false ? null : fin, kick: function () { if (skipping(true)) fin(); }, cancel: function () { clearTimeout(timer); } };
      });
    });
    E.register('INFO', function (cmd) { PN.information.get(cmd.id, cmd.silent); });
    E.register('EFFECT', function (cmd) {
      var p = PN.fx.run(cmd.name, cmd);
      if (cmd.wait === false || skipping(true)) return;
      return p;
    });
    E.register('TEXT_STYLE', function (cmd) {
      var st = {}, n = 0;
      if (cmd.mode && cmd.mode !== 'RESET') { st.mode = cmd.mode; n++; }
      if (cmd.speed !== undefined) { st.charMs = +cmd.speed; n++; }
      ['charMs', 'punctMs', 'lineMs', 'fadeMs', 'lineModeMs'].forEach(function (k) { if (cmd[k] !== undefined) { st[k] = +cmd[k]; n++; } });
      PN.state.view.style = (cmd.mode === 'RESET' || !n) ? null : st;   /* RESET でユーザー設定へ戻る */
    });
    /* STORY難易度の補完: need を満たしていなければ、情報・フラグを補い、必要なら補完シーンを挟む */
    E.register('REQUIRE', function (cmd) {
      if (B.test(cmd.need)) return;
      PN.log('info', 'REQUIRE: 条件未達のため補完します（' + PN.state.scene + '）');
      B.setFlags(cmd.setFlag);
      var grant = [].concat(cmd.grant || []);
      if (cmd.call) {   /* 補完シーンを挟んでから戻る。情報はここで渡しておく（お知らせは出さない） */
        PN.state.stack.push({ scene: PN.state.scene, index: PN.state.index + 1 });
        grant.forEach(function (id) { PN.information.get(id, true); });
        return { jump: cmd.call };
      }
      grant.forEach(function (id) { PN.information.get(id, cmd.silent); });
    });
    E.register('ENDING', function (cmd) {
      var S = PN.state, d = null;
      if (cmd.id) d = PN.ending.def(cmd.id);
      else if (S.flags.__ending) d = PN.ending.def(S.flags.__ending);
      else {
        d = PN.ending.judge();
        if (d && d.scene) { S.flags.__ending = d.id; return { jump: d.scene }; }   /* 結末ごとのシーンを挟む */
      }
      if (!d) { PN.log('error', 'ENDING: 該当するエンディングがありません'); E.toTitle(); return 'stop'; }
      reachEnding(d);
      return 'stop';
    });
    E.register('END', function () { E.toTitle(); return 'stop'; });
  };
})();
