/* branching.js — 条件の判定、STORY難易度の補完（REQUIRE）、シーン到達条件 */
(function () {
  'use strict';
  var B = PN.branch = {};

  function flagVal(name) { return PN.state.flags[name]; }
  function chose(ref) {
    var p = String(ref).split('.');
    return PN.state.history.some(function (h) {
      if (h.id !== p[0]) return false;
      return p[1] === undefined || h.optId === p[1] || String(h.opt + 1) === p[1];
    });
  }
  function atom(kind, id) {
    if (kind === 'info') return PN.state.info.indexOf(id) >= 0;
    if (kind === 'ending') return !!PN.sys.endings[id];
    if (kind === 'chose') return chose(id);
    return !!flagVal(id);
  }
  function cmp(a, op, b) {
    switch (op) {
      case '==': case '=': case undefined: return a == b || (b === true && !!a && typeof a !== 'number') || (b === false && !a);
      case '!=': return !(a == b);
      case '>': return (+a || 0) > +b;
      case '>=': return (+a || 0) >= +b;
      case '<': return (+a || 0) < +b;
      case '<=': return (+a || 0) <= +b;
    }
    PN.log('error', '条件の演算子 "' + op + '" は使えません');
    return false;
  }
  /* 条件の形: true/false ／ "flag" "!flag" "info:x" "ending:x" "chose:c.o"
   *   ／ {flag,op,value} {info} {ending} {chose} ／ {all:[…]} {any:[…]} {not:…} */
  B.test = function (c) {
    if (c == null) return true;
    if (typeof c === 'boolean') return c;
    if (typeof c === 'string') {
      var neg = c.charAt(0) === '!', s = neg ? c.slice(1) : c;
      var m = /^(info|ending|chose):(.+)$/.exec(s);
      var r = m ? atom(m[1], m[2]) : atom('flag', s);
      return neg ? !r : r;
    }
    if (c.all) return c.all.every(B.test);
    if (c.any) return c.any.some(B.test);
    if (c.not !== undefined) return !B.test(c.not);
    if (c.flag !== undefined) return (c.op === undefined && c.value === undefined) ? !!flagVal(c.flag) : cmp(flagVal(c.flag), c.op, c.value === undefined ? true : c.value);
    if (c.info !== undefined) return atom('info', c.info);
    if (c.ending !== undefined) return atom('ending', c.ending);
    if (c.chose !== undefined) return atom('chose', c.chose);
    PN.log('error', '読めない条件です: ' + JSON.stringify(c));
    return false;
  };
  /* 開発者モード用: 条件を、今の真偽つきの文字にする */
  B.explain = function (c, depth) {
    var pad = new Array((depth || 0) + 1).join('  ');
    var mark = function (x) { return B.test(x) ? '○ ' : '× '; };
    if (c == null) return pad + '○ （条件なし）';
    if (typeof c === 'object' && (c.all || c.any)) {
      var list = c.all || c.any;
      return pad + mark(c) + (c.all ? 'すべて' : 'どれか') + '\n' + list.map(function (x) { return B.explain(x, (depth || 0) + 1); }).join('\n');
    }
    if (typeof c === 'object' && c.not !== undefined) return pad + mark(c) + '否定\n' + B.explain(c.not, (depth || 0) + 1);
    var label = typeof c === 'string' ? c : c.flag !== undefined ? c.flag + ' ' + (c.op || '==') + ' ' + JSON.stringify(c.value === undefined ? true : c.value) + '（今: ' + JSON.stringify(flagVal(c.flag)) + '）'
      : c.info !== undefined ? 'info:' + c.info : c.ending !== undefined ? 'ending:' + c.ending : c.chose !== undefined ? 'chose:' + c.chose : JSON.stringify(c);
    return pad + mark(c) + label;
  };

  B.setFlags = function (set, add) {
    var f = PN.state.flags;
    Object.keys(set || {}).forEach(function (k) { f[k] = set[k]; });
    Object.keys(add || {}).forEach(function (k) { f[k] = (+f[k] || 0) + (+add[k] || 0); });
    if (set || add) PN.emit('flags');
  };

  /* シーン到達条件: require を満たさないシーンへ入ろうとしたら fallback へ回す（進行不能にしない）
   * t = {scene,label} を受け取り、実際に入る {scene,label} を返す */
  B.gate = function (t) {
    var guard = 0;
    while (guard++ < 20) {
      var s = PN.game.scenario.scenes[t.scene];
      if (!s || s.require === undefined || B.test(s.require)) return t;
      if (!s.fallback) { PN.log('warn', 'シーン "' + t.scene + '" の到達条件を満たしていませんが、fallback がないのでそのまま進みます'); return t; }
      PN.log('info', 'シーン "' + t.scene + '" の到達条件を満たさないため "' + s.fallback + '" へ回しました');
      t = PN.scenario.parseTarget(s.fallback, t.scene);
    }
    PN.log('error', 'fallback が循環しています: ' + t.scene);
    return t;
  };
})();
