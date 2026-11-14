/* save.js — セーブ・ロード（IndexedDB。ゲームIDごとにデータベースを分ける）
 * IndexedDB が使えない環境では localStorage、それも駄目ならメモリに保存する（止めない）。 */
(function () {
  'use strict';
  var SV = PN.save = { SLOTS: 20, backend: 'none' };
  var db = null, mem = {}, prefix = '';

  function idbOpen(name) {
    return new Promise(function (res, rej) {
      var rq;
      try { rq = indexedDB.open(name, 1); } catch (e) { return rej(e); }
      rq.onupgradeneeded = function () {
        var d = rq.result;
        if (!d.objectStoreNames.contains('saves')) d.createObjectStore('saves');
        if (!d.objectStoreNames.contains('system')) d.createObjectStore('system');
      };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error || new Error('IndexedDB')); };
      rq.onblocked = function () { rej(new Error('blocked')); };
      setTimeout(function () { rej(new Error('timeout')); }, 3000);
    });
  }
  function tx(store, mode, fn) {
    return new Promise(function (res, rej) {
      var t = db.transaction(store, mode), out, rq = fn(t.objectStore(store));
      if (rq) rq.onsuccess = function () { out = rq.result; };
      t.oncomplete = function () { res(out); };
      t.onerror = t.onabort = function () { rej(t.error || new Error('tx')); };
    });
  }
  function lsOk() { try { localStorage.setItem(prefix + 't', '1'); localStorage.removeItem(prefix + 't'); return true; } catch (e) { return false; } }

  SV.init = function () {
    var id = PN.game.config.gameId;
    prefix = 'pc98novel__' + id + '__';
    return idbOpen('pc98novel__' + id).then(function (d) { db = d; SV.backend = 'indexeddb'; })
      .catch(function (e) {
        SV.backend = lsOk() ? 'localstorage' : 'memory';
        PN.log('warn', 'IndexedDB が使えないため ' + SV.backend + ' に保存します（' + (e && e.message) + '）');
      });
  };
  function get(store, key) {
    if (SV.backend === 'indexeddb') return tx(store, 'readonly', function (s) { return s.get(key); }).then(function (v) { return v === undefined ? null : v; });
    if (SV.backend === 'localstorage') { try { var v = localStorage.getItem(prefix + store + '/' + key); return Promise.resolve(v ? JSON.parse(v) : null); } catch (e) { return Promise.resolve(null); } }
    return Promise.resolve(mem[store + '/' + key] ? JSON.parse(mem[store + '/' + key]) : null);
  }
  function put(store, key, val) {
    if (SV.backend === 'indexeddb') return tx(store, 'readwrite', function (s) { s.put(val, key); });
    if (SV.backend === 'localstorage') { try { localStorage.setItem(prefix + store + '/' + key, JSON.stringify(val)); return Promise.resolve(); } catch (e) { return Promise.reject(e); } }
    mem[store + '/' + key] = JSON.stringify(val); return Promise.resolve();
  }
  function del(store, key) {
    if (SV.backend === 'indexeddb') return tx(store, 'readwrite', function (s) { s.delete(key); });
    if (SV.backend === 'localstorage') { try { localStorage.removeItem(prefix + store + '/' + key); } catch (e) {} return Promise.resolve(); }
    delete mem[store + '/' + key]; return Promise.resolve();
  }

  SV.slotKeys = function (withSpecial) {
    var k = [];
    if (withSpecial) k.push('auto', 'quick');
    for (var i = 1; i <= SV.SLOTS; i++) k.push('s' + PN.pad2(i));
    return k;
  };
  SV.slotLabel = function (k) { return k === 'auto' ? 'AUTO' : k === 'quick' ? 'QUICK' : k.slice(1); };
  SV.read = function (slot) { return get('saves', slot); };
  SV.write = function (slot, data) { return put('saves', slot, data || PN.snapshot()); };
  SV.remove = function (slot) { return del('saves', slot); };
  SV.list = function (withSpecial) {
    var keys = SV.slotKeys(withSpecial);
    return Promise.all(keys.map(SV.read)).then(function (arr) { return keys.map(function (k, i) { return { slot: k, data: arr[i] }; }); });
  };
  SV.latest = function () {
    return SV.list(true).then(function (l) {
      var best = null;
      l.forEach(function (x) { if (x.data && !PN.checkSave(x.data) && (!best || x.data.savedAt > best.data.savedAt)) best = x; });
      return best;
    });
  };
  /* システムデータ（設定・エンディング到達・既読） */
  SV.loadSys = function () {
    return Promise.all([get('system', 'config'), get('system', 'endings'), get('system', 'read')]).then(function (r) {
      var def = Object.assign({}, PN.CONFIG_DEFAULT, PN.game.config.text || {});
      PN.sys.configDefault = def;
      PN.sys.config = Object.assign({}, def, r[0] || {});
      PN.sys.endings = r[1] || {};
      PN.sys.read = r[2] || {};
    });
  };
  var readTimer = 0;
  SV.saveConfig = function () { return put('system', 'config', PN.sys.config).catch(warn); };
  SV.saveEndings = function () { return put('system', 'endings', PN.sys.endings).catch(warn); };
  SV.saveRead = function () { clearTimeout(readTimer); readTimer = setTimeout(function () { put('system', 'read', PN.sys.read).catch(warn); }, 1500); };
  function warn(e) { PN.log('warn', '保存に失敗: ' + (e && e.message)); }

  /* ---------- エクスポート・インポート ---------- */
  SV.exportAll = function () {
    return SV.list(true).then(function (l) {
      var saves = {};
      l.forEach(function (x) { if (x.data) saves[x.slot] = x.data; });
      return { format: 'pc98novel-export', saveVersion: PN.SAVE_VERSION, gameId: PN.game.config.gameId, scenarioVersion: String(PN.game.config.version),
        exportedAt: Date.now(), saves: saves, endings: PN.sys.endings, read: PN.sys.read };
    });
  };
  /* 形式を検証する。{ok, error, count, warnings} */
  SV.checkImport = function (o) {
    if (!o || typeof o !== 'object') return { ok: false, error: 'JSON の中身がセーブデータではありません' };
    if (o.format !== 'pc98novel-export') return { ok: false, error: 'このエンジンの書き出しデータではありません（format）' };
    if (o.gameId !== PN.game.config.gameId) return { ok: false, error: '別の作品のデータです（' + o.gameId + '）。この作品は ' + PN.game.config.gameId };
    if (typeof o.saveVersion !== 'number' || o.saveVersion > PN.SAVE_VERSION) return { ok: false, error: '対応していない版のデータです（saveVersion ' + o.saveVersion + '）' };
    if (!o.saves || typeof o.saves !== 'object') return { ok: false, error: 'saves がありません' };
    var valid = SV.slotKeys(true), n = 0, warnings = [];
    for (var k in o.saves) {
      if (valid.indexOf(k) < 0) return { ok: false, error: '知らないスロット名です: ' + k };
      var e = PN.checkSave(o.saves[k]);
      if (e) return { ok: false, error: 'スロット ' + SV.slotLabel(k) + ': ' + e };
      n++;
    }
    if (o.endings && typeof o.endings !== 'object') return { ok: false, error: 'endings の形式が違います' };
    if (String(o.scenarioVersion) !== String(PN.game.config.version)) warnings.push('シナリオの版が違います（' + o.scenarioVersion + ' → ' + PN.game.config.version + '）');
    return { ok: true, count: n, warnings: warnings };
  };
  SV.importAll = function (o) {
    var jobs = SV.slotKeys(true).map(function (k) { return o.saves[k] ? put('saves', k, PN.migrateSave(o.saves[k])) : del('saves', k); });
    return Promise.all(jobs).then(function () {
      if (o.endings) { Object.keys(o.endings).forEach(function (k) { if (!PN.sys.endings[k]) PN.sys.endings[k] = o.endings[k]; }); SV.saveEndings(); }
      if (o.read) { Object.assign(PN.sys.read, o.read); SV.saveRead(); }
    });
  };
  SV.download = function (obj, name) {
    var blob = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };
})();
