/* main.js — 起動。埋め込まれたゲームデータ（JSON）を読み、検証してからタイトルを出す */
(function () {
  'use strict';
  function fatal(title, lines) {
    var d = PN.el('div', 'pn-fatal');
    d.appendChild(PN.el('h2', '', '■ ' + title));
    d.appendChild(document.createTextNode(lines.join('\n')));
    PN.$('pn-stage').appendChild(d);
    PN.fatal = { title: title, lines: lines };
  }
  function boot() {
    PN.render.init();
    var game, raw = PN.$('pn-data').textContent;
    try { game = JSON.parse(raw); }
    catch (e) { return fatal('シナリオデータ（JSON）を読めません', ['JSON の書き方に誤りがあります。', e.message]); }
    var v;
    try {
      PN.engine.init();
      PN.scenario.normalize(game);
      v = PN.scenario.validate(game, PN.engine.commandNames());
    } catch (e) { return fatal('シナリオデータを検証できません', [e.message]); }
    if (v.errors.length) return fatal('シナリオデータに誤りがあります（' + v.errors.length + '件）', v.errors);
    v.warnings.forEach(function (w) { PN.log('warn', w); });
    PN.game = game; PN.knownFlags = v.flags;
    document.title = game.config.title;
    PN.text = new PN.TextDisplay(PN.$('pn-text'));
    PN.sys.config = Object.assign({}, PN.CONFIG_DEFAULT, game.config.text || {});
    PN.save.init().then(PN.save.loadSys).catch(function (e) { PN.log('error', '保存領域の初期化: ' + (e && e.message)); }).then(function () {
      PN.audio.applyVolume();
      PN.input.buildFkeys();
      PN.input.init();
      PN.engine.toTitle();
      PN.ready = true;
      PN.emit('ready');
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
