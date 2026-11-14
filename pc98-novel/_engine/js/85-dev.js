/* dev.js — 開発者モード（シーン一覧・移動、フラグ変更、選択肢の強制実行、エンディング条件、ログ） */
(function () {
  'use strict';
  var TABS = [['scene', 'SCENE'], ['flag', 'FLAG'], ['choice', 'CHOICE'], ['ending', 'ENDING'], ['log', 'LOG']];
  function row(parent, text, cls) { var r = PN.el('div', 'pn-dev-row' + (cls ? ' ' + cls : '')); r.appendChild(PN.el('span', 'k', text)); parent.appendChild(r); return r; }
  function btn(r, label, fn) { var b = PN.el('button', '', label); b.addEventListener('click', function (e) { e.stopPropagation(); fn(); }); r.appendChild(b); return b; }
  function parseVal(s) { s = s.trim(); if (s === 'true') return true; if (s === 'false') return false; if (s !== '' && !isNaN(+s)) return +s; return s.replace(/^"|"$/g, ''); }

  var VIEW = {
    scene: function (c, box) {
      var S = PN.state;
      row(box, '現在: ' + (S ? S.scene + ' [' + (S.index + 1) + ']' + (S.stack.length ? '　（CALL 中: ' + S.stack.length + '）' : '') : '（タイトル）'));
      Object.keys(PN.game.scenario.scenes).forEach(function (id) {
        var s = PN.game.scenario.scenes[id];
        var r = row(box, id + '　（' + s.commands.length + '）' + (s.require !== undefined ? '　条件あり' : ''), S && S.scene === id ? 'warn' : '');
        btn(r, '移動', function () { PN.engine.jumpTo(id); });
      });
    },
    flag: function (c, box) {
      if (!PN.state) return row(box, 'ゲーム中だけ変更できます。');
      var f = PN.state.flags, names = {};
      (PN.knownFlags || []).concat(Object.keys(f)).forEach(function (k) { names[k] = 1; });
      Object.keys(names).sort().forEach(function (k) {
        var v = f[k], r = row(box, k);
        r.appendChild(PN.el('span', 'v', v === undefined ? '—' : JSON.stringify(v)));
        if (typeof v === 'number') { btn(r, '−', function () { f[k] = v - 1; c.refresh(); }); btn(r, '＋', function () { f[k] = v + 1; c.refresh(); }); }
        else btn(r, v ? 'OFF' : 'ON', function () { f[k] = !v; c.refresh(); });
        btn(r, '消', function () { delete f[k]; c.refresh(); });
      });
      var r2 = row(box, '');
      var inp = document.createElement('input'); inp.placeholder = '名前=値（例: trust=2）';
      inp.addEventListener('click', function (e) { e.stopPropagation(); });
      r2.replaceChild(inp, r2.firstChild);
      btn(r2, '設定', function () {
        var m = /^\s*([\w.-]+)\s*=\s*(.*)$/.exec(inp.value);
        if (!m) return PN.render.notice('名前=値 の形で書いてください', true);
        f[m[1]] = parseVal(m[2]); c.refresh();
      });
      row(box, '入手情報: ' + (PN.state.info.join(', ') || 'なし'));
      Object.keys(PN.game.info).forEach(function (id) {
        if (PN.state.info.indexOf(id) >= 0) return;
        var r = row(box, '情報 ' + id + '（未入手）'); btn(r, '入手', function () { PN.information.get(id, true); c.refresh(); });
      });
    },
    choice: function (c, box) {
      var w = PN.engine.currentChoice();
      if (!w) row(box, '今は選択肢の場面ではありません。');
      else w.cmd.options.forEach(function (o, k) {
        var hidden = o.if !== undefined && !PN.branch.test(o.if);
        var r = row(box, (k + 1) + '. ' + o.text + (o.next !== undefined ? '　→ ' + o.next : '') + (hidden ? '\n   （条件未達で非表示）\n' + PN.branch.explain(o.if, 2) : ''), hidden ? 'warn' : '');
        btn(r, '実行', function () { PN.engine.forceChoice(k); });
      });
      if (PN.state) {
        row(box, '— 選択履歴 —');
        PN.state.history.forEach(function (h) { row(box, h.scene + ' [' + (h.index + 1) + '] ' + (h.id ? h.id + '.' + (h.optId || h.opt + 1) + ' ' : '') + '「' + h.text + '」' + (h.correct === null ? '' : h.correct ? '　正' : '　誤')); });
      }
    },
    ending: function (c, box) {
      if (PN.state) { var j = PN.ending.judge(); row(box, '今 ENDING（自動判定）に着くと: ' + (j ? j.id + '「' + j.name + '」' : 'なし')); }
      PN.game.endings.forEach(function (d) {
        var r = row(box, '[' + d.type + '] ' + d.id + '「' + d.name + '」' + (PN.sys.endings[d.id] ? '　到達済' : '') + (PN.state ? '\n' + PN.branch.explain(d.cond, 1) : ''));
        btn(r, '到達', function () { PN.engine.forceEnding(d.id); });
      });
      var r2 = row(box, 'エンディングの到達記録を消す');
      btn(r2, '消去', function () { PN.sys.endings = {}; PN.save.saveEndings(); c.refresh(); });
    },
    log: function (c, box) {
      if (!PN.logs.length) row(box, 'ログはありません。');
      PN.logs.slice().reverse().forEach(function (l) {
        var d = new Date(l.t);
        row(box, PN.pad2(d.getHours()) + ':' + PN.pad2(d.getMinutes()) + ':' + PN.pad2(d.getSeconds()) + ' [' + l.level + '] ' + l.msg, l.level === 'error' ? 'err' : l.level === 'warn' ? 'warn' : '');
      });
    }
  };
  PN.screens.define('dev', {
    title: 'DEVELOPER', full: true,
    build: function (c) {
      var cur = c.args.tab || 'scene', tabs = PN.el('div', 'pn-tabs');
      TABS.forEach(function (t) {
        var b = PN.el('button', t[0] === cur ? 'on' : '', t[1]);
        b.addEventListener('click', function (e) { e.stopPropagation(); c.args.tab = t[0]; c.refresh(false); });
        tabs.appendChild(b);
      });
      c.body.appendChild(tabs);
      VIEW[cur](c, c.body);
      c.foot.appendChild(PN.el('span', '', '←→ タブ / ↑↓ スクロール / Esc 戻る'));
    },
    onKey: function (k, c) {
      if (document.activeElement && document.activeElement.tagName === 'INPUT') return k !== 'esc';
      if (k === 'left' || k === 'right') {
        var i = TABS.map(function (t) { return t[0]; }).indexOf(c.args.tab || 'scene');
        c.args.tab = TABS[(i + (k === 'left' ? -1 : 1) + TABS.length) % TABS.length][0]; c.refresh(false); return true;
      }
      if (k === 'up' || k === 'down') { c.body.scrollTop += (k === 'up' ? -1 : 1) * 60; return true; }
      return false;
    }
  });
  /* エラーは、開発者モードのとき画面にも出す */
  PN.on('log', function (rec) { if (rec.level === 'error' && PN.sys.config.dev && PN.render.notice) PN.render.notice('ERROR: ' + rec.msg.slice(0, 40), true); });
})();
