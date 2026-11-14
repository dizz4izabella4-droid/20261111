/* backlog.js — バックログ（読んだ文章の記録と、その画面） */
(function () {
  'use strict';
  var MAX = 200;
  PN.backlog = {
    push: function (who, text, kind) {
      var b = PN.state.backlog, last = b[b.length - 1];
      if (last && last.who === (who || '') && last.text === text && last.kind === kind) return;   /* ロード直後の重複を避ける */
      b.push({ who: who || '', text: text, kind: kind });
      if (b.length > MAX) b.shift();
    }
  };
  PN.screens.define('backlog', {
    title: 'BACKLOG', full: true,
    build: function (c) {
      var b = PN.state ? PN.state.backlog : [];
      if (!b.length) c.body.appendChild(PN.el('div', 'pn-note', 'まだ記録がありません。'));
      b.forEach(function (e) {
        var d = PN.el('div', 'pn-log' + (e.kind === 'choice' ? ' choice' : ''));
        if (e.who) { d.appendChild(PN.el('span', 'who', '【' + e.who + '】')); d.appendChild(document.createElement('br')); }
        d.appendChild(document.createTextNode(e.kind === 'choice' ? '▶ ' + e.text : e.text));
        c.body.appendChild(d);
      });
      c.foot.appendChild(PN.el('span', '', '↑↓ スクロール / Esc 戻る'));
      setTimeout(function () { c.body.scrollTop = c.body.scrollHeight; }, 0);
    },
    onKey: function (k, c) {
      if (k === 'up' || k === 'down') { c.body.scrollTop += (k === 'up' ? -1 : 1) * 60; return true; }
      if (k === 'enter') { c.close(); return true; }
      return false;
    }
  });
})();
