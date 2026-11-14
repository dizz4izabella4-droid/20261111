/* text-display.js — 文章表示エンジン（TYPEWRITER / INSTANT / FADE / LINE / CUSTOM）
 * 使い方: var td = new PN.TextDisplay(要素); td.show(文章, 設定, 完了時の関数); td.complete(); */
(function () {
  'use strict';
  var PUNCT = '、。，．,.！？!?…‥―─」』）';
  var GARBLE = '縺薙ｓ繧ｫ荳也阜譁ｭ邨ｶ蟄怜喧縺ｱ繝ｻ讖溯・ｽ�ｿｽ#%&$@*+=<>';

  function TD(el) { this.el = el; this.timer = 0; this.busy = false; this.spans = []; this.onDone = null; this.gTimer = 0; }
  /* 走っているフェードを確実に止める（行き先の値が同じだと、クラスを外しても transition は走り続けるため） */
  TD.prototype.killFade = function () {
    var el = this.el;
    el.classList.add('nofx'); el.classList.remove('whole', 'fade');
    el.style.opacity = '';
    void el.offsetWidth;
    el.classList.remove('nofx');
  };
  TD.prototype.clear = function () {
    this.stop();
    this.el.textContent = '';
    this.killFade();
    this.el.classList.remove('glitch', 'garble');
    this.spans = [];
  };
  TD.prototype.stop = function () {
    clearTimeout(this.timer); clearInterval(this.gTimer);
    this.timer = 0; this.gTimer = 0; this.busy = false; this.onDone = null;
  };
  TD.prototype.build = function (text) {
    var el = this.el, spans = this.spans = [];
    el.textContent = '';
    for (var i = 0, chars = Array.from(text); i < chars.length; i++) {
      if (chars[i] === '\n') { el.appendChild(document.createElement('br')); spans.push({ br: true }); continue; }
      var s = document.createElement('span');
      s.className = 'c'; s.textContent = chars[i];
      el.appendChild(s);
      spans.push({ el: s, ch: chars[i] });
    }
  };
  /* o = { mode, charMs, punctMs, lineMs, fadeMs, lineModeMs, fx } */
  TD.prototype.show = function (text, o, onDone) {
    var self = this;
    this.clear();
    this.build(text);
    this.busy = true; this.onDone = onDone || null;
    var mode = o.mode || 'TYPEWRITER', el = this.el, spans = this.spans;
    if (o.fx === 'glitch') el.classList.add('glitch');
    if (o.fx === 'garble') this.garble(Math.max(600, text.length * 40));
    if (mode === 'INSTANT' || (mode !== 'FADE' && mode !== 'LINE' && !(o.charMs > 0))) return this.complete();
    if (mode === 'FADE') {
      spans.forEach(function (s) { if (s.el) s.el.classList.add('on'); });
      el.style.setProperty('--wf', '0ms'); el.classList.add('whole'); el.style.opacity = '0';
      void el.offsetWidth;
      el.style.setProperty('--wf', o.fadeMs + 'ms'); el.style.opacity = '1';
      this.timer = setTimeout(function () { self.complete(); }, o.fadeMs);
      return;
    }
    if (mode === 'LINE') {
      /* 実際に折り返された行ごとにまとめて出す */
      var lines = [], top = null;
      spans.forEach(function (s) {
        if (!s.el) return;
        var t = s.el.offsetTop;
        if (top === null || Math.abs(t - top) > 2) { lines.push([]); top = t; }
        lines[lines.length - 1].push(s.el);
      });
      var li = 0;
      (function next() {
        if (li >= lines.length) return self.complete();
        lines[li++].forEach(function (e) { e.classList.add('on'); });
        self.timer = setTimeout(next, li >= lines.length ? 0 : o.lineModeMs);
      })();
      return;
    }
    /* TYPEWRITER / CUSTOM: 一文字ずつ。CUSTOM は一文字ごとのフェードと改行の間も効く */
    var custom = mode === 'CUSTOM';
    if (custom && o.fadeMs > 0) { el.style.setProperty('--cf', Math.min(o.fadeMs, 1500) + 'ms'); el.classList.add('fade'); void el.offsetWidth; }
    var i = 0;
    (function step() {
      if (i >= spans.length) return self.complete();
      var s = spans[i++], wait = o.charMs;
      if (s.br) wait = custom ? o.lineMs : o.charMs;
      else {
        s.el.classList.add('on');
        if (PUNCT.indexOf(s.ch) >= 0 && i < spans.length && !(spans[i].el && PUNCT.indexOf(spans[i].ch) >= 0)) wait += o.punctMs;
      }
      self.timer = setTimeout(step, i >= spans.length ? 0 : wait);
    })();
  };
  /* 全文をすぐに出す（表示途中のクリック） */
  TD.prototype.complete = function () {
    if (!this.busy) return;
    clearTimeout(this.timer); this.timer = 0;
    this.spans.forEach(function (s) { if (s.el) s.el.classList.add('on'); });
    this.killFade();
    this.busy = false;
    var f = this.onDone; this.onDone = null;
    if (f) f();
  };
  /* 文字化け風: 一時的に別の文字へ置き換え、だんだん元へ戻す */
  TD.prototype.garble = function (ms) {
    var self = this, spans = this.spans.filter(function (s) { return s.el; }), t0 = Date.now();
    clearInterval(this.gTimer);
    this.el.classList.add('garble');
    this.gTimer = setInterval(function () {
      var p = (Date.now() - t0) / ms;
      spans.forEach(function (s, k) {
        s.el.textContent = (p >= 1 || k / spans.length < p - 0.15) ? s.ch : GARBLE.charAt(Math.floor(Math.random() * GARBLE.length));
      });
      if (p >= 1) { clearInterval(self.gTimer); self.gTimer = 0; self.el.classList.remove('garble'); }
    }, 60);
  };
  TD.prototype.glitch = function (ms) {
    var el = this.el;
    el.classList.add('glitch');
    setTimeout(function () { el.classList.remove('glitch'); }, ms);
  };
  PN.TextDisplay = TD;

  /* 今の表示設定（ユーザー設定に、シナリオの TEXT_STYLE を重ねる） */
  PN.textOptions = function (override) {
    var c = PN.sys.config, o = {
      mode: c.textMode, charMs: c.charMs, punctMs: c.punctMs, lineMs: c.lineMs, fadeMs: c.fadeMs, lineModeMs: c.lineModeMs
    };
    var st = override || (PN.state && PN.state.view.style);
    if (st) ['mode', 'charMs', 'punctMs', 'lineMs', 'fadeMs', 'lineModeMs'].forEach(function (k) { if (st[k] !== undefined) o[k] = st[k]; });
    return o;
  };
})();
