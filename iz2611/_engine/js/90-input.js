/* input.js — マウス・キーボード・タッチの入力
 *  左クリック/タップ: 文章送り・決定 ／ 右クリック: メニュー ／ Enter: 決定・文章送り ／ Space: 文章送り
 *  ↑↓: 選択 ／ Esc: メニュー・キャンセル ／ Ctrl: 押している間スキップ ／ Tab: 情報画面 ／ ホイール上・PageUp: バックログ */
(function () {
  'use strict';
  var IN = PN.input = {};
  var KEYS = { Enter: 'enter', ' ': 'space', Spacebar: 'space', ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Escape: 'esc', Tab: 'tab', Control: 'ctrl', PageUp: 'pageup' };

  IN.init = function () {
    var stage = PN.$('pn-stage'), E = PN.engine, SC = PN.screens, R = PN.render;
    stage.setAttribute('role', 'button');   /* 連続タップの文章送りを、拡大防止の処理に止めさせない */
    stage.addEventListener('click', function (e) {
      PN.audio.unlock();
      if (SC.isOpen() || e.target.closest('button')) return;
      E.advance();
    });
    document.addEventListener('pointerdown', function () { PN.audio.unlock(); }, true);
    stage.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      PN.audio.unlock();
      if (SC.isOpen()) SC.key('esc'); else if (E.playing()) IN.menu();
    });
    document.addEventListener('keydown', function (e) {
      var k = KEYS[e.key];
      if (!k) return;
      var inField = e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (inField && k !== 'esc') return;
      PN.audio.unlock();
      if (k === 'ctrl') { E.setCtrl(true); return; }
      e.preventDefault();
      if (SC.isOpen()) {
        if (k === 'tab') { if (SC.topName() === 'information') SC.close(); return; }
        if (k === 'pageup') { if (SC.topName() === 'backlog') SC.key('up'); return; }
        if (e.repeat && (k === 'enter' || k === 'space' || k === 'esc')) return;
        SC.key(k === 'space' ? 'enter' : k);
        return;
      }
      if (!E.playing()) return;
      if (R.choiceOpen()) {
        if (k === 'up') R.choiceMove(-1); else if (k === 'down') R.choiceMove(1);
        else if ((k === 'enter' || k === 'space') && !e.repeat) R.choiceDecide();
        else if (k === 'esc') IN.menu(); else if (k === 'tab') SC.open('information'); else if (k === 'pageup') SC.open('backlog');
        return;
      }
      if (k === 'enter' || k === 'space') { if (!e.repeat) E.advance(); }
      else if (k === 'esc') IN.menu();
      else if (k === 'tab') SC.open('information');
      else if (k === 'pageup' || k === 'up') SC.open('backlog');
    });
    document.addEventListener('keyup', function (e) { if (e.key === 'Control') E.setCtrl(false); });
    window.addEventListener('blur', function () { E.setCtrl(false); });
    stage.addEventListener('wheel', function (e) {
      if (SC.isOpen() || !E.playing()) return;
      if (e.deltaY < 0) SC.open('backlog');
    }, { passive: true });
  };
  IN.menu = function () { PN.audio.se('click'); PN.screens.open('menu'); };

  /* 本文欄の下の操作ボタン列 */
  IN.buildFkeys = function () {
    var box = PN.$('pn-fkeys'), E = PN.engine, SC = PN.screens, btns = {};
    box.textContent = '';
    function add(id, label, fn, cls) {
      var b = PN.el('button', cls || '', label);
      b.setAttribute('data-fkey', id);
      b.addEventListener('click', function (e) { e.stopPropagation(); PN.audio.unlock(); if (!SC.isOpen() && E.playing()) { PN.audio.se('click'); fn(); } });
      box.appendChild(b); btns[id] = b;
    }
    add('auto', 'AUTO', function () { E.setAuto(!E.auto); });
    add('skip', 'SKIP', function () { E.setSkip(!E.skip); });
    add('log', 'LOG', function () { SC.open('backlog'); });
    add('info', 'INFO', function () { SC.open('information'); });
    add('qsave', 'Q.SAVE', function () { E.quickSave(); });
    add('qload', 'Q.LOAD', function () { E.quickLoad(); });
    add('menu', 'MENU', function () { SC.open('menu'); });
    if (PN.sys.config.dev) add('dev', 'DEV', function () { SC.open('dev'); }, 'dev');
    function paint() { btns.auto.classList.toggle('on', E.auto); btns.skip.classList.toggle('on', E.skip); }
    IN._paint = paint; paint();
  };
  PN.on('mode', function () { if (IN._paint) IN._paint(); });
  PN.on('dev', function () { IN.buildFkeys(); PN.render.devLabel(); });
})();
