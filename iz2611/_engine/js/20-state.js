/* state.js — ゲームの進行状態（セーブされるもの）と、システムデータ（設定・既読・エンディング） */
(function () {
  'use strict';
  PN.CONFIG_DEFAULT = {
    textMode: 'TYPEWRITER', charMs: 30, punctMs: 200, lineMs: 300, fadeMs: 600, lineModeMs: 400, autoMs: 1500,
    skipUnread: false, volBgm: 60, volSe: 70, dev: false
  };
  PN.sys = { config: {}, endings: {}, read: {} };
  PN.state = null;

  PN.newState = function () {
    var f = PN.clone((PN.game.config && PN.game.config.flags) || {});
    return {
      scene: PN.game.scenario.start, index: 0, stack: [],
      flags: f, info: [], history: [], backlog: [], playMs: 0,
      view: { bg: null, chars: {}, order: [], status: {}, bgm: null, env: null, fx: {}, style: null }
    };
  };
  var tick = 0;
  PN.playClock = {
    start: function () { tick = Date.now(); },
    stop: function () { if (tick && PN.state) PN.state.playMs += Date.now() - tick; tick = 0; },
    now: function () { return (PN.state ? PN.state.playMs : 0) + (tick ? Date.now() - tick : 0); }
  };

  /* セーブデータを作る／戻す */
  PN.snapshot = function () {
    var s = PN.state, g = PN.game.config;
    var last = s.backlog[s.backlog.length - 1];
    return {
      format: 'pc98novel-save', saveVersion: PN.SAVE_VERSION, gameId: g.gameId, scenarioVersion: String(g.version),
      scene: s.scene, index: s.index, stack: PN.clone(s.stack), flags: PN.clone(s.flags), info: s.info.slice(),
      history: PN.clone(s.history), endings: PN.clone(PN.sys.endings), playMs: PN.playClock.now(), savedAt: Date.now(),
      view: PN.clone(s.view), backlog: PN.clone(s.backlog.slice(-80)),
      preview: last ? (last.who ? last.who + ' ' : '') + last.text.replace(/\n/g, ' ').slice(0, 40) : ''
    };
  };

  /* 形式の検証（ロード・インポートの両方で使う）。問題があれば文字列、なければ null */
  PN.checkSave = function (d) {
    if (!d || typeof d !== 'object') return 'セーブデータの形式ではありません';
    if (d.format !== 'pc98novel-save') return 'format が違います';
    if (typeof d.saveVersion !== 'number') return 'saveVersion がありません';
    if (d.saveVersion > PN.SAVE_VERSION) return '新しいバージョンのエンジンで作られたデータです（v' + d.saveVersion + '）';
    if (d.gameId !== PN.game.config.gameId) return '別の作品のデータです（' + d.gameId + '）';
    if (typeof d.scene !== 'string' || typeof d.index !== 'number') return '現在位置がありません';
    if (!d.flags || typeof d.flags !== 'object' || !Array.isArray(d.info) || !Array.isArray(d.history)) return 'フラグ・情報・選択履歴がありません';
    var sc = PN.game.scenario.scenes[d.scene];
    if (!sc) return 'シーン "' + d.scene + '" は今のシナリオにありません';
    return null;
  };
  /* 古い saveVersion のデータを今の形へ直す。版を上げたら MIGRATE[旧版] を足す */
  var MIGRATE = { /* 1: function (d) { ...; d.saveVersion = 2; } */ };
  PN.migrateSave = function (d) {
    while (d.saveVersion < PN.SAVE_VERSION && MIGRATE[d.saveVersion]) MIGRATE[d.saveVersion](d);
    return d;
  };
  PN.stateFromSave = function (d) {
    d = PN.migrateSave(PN.clone(d));
    var st = PN.newState();
    st.scene = d.scene; st.index = d.index; st.stack = d.stack || [];
    st.flags = d.flags; st.info = d.info; st.history = d.history; st.playMs = d.playMs || 0;
    st.backlog = d.backlog || [];
    var v = d.view || {};
    st.view = { bg: v.bg || null, chars: v.chars || {}, order: v.order || Object.keys(v.chars || {}), status: v.status || {}, bgm: v.bgm || null, env: v.env || null, fx: v.fx || {}, style: v.style || null };
    var sc = PN.game.scenario.scenes[st.scene];
    if (String(d.scenarioVersion) !== String(PN.game.config.version)) {
      PN.log('warn', 'シナリオの版が違うセーブです（' + d.scenarioVersion + ' → ' + PN.game.config.version + '）');
      var c = sc.commands[st.index];
      if (!c || (c.type !== 'TEXT' && c.type !== 'CHOICE')) { st.index = 0; st.stack = []; }
    }
    if (st.index >= sc.commands.length) st.index = 0;
    return st;
  };
})();
