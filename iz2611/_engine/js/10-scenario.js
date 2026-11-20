/* scenario.js — シナリオデータの読み込み・正規化・検証
 * ブラウザ（エンジン）と Node（build.js）の両方で使う。 */
(function (root) {
  'use strict';
  var S = {};
  S.COMMANDS = ['TEXT', 'BG', 'CHARACTER', 'HIDE_CHARACTER', 'BGM', 'SE', 'CHOICE', 'FLAG', 'IF', 'JUMP', 'WAIT', 'INFO',
    'EFFECT', 'TEXT_STYLE', 'ENDING', 'END', 'STATUS', 'LABEL', 'CALL', 'RETURN', 'REQUIRE'];
  S.ENDING_TYPES = ['NORMAL', 'BAD', 'GOOD', 'TRUE', 'SECRET'];
  S.EFFECTS = ['fadein', 'fadeout', 'blackout', 'flash', 'shake', 'noise', 'invert', 'garble', 'glitch'];
  S.TEXT_MODES = ['TYPEWRITER', 'INSTANT', 'FADE', 'LINE', 'CUSTOM'];

  function pick(o, keys) { for (var i = 0; i < keys.length; i++) if (o[keys[i]] !== undefined) return o[keys[i]]; }

  /* 書き方のゆれ（value など）を、エンジンが読む形にそろえる */
  S.normalizeCommand = function (c) {
    if (!c || typeof c !== 'object') return c;
    var t = c.type = String(c.type || '').toUpperCase();
    if (t === 'BG' || t === 'SE' || t === 'INFO' || t === 'BGM') { if (c.id === undefined && c.value !== undefined) c.id = c.value; }
    if (t === 'CHARACTER') {
      if (c.id === undefined) c.id = pick(c, ['value', 'name']);
      if (c.expr === undefined) c.expr = pick(c, ['expression', 'face']) || 'normal';
      if (c.pos === undefined) c.pos = c.position || 'center';
    }
    if (t === 'HIDE_CHARACTER' && c.id === undefined) c.id = pick(c, ['value', 'name']) || 'all';
    if (t === 'WAIT' && c.ms === undefined) c.ms = +pick(c, ['value', 'time']) || 0;
    if (t === 'JUMP' && c.to === undefined) c.to = pick(c, ['next', 'value', 'scene']);
    if (t === 'CALL' && c.to === undefined) c.to = pick(c, ['next', 'value', 'scene']);
    if (t === 'IF') { if (c.then === undefined && c.jump !== undefined) c.then = c.jump; if (c.cond === undefined) c.cond = pick(c, ['condition', 'if']); }
    if (t === 'FLAG') { if (!c.set && !c.add && c.name !== undefined) { c.set = {}; c.set[c.name] = c.value === undefined ? true : c.value; } }
    if (t === 'EFFECT' && c.name === undefined) c.name = c.value;
    if (t === 'TEXT_STYLE' && c.mode === undefined && c.value !== undefined) c.mode = c.value;
    if (t === 'TEXT_STYLE' && c.mode) c.mode = String(c.mode).toUpperCase();
    if (t === 'ENDING' && c.id === undefined && c.value !== undefined) c.id = c.value;
    if (t === 'LABEL' && c.name === undefined) c.name = c.value;
    if (t === 'CHOICE') (c.options || []).forEach(function (o) { if (o.set && !o.setFlag) o.setFlag = o.set; if (o.add && !o.addFlag) o.addFlag = o.add; });
    return c;
  };

  /* game = { config, scenario, characters, endings, backgrounds, info, audio } をそろえる */
  S.normalize = function (game) {
    game.config = game.config || {};
    var sc = game.scenario = game.scenario || {};
    sc.scenes = sc.scenes || {};
    game.config.gameId = game.config.gameId || sc.gameId || 'pc98_game';
    game.config.title = game.config.title || sc.title || 'NO TITLE';
    game.config.version = game.config.version || sc.version || '1';
    sc.start = sc.start || game.config.start;
    game.characters = game.characters || {};
    game.backgrounds = game.backgrounds || {};
    game.info = game.info || {};
    game.audio = game.audio || {};
    game.audio.bgm = game.audio.bgm || {};
    game.audio.se = game.audio.se || {};
    game.audio.env = game.audio.env || {};
    var en = game.endings || [];
    if (!Array.isArray(en)) en = Object.keys(en).map(function (k) { var e = en[k]; e.id = e.id || k; return e; });
    en.forEach(function (e) { e.type = String(e.type || 'NORMAL').toUpperCase(); });
    game.endings = en;
    Object.keys(sc.scenes).forEach(function (id) {
      var s = sc.scenes[id];
      if (Array.isArray(s)) s = sc.scenes[id] = { commands: s };
      s.commands = (s.commands || []).map(S.normalizeCommand);
      s.labels = {};
      s.commands.forEach(function (c, i) { if (c && c.type === 'LABEL' && c.name) s.labels[c.name] = i; });
    });
    return game;
  };

  /* 移動先の書き方: "scene" / "scene#label" / "#label"（同じシーン内） */
  S.parseTarget = function (str, cur) {
    str = String(str == null ? '' : str);
    var i = str.indexOf('#');
    if (i < 0) return { scene: str, label: null };
    return { scene: i === 0 ? cur : str.slice(0, i), label: str.slice(i + 1) };
  };

  function condRefs(c, out) {
    if (c == null || typeof c === 'boolean') return;
    if (typeof c === 'string') {
      var s = c.replace(/^!/, '');
      var m = /^(info|ending|chose):(.+)$/.exec(s);
      if (m) out.push({ kind: m[1], id: m[2] }); else out.push({ kind: 'flag', id: s });
      return;
    }
    if (c.all) return c.all.forEach(function (x) { condRefs(x, out); });
    if (c.any) return c.any.forEach(function (x) { condRefs(x, out); });
    if (c.not !== undefined) return condRefs(c.not, out);
    if (c.flag !== undefined) out.push({ kind: 'flag', id: c.flag });
    if (c.info !== undefined) out.push({ kind: 'info', id: c.info });
    if (c.ending !== undefined) out.push({ kind: 'ending', id: c.ending });
    if (c.chose !== undefined) out.push({ kind: 'chose', id: c.chose });
  }
  S.condRefs = function (c) { var o = []; condRefs(c, o); return o; };

  /* 検証。errors があれば起動しない。warnings は動くが直した方がよい点 */
  S.validate = function (game, extraCommands) {
    var errors = [], warnings = [];
    var known = S.COMMANDS.concat(extraCommands || []);
    var sc = game.scenario, scenes = sc.scenes, ids = Object.keys(scenes);
    var endIds = {}; game.endings.forEach(function (e) {
      if (!e.id) errors.push('endings: id のないエンディングがあります');
      if (endIds[e.id]) errors.push('endings: id "' + e.id + '" が重複しています');
      endIds[e.id] = 1;
      if (S.ENDING_TYPES.indexOf(e.type) < 0) warnings.push('endings: "' + e.id + '" の type "' + e.type + '" は標準の種類ではありません');
      if (e.scene && !scenes[S.parseTarget(e.scene).scene]) errors.push('endings: "' + e.id + '" の scene "' + e.scene + '" がありません');
    });
    if (!ids.length) errors.push('シーンが1つもありません');
    if (!sc.start) errors.push('start（最初のシーン）が指定されていません');
    else if (!scenes[sc.start]) errors.push('start のシーン "' + sc.start + '" がありません');
    if (!/^[A-Za-z0-9_\-]+$/.test(game.config.gameId)) errors.push('config.gameId は半角英数字・_・- で書いてください: "' + game.config.gameId + '"');
    var reached = {}, flagsSeen = {}, choiceIds = {};
    function target(str, cur, where) {
      if (str == null || str === '') { errors.push(where + ': 移動先が空です'); return; }
      var t = S.parseTarget(str, cur);
      if (!scenes[t.scene]) { errors.push(where + ': 移動先のシーン "' + t.scene + '" がありません'); return; }
      if (t.label && scenes[t.scene].labels[t.label] === undefined) errors.push(where + ': ラベル "' + t.label + '" がシーン "' + t.scene + '" にありません');
      reached[t.scene] = 1;
    }
    function cond(c, where) {
      S.condRefs(c).forEach(function (r) {
        if (r.kind === 'flag') flagsSeen[r.id] = 1;
        if (r.kind === 'info' && !game.info[r.id]) warnings.push(where + ': 条件の情報 "' + r.id + '" が info にありません');
        if (r.kind === 'ending' && !endIds[r.id]) errors.push(where + ': 条件のエンディング "' + r.id + '" がありません');
        if (r.kind === 'chose') choiceRefs.push({ id: r.id, where: where });
      });
    }
    var choiceRefs = [];
    function flags(o) { Object.keys(o || {}).forEach(function (k) { flagsSeen[k] = 1; }); }
    if (sc.start) reached[sc.start] = 1;
    game.endings.forEach(function (e) { if (e.scene) reached[S.parseTarget(e.scene).scene] = 1; if (e.cond !== undefined) cond(e.cond, 'endings "' + e.id + '"'); });
    ids.forEach(function (id) {
      var s = scenes[id];
      if (s.require !== undefined) cond(s.require, 'シーン "' + id + '" の require');
      if (s.fallback) target(s.fallback, id, 'シーン "' + id + '" の fallback');
      if (s.require !== undefined && !s.fallback) warnings.push('シーン "' + id + '": require があるのに fallback（代わりの行き先）がありません');
      if (!s.commands.length) warnings.push('シーン "' + id + '" は空です');
      var last = s.commands[s.commands.length - 1];
      s.commands.forEach(function (c, i) {
        var w = id + ' [' + (i + 1) + '] ' + (c && c.type);
        if (!c || !c.type) { errors.push(id + ' [' + (i + 1) + ']: type のない命令があります'); return; }
        if (known.indexOf(c.type) < 0) { errors.push(w + ': 知らない命令です'); return; }
        switch (c.type) {
          case 'TEXT':
            if (typeof c.text !== 'string') errors.push(w + ': text がありません');
            else if (c.text.length > 110) warnings.push(w + ': 文章が長く（' + c.text.length + '字）、横画面の本文欄3行に収まらないおそれがあります');
            break;
          case 'BG': if (c.id && c.id !== 'none' && !game.backgrounds[c.id]) warnings.push(w + ': 背景 "' + c.id + '" が backgrounds にありません（仮表示になります）'); break;
          case 'CHARACTER': if (!c.id) errors.push(w + ': id がありません'); else if (!game.characters[c.id]) warnings.push(w + ': キャラクター "' + c.id + '" が characters にありません（仮表示になります）'); break;
          case 'CHOICE':
            if (!Array.isArray(c.options) || !c.options.length) { errors.push(w + ': options がありません'); break; }
            if (c.id) { if (choiceIds[c.id]) warnings.push(w + ': 選択肢の id "' + c.id + '" が重複しています'); choiceIds[c.id] = c; }
            c.options.forEach(function (o, k) {
              var ww = w + ' 選択肢' + (k + 1);
              if (typeof o.text !== 'string' || !o.text) errors.push(ww + ': text がありません');
              if (o.next !== undefined) target(o.next, id, ww);
              if (o.if !== undefined) cond(o.if, ww);
              flags(o.setFlag); flags(o.addFlag);
              [].concat(o.info || []).forEach(function (x) { if (!game.info[x]) warnings.push(ww + ': 情報 "' + x + '" が info にありません'); });
            });
            break;
          case 'FLAG': if (!c.set && !c.add) errors.push(w + ': set か add が必要です'); flags(c.set); flags(c.add); break;
          case 'IF':
            if (c.cond === undefined) errors.push(w + ': cond（条件）がありません'); else cond(c.cond, w);
            if (c.then === undefined && c.else === undefined) errors.push(w + ': then か else（移動先）が必要です');
            if (c.then !== undefined) target(c.then, id, w + ' then');
            if (c.else !== undefined) target(c.else, id, w + ' else');
            break;
          case 'JUMP': case 'CALL': target(c.to, id, w); break;
          case 'INFO': if (!c.id) errors.push(w + ': id がありません'); else if (!game.info[c.id]) warnings.push(w + ': 情報 "' + c.id + '" が info にありません'); break;
          case 'EFFECT': if (S.EFFECTS.indexOf(c.name) < 0) errors.push(w + ': 演出 "' + c.name + '" はありません（' + S.EFFECTS.join(' / ') + '）'); break;
          case 'TEXT_STYLE': if (c.mode && c.mode !== 'RESET' && S.TEXT_MODES.indexOf(c.mode) < 0) errors.push(w + ': 表示方式 "' + c.mode + '" はありません（' + S.TEXT_MODES.join(' / ') + ' / RESET）'); break;
          case 'ENDING': if (c.id && !endIds[c.id]) errors.push(w + ': エンディング "' + c.id + '" が endings にありません'); if (!c.id && !game.endings.length) errors.push(w + ': endings が空です'); break;
          case 'REQUIRE':
            if (c.need === undefined) errors.push(w + ': need（必要な条件）がありません'); else cond(c.need, w);
            if (c.call) target(c.call, id, w + ' call');
            flags(c.setFlag);
            [].concat(c.grant || []).forEach(function (x) { if (!game.info[x]) warnings.push(w + ': 情報 "' + x + '" が info にありません'); });
            break;
          case 'BGM': if (c.id && c.id !== 'stop' && !(c.channel === 'env' ? game.audio.env : game.audio.bgm)[c.id]) warnings.push(w + ': ' + (c.channel === 'env' ? '環境音' : 'BGM') + ' "' + c.id + '" が audio にありません（鳴りません）'); break;
          case 'SE': if (c.id && !game.audio.se[c.id]) warnings.push(w + ': SE "' + c.id + '" が audio にありません（鳴りません）'); break;
        }
      });
      var term = last && (last.type === 'JUMP' || last.type === 'END' || last.type === 'ENDING' || last.type === 'RETURN' ||
        (last.type === 'IF' && last.then !== undefined && last.else !== undefined) ||
        (last.type === 'CHOICE' && last.options && last.options.every(function (o) { return o.next !== undefined; })));
      if (s.commands.length && !term) warnings.push('シーン "' + id + '": 最後に JUMP / END / ENDING がありません（そのまま終わると END 扱いになります）');
    });
    choiceRefs.forEach(function (r) {
      var p = String(r.id).split('.');
      var c = choiceIds[p[0]];
      if (!c) errors.push(r.where + ': chose の選択肢 "' + p[0] + '" がありません');
      else if (p[1] !== undefined && !c.options.some(function (o, k) { return o.id === p[1] || String(k + 1) === p[1]; })) errors.push(r.where + ': chose の "' + r.id + '" に当たる選択肢がありません');
    });
    ids.forEach(function (id) { if (!reached[id]) warnings.push('シーン "' + id + '" へ行く道がありません'); });
    return { errors: errors, warnings: warnings, flags: Object.keys(flagsSeen).sort() };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = S;
  else root.PN.scenario = S;
})(typeof window !== 'undefined' ? window : this);
