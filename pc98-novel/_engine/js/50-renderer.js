/* renderer.js — 画面の拡大縮小、背景・キャラクター（画像がなければ図形で仮表示）、情報欄、選択肢、お知らせ */
(function () {
  'use strict';
  var R = PN.render = {};
  var stage, view, bgCv, bgImg, charsEl;
  R.portrait = false;

  R.init = function () {
    stage = PN.$('pn-stage'); view = PN.$('pn-view'); bgCv = PN.$('pn-bg'); bgImg = PN.$('pn-bgimg'); charsEl = PN.$('pn-chars');
    window.addEventListener('resize', R.layout);
    window.addEventListener('orientationchange', function () { setTimeout(R.layout, 200); });
    if (window.visualViewport) window.visualViewport.addEventListener('resize', R.layout);
    R.layout();
    R.drawBg(null);
  };
  /* 横: 640×400 固定比 ／ 縦: 幅400、高さは画面に合わせて 600〜900 */
  R.layout = function () {
    var root = PN.$('pn-root'), cs = getComputedStyle(root);
    var w = root.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var h = root.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (w <= 0 || h <= 0) return;
    var port = h > w * 1.15, W = 640, H = 400;
    if (port) { W = 400; H = Math.round(PN.clamp(400 * h / w, 600, 900)); }
    var changed = port !== R.portrait;
    R.portrait = port;
    stage.classList.toggle('port', port); stage.classList.toggle('land', !port);
    stage.style.width = W + 'px'; stage.style.height = H + 'px';
    var sc = Math.min(w / W, h / H);
    stage.style.transform = 'scale(' + sc + ')';
    R.scale = sc;
    if (changed) PN.emit('layout', port);
  };

  /* ---------- 背景 ---------- */
  var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  var patCache = {};
  /* 2色を level/16 の割合で混ぜる 4×4 のディザパターン */
  function dither(ctx, a, b, level) {
    var key = a + b + level;
    if (!patCache[key]) {
      var c = document.createElement('canvas'); c.width = c.height = 8;
      var x = c.getContext('2d');
      for (var i = 0; i < 16; i++) { x.fillStyle = BAYER[i] < level ? b : a; x.fillRect((i % 4) * 2, (i >> 2) * 2, 2, 2); }
      patCache[key] = c;
    }
    return ctx.createPattern(patCache[key], 'repeat');
  }
  function fillOf(ctx, s) {
    if (s.dither) return dither(ctx, s.dither[0], s.dither[1], s.mix === undefined ? 8 : Math.round(s.mix * 16));
    return s.color || '#000';
  }
  function drawShape(ctx, s, ox, oy) {
    ctx.save(); ctx.translate(ox, oy);
    if (s.grad && s.rect) {           /* 縦方向の帯ディザのグラデーション */
      var r = s.rect, n = 17, bh = r[3] / n;
      for (var i = 0; i < n; i++) { ctx.fillStyle = dither(ctx, s.grad[0], s.grad[1], i); ctx.fillRect(r[0], Math.round(r[1] + i * bh), r[2], Math.ceil(bh) + 1); }
    } else if (s.rect) { ctx.fillStyle = fillOf(ctx, s); ctx.fillRect(s.rect[0], s.rect[1], s.rect[2], s.rect[3]); }
    else if (s.poly) {
      ctx.fillStyle = fillOf(ctx, s); ctx.beginPath();
      for (var k = 0; k < s.poly.length; k += 2) ctx[k ? 'lineTo' : 'moveTo'](s.poly[k], s.poly[k + 1]);
      ctx.closePath(); ctx.fill();
    } else if (s.circle) { ctx.fillStyle = fillOf(ctx, s); ctx.beginPath(); ctx.arc(s.circle[0], s.circle[1], s.circle[2], 0, 6.2832); ctx.fill(); }
    else if (s.line) { ctx.strokeStyle = s.color || '#fff'; ctx.lineWidth = s.width || 2; ctx.beginPath(); ctx.moveTo(s.line[0], s.line[1]); ctx.lineTo(s.line[2], s.line[3]); ctx.stroke(); }
    else if (s.text) { ctx.fillStyle = s.color || '#fff'; ctx.font = (s.size || 14) + 'px sans-serif'; ctx.fillText(s.text, s.at ? s.at[0] : 0, s.at ? s.at[1] : 0); }
    ctx.restore();
  }
  R.drawPlaceholder = function (ctx, def, id) {
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 640, 400);
    var shapes = def && def.draw;
    if (!shapes) {   /* 定義のない背景: 名前だけの仮画面 */
      if (!id) return;
      shapes = [{ grad: ['#0a1040', '#2848b0'], rect: [0, 0, 640, 400] }, { rect: [0, 300, 640, 100], dither: ['#000000', '#0a1040'] },
        { text: '[ ' + ((def && def.label) || id) + ' ]', at: [20, 60], size: 20, color: '#78e8d8' }];
    }
    shapes.forEach(function (s) {
      var rep = s.repeat || { count: 1, dx: 0, dy: 0 }, rows = rep.rows || 1;
      for (var j = 0; j < rows; j++) for (var i = 0; i < (rep.count || 1); i++) drawShape(ctx, s, i * (rep.dx || 0), j * (rep.dy || 0));
    });
  };
  var bgSeq = 0;
  R.drawBg = function (id) {
    var def = id ? PN.game && PN.game.backgrounds[id] : null, seq = ++bgSeq;
    R.drawPlaceholder(bgCv.getContext('2d'), def, id);
    bgImg.hidden = true;
    R.bgPlaceholder = !!id;
    /* 画像があれば差し替える。読めなければ仮表示のまま（止めない） */
    var src = def && def.image;
    if (src) {
      var im = new Image();
      im.onload = function () { if (seq !== bgSeq) return; bgImg.src = src; bgImg.hidden = false; R.bgPlaceholder = false; R.devLabel(); };
      im.onerror = function () { PN.log('info', '背景画像なし（仮表示）: ' + src); };
      im.src = src;
    }
    R.devLabel();
  };
  R.setBg = function (id) { PN.state.view.bg = (id && id !== 'none') ? id : null; R.drawBg(PN.state.view.bg); };

  /* ---------- キャラクター ---------- */
  var POS = { left: 150, center: 320, right: 490 };
  var nodes = {};
  function drawFigure(cv, def, expr) {
    var ctx = cv.getContext('2d'), p = (def && def.placeholder) || {};
    var body = p.body || '#2848b0', hair = p.hair || '#101030', skin = p.skin || '#e8d8c8', line = '#000';
    ctx.clearRect(0, 0, 100, 150); ctx.imageSmoothingEnabled = false;
    function R4(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }
    R4(26, 14, 48, 62, hair);                                  /* 髪 */
    R4(22, 30, 56, 70, hair);
    R4(32, 22, 36, 42, skin);                                  /* 顔 */
    R4(44, 64, 12, 10, skin);                                  /* 首 */
    R4(14, 72, 72, 78, body); R4(8, 82, 84, 68, body);         /* 胴 */
    R4(40, 72, 20, 10, '#f0f4f8');                             /* 襟 */
    R4(30, 18, 40, 10, hair);                                  /* 前髪 */
    /* 目・口は表情で変える */
    var e = expr || 'normal';
    if (e === 'smile') { R4(37, 40, 8, 2, line); R4(55, 40, 8, 2, line); R4(44, 54, 12, 2, line); R4(42, 52, 2, 2, line); R4(56, 52, 2, 2, line); }
    else if (e === 'sad') { R4(37, 42, 8, 2, line); R4(55, 42, 8, 2, line); R4(36, 38, 4, 2, line); R4(60, 38, 4, 2, line); R4(45, 56, 10, 2, line); R4(43, 58, 2, 2, line); R4(55, 58, 2, 2, line); }
    else if (e === 'angry') { R4(37, 41, 8, 4, line); R4(55, 41, 8, 4, line); R4(36, 36, 10, 2, line); R4(54, 36, 10, 2, line); R4(45, 56, 10, 2, line); }
    else if (e === 'surprise') { R4(37, 38, 7, 7, line); R4(56, 38, 7, 7, line); R4(39, 40, 3, 3, '#fff'); R4(58, 40, 3, 3, '#fff'); R4(46, 53, 8, 7, line); }
    else { R4(38, 39, 6, 5, line); R4(56, 39, 6, 5, line); R4(46, 55, 8, 2, line); }
    /* 輪郭をディザで少し沈める */
    ctx.fillStyle = dither(ctx, 'rgba(0,0,0,0)', 'rgba(0,0,0,.55)', 6);
    ctx.fillRect(8, 110, 84, 40);
  }
  function charSrc(def, expr) {
    if (!def || !def.image) return null;
    if (typeof def.image === 'string') return def.image.replace('{expr}', expr);
    return def.image[expr] || def.image.normal || null;
  }
  R.showChar = function (id, expr, pos, instant) {
    var def = PN.game.characters[id], n = nodes[id];
    if (!n) {
      n = nodes[id] = { el: PN.el('div', 'pn-char'), cv: document.createElement('canvas'), img: new Image() };
      n.cv.width = 100; n.cv.height = 150; n.img.alt = ''; n.img.hidden = true;
      n.el.appendChild(n.cv); n.el.appendChild(n.img);
      charsEl.appendChild(n.el);
      void n.el.offsetWidth;
    }
    drawFigure(n.cv, def, expr);
    n.cv.hidden = false; n.img.hidden = true;
    var src = charSrc(def, expr);
    n.want = src;
    if (src) {
      var im = new Image();
      im.onload = function () { if (n.want !== src) return; n.img.src = src; n.img.hidden = false; n.cv.hidden = true; };
      im.onerror = function () { PN.log('info', '立ち絵なし（仮表示）: ' + src); };
      im.src = src;
    }
    var x = typeof pos === 'number' ? pos : (POS[pos] || POS.center);
    if (instant) n.el.style.transition = 'none';
    n.el.style.left = x + 'px';
    n.el.classList.add('on');
    if (instant) { void n.el.offsetWidth; n.el.style.transition = ''; }
  };
  R.hideChar = function (id) {
    (id === 'all' || !id ? Object.keys(nodes) : [id]).forEach(function (k) { if (nodes[k]) nodes[k].el.classList.remove('on'); });
  };

  /* ---------- 情報欄・名前 ---------- */
  R.setStatus = function (st) {
    st = st || {};
    PN.$('st-date').textContent = st.date || '';
    PN.$('st-place').textContent = st.place || '';
    PN.$('st-chapter').textContent = st.chapter || '';
    PN.$('pn-status').classList.toggle('off', !(st.date || st.place || st.chapter));
  };
  R.setName = function (name, color) {
    var n = PN.$('pn-name');
    n.textContent = name || '';
    n.style.background = color || '';
  };
  R.showNext = function (on) { PN.$('pn-next').classList.toggle('on', !!on); };
  R.showMessage = function (on) { PN.$('pn-msg').hidden = !on; if (!on) PN.$('pn-name').textContent = ''; };

  /* ---------- 選択肢 ---------- */
  var choiceSel = 0, choiceBtns = [];
  R.showChoices = function (list, prompt, onPick) {
    var box = PN.$('pn-choices');
    box.textContent = ''; choiceBtns = []; choiceSel = 0;
    if (prompt) box.appendChild(PN.el('div', 'prompt', prompt));
    list.forEach(function (it, k) {
      var b = PN.el('button', it.forced ? 'forced' : '', it.text);
      b.addEventListener('click', function (e) { e.stopPropagation(); onPick(it.index); });
      b.addEventListener('mousemove', function () { if (choiceSel !== k) { choiceSel = k; markChoice(); } });
      box.appendChild(b); choiceBtns.push(b);
    });
    box.classList.add('on');
    markChoice();
  };
  function markChoice() { choiceBtns.forEach(function (b, k) { b.classList.toggle('sel', k === choiceSel); }); if (choiceBtns[choiceSel]) choiceBtns[choiceSel].scrollIntoView({ block: 'nearest' }); }
  R.hideChoices = function () { PN.$('pn-choices').classList.remove('on'); choiceBtns = []; };
  R.choiceOpen = function () { return choiceBtns.length > 0; };
  R.choiceMove = function (d) { if (!choiceBtns.length) return; choiceSel = (choiceSel + d + choiceBtns.length) % choiceBtns.length; markChoice(); };
  R.choiceDecide = function () { if (choiceBtns[choiceSel]) choiceBtns[choiceSel].click(); };

  /* ---------- お知らせ ---------- */
  R.notice = function (text, err) {
    var d = PN.el('div', err ? 'err' : '', text);
    PN.$('pn-notice').appendChild(d);
    setTimeout(function () { d.remove(); }, 2700);
  };
  R.devLabel = function () {
    var el = PN.$('pn-devlabel');
    if (!PN.sys.config.dev || !PN.state) { el.textContent = ''; return; }
    var v = PN.state.view;
    el.textContent = PN.state.scene + ' [' + (PN.state.index + 1) + ']' + (v.bg ? '\nBG: ' + v.bg + (R.bgPlaceholder ? '（仮）' : '') : '');
  };

  /* ---------- セーブから画面を戻す／消す ---------- */
  R.restore = function () {
    var v = PN.state.view;
    R.drawBg(v.bg);
    R.hideChar('all');
    (v.order || []).forEach(function (id) { var c = v.chars[id]; if (c) R.showChar(id, c.expr, c.pos, true); });
    R.setStatus(v.status);
    PN.fx.restore(v.fx);
  };
  R.reset = function () {
    R.drawBg(null); R.hideChar('all'); R.setStatus(null); R.setName(''); R.hideChoices(); R.showNext(false);
    PN.fx.restore({});
  };
})();
