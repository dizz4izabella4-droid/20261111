/* izdisk-client v1 — ディスク対応の部品（任意。使わなくても、規格の最小条件を満たせばディスクとして動く）
 * 作品は1ファイル完結なので、このまま作品の <script> の先頭に貼る。外部読み込みはしない。
 * ディスク（トップ画面のモニター）の中で動いていなければ、何もしない（単独で開いても壊れない）。 */
(function () {
  'use strict';
  var P = window.parent, hosted = !!P && P !== window;
  var O = (location.protocol === 'file:' || location.origin === 'null') ? '*' : location.origin;
  var beforeEject = null;
  function send(t) { if (!hosted) return; try { P.postMessage({ izdisk: 1, type: t }, O); } catch (e) {} }
  window.IZDISK = {
    hosted: hosted,
    ready: function () { send('ready'); },               // 最初の画面を出せたら呼ぶ（呼ばなくても、読み込み完了で始まる）
    access: function () { send('access'); },             // セーブしたら呼ぶ（ドライブのランプが光り、読み書きの音が鳴る）
    eject: function () { send('eject'); },               // 作品の側から終わらせたいとき（通常は使わない。トップへ戻る操作は付けない方針）
    onBeforeEject: function (fn) { beforeEject = fn; }   // 排出の直前に呼ばれる。ここで保存する
  };
  addEventListener('message', function (e) {
    if (!hosted || e.source !== P) return;
    var m = e.data; if (!m || m.izdisk !== 1) return;
    if (m.type === 'before-eject') { try { if (beforeEject) beforeEject(); } catch (x) {} send('saved'); }
  });
})();
