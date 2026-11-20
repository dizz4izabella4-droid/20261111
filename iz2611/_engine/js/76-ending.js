/* ending.js — エンディングの条件判定・到達記録・ENDING 画面・ENDING_LIST 画面 */
(function () {
  'use strict';
  var EN = PN.ending = {};
  var TYPE_JA = { NORMAL: 'NORMAL END', BAD: 'BAD END', GOOD: 'GOOD END', TRUE: 'TRUE END', SECRET: 'SECRET END' };
  EN.typeLabel = function (t) { return TYPE_JA[t] || (t + ' END'); };
  EN.def = function (id) { return PN.game.endings.filter(function (e) { return e.id === id; })[0] || null; };
  /* 条件を上から順に調べ、最初に満たしたものを返す（cond のないものは最後の受け皿） */
  EN.judge = function () {
    var list = PN.game.endings, i;
    for (i = 0; i < list.length; i++) if (list[i].cond !== undefined && list[i].auto !== false && PN.branch.test(list[i].cond)) return list[i];
    for (i = 0; i < list.length; i++) if (list[i].cond === undefined && list[i].auto !== false) return list[i];
    return list[0] || null;
  };
  /* 到達を記録する（ID・名前・到達日時・クリア済み） */
  EN.record = function (id) {
    var d = EN.def(id), r = PN.sys.endings[id];
    if (!r) r = PN.sys.endings[id] = { id: id, name: d ? d.name : id, type: d ? d.type : 'NORMAL', firstAt: Date.now(), count: 0, cleared: true };
    r.count++; r.lastAt = Date.now(); r.name = d ? d.name : r.name;
    PN.save.saveEndings();
    PN.log('info', 'エンディング到達: ' + id);
    return r;
  };
  EN.count = function () {
    var all = PN.game.endings.length, got = PN.game.endings.filter(function (e) { return PN.sys.endings[e.id]; }).length;
    return { got: got, all: all };
  };

  PN.screens.define('ending', {
    noEsc: true, opaque: true,
    custom: function (el, c) {
      var d = c.args.def, n = EN.count(), box = PN.el('div', 'pn-ending');
      box.appendChild(PN.el('div', 'ty', EN.typeLabel(d.type)));
      box.appendChild(PN.el('div', 'nm', d.name || d.id));
      if (d.text) box.appendChild(PN.el('div', 'tx', d.text));
      box.appendChild(PN.el('div', 'cnt', 'ENDING ' + n.got + ' / ' + n.all + (c.args.first ? '　— NEW —' : '')));
      c.item(box, 'TITLE へ', function () { c.close(); }, { cls: 'pn-item center' });
      el.appendChild(box);
    }
  });
  PN.screens.define('endings', {
    title: function () { var n = EN.count(); return 'ENDING LIST　' + n.got + ' / ' + n.all; },
    full: true,
    build: function (c) {
      if (!PN.game.endings.length) c.body.appendChild(PN.el('div', 'pn-note', 'この作品にはエンディングが登録されていません。'));
      PN.game.endings.forEach(function (d, i) {
        var r = PN.sys.endings[d.id];
        var row = PN.el('div', 'pn-end ' + (r ? 't-' + d.type : 'lock'));
        row.appendChild(PN.el('div', 'ty', r || d.showType ? EN.typeLabel(d.type) : 'LOCKED'));
        row.appendChild(PN.el('div', '', r ? d.name : '？？？？？？' + (d.hint ? '　（' + d.hint + '）' : '')));
        row.appendChild(PN.el('div', 'at', r ? PN.fmtDate(r.firstAt) + (r.count > 1 ? ' ×' + r.count : '') : 'No.' + PN.pad2(i + 1)));
        c.body.appendChild(row);
      });
      c.item(c.body, '戻る', function () { c.close(); }, { cls: 'pn-item center' });
    },
    onKey: function (k, c) { if (k === 'up' || k === 'down') { c.body.scrollTop += (k === 'up' ? -1 : 1) * 60; return true; } return false; }
  });
})();
