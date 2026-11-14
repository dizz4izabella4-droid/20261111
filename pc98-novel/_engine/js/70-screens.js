/* screens.js — 画面（TITLE / MENU / SAVE / LOAD / CONFIG …）の管理と、共通のウィンドウ部品
 * 各画面は PN.screens.define(名前, {title, full, build(ctx)}) で登録する独立したモジュール。 */
(function () {
  'use strict';
  var SC = PN.screens = {};
  var defs = {}, stack = [];

  SC.define = function (name, def) { defs[name] = def; };
  SC.isOpen = function () { return stack.length > 0; };
  SC.top = function () { return stack[stack.length - 1] || null; };
  SC.topName = function () { var t = SC.top(); return t ? t.name : null; };

  function items(s) { return Array.prototype.filter.call(s.el.querySelectorAll('[data-i]'), function (e) { return !e.disabled && !e.hasAttribute('data-off'); }); }
  function mark(s, scroll) {
    var list = items(s);
    if (!list.length) return;
    s.sel = PN.clamp(s.sel, 0, list.length - 1);
    Array.prototype.forEach.call(s.el.querySelectorAll('[data-i]'), function (e) { e.classList.remove('sel'); });
    list[s.sel].classList.add('sel');
    if (scroll) list[s.sel].scrollIntoView({ block: 'nearest' });
    if (s.def.onSelect) s.def.onSelect(s.ctx, list[s.sel]);
  }
  function makeCtx(s) {
    var ctx = {
      args: s.args, el: s.el,
      close: function (v) { SC.close(s, v); },
      /* 選べる項目を足す。fn は決定時、opt.adj(±1) は左右キー */
      item: function (parent, label, fn, opt) {
        opt = opt || {};
        var b = PN.el(opt.tag || 'button', opt.cls || 'pn-item', label);
        b.setAttribute('data-i', '');
        if (opt.disabled) b.disabled = true;
        b._fn = fn; b._adj = opt.adj;
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          if (b.disabled) return;
          var l = items(s), k = l.indexOf(b); if (k >= 0) { s.sel = k; mark(s); }
          if (fn && !(e.target !== b && e.target.closest('button') && e.target.closest('button') !== b)) fn(b);
        });
        b.addEventListener('mousemove', function () { var l = items(s), k = l.indexOf(b); if (k >= 0 && k !== s.sel) { s.sel = k; mark(s); } });   /* mouseenter だと、止まったマウスの下に出た項目が勝手に選ばれる */
        parent.appendChild(b);
        return b;
      },
      refresh: function (keepScroll) {
        var body = s.el.querySelector('.pn-win-body'), y = body ? body.scrollTop : 0;
        build(s);
        var b2 = s.el.querySelector('.pn-win-body'); if (b2 && keepScroll !== false) b2.scrollTop = y;
        mark(s);
      },
      select: function (k) { s.sel = k; mark(s, true); }
    };
    return ctx;
  }
  function build(s) {
    var def = s.def;
    s.el.textContent = '';
    if (def.custom) { def.custom(s.el, s.ctx); return; }
    var win = PN.el('div', 'pn-win' + (def.full ? ' full' : ''));
    var tt = PN.el('div', 'pn-win-title'); tt.appendChild(PN.el('span', '', '■ ' + (typeof def.title === 'function' ? def.title(s.args) : def.title)));
    if (!def.noEsc) { var x = PN.el('button', 'x', '×'); x.addEventListener('click', function (e) { e.stopPropagation(); SC.close(s); }); tt.appendChild(x); }
    win.appendChild(tt);
    var body = PN.el('div', 'pn-win-body'), foot = PN.el('div', 'pn-win-foot');
    win.appendChild(body);
    s.ctx.body = body; s.ctx.foot = foot; s.ctx.win = win;
    def.build(s.ctx);
    if (foot.childNodes.length) win.appendChild(foot);
    s.el.appendChild(win);
  }
  SC.open = function (name, args) {
    var def = defs[name];
    if (!def) { PN.log('error', '画面 "' + name + '" はありません'); return Promise.resolve(); }
    var s = { name: name, def: def, args: args || {}, sel: 0, el: PN.el('div', 'pn-screen' + (def.opaque ? ' opaque' : '')) };
    s.el.setAttribute('data-screen', name);
    s.ctx = makeCtx(s);
    /* 画面の外側（暗い部分）を押したら閉じる */
    s.el.addEventListener('click', function (e) { e.stopPropagation(); if (e.target === s.el && !def.noEsc) SC.close(s); });
    stack.push(s);
    PN.$('pn-screens').appendChild(s.el);
    build(s);
    if (def.initSel) s.sel = def.initSel(s.ctx) || 0;
    mark(s, true);
    PN.emit('screen', name);
    return new Promise(function (res) { s.resolve = res; });
  };
  SC.close = function (s, value) {
    s = s || SC.top();
    if (!s) return;
    var k = stack.indexOf(s);
    if (k < 0) return;
    stack.splice(k, 1);
    if (s.def.onClose) s.def.onClose(s.ctx);
    s.el.remove();
    if (s.resolve) s.resolve(value);
    PN.emit('screen', SC.topName());
  };
  SC.closeAll = function () { while (stack.length) SC.close(stack[stack.length - 1]); };
  /* キー操作（input.js から呼ばれる） */
  SC.key = function (k) {
    var s = SC.top();
    if (!s) return false;
    if (s.def.onKey && s.def.onKey(k, s.ctx)) return true;
    var list = items(s);
    if (k === 'up' || k === 'down') { if (list.length) { s.sel = (s.sel + (k === 'up' ? -1 : 1) + list.length) % list.length; mark(s, true); } }
    else if (k === 'left' || k === 'right') { var it = list[s.sel]; if (it && it._adj) it._adj(k === 'left' ? -1 : 1); }
    else if (k === 'enter') { var it2 = list[s.sel]; if (it2 && it2._fn) { PN.audio.se('click'); it2._fn(it2); } }
    else if (k === 'esc') { if (!s.def.noEsc) { PN.audio.se('cancel'); SC.close(s); } }
    return true;
  };

  /* ---------- 確認・お知らせ ---------- */
  SC.define('confirm', {
    title: '確認', noEsc: false,
    build: function (c) {
      c.body.appendChild(PN.el('div', 'pn-note', c.args.text));
      c.item(c.body, c.args.yes || 'はい', function () { c.close(true); }, { cls: 'pn-item center' });
      c.item(c.body, c.args.no || 'いいえ', function () { c.close(false); }, { cls: 'pn-item center' });
    },
    initSel: function (c) { return c.args.defaultYes ? 0 : 1; }
  });
  SC.confirm = function (text, o) { return SC.open('confirm', Object.assign({ text: text }, o || {})).then(function (v) { return v === true; }); };
  SC.define('message', {
    title: function (a) { return a.title || 'お知らせ'; },
    build: function (c) {
      c.body.appendChild(PN.el('div', 'pn-note' + (c.args.err ? ' err' : ''), c.args.text));
      c.item(c.body, 'OK', function () { c.close(); }, { cls: 'pn-item center' });
    }
  });
  SC.message = function (text, o) { return SC.open('message', Object.assign({ text: text }, o || {})); };

  /* ---------- TITLE ---------- */
  SC.define('title', {
    noEsc: true,
    custom: function (el, c) {
      var g = PN.game.config, box = PN.el('div', 'pn-title');
      if (g.titleNote) box.appendChild(PN.el('div', 'note', g.titleNote));   /* タイトル上部の注意書き（config.json の titleNote） */
      box.appendChild(PN.el('h1', '', g.title));
      box.appendChild(PN.el('div', 'sub', g.subtitle || ''));
      var menu = PN.el('div', 'menu');
      c.item(menu, 'START', function () { PN.engine.startNew(); }, { cls: 'pn-item center' });
      var cont = c.item(menu, 'CONTINUE', function () {
        PN.save.latest().then(function (x) { if (x) PN.engine.loadData(x.data); });
      }, { cls: 'pn-item center', disabled: true });
      PN.save.latest().then(function (x) { if (x) { cont.disabled = false; } });
      c.item(menu, 'LOAD', function () { SC.open('load'); }, { cls: 'pn-item center' });
      c.item(menu, 'ENDING LIST', function () { SC.open('endings'); }, { cls: 'pn-item center' });
      c.item(menu, 'CONFIG', function () { SC.open('config'); }, { cls: 'pn-item center' });
      box.appendChild(menu);
      box.appendChild(PN.el('div', 'copy', g.copyright || ''));
      box.appendChild(PN.el('div', 'ver', 'Ver.' + g.version + ' / PC98 NOVEL ENGINE ' + PN.version));
      el.appendChild(box);
    }
  });

  /* ---------- MENU ---------- */
  SC.define('menu', {
    title: 'MENU',
    build: function (c) {
      var E = PN.engine;
      c.item(c.body, 'SAVE　　セーブ', function () { SC.open('save'); }, { disabled: !E.canSave() });
      c.item(c.body, 'LOAD　　ロード', function () { SC.open('load'); });
      c.item(c.body, 'Q.SAVE　クイックセーブ', function () { c.close(); E.quickSave(); }, { disabled: !E.canSave() });
      c.item(c.body, 'Q.LOAD　クイックロード', function () { c.close(); E.quickLoad(); });
      c.item(c.body, 'BACKLOG　バックログ', function () { SC.open('backlog'); });
      c.item(c.body, 'INFORMATION　入手情報', function () { SC.open('information'); });
      c.item(c.body, 'ENDING LIST　エンディング一覧', function () { SC.open('endings'); });
      c.item(c.body, 'CONFIG　設定', function () { SC.open('config'); });
      if (PN.sys.config.dev) c.item(c.body, 'DEVELOPER　開発者モード', function () { SC.open('dev'); });
      c.item(c.body, 'TITLE　タイトルへ戻る', function () {
        SC.confirm('タイトルへ戻りますか？\nセーブしていない進行は失われます。').then(function (ok) { if (ok) E.toTitle(); });
      });
      c.item(c.body, 'CLOSE　ゲームに戻る', function () { c.close(); });
    }
  });

  /* ---------- SAVE / LOAD ---------- */
  function slotScreen(mode) {
    return {
      title: mode === 'save' ? 'SAVE' : 'LOAD', full: true,
      build: function (c) {
        var load = mode === 'load';
        c.body.appendChild(PN.el('div', 'pn-note', '読み込み中…'));
        PN.save.list(load).then(function (list) {
          c.body.textContent = '';
          if (PN.save.backend !== 'indexeddb') c.body.appendChild(PN.el('div', 'pn-note warn', PN.save.backend === 'memory'
            ? '※この環境では保存領域が使えないため、ページを閉じるとセーブは消えます。' : '※IndexedDB が使えないため、簡易保存（localStorage）を使っています。'));
          list.forEach(function (x) {
            var d = x.data, bad = d ? PN.checkSave(d) : null;
            var row = c.item(c.body, '', function () { load ? doLoad(x, bad) : doSave(x); }, { cls: 'pn-item pn-slot' + (d ? '' : ' empty'), disabled: load && !d });
            row.appendChild(PN.el('div', 'no', PN.save.slotLabel(x.slot)));
            var main = PN.el('div', 'main');
            if (d) {
              var st = (d.view && d.view.status) || {};
              main.appendChild(PN.el('div', 'l1', [st.chapter, st.date, st.place].filter(Boolean).join('　') || d.scene));
              main.appendChild(PN.el('div', 'l2', bad ? '（読み込めません: ' + bad + '）' : (d.preview || '…')));
            } else main.appendChild(PN.el('div', 'l2', '— NO DATA —'));
            row.appendChild(main);
            var meta = PN.el('div', 'meta');
            if (d) { meta.appendChild(PN.el('div', '', PN.fmtDate(d.savedAt))); meta.appendChild(PN.el('div', '', 'PLAY ' + PN.fmtPlay(d.playMs))); }
            row.appendChild(meta);
          });
          c.select(c.args.sel || 0);
        });
        function doSave(x) {
          var go = function () {
            PN.save.write(x.slot).then(function () { PN.audio.se('save'); PN.render.notice('スロット ' + PN.save.slotLabel(x.slot) + ' にセーブしました'); c.args.sel = selIndex(); c.refresh(); })
              .catch(function (e) { SC.message('セーブに失敗しました。\n' + (e && e.message), { err: true }); });
          };
          if (x.data) SC.confirm('スロット ' + PN.save.slotLabel(x.slot) + ' に上書きしますか？').then(function (ok) { if (ok) go(); }); else go();
        }
        function doLoad(x, bad) {
          if (bad) return SC.message('このデータは読み込めません。\n' + bad, { err: true });
          var go = function () { PN.engine.loadData(x.data); };
          if (PN.engine.playing()) SC.confirm('スロット ' + PN.save.slotLabel(x.slot) + ' をロードしますか？\n今の進行は失われます。').then(function (ok) { if (ok) go(); }); else go();
        }
        function selIndex() { var l = c.body.querySelectorAll('[data-i]'); for (var i = 0; i < l.length; i++) if (l[i].classList.contains('sel')) return i; return 0; }
        /* エクスポート・インポート */
        c.item(c.foot, 'EXPORT 書き出し', function () {
          PN.save.exportAll().then(function (o) { PN.save.download(o, PN.game.config.gameId + '_save.json'); PN.render.notice('セーブデータを書き出しました'); });
        }, { cls: 'pn-item pn-btn' });
        c.item(c.foot, 'IMPORT 読み込み', function () { importFile(c); }, { cls: 'pn-item pn-btn' });
        c.foot.appendChild(PN.el('span', '', '↑↓ 選択 / Enter 決定 / Esc 戻る'));
      }
    };
  }
  function importFile(c) {
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.addEventListener('change', function () {
      var f = inp.files && inp.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () { SC.importText(String(rd.result)).then(function (ok) { if (ok) c.refresh(); }); };
      rd.onerror = function () { SC.message('ファイルを読めませんでした。', { err: true }); };
      rd.readAsText(f);
    });
    inp.click();
  }
  /* 読み込んだ文字列を検証し、確認のうえ取り込む（テストからも呼べる） */
  SC.importText = function (text) {
    var o;
    try { o = JSON.parse(text); } catch (e) { return SC.message('JSON として読めませんでした。\n' + e.message, { err: true, title: 'IMPORT' }).then(function () { return false; }); }
    var r = PN.save.checkImport(o);
    if (!r.ok) return SC.message('取り込めません。\n' + r.error, { err: true, title: 'IMPORT' }).then(function () { return false; });
    return SC.confirm('セーブデータ ' + r.count + ' 件を取り込みます。\n今のセーブデータはすべて上書きされます。よろしいですか？' + (r.warnings.length ? '\n※' + r.warnings.join('\n※') : '')).then(function (ok) {
      if (!ok) return false;
      return PN.save.importAll(o).then(function () { PN.render.notice('セーブデータを取り込みました'); return true; });
    });
  };
  SC.define('save', slotScreen('save'));
  SC.define('load', slotScreen('load'));

  /* ---------- CONFIG ---------- */
  var MODE_JA = { TYPEWRITER: 'TYPEWRITER 一文字ずつ', INSTANT: 'INSTANT 即時', FADE: 'FADE 徐々に', LINE: 'LINE 行ごと', CUSTOM: 'CUSTOM 個別指定' };
  var ms = function (v) { return v ? v + ' ms' : 'なし'; };
  var CFG = [
    { k: 'textMode', label: '文章表示', values: ['TYPEWRITER', 'INSTANT', 'FADE', 'LINE', 'CUSTOM'], fmt: function (v) { return v; }, text: 1 },
    { k: 'charMs', label: '文字速度（1字あたり）', min: 0, max: 150, step: 10, fmt: function (v) { return v ? v + ' ms' : '瞬時'; }, modes: ['TYPEWRITER', 'CUSTOM'], text: 1 },
    { k: 'punctMs', label: '句読点の待ち時間', min: 0, max: 800, step: 50, fmt: ms, modes: ['TYPEWRITER', 'CUSTOM'], text: 1 },
    { k: 'lineMs', label: '改行の間隔', min: 0, max: 1500, step: 100, fmt: ms, modes: ['CUSTOM'], text: 1 },
    { k: 'fadeMs', label: 'フェード時間', min: 0, max: 2000, step: 100, fmt: ms, modes: ['FADE', 'CUSTOM'], text: 1 },
    { k: 'lineModeMs', label: '行ごとの表示間隔', min: 100, max: 1500, step: 100, fmt: ms, modes: ['LINE'], text: 1 },
    { k: 'autoMs', label: '自動送りの待ち時間', min: 500, max: 5000, step: 250, fmt: ms },
    { k: 'skipUnread', label: '未読の文章もスキップ', bool: 1 },
    { k: 'volBgm', label: 'BGM 音量', min: 0, max: 100, step: 10, fmt: function (v) { return v + ''; }, vol: 1 },
    { k: 'volSe', label: '効果音 音量', min: 0, max: 100, step: 10, fmt: function (v) { return v + ''; }, vol: 2 },
    { k: 'dev', label: '開発者モード', bool: 1 }
  ];
  var PREVIEW = '時計の針は、午前零時を指していた。\n——静かな夜だ。風の音だけが、廊下を渡っていく。';
  SC.define('config', {
    title: 'CONFIG', full: true,
    build: function (c) {
      var cfg = PN.sys.config;
      var pv = PN.el('div', 'pn-preview'); c.body.appendChild(pv);
      var td = c._td = new PN.TextDisplay(pv), again = 0;
      function preview() { clearTimeout(again); td.show(PREVIEW, PN.textOptions({}), function () { again = setTimeout(preview, 2200); }); }
      c._stop = function () { clearTimeout(again); td.stop(); };
      var note = PN.el('div', 'pn-note', '');
      var rows = [];
      CFG.forEach(function (d) {
        var row = c.item(c.body, '', function () { adj(1, true); }, { tag: 'div', cls: 'pn-cfg', adj: function (n) { adj(n); } });
        row.appendChild(PN.el('span', '', d.label));
        var bl = PN.el('button', '', '◀'), v = PN.el('span', 'v'), br = PN.el('button', '', '▶');
        bl.addEventListener('click', function (e) { e.stopPropagation(); adj(-1); });
        br.addEventListener('click', function (e) { e.stopPropagation(); adj(1); });
        row.appendChild(bl); row.appendChild(v); row.appendChild(br);
        function adj(n, wrap) {
          if (d.bool) cfg[d.k] = !cfg[d.k];
          else if (d.values) { var i = d.values.indexOf(cfg[d.k]); cfg[d.k] = d.values[(i + n + d.values.length) % d.values.length]; }
          else { var nv = cfg[d.k] + n * d.step; if (wrap && nv > d.max) nv = d.min; cfg[d.k] = PN.clamp(nv, d.min, d.max); }
          PN.save.saveConfig();
          if (d.vol) { PN.audio.applyVolume(); if (d.vol === 2) PN.audio.se('select'); }
          if (d.k === 'dev') PN.emit('dev');
          paint(); if (d.text) preview();
        }
        rows.push({ d: d, row: row, v: v });
      });
      function paint() {
        rows.forEach(function (r) {
          var d = r.d, val = cfg[d.k];
          r.v.textContent = d.bool ? (val ? 'ON' : 'OFF') : d.fmt(val);
          r.row.classList.toggle('na', !!(d.modes && d.modes.indexOf(cfg.textMode) < 0));
        });
        note.textContent = '表示方式: ' + MODE_JA[cfg.textMode] + '（灰色の項目は、この方式では使いません）';
      }
      c.body.appendChild(note);
      c.item(c.body, '初期値に戻す', function () {
        SC.confirm('設定を初期値に戻しますか？').then(function (ok) {
          if (!ok) return;
          var dev = cfg.dev; Object.assign(cfg, PN.sys.configDefault); cfg.dev = dev;
          PN.save.saveConfig(); PN.audio.applyVolume(); paint(); preview();
        });
      }, { cls: 'pn-item center' });
      c.item(c.body, '戻る', function () { c.close(); }, { cls: 'pn-item center' });
      c.foot.appendChild(PN.el('span', '', '↑↓ 選択 / ←→ 変更 / Esc 戻る'));
      paint(); preview();
    },
    onClose: function (c) { if (c._stop) c._stop(); }
  });
})();
