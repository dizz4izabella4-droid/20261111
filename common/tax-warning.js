/* 税金関係の作品の「始まる前の警告」。同意ボタンを押すまで、作品の画面は操作できない。
   使い方：作品の index.html の <head> に <script src="../common/tax-warning.js"></script> を1行入れる。
   警告文を直すときはこのファイルだけ直す（5作品に共通）。作品側の保存データには触れない。 */
(function () {
  'use strict';
  var TEXT = '概念学習用です。\n最新情報ではない場合や間違いがある場合がありますので、実際の計算には使わないでください。';
  var css = '#taxWarn{position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483647;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;text-align:center;' +
    'font-family:"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic","Meiryo","Noto Sans JP",sans-serif}' +
    '#taxWarn p{margin:0 0 36px;max-width:30em;color:#ff2d2d;font-size:clamp(18px,4.6vw,26px);font-weight:700;line-height:1.9;white-space:pre-line}' +
    '#taxWarn button{appearance:none;-webkit-appearance:none;border:2px solid #ff2d2d;background:#000;color:#ff2d2d;font:inherit;font-size:clamp(16px,4vw,20px);font-weight:700;padding:14px 36px;min-height:48px;border-radius:6px;cursor:pointer}' +
    '#taxWarn button:hover,#taxWarn button:focus-visible{background:#ff2d2d;color:#000;outline:none}';
  var st = document.createElement('style'); st.textContent = css;
  var box = document.createElement('div'); box.id = 'taxWarn'; box.setAttribute('role', 'alertdialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', '注意');
  var p = document.createElement('p'); p.textContent = TEXT;
  var b = document.createElement('button'); b.type = 'button'; b.textContent = '同意してスタート';
  box.appendChild(p); box.appendChild(b);
  var root = document.documentElement;
  root.appendChild(st); root.appendChild(box);   // <body> より先に出すので、作品の画面が一瞬見えることはない
  function lock(on) { if (document.body) { if (on) document.body.setAttribute('inert', ''); else document.body.removeAttribute('inert'); } }
  if (document.body) lock(true); else document.addEventListener('DOMContentLoaded', function () { if (box.parentNode) lock(true); });
  b.addEventListener('click', function () { lock(false); box.parentNode && box.parentNode.removeChild(box); st.parentNode && st.parentNode.removeChild(st); });
  document.addEventListener('DOMContentLoaded', function () { b.focus(); });
})();
