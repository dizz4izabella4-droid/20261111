/* iz-game-base v1 — 全ゲーム共通の基本設計
 *  1. iOS の「ダブルタップで拡大」「ピンチ拡大」を無効にする
 *  2. 全画面表示の切り替え（Fullscreen API。iPhone は非対応のため「ホーム画面に追加」を案内）
 *  3. 画面の向き（自動 / 縦 / 横）の選択（Androidは全画面時に固定、非対応端末は回転の案内を出す）
 * 各作品の <head> へ tools/apply_game_base.py が埋め込む（作品は1ファイル完結のため、外部読み込みはしない）。
 * 位置を変えたいときは、この前に window.IZ_BASE={pos:'tr'|'tl'|'br'|'bl'} を書く。
 */
(function () {
  'use strict';
  if (window.__izGameBase) return;
  window.__izGameBase = 1;
  var D = document, W = window, DE = D.documentElement;
  var KEY = 'izGameBase.orient';
  var cfg = W.IZ_BASE || {};
  /* 表示文言。作品側で window.IZ_BASE={lang:'en'} を書くと英語になる（既定は日本語） */
  var T = cfg.lang === 'en'
    ? { set: 'Display settings', scr: 'SCREEN', fs: 'Go full screen', fsOff: 'Exit full screen', ori: 'ORIENTATION', auto: 'Auto', port: 'Portrait', land: 'Landscape', close: 'Close', nAuto: 'Follows your device orientation.', nFix: 'Locks the orientation in full screen. If it cannot be locked, please rotate your device.', rot: function (m) { return '\u21bb Please turn your device to ' + (m === 'land' ? 'landscape' : 'portrait'); } }
    : { set: '表示設定', scr: '画面', fs: '全画面にする', fsOff: '全画面をやめる', ori: '向き', auto: '自動', port: '縦', land: '横', close: '閉じる', nAuto: '端末の向きに合わせます。', nFix: '全画面のときに向きを固定します。固定できない場合は、端末を回してください。', rot: function (m) { return '\u21bb 端末を' + (m === 'land' ? '横' : '縦') + '向きにしてください'; } };

  /* ---------- 1. 拡大の無効化 ---------- */
  function fixViewport() {
    var m = D.querySelector('meta[name="viewport"]');
    if (!m) {
      m = D.createElement('meta');
      m.name = 'viewport';
      (D.head || DE).appendChild(m);
      m.content = 'width=device-width,initial-scale=1,viewport-fit=cover';
    }
    var c = m.getAttribute('content') || '';
    c = c.replace(/(^|,)\s*(maximum-scale|minimum-scale|user-scalable)\s*=\s*[^,]*/gi, '').replace(/^,/, '');
    m.setAttribute('content', c + ',maximum-scale=1,user-scalable=no');
  }
  fixViewport();

  var st = D.createElement('style');
  st.textContent = 'html{touch-action:manipulation;-webkit-text-size-adjust:100%;text-size-adjust:100%}';
  (D.head || DE).appendChild(st);

  // iOS Safari はピンチを gesture イベントで受ける
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (t) {
    D.addEventListener(t, function (e) { e.preventDefault(); }, { passive: false });
  });
  // 2本指の拡大（scale が 1 から動いたとき）だけを止める。マルチタッチ操作そのものは妨げない
  D.addEventListener('touchmove', function (e) {
    if (e.touches && e.touches.length > 1 && e.scale && e.scale !== 1) e.preventDefault();
  }, { passive: false });
  // ダブルタップ拡大の保険。ボタン・入力欄などは click を壊さないよう除外し、CSS の touch-action に任せる
  var lastEnd = 0;
  var SKIP = 'input,textarea,select,button,a,label,summary,video,audio,[contenteditable],[role="button"],[data-iz-base-ui]';
  D.addEventListener('touchend', function (e) {
    var now = Date.now();
    var t = e.target;
    var skip = t && t.closest && t.closest(SKIP);
    if (!skip && now - lastEnd < 350 && e.cancelable) e.preventDefault();
    lastEnd = now;
  }, { passive: false });

  /* ---------- 2・3. 全画面と向き ---------- */
  var fsEl = DE;
  var fsReq = fsEl.requestFullscreen || fsEl.webkitRequestFullscreen || fsEl.msRequestFullscreen;
  var fsOk = !!fsReq && (D.fullscreenEnabled !== false) && (D.webkitFullscreenEnabled !== false);
  function isFs() { return !!(D.fullscreenElement || D.webkitFullscreenElement); }
  function standalone() {
    return !!(navigator.standalone || (W.matchMedia && W.matchMedia('(display-mode: standalone)').matches));
  }
  function enterFs() {
    try {
      var p = fsReq.call(fsEl, { navigationUI: 'hide' });
      if (p && p.catch) p.catch(function () {});
      return p;
    } catch (e) { return null; }
  }
  function exitFs() {
    var f = D.exitFullscreen || D.webkitExitFullscreen || D.msExitFullscreen;
    try { var p = f && f.call(D); if (p && p.catch) p.catch(function () {}); } catch (e) {}
  }
  function lockApi() { return W.screen && screen.orientation && screen.orientation.lock; }
  // 変更できない機能は表示しない（iPhone は両方とも不可なので、ボタン自体を出さない）
  var orOk = !!lockApi() && (navigator.maxTouchPoints > 0);
  var uiOk = fsOk || orOk;
  function applyOrient(mode, wantFs) {
    // 戻り値は使わず、結果は banner() が画面の向きで判定する
    if (mode === 'auto') {
      try { if (W.screen && screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e) {}
      return;
    }
    var tgt = mode === 'land' ? 'landscape' : 'portrait';
    function lock() {
      if (!lockApi()) return;
      try { var p = screen.orientation.lock(tgt); if (p && p.catch) p.catch(function () {}); } catch (e) {}
    }
    if (isFs() || standalone()) lock();
    else if (wantFs && fsOk) {
      var p = enterFs();
      if (p && p.then) p.then(lock, function () {}); else lock();
    }
  }
  var mode = 'auto';
  try { mode = localStorage.getItem(KEY) || 'auto'; } catch (e) {}
  if ((mode !== 'land' && mode !== 'port') || !orOk) mode = 'auto';

  /* ---------- UI ---------- */
  var ui, btn, panel, banner, bT;
  var pos = cfg.pos || 'tr';
  function build() {
    if (ui || !D.body || !uiOk) return;
    var css = D.createElement('style');
    css.textContent =
      '#izb{position:fixed;z-index:2147483646;font:12px/1.4 "Hiragino Sans","Yu Gothic","Meiryo","Noto Sans JP",sans-serif;color:#fff;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;touch-action:manipulation}' +
      '#izb *{box-sizing:border-box}' +
      '#izb.tr{top:calc(6px + env(safe-area-inset-top,0px));right:calc(6px + env(safe-area-inset-right,0px))}' +
      '#izb.tl{top:calc(6px + env(safe-area-inset-top,0px));left:calc(6px + env(safe-area-inset-left,0px))}' +
      '#izb.br{bottom:calc(6px + env(safe-area-inset-bottom,0px));right:calc(6px + env(safe-area-inset-right,0px))}' +
      '#izb.bl{bottom:calc(6px + env(safe-area-inset-bottom,0px));left:calc(6px + env(safe-area-inset-left,0px))}' +
      '#izb button{font:inherit;color:inherit;border:0;margin:0;cursor:pointer;-webkit-appearance:none;appearance:none}' +
      '#izb .iz-b{width:30px;height:30px;border-radius:8px;background:rgba(20,20,24,.45);border:1px solid rgba(255,255,255,.25);font-size:16px;line-height:28px;text-align:center;padding:0;opacity:.45;transition:opacity .2s}' +
      '#izb .iz-b:active,#izb.open .iz-b{opacity:1}' +
      '#izb .iz-p{display:none;position:absolute;width:210px;padding:10px;border-radius:10px;background:rgba(18,18,22,.94);border:1px solid rgba(255,255,255,.22);box-shadow:0 4px 18px rgba(0,0,0,.5)}' +
      '#izb.open .iz-p{display:block}' +
      '#izb.tr .iz-p,#izb.tl .iz-p{top:36px}#izb.br .iz-p,#izb.bl .iz-p{bottom:36px}' +
      '#izb.tr .iz-p,#izb.br .iz-p{right:0}#izb.tl .iz-p,#izb.bl .iz-p{left:0}' +
      '#izb .iz-h{font-size:11px;color:#aab;margin:0 0 5px}' +
      '#izb .iz-r{display:flex;gap:4px;margin-bottom:9px}' +
      '#izb .iz-r button{flex:1;padding:8px 0;border-radius:7px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);font-size:13px}' +
      '#izb .iz-r button.on{background:#e8c13a;color:#111;border-color:#e8c13a;font-weight:700}' +
      '#izb .iz-r button[disabled]{opacity:.4}' +
      '#izb .iz-n{font-size:10.5px;color:#9a9aa8;margin:-3px 0 6px}' +
      '#izb .iz-x{display:block;width:100%;padding:6px 0;border-radius:7px;background:transparent;border:1px solid rgba(255,255,255,.18);font-size:12px;color:#ccd}' +
      '#izbn{position:fixed;left:50%;transform:translateX(-50%);top:calc(10px + env(safe-area-inset-top,0px));z-index:2147483645;padding:7px 14px;border-radius:18px;background:rgba(18,18,22,.88);border:1px solid rgba(255,255,255,.25);color:#fff;font:13px/1.3 "Hiragino Sans","Yu Gothic","Meiryo","Noto Sans JP",sans-serif;pointer-events:none;display:none;white-space:nowrap}';
    (D.head || DE).appendChild(css);

    ui = D.createElement('div');
    ui.id = 'izb';
    ui.className = pos;
    ui.setAttribute('data-iz-base-ui', '');
    ui.innerHTML =
      '<button type="button" class="iz-b" tabindex="-1" aria-label="' + T.set + '">⛶</button>' +
      '<div class="iz-p">' +
      (fsOk ? '<div class="iz-h">' + T.scr + '</div><div class="iz-r"><button type="button" tabindex="-1" data-fs="1">' + T.fs + '</button></div>' : '') +
      (orOk ? '<div class="iz-h">' + T.ori + '</div><div class="iz-r" id="izor"><button type="button" tabindex="-1" data-o="auto">' + T.auto + '</button><button type="button" tabindex="-1" data-o="port">' + T.port + '</button><button type="button" tabindex="-1" data-o="land">' + T.land + '</button></div><div class="iz-n" id="izon"></div>' : '') +
      '<button type="button" class="iz-x" tabindex="-1" data-close="1">' + T.close + '</button>' +
      '</div>';
    D.body.appendChild(ui);
    btn = ui.querySelector('.iz-b');
    panel = ui.querySelector('.iz-p');

    banner = D.createElement('div');
    banner.id = 'izbn';
    D.body.appendChild(banner);

    // UI 上の操作はゲーム側へ伝えない
    ['touchstart', 'touchend', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'keydown', 'keyup'].forEach(function (t) {
      ui.addEventListener(t, function (e) { e.stopPropagation(); });
    });
    ui.addEventListener('click', function (e) {
      var t = e.target.closest('button');
      if (!t) return;
      if (t === btn) { ui.classList.toggle('open'); refresh(); }
      else if (t.getAttribute('data-close')) ui.classList.remove('open');
      else if (t.getAttribute('data-fs')) { isFs() ? exitFs() : enterFs(); setTimeout(refresh, 250); }
      else if (t.getAttribute('data-o')) setMode(t.getAttribute('data-o'), true);
      if (t.blur) t.blur();
    });
    refresh();
  }
  function setMode(m, fromUser) {
    mode = m;
    try { localStorage.setItem(KEY, m); } catch (e) {}
    applyOrient(m, fromUser);
    refresh();
    setTimeout(banner_, 400);
  }
  function refresh() {
    if (!ui) return;
    var fb = ui.querySelector('[data-fs]');
    if (fb) fb.textContent = isFs() ? T.fsOff : T.fs;
    var bs = ui.querySelectorAll('[data-o]');
    for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('on', bs[i].getAttribute('data-o') === mode);
    var on = ui.querySelector('#izon');
    if (on) on.textContent = mode === 'auto' ? T.nAuto : T.nFix;
  }
  function banner_() {
    if (!banner) return;
    var land = W.innerWidth > W.innerHeight;
    var bad = (mode === 'land' && !land) || (mode === 'port' && land);
    if (bad) {
      banner.textContent = T.rot(mode);
      banner.style.display = 'block';
      clearTimeout(bT);
      bT = setTimeout(function () { banner.style.display = 'none'; }, 6000);
    } else banner.style.display = 'none';
  }
  function onChange() { refresh(); setTimeout(banner_, 300); }
  D.addEventListener('fullscreenchange', onChange);
  D.addEventListener('webkitfullscreenchange', onChange);
  W.addEventListener('orientationchange', onChange);
  W.addEventListener('resize', function () { setTimeout(banner_, 300); });

  function init() {
    build();
    if (mode !== 'auto') { applyOrient(mode, false); setTimeout(banner_, 600); }
  }
  if (D.body) init(); else D.addEventListener('DOMContentLoaded', init);

  W.IZBase = { fullscreen: function (on) { on === false ? exitFs() : enterFs(); }, orientation: setMode, get mode() { return mode; } };
})();
