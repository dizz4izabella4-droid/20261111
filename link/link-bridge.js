/* izlink bridge v1 — 連携アプリの共通データ層とイベント
 *
 * 各アプリ（保管庫・レッドライン・iz2611）と外枠（link/）に埋め込む小さな部品。
 * 埋め込みは tools/apply_link_bridge.py で行う（作品は1ファイル完結のため）。
 *
 * 保存先（同一ドメインの localStorage）
 *   izlink.v1.meta      : { caseId, settings:{ brand, stringsForFloppy } }
 *   izlink.v1.<caseId>  : { marks:[], floppies:{}, terminal:{}, board:{items:[],pins:[],strings:[]}, truth:null }
 *
 * API（window.IzLink）
 *   IzLink.linked                 外枠の中で動いているか（単体起動なら false）
 *   IzLink.brand()                端末名（既定 'iz2611'）
 *   IzLink.setting(key)           設定値
 *   IzLink.caseId()               現在の事件ID
 *   IzLink.meta() / setMeta(fn)   メタの読み出し・更新
 *   IzLink.get(caseId?)           事件データ（無ければ空の形で返す）
 *   IzLink.update(fn, caseId?)    事件データを fn(data) で書き換えて保存し、'data.changed' を流す
 *   IzLink.on(type, cb)           イベント受信（自分・他の画面・外枠のどこから来たものも）。戻り値で解除
 *   IzLink.emit(type, payload)    イベント送信（自分にも届く。外枠経由で他の画面へも届く）
 *   IzLink.onVisibility(cb)       表示・非表示の通知（外枠が送る）
 *
 * 主なイベント
 *   case.selected {caseId}  mark.added {docId,...}  string.added {stringId}
 *   floppy.found {caseId}   floppy.inserted {caseId}  article.pinned {articleId}
 *   evidence.found {...}    truth.revealed {...}      data.changed {caseId}
 */
(function (global) {
  'use strict';
  if (global.IzLink) return;

  var PREFIX = 'izlink.v1.';
  var META_KEY = PREFIX + 'meta';
  var DEFAULT_SETTINGS = { brand: 'iz2611', stringsForFloppy: 3 };
  var listeners = {};
  var visListeners = [];
  var isTop = global.parent === global;
  // 外枠（link/）は、部品より先に window.IZLINK_HOST = 1 を置く。
  // 祖先に外枠がいるときだけ「連携中」とみなす（単体の端末の中のディスクなどは連携しない）
  var hostWin = null;
  (function () {
    var w = global;
    for (var i = 0; i < 6; i++) {
      try { if (w.IZLINK_HOST) { hostWin = w; return; } } catch (e) { return; }
      if (w.parent === w) return;
      w = w.parent;
    }
  })();

  function read(key, fallback) {
    try {
      var s = global.localStorage.getItem(key);
      return s ? JSON.parse(s) : fallback;
    } catch (e) { return fallback; }
  }
  function write(key, value) {
    try { global.localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }

  function emptyCase() {
    return { marks: [], floppies: {}, terminal: {}, board: { items: [], pins: [], strings: [] }, truth: null };
  }
  function normalizeCase(d) {
    var e = emptyCase();
    if (!d || typeof d !== 'object') return e;
    for (var k in e) if (!(k in d)) d[k] = e[k];
    if (!d.board || typeof d.board !== 'object') d.board = e.board;
    ['items', 'pins', 'strings'].forEach(function (k) { if (!Array.isArray(d.board[k])) d.board[k] = []; });
    return d;
  }

  function meta() {
    var m = read(META_KEY, null) || {};
    m.settings = m.settings || {};
    for (var k in DEFAULT_SETTINGS) if (!(k in m.settings)) m.settings[k] = DEFAULT_SETTINGS[k];
    if (!('caseId' in m)) m.caseId = null;
    return m;
  }
  function setMeta(fn) {
    var m = meta();
    var r = fn(m);
    write(META_KEY, r || m);
    return r || m;
  }

  function caseId() { return meta().caseId; }
  function get(id) {
    id = id || caseId();
    if (!id) return emptyCase();
    return normalizeCase(read(PREFIX + id, null));
  }
  function update(fn, id) {
    id = id || caseId();
    if (!id) return null;
    var d = get(id);
    var r = fn(d);
    d = normalizeCase(r || d);
    write(PREFIX + id, d);
    emit('data.changed', { caseId: id });
    return d;
  }

  function deliver(type, payload, origin) {
    var ev = { type: type, payload: payload || {}, origin: origin };
    (listeners[type] || []).slice().forEach(function (cb) { try { cb(ev.payload, ev); } catch (e) { console.error(e); } });
    (listeners['*'] || []).slice().forEach(function (cb) { try { cb(ev.payload, ev); } catch (e) { console.error(e); } });
  }
  function on(type, cb) {
    (listeners[type] = listeners[type] || []).push(cb);
    return function () {
      var a = listeners[type] || [];
      var i = a.indexOf(cb);
      if (i >= 0) a.splice(i, 1);
    };
  }

  var selfId = Math.random().toString(36).slice(2);
  // 窓の木（外枠 → 各アプリ → その中のディスク …）に沿って、送り元以外の隣へ流す
  function neighbors() {
    var out = [];
    if (!isTop) out.push(global.parent);
    var frames = global.document ? global.document.querySelectorAll('iframe') : [];
    Array.prototype.forEach.call(frames, function (f) { if (f.contentWindow) out.push(f.contentWindow); });
    return out;
  }
  function relay(msg, exceptWin) {
    neighbors().forEach(function (w) {
      if (w === exceptWin) return;
      try { w.postMessage(msg, '*'); } catch (e) {}
    });
  }
  function emit(type, payload) {
    deliver(type, payload, 'self');
    if (!hostWin) return; // 連携していないときは自分の中だけ
    relay({ izlink: 1, kind: 'event', type: type, payload: payload || {}, from: selfId }, null);
  }

  global.addEventListener('message', function (e) {
    var d = e.data;
    if (!d) return;
    // 外枠からの表示通知（link/ の既存形式）
    if (d.type === 'izlink.visibility') {
      if (e.source === global.parent) visListeners.slice().forEach(function (cb) { try { cb(!!d.visible); } catch (er) {} });
      return;
    }
    if (d.izlink !== 1 || d.kind !== 'event' || d.from === selfId || !hostWin) return;
    var known = e.source === global.parent && !isTop;
    if (!known) {
      var frames = global.document ? global.document.querySelectorAll('iframe') : [];
      for (var i = 0; i < frames.length; i++) if (frames[i].contentWindow === e.source) { known = true; break; }
    }
    if (!known) return;
    deliver(d.type, d.payload, 'frame');
    relay(d, e.source);
  });

  var api = {
    version: 1,
    linked: !!hostWin && hostWin !== global,
    isFrame: hostWin === global,
    brand: function () { return meta().settings.brand; },
    setting: function (k) { return meta().settings[k]; },
    meta: meta,
    setMeta: setMeta,
    caseId: caseId,
    get: get,
    update: update,
    on: on,
    emit: emit,
    onVisibility: function (cb) { visListeners.push(cb); },
    _keys: { prefix: PREFIX, meta: META_KEY }
  };
  global.IzLink = api;
  if (api.linked) {
    try { global.parent.postMessage({ type: 'izlink.ready' }, '*'); } catch (e) {}
  }
})(window);
