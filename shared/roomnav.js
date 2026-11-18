/* 部屋どうしの行き来：下に小さなナビ（おもちゃ箱／実験室／実用の部屋／あそびば）と、いちばん下に小さな脳みそ（BRAINトップへ）。
   使い方：各部屋の index.html の </body> 直前に <script src="../shared/roomnav.js"></script> */
(function () {
  if (window.__roomnav) return; window.__roomnav = 1;
  var here = (location.pathname.match(/\/(toybox|lab|utility)\/?(index\.html)?$/) || [])[1] || '';
  var rooms = [['toybox', 'おもちゃ箱', '../toybox/'], ['lab', '実験室', '../lab/'], ['utility', '実用の部屋', '../utility/']];
  var css = document.createElement('style');
  css.textContent = '#rn{position:fixed;left:0;right:0;bottom:0;z-index:60;display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 8px max(6px,env(safe-area-inset-bottom,0px));pointer-events:none;font:600 12px/1 "Hiragino Sans","Yu Gothic","Meiryo","Noto Sans JP",system-ui,sans-serif}' +
    '#rn .r{pointer-events:auto;display:flex;gap:4px;padding:4px;border-radius:999px;background:rgba(18,18,30,.62);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);box-shadow:0 1px 6px rgba(0,0,0,.25)}' +
    '#rn a{color:#fff;text-decoration:none;padding:7px 11px;border-radius:999px;white-space:nowrap;-webkit-tap-highlight-color:transparent}' +
    '#rn a.on{background:rgba(255,255,255,.9);color:#222;pointer-events:none}' +
    '#rn a.ex{color:#ffe9b0}' +
    '#rn .b{pointer-events:auto;display:flex;align-items:center;justify-content:center;width:34px;height:26px;border-radius:13px;background:rgba(18,18,30,.62);color:#fff;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}' +
    '#rn .b svg{width:18px;height:18px}' +
    'body{padding-bottom:calc(max(20px,env(safe-area-inset-bottom,0px)) + 72px)!important}';
  document.head.appendChild(css);
  var nav = document.createElement('nav'); nav.id = 'rn'; nav.setAttribute('aria-label', 'ほかの部屋');
  var row = document.createElement('div'); row.className = 'r';
  rooms.forEach(function (r) { var a = document.createElement('a'); a.textContent = r[1]; if (r[0] === here) a.className = 'on'; else a.href = r[2]; row.appendChild(a); });
  var ex = document.createElement('a'); ex.className = 'ex'; ex.textContent = 'あそびば'; ex.href = 'https://iz3ico.github.io/app/'; ex.target = '_blank'; ex.rel = 'noopener noreferrer'; row.appendChild(ex);
  var br = document.createElement('a'); br.className = 'b'; br.href = '../'; br.setAttribute('aria-label', 'BRAIN（入り口）へ'); br.title = 'BRAIN';
  br.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g id="rnh"><path d="M12 5.2C11.2 3.9 9.4 3.4 8 4.2 6.5 4.6 5.8 6.2 6.3 7.5 4.7 8.2 4.2 10.2 5.2 11.6 4.6 13.1 5.2 15 6.7 15.7 6.7 17.4 8.2 18.6 9.7 18.4 10.7 19.2 11.7 19 12 18.4"/><path d="M12 5.2V18.4M8.2 9.2C9.2 9.2 10 9.8 10.4 10.6M7.6 14C8.8 13.8 9.8 13.2 10.2 12.4"/></g><use href="#rnh" transform="translate(24 0) scale(-1 1)"/></svg>';
  nav.appendChild(row); nav.appendChild(br); document.body.appendChild(nav);
})();
