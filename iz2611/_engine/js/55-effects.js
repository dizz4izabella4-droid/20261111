/* effects.js — 画面演出。PN.fx.run(名前, {ms,on}) で個別に呼べる（Promise を返す） */
(function () {
  'use strict';
  var F = PN.fx = {};
  var noiseTimer = 0;
  function $(id) { return PN.$(id); }
  function anim(el, from, to, ms) {
    return new Promise(function (res) {
      el.style.transition = 'none'; el.style.opacity = from; void el.offsetWidth;
      el.style.transition = 'opacity ' + ms + 'ms linear'; el.style.opacity = to;
      setTimeout(res, ms);
    });
  }
  function persist() { return PN.state ? PN.state.view.fx : {}; }
  function noise(on) {
    var cv = $('fx-noise'), ctx = cv.getContext('2d');
    clearInterval(noiseTimer); noiseTimer = 0;
    cv.style.opacity = on ? 0.55 : 0;
    if (!on) return;
    noiseTimer = setInterval(function () {
      var im = ctx.createImageData(160, 100), d = im.data;
      for (var i = 0; i < d.length; i += 4) { var v = Math.random() < 0.5 ? 0 : (Math.random() < 0.5 ? 200 : 110); d[i] = v * 0.6; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255; }
      ctx.putImageData(im, 0, 0);
    }, 70);
  }
  var EFFECTS = {
    fadein: function (o) { persist().black = false; return anim($('fx-fade'), 1, 0, o.ms || 600); },
    fadeout: function (o) { persist().black = true; return anim($('fx-fade'), 0, 1, o.ms || 600); },
    blackout: function (o) {
      var on = o.on !== false; persist().black = on;
      var el = $('fx-fade'); el.style.transition = 'none'; el.style.opacity = on ? 1 : 0;
      return o.ms && on && o.on === undefined ? PN.sleep(o.ms).then(function () { persist().black = false; el.style.opacity = 0; }) : Promise.resolve();
    },
    flash: function (o) { return anim($('fx-flash'), 1, 0, o.ms || 300); },
    shake: function (o) {
      var st = $('pn-stage'); st.classList.add('shake');
      return PN.sleep(o.ms || 400).then(function () { st.classList.remove('shake'); });
    },
    noise: function (o) {
      if (o.on !== undefined) { persist().noise = !!o.on; noise(!!o.on); return Promise.resolve(); }
      noise(true);
      return PN.sleep(o.ms || 500).then(function () { noise(!!persist().noise); });
    },
    invert: function (o) {
      var v = $('pn-view');
      if (o.on !== undefined) { persist().invert = !!o.on; v.classList.toggle('invert', !!o.on); return Promise.resolve(); }
      v.classList.add('invert');
      return PN.sleep(o.ms || 200).then(function () { v.classList.toggle('invert', !!persist().invert); });
    },
    garble: function (o) { PN.text.garble(o.ms || 800); return PN.sleep(o.ms || 800); },
    glitch: function (o) { PN.text.glitch(o.ms || 600); return PN.sleep(o.ms || 600); }
  };
  F.names = Object.keys(EFFECTS);
  F.register = function (name, fn) { EFFECTS[name] = fn; F.names = Object.keys(EFFECTS); };
  F.run = function (name, o) {
    var f = EFFECTS[name];
    if (!f) { PN.log('error', '演出 "' + name + '" はありません'); return Promise.resolve(); }
    try { return f(o || {}) || Promise.resolve(); } catch (e) { PN.log('error', '演出 ' + name + ': ' + e.message); return Promise.resolve(); }
  };
  /* 続いている演出（暗転・反転・ノイズ）をセーブから戻す */
  F.restore = function (fx) {
    fx = fx || {};
    var el = $('fx-fade'); el.style.transition = 'none'; el.style.opacity = fx.black ? 1 : 0;
    $('fx-flash').style.opacity = 0;
    $('pn-view').classList.toggle('invert', !!fx.invert);
    $('pn-stage').classList.remove('shake');
    noise(!!fx.noise);
  };
})();
