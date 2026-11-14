/* information.js — 入手情報の管理と、INFORMATION 画面 */
(function () {
  'use strict';
  var I = PN.information = {};
  I.def = function (id) { return PN.game.info[id] || { title: id, text: '' }; };
  I.has = function (id) { return PN.state.info.indexOf(id) >= 0; };
  /* 情報を入手する。新しく入手したら true */
  I.get = function (id, silent) {
    if (I.has(id)) return false;
    PN.state.info.push(id);
    if (!silent) { PN.render.notice('情報を入手：' + I.def(id).title); PN.audio.se('get'); }
    PN.emit('info', id);
    return true;
  };
  PN.screens.define('information', {
    title: function () { return 'INFORMATION　' + (PN.state ? PN.state.info.length : 0) + ' / ' + Object.keys(PN.game.info).length; },
    full: true,
    build: function (c) {
      var ids = PN.state ? PN.state.info : [];
      if (!ids.length) { c.body.appendChild(PN.el('div', 'pn-note', 'まだ情報を入手していません。')); return; }
      var two = PN.el('div', 'pn-two'), list = PN.el('div', 'list'), detail = PN.el('div', 'detail');
      c._detail = detail;
      ids.forEach(function (id) { var b = c.item(list, I.def(id).title, null); b._info = id; });
      two.appendChild(list); two.appendChild(detail);
      c.body.appendChild(two);
      c.foot.appendChild(PN.el('span', '', '↑↓ 選択 / Esc 戻る'));
    },
    onSelect: function (c, el) {
      if (!c._detail || !el._info) return;
      var d = I.def(el._info);
      c._detail.textContent = '';
      c._detail.appendChild(PN.el('h3', '', d.title));
      c._detail.appendChild(document.createTextNode(d.text || ''));
    }
  });
})();
