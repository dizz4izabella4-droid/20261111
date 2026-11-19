/* izのおもちゃ箱 — 3画面（GALLERY / BRAIN / ARCHIVE）共通の部品。
   作品台帳 data/works.json と、Git履歴から作った data/history.json を読み、1つの一覧にまとめる。
   リポジトリの根（作品フォルダがある場所）は、このファイルの位置から自動で求める。
   ※サイトを別の場所へ移したときは ROOT_FROM_ASSETS だけを直す（README「本番への切り替え」参照）。 */
(function () {
  'use strict';
  var ROOT_FROM_ASSETS = '../';   // common/ から見たリポジトリの根（common/ → 20261111/）。サイトを別の階層へ移したときだけ直す
  var DATA_FROM_ASSETS = '../data/'; // common/ から見た data/
  var me = document.currentScript && document.currentScript.src || location.href;
  var ROOT = new URL(ROOT_FROM_ASSETS, me).href;
  var DATA = new URL(DATA_FROM_ASSETS, me).href;
  var GH = 'https://github.com/';

  var CATS = {
    game: { ja: 'ゲーム', en: 'GAME', cls: 'c-game' },
    tool: { ja: '実用', en: 'UTILITY', cls: 'c-tool' },
    lab:  { ja: '実験', en: 'LAB', cls: 'c-lab' }
  };
  var STATUS = {
    stable: null,
    test:   { ja: '試作', cls: 'st' },
    wip:    { ja: '未完', cls: 'st' },
    paused: { ja: '開発停止', cls: 'stop' }
  };

  /* アイコン（旧おもちゃ箱・実験室・実用の部屋のものを流用。色は currentColor） */
  var P = {
    calc: '<rect x="10" y="5" width="28" height="38" rx="5"/><rect x="15" y="10" width="18" height="7" rx="1.5" fill="currentColor" fill-opacity=".25"/><path d="M16 25h.01M24 25h.01M32 25h.01M16 32h.01M24 32h.01M32 32h.01M16 38h.01M24 38h.01M32 38h.01" stroke-width="4"/>',
    keyboard: '<rect x="5" y="13" width="38" height="24" rx="6"/><path d="M12 21h.01M18 21h.01M24 21h.01M30 21h.01M36 21h.01M12 27h.01M36 27h.01M17 30h14" stroke-width="4"/>',
    phone: '<rect x="13" y="4" width="22" height="40" rx="6"/><path d="M21 38h6"/><text x="24" y="27" text-anchor="middle" fill="currentColor" stroke="none" font-size="14" font-weight="800" font-family="sans-serif">あ</text>',
    bird: '<path d="M8 28c0-9 7-15 16-15 6 0 10 3 12 7l6 1-5 4c0 9-7 14-16 14-7 0-13-4-13-11z" fill="currentColor" fill-opacity=".25"/><path d="M14 25c4 4 10 4 14 0"/><circle cx="31" cy="20" r="1.6" fill="currentColor"/>',
    loop: '<path d="M10 10h14v14h14v14H10z" fill="currentColor" fill-opacity=".25"/><path d="M38 10h.01" stroke-width="5"/>',
    glass: '<path d="M10 7h28v34H10z" fill="currentColor" fill-opacity=".25"/><path d="M27 7l-6 12 9 6-7 16"/><path d="M21 19l-9-4M30 25l8-3"/>',
    hige: '<path d="M4 24c4-8 12-8 20-2 8-6 16-6 20 2-6 2-12 0-20 4-8-4-14-2-20-4z" fill="currentColor" fill-opacity=".25"/>',
    wing: '<path d="M6 34C8 18 20 8 42 8c-2 12-10 22-24 24l-6 8z" fill="currentColor" fill-opacity=".25"/><path d="M16 28c6-2 12-8 18-16M22 30c4-2 9-6 13-12"/>',
    flame: '<path d="M24 5c2 8 11 12 11 23a11 11 0 0 1-22 0c0-5 3-8 5-11 1 4 3 5 4 5 0-6 0-11 2-17z" fill="currentColor" fill-opacity=".25"/>',
    rosette: '<circle cx="24" cy="24" r="17" fill="currentColor" fill-opacity=".25"/><circle cx="24" cy="24" r="9" fill="currentColor" fill-opacity=".9" stroke="none"/><path d="M24 4.5v.01M24 43.5v.01M4.5 24h.01M43.5 24h.01M10.2 10.2l.01.01M37.8 37.8l.01.01M37.8 10.2l.01.01M10.2 37.8l.01.01" stroke-width="3.6"/>',
    star: '<path d="M24 6l5.5 11.6 12.5 1.7-9.2 8.7 2.3 12.5L24 34.4 12.9 40.5l2.3-12.5L6 19.3l12.5-1.7z" fill="currentColor" stroke="none"/>',
    blob: '<path d="M24 8c10 0 17 8 17 18 0 9-7 14-17 14S7 35 7 26C7 16 14 8 24 8z" fill="currentColor" fill-opacity=".25"/><circle cx="18" cy="24" r="1.6" fill="currentColor"/><circle cx="30" cy="24" r="1.6" fill="currentColor"/><path d="M20 31q4 3 8 0"/>',
    novel: '<rect x="5" y="7" width="38" height="28" rx="3" fill="currentColor" fill-opacity=".25"/><path d="M11 22h26v8H11zM15 26h12M18 41h12M24 35v6"/>',
    yen: '<circle cx="24" cy="24" r="17"/><path d="M16 14l8 11 8-11M24 25v12M17 27h14M17 32h14"/>',
    scale: '<path d="M24 8v32M14 40h20M10 14h28"/><path d="M10 14l-5 12h10zM38 14l-5 12h10z"/>',
    phones: '<path d="M9 30v-6a15 15 0 0 1 30 0v6"/><rect x="7" y="29" width="8" height="12" rx="3" fill="currentColor" fill-opacity=".25"/><rect x="33" y="29" width="8" height="12" rx="3" fill="currentColor" fill-opacity=".25"/>',
    ledger: '<rect x="9" y="6" width="30" height="36" rx="3" fill="currentColor" fill-opacity=".25"/><path d="M16 15h16M16 22h16M16 29h9"/>',
    siren: '<path d="M14 34V24a10 10 0 0 1 20 0v10" fill="currentColor" fill-opacity=".25"/><path d="M9 38h30M24 6v4M10 12l3 3M38 12l-3 3"/>',
    thread: '<path d="M6 30c6-12 12 6 18-6s12 6 18-6"/><circle cx="6" cy="30" r="2.5" fill="currentColor"/><circle cx="42" cy="18" r="2.5" fill="currentColor"/>',
    leaf: '<path d="M10 38C10 20 22 10 40 8c0 18-10 30-28 30z" fill="currentColor" fill-opacity=".25"/><path d="M10 38L28 20"/>'
  };
  function icon(name) {
    return '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[name] || P.star) + '</svg>';
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* 今日（日本時間）の YYYY-MM-DD */
  function todayJST() {
    var d = new Date(Date.now() + 9 * 3600e3);
    return d.toISOString().slice(0, 10);
  }
  function daysBetween(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5); }
  function dot(d) { return d ? d.replace(/-/g, '.') : ''; }

  function getJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status + ' ' + url); return r.json(); });
  }

  /* 台帳と履歴をまとめる。履歴が読めなくても台帳だけで一覧は出す（日付は「未集計」） */
  function load() {
    if (location.protocol === 'file:') return Promise.reject(new Error('file'));
    return Promise.all([getJSON(DATA + 'works.json'), getJSON(DATA + 'history.json').catch(function () { return null; })])
      .then(function (res) {
        var reg = res[0], hist = res[1] || { works: {} }, today = todayJST();
        var works = reg.works.map(function (w, i) {
          var h = hist.works[w.id] || null;
          var ok = !!(h && h.status === 'ok' && h.first);
          var o = {
            id: w.id, title: w.title, titleEn: w.titleEn || '', summary: w.summary || '',
            category: CATS[w.category] ? w.category : 'lab', status: w.status || 'stable', statusNote: w.statusNote || '',
            devices: w.devices || [], icon: w.icon, gallery: w.gallery !== false, order: i,
            url: new URL(w.path, ROOT).href, path: w.path,
            history: h, dateState: !h ? 'pending' : (h.status === 'ok' ? 'ok' : (h.status === 'none' ? 'none' : 'unverified')),
            first: ok ? h.first.date : null,
            last: h && h.last ? h.last.date : null
          };
          o.isNew = !!(o.first && daysBetween(o.first, today) <= 1);
          o.isUpdated = !o.isNew && !!(o.last && daysBetween(o.last, today) <= 1);
          return o;
        });
        return { works: works, history: hist, repo: reg.repository || '' };
      });
  }

  function catBadge(w) { var c = CATS[w.category]; return '<span class="b cat">' + c.ja + '</span>'; }
  function statusBadges(w) {
    var s = STATUS[w.status], out = '';
    if (s) out += '<span class="b ' + s.cls + '">' + s.ja + '</span>';
    if (w.statusNote) out += '<span class="b ' + (w.status === 'paused' ? 'stop' : 'st') + '">' + esc(w.statusNote) + '</span>';
    return out;
  }
  function deviceText(w) {
    var d = w.devices, m = d.indexOf('mobile') >= 0, p = d.indexOf('pc') >= 0;
    if (m && p) return 'スマホ・PC';
    if (m) return 'スマホ向け';
    if (p) return 'PC向け';
    return '';
  }
  function dateLabel(w, which) {
    if (w.dateState === 'pending') return '未集計';
    if (w.dateState === 'none') return '記録なし';
    if (which === 'first' && w.dateState === 'unverified') return '要確認';
    return dot(which === 'first' ? w.first : w.last);
  }
  function commitURL(repo, hash) { return repo && hash ? GH + repo + '/commit/' + hash : ''; }

  /* data-root-href="staff/" と書いたリンクを、リポジトリの根からの場所に直す（置き場所が変わってもHTMLを直さなくてよい） */
  function fixRootLinks() {
    document.querySelectorAll('[data-root-href]').forEach(function (a) { a.href = new URL(a.getAttribute('data-root-href'), ROOT).href; });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fixRootLinks); else fixRootLinks();

  /* ---- お気に入り（ハート）：この端末のブラウザにだけ保存。人ごとに別。通信はしない ---- */
  function readFav() { try { var v = JSON.parse(localStorage.getItem('izSite.fav') || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  var favs = {
    all: readFav,
    has: function (id) { return readFav().indexOf(id) >= 0; },
    toggle: function (id) {
      var a = readFav(), i = a.indexOf(id), on = i < 0;
      if (on) a.push(id); else a.splice(i, 1);
      try { localStorage.setItem('izSite.fav', JSON.stringify(a)); } catch (e) {}
      return on;
    }
  };

  window.IZ = {
    favs: favs,
    ROOT: ROOT, DATA: DATA, CATS: CATS, STATUS: STATUS, load: load, icon: icon, esc: esc, dot: dot,
    catBadge: catBadge, statusBadges: statusBadges, deviceText: deviceText, dateLabel: dateLabel,
    commitURL: commitURL, todayJST: todayJST,
    fileNotice: '<div class="notice">このページはローカルサーバーで開いてください。ターミナルでリポジトリのフォルダに移り <code>python3 -m http.server 8000</code> を実行し、<code>http://localhost:8000/</code> を開きます。</div>'
  };
})();
