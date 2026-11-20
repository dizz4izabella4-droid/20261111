/* core.js — 名前空間・共通の道具・ログ */
var PN = window.PN = { version: '0.1.0', SAVE_VERSION: 1 };
(function () {
  'use strict';
  PN.$ = function (id) { return document.getElementById(id); };
  PN.el = function (tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  PN.clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  PN.clone = function (o) { return o == null ? o : JSON.parse(JSON.stringify(o)); };
  PN.pad2 = function (n) { return (n < 10 ? '0' : '') + n; };
  PN.fmtDate = function (ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return d.getFullYear() + '/' + PN.pad2(d.getMonth() + 1) + '/' + PN.pad2(d.getDate()) + ' ' + PN.pad2(d.getHours()) + ':' + PN.pad2(d.getMinutes());
  };
  PN.fmtPlay = function (ms) {
    var s = Math.floor((ms || 0) / 1000);
    return Math.floor(s / 3600) + ':' + PN.pad2(Math.floor(s / 60) % 60) + ':' + PN.pad2(s % 60);
  };
  PN.sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  /* 簡易イベントバス */
  var subs = {};
  PN.on = function (ev, fn) { (subs[ev] = subs[ev] || []).push(fn); };
  PN.emit = function (ev, a, b) {
    (subs[ev] || []).forEach(function (fn) { try { fn(a, b); } catch (e) { console.warn(e); } });
  };

  /* ログ（開発者モードの LOG に出る。error は画面にも知らせる） */
  PN.logs = [];
  PN.log = function (level, msg) {
    var rec = { t: Date.now(), level: level, msg: String(msg) };
    PN.logs.push(rec);
    if (PN.logs.length > 400) PN.logs.shift();
    if (level === 'error') console.warn('[PN] ' + rec.msg);
    PN.emit('log', rec);
  };
  window.addEventListener('error', function (e) { PN.log('error', (e.message || 'error') + ' @' + (e.lineno || '?')); });
  window.addEventListener('unhandledrejection', function (e) { PN.log('error', 'Promise: ' + (e.reason && e.reason.message || e.reason)); });
})();
