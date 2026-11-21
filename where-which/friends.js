/* WHERE WHICH: character gallery + freehand photo cutouts; shares origin storage with YAWARAKA. */
(function(){
'use strict';
const GALLERY='brain-friends-gallery-v1',PLACED='where-which-placed-friends-v1';
const MAX=24,MAX_ON_STAGE=10;
let stage,layer,modal,crop,canvas,ctx,placed=[],sprites=[];
let photo=null,photoBox=null,outline=[],drawing=false,lastWidth=0,lastHeight=0;
let options={},lastOptionsAt=0;
function $(id){return document.getElementById(id);}
function notice(message){$('friends-message').textContent=message;}
function items(){
  const value=JSON.parse(localStorage.getItem(GALLERY)||'[]');
  if(!Array.isArray(value))throw Error('登録データを読めません');
  return value.filter(r=>r&&typeof r.id==='string'&&typeof r.image==='string'&&/^data:image\/(?:png|webp|jpeg|svg\+xml)/.test(r.image));
}
function register(record){
  const all=items();
  if(all.length>=MAX)throw Error('登録できるのは24人までです');
  const obj={id:'ww-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),
    name:String(record.name||'んちょ').trim().slice(0,24)||'んちょ',
    source:record.source||'photo',image:record.image,createdAt:Date.now()};
  all.push(obj);localStorage.setItem(GALLERY,JSON.stringify(all));return obj;
}
function readPlaced(){
  try{
    const arr=JSON.parse(localStorage.getItem(PLACED)||'[]');
    placed=Array.isArray(arr)?[...new Set(arr.filter(x=>typeof x==='string'))].slice(0,MAX_ON_STAGE):[];
  }catch(e){placed=[];}
}
function savePlaced(){localStorage.setItem(PLACED,JSON.stringify(placed));}
function obstacles(){
  const base=stage.getBoundingClientRect();
  return [ $('speech-box'),$('character-mover'),$('hero'),stage.querySelector('.status')]
    .filter(el=>el && getComputedStyle(el).display!=='none' && getComputedStyle(el).visibility!=='hidden'
      && getComputedStyle(el).opacity!=='0')
    .map(el=>{const r=el.getBoundingClientRect();
      return{x:r.left-base.left,y:r.top-base.top,w:r.width,h:r.height};});
}
function clearSpot(x,y,size,ob,w,h){
  if(x<7||y<6||x+size>w-7||y+size>h-7)return false;
  return !ob.some(b=>x<b.x+b.w+5&&x+size>b.x-5&&y<b.y+b.h+5&&y+size>b.y-5);
}
function randomSpot(s,ob,w,h){
  for(let tries=0;tries<90;tries++){
    const x=8+Math.random()*Math.max(0,w-s.size-16),y=8+Math.random()*Math.max(0,h-s.size-16);
    if(clearSpot(x,y,s.size,ob,w,h))return{x,y};
  }
  return null;
}
function render(){
  let all;
  try{all=items();}catch(e){notice('登録データを読み込めません');return;}
  layer.replaceChildren();sprites=[];
  const w=stage.clientWidth,h=stage.clientHeight,ob=obstacles();
  lastWidth=w;lastHeight=h;
  placed.forEach((id,i)=>{
    const rec=all.find(x=>x.id===id);if(!rec)return;
    const el=document.createElement('div');el.className='friend-sprite';
    const inner=document.createElement('div');inner.className='friend-inner';
    const img=new Image();img.src=rec.image;img.alt='';
    const effect=document.createElement('span');effect.className='friend-fx';
    inner.appendChild(img);el.append(inner,effect);layer.appendChild(el);
    const o={el,effect,size:Math.min(42,Math.max(26,w*.09)),x:10,y:10,
      vx:4+Math.random()*12,vy:4+Math.random()*12,turn:0,
      nextFx:performance.now()+800+i*440};
    el.style.width=el.style.height=o.size+'px';
    const p=randomSpot(o,ob,w,h);if(p){o.x=p.x;o.y=p.y;}
    else el.style.visibility='hidden';
    el.style.transform='translate3d('+o.x+'px,'+o.y+'px,0)';
    sprites.push(o);
  });
}
function tick(){
  if(!sprites.length)return;
  const now=performance.now();
  if(now-lastOptionsAt>1000){
    lastOptionsAt=now;
    try{options=JSON.parse(localStorage.getItem('iris_options_v1')||'{}')||{};}catch(e){options={};}
  }
  const still=options.move==='none'||document.hidden||matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.body.classList.toggle('friend-still',still);
  if(still||document.querySelector('.modal.flex')||!$('ttl').classList.contains('hidden'))return;
  const w=stage.clientWidth,h=stage.clientHeight;
  if(w!==lastWidth||h!==lastHeight){render();return;}
  const ob=obstacles();
  sprites.forEach(o=>{
    if(now>o.turn){o.vx=(Math.random()-.5)*29;o.vy=(Math.random()-.5)*29;o.turn=now+1500+Math.random()*2800;}
    if(!clearSpot(o.x,o.y,o.size,ob,w,h)){
      const p=randomSpot(o,ob,w,h);
      if(p){o.x=p.x;o.y=p.y;o.el.style.visibility='visible';}
      else {o.el.style.visibility='hidden';return;}
    }
    const nx=o.x+o.vx*.095,ny=o.y+o.vy*.095;
    if(clearSpot(nx,ny,o.size,ob,w,h)){o.x=nx;o.y=ny;}
    else{o.vx=-o.vx;o.vy=-o.vy;o.turn=now+450;}
    o.el.style.transform='translate3d('+o.x.toFixed(1)+'px,'+o.y.toFixed(1)+'px,0)';
    if(!document.body.classList.contains('nofx')&&now>o.nextFx){
      o.effect.textContent=['♥','✧','♪','！','？','z'][Math.floor(Math.random()*6)];
      o.effect.classList.remove('pop');void o.effect.offsetWidth;o.effect.classList.add('pop');
      o.nextFx=now+2400+Math.random()*5200;
    }
  });
}
function manager(){
  const parent=$('friends-list');parent.replaceChildren();
  let all;try{all=items();}catch(e){notice('登録データを読み込めません');return;}
  if(!all.length){
    const div=document.createElement('div');div.className='empty';
    div.textContent='まだ なかまが いません。写真や んちょを登録してね。';
    parent.appendChild(div);return;
  }
  all.slice().reverse().forEach(rec=>{
    const card=document.createElement('div');card.className='friend-card';
    const img=new Image();img.src=rec.image;img.alt='';
    const label=document.createElement('div');label.className='fname';label.textContent=rec.name;
    const sub=document.createElement('small');sub.textContent=rec.source==='yawaraka'?'YAWARAKA':rec.source==='ncho'?'んちょ':'写真';label.appendChild(sub);
    const controls=document.createElement('div');controls.className='controls';
    const active=placed.includes(rec.id);
    const add=document.createElement('button');add.type='button';add.textContent=active?'へやから外す':'へやに追加';
    add.onclick=()=>{
      if(active)placed=placed.filter(x=>x!==rec.id);
      else{
        if(placed.length>=MAX_ON_STAGE){notice('へやに だせるのは10人までです');return;}
        placed.push(rec.id);
      }
      try{savePlaced();render();manager();notice(active?'へやから外しました':'へやに追加しました');}
      catch(e){notice('配置を保存できませんでした');}
    };
    const del=document.createElement('button');del.type='button';del.className='remove';del.textContent='登録削除';
    del.onclick=()=>{
      if(!confirm('「'+rec.name+'」を登録から削除しますか？'))return;
      try{
        localStorage.setItem(GALLERY,JSON.stringify(items().filter(x=>x.id!==rec.id)));
        placed=placed.filter(x=>x!==rec.id);savePlaced();render();manager();notice('登録を削除しました');
      }catch(e){notice('登録を削除できませんでした');}
    };
    controls.append(add,del);card.append(img,label,controls);parent.appendChild(card);
  });
}
function openModal(){modal.classList.add('flex');manager();}
function closeModal(){modal.classList.remove('flex');crop.classList.add('hidden');photo=null;outline=[];drawing=false;}
function captureNcho(){
  const original=$('character-svg').querySelector('svg');
  if(!original){notice('まだ んちょが いません');return;}
  const svg=original.cloneNode(true);
  svg.setAttribute('xmlns','http://www.w3.org/2000/svg');
  svg.setAttribute('width','160');svg.setAttribute('height','160');
  const from=original.querySelectorAll('*'),to=svg.querySelectorAll('*');
  from.forEach((node,i)=>{if(node.classList.contains('grow'))to[i].style.display=getComputedStyle(node).display;});
  try{
    const xml=new XMLSerializer().serializeToString(svg);
    const name='んちょ '+(($('level-label')||{}).textContent||'');
    register({name,source:'ncho',image:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(xml)});
    manager();notice('いまの んちょを 登録しました');
  }catch(e){notice(e.message||'登録できませんでした');}
}
function drawPhoto(){
  ctx.clearRect(0,0,360,360);ctx.fillStyle='#eee9f4';ctx.fillRect(0,0,360,360);
  if(photo&&photoBox)ctx.drawImage(photo,photoBox.x,photoBox.y,photoBox.w,photoBox.h);
  if(outline.length){
    ctx.beginPath();outline.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
    if(!drawing&&outline.length>2){ctx.closePath();ctx.fillStyle='rgba(248,139,187,.22)';ctx.fill();}
    ctx.strokeStyle='#e0397c';ctx.lineWidth=3;ctx.lineJoin='round';ctx.lineCap='round';ctx.stroke();
  }
}
function pointer(e){
  const bounds=canvas.getBoundingClientRect(),r=photoBox;
  return{x:Math.min(r.x+r.w,Math.max(r.x,(e.clientX-bounds.left)*360/bounds.width)),
    y:Math.min(r.y+r.h,Math.max(r.y,(e.clientY-bounds.top)*360/bounds.height))};
}
function loadPhoto(file){
  if(!file)return;
  if(!file.type.startsWith('image/')||file.size>12*1024*1024){notice('12MB以下の写真をえらんでね');return;}
  const url=URL.createObjectURL(file),img=new Image();
  img.onload=()=>{
    URL.revokeObjectURL(url);photo=img;outline=[];drawing=false;
    const scale=Math.min(360/img.width,360/img.height),w=img.width*scale,h=img.height*scale;
    photoBox={x:(360-w)/2,y:(360-h)/2,w,h};
    $('friend-photo-name').value=file.name.replace(/\.[^.]+$/,'').slice(0,24)||'しゃしんの子';
    crop.classList.remove('hidden');drawPhoto();notice('輪郭を ゆびで ぐるっと かこんでね');
  };
  img.onerror=()=>{URL.revokeObjectURL(url);notice('この写真は読めませんでした');};
  img.src=url;
}
function saveCrop(){
  if(!photo||outline.length<6){notice('写真の輪郭を なぞってね');return;}
  const xs=outline.map(p=>p.x),ys=outline.map(p=>p.y);
  const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
  if(x1-x0<12||y1-y0<12){notice('もう少し 大きくかこんでね');return;}
  const output=document.createElement('canvas');output.width=output.height=320;
  const oc=output.getContext('2d'),scale=280/Math.max(x1-x0,y1-y0);
  oc.translate((320-(x1-x0)*scale)/2,(320-(y1-y0)*scale)/2);
  oc.scale(scale,scale);oc.translate(-x0,-y0);
  oc.beginPath();outline.forEach((p,i)=>i?oc.lineTo(p.x,p.y):oc.moveTo(p.x,p.y));
  oc.closePath();oc.clip();oc.drawImage(photo,photoBox.x,photoBox.y,photoBox.w,photoBox.h);
  try{
    register({name:$('friend-photo-name').value,source:'photo',image:output.toDataURL('image/webp',.84)});
    crop.classList.add('hidden');photo=null;outline=[];
    manager();notice('写真から なかまを 登録しました');
  }catch(e){notice(e.message||'写真を保存できませんでした');}
}
function init(){
  stage=$('character-stage');
  if(!stage)return;
  const style=document.createElement('style');style.textContent="\n@media(max-width:430px){#btn-open-wordbook>span:not(.num){display:none}#btn-open-wordbook{padding:6px 8px 7px}}\n@media(max-width:370px){.logo h1{font-size:16px}.logo small{display:none}#btn-open-characters{padding:5px 7px;font-size:11px}#btn-open-wordbook{padding:5px 6px}}\n#friend-layer{position:absolute;inset:0;overflow:hidden;z-index:2;pointer-events:none}\n.friend-sprite{position:absolute;left:0;top:0;pointer-events:none;user-select:none;will-change:transform;transition:transform .095s linear}\n.friend-inner{width:100%;height:100%;transform-origin:50% 90%;animation:friendWiggle 2.8s ease-in-out infinite}\n.friend-sprite:nth-child(3n) .friend-inner{animation:friendBounce 1.9s ease-in-out infinite}\n.friend-sprite:nth-child(3n+1) .friend-inner{animation:friendWiggle 3.4s ease-in-out -.8s infinite}\n.friend-inner img{display:block;width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 2px 2px rgba(54,45,67,.22))}\n.friend-fx{position:absolute;top:-12px;right:-10px;font-size:19px;line-height:1;color:#e96b98;opacity:0;text-shadow:0 1px 2px #fff}\n.friend-fx.pop{animation:friendFx 1.4s ease-out forwards}\n@keyframes friendWiggle{0%,100%{transform:rotate(-7deg) translateY(0)}50%{transform:rotate(7deg) translateY(-5px)}}\n@keyframes friendBounce{0%,100%{transform:translateY(0) scale(1)}30%{transform:translateY(-9px) scale(.96,1.06)}70%{transform:translateY(0) scale(1.05,.94)}}\n@keyframes friendFx{0%{opacity:0;transform:translateY(6px) scale(.5)}20%{opacity:1}75%{opacity:1}100%{opacity:0;transform:translateY(-24px) scale(1.1)}}\nbody.nofx .friend-fx{display:none}\nbody.friend-still .friend-inner,body.friend-still .friend-fx{animation:none!important}\nbody.friend-still .friend-sprite{transition:none}\n@media(prefers-reduced-motion:reduce){.friend-inner,.friend-fx{animation:none!important}.friend-sprite{transition:none}}\n#friends-modal .sheet{max-height:90dvh}\n#friend-actions{padding:12px 16px;display:flex;flex-wrap:wrap;align-items:center;gap:8px;border-bottom:2px solid var(--line)}\n#friend-actions .btn-s{display:inline-flex;align-items:center;justify-content:center;min-height:38px}\n#friend-actions input[type=file]{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}\n#friends-message{font-size:12px;font-weight:700;color:var(--ink2);padding:2px 16px 8px;min-height:18px}\n#friends-list{overflow-y:auto;flex:1;min-height:50px;padding:10px 16px;background:#faf7ff}\n.friend-card{display:flex;align-items:center;gap:9px;background:#fff;border-radius:15px;padding:8px;margin-bottom:8px;box-shadow:0 2px 0 var(--line)}\n.friend-card img{width:54px;height:54px;object-fit:contain;flex:none;background:var(--mintS);border-radius:12px}\n.friend-card .fname{flex:1;min-width:0;font-weight:800;font-size:12px;overflow-wrap:anywhere}\n.friend-card .fname small{display:block;color:var(--ink2);font-size:10px}\n.friend-card .controls{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end}\n.friend-card .controls button{padding:6px 9px;font-weight:800;font-size:11px;border:0;border-radius:10px;background:var(--lavS);color:var(--lavD)}\n.friend-card .controls .remove{background:var(--pinkS);color:var(--pinkD)}\n#friend-crop{padding:10px 16px;display:flex;flex-direction:column;align-items:center;gap:8px;background:#fff}\n#friend-crop.hidden{display:none}\n#friend-crop p{font-size:12px;margin:0;color:var(--ink2);font-weight:700;text-align:center}\n#friend-crop-canvas{display:block;width:min(100%,360px);aspect-ratio:1;background:#e9e5ee;border-radius:12px;touch-action:none;cursor:crosshair}\n#friend-crop .crop-buttons{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}\n#friend-crop label{font-size:12px;color:var(--ink2);font-weight:800}\n#friend-photo-name{max-width:160px;border:2px solid var(--line);border-radius:10px;padding:5px 8px}\n";
  document.head.appendChild(style);
  layer=document.createElement('div');layer.id='friend-layer';layer.setAttribute('aria-hidden','true');
  stage.insertBefore(layer,stage.querySelector('.status'));
  const button=document.createElement('button');
  button.id='btn-open-characters';button.type='button';button.className='chip-btn';
  button.textContent='なかま';button.setAttribute('aria-label','なかまを管理する');
  const hbtns=document.querySelector('.hbtns');hbtns.insertBefore(button,$('btn-open-wordbook'));
  modal=document.createElement('div');modal.id='friends-modal';modal.className='modal';
  modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');
  modal.setAttribute('aria-labelledby','friends-title');
  modal.innerHTML="\n<div class=\"sheet\">\n  <div class=\"sheet-head\">\n    <div><h2 id=\"friends-title\">なかまの かんり</h2><p class=\"sub\">とうろくした子を へやに追加・削除できるよ</p></div>\n    <button id=\"btn-close-friends\" class=\"x\" type=\"button\" aria-label=\"とじる\">×</button>\n  </div>\n  <div id=\"friend-actions\">\n    <button class=\"btn-s main\" id=\"friend-register-ncho\" type=\"button\">いまの んちょを登録</button>\n    <label class=\"btn-s main\" for=\"friend-photo-input\">写真からつくる<input id=\"friend-photo-input\" type=\"file\" accept=\"image/*\"></label>\n  </div>\n  <div id=\"friends-message\" role=\"status\">YAWARAKAから登録した子も ここに ならぶよ</div>\n  <div id=\"friend-crop\" class=\"hidden\">\n    <p>のこしたいところを ゆびやマウスで なぞって かこもう</p>\n    <canvas id=\"friend-crop-canvas\" width=\"360\" height=\"360\" aria-label=\"切り抜き範囲を描く\"></canvas>\n    <label>なまえ <input id=\"friend-photo-name\" type=\"text\" maxlength=\"24\" value=\"しゃしんの子\"></label>\n    <div class=\"crop-buttons\">\n      <button id=\"friend-redraw\" class=\"btn-s\" type=\"button\">なぞりなおす</button>\n      <button id=\"friend-crop-save\" class=\"btn-s main\" type=\"button\">切り抜いて登録</button>\n      <button id=\"friend-crop-cancel\" class=\"btn-s\" type=\"button\">やめる</button>\n    </div>\n  </div>\n  <div id=\"friends-list\" aria-live=\"polite\"></div>\n  <div class=\"sheet-foot\"><span>このブラウザに保存・登録24人／表示10人まで</span>\n    <button id=\"btn-close-friends-bottom\" class=\"btn-s main\" type=\"button\">とじる</button>\n  </div>\n</div>\n";
  document.body.appendChild(modal);
  crop=$('friend-crop');canvas=$('friend-crop-canvas');ctx=canvas.getContext('2d');
  button.onclick=openModal;$('btn-close-friends').onclick=closeModal;
  $('btn-close-friends-bottom').onclick=closeModal;
  modal.addEventListener('click',e=>{if(e.target===modal)closeModal();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&modal.classList.contains('flex'))closeModal();});
  $('friend-register-ncho').onclick=captureNcho;
  const file=$('friend-photo-input');
  file.addEventListener('change',()=>{loadPhoto(file.files[0]);file.value='';});
  canvas.addEventListener('pointerdown',e=>{
    if(!photo)return;e.preventDefault();drawing=true;outline=[pointer(e)];
    canvas.setPointerCapture(e.pointerId);drawPhoto();
  });
  canvas.addEventListener('pointermove',e=>{
    if(!drawing)return;e.preventDefault();const p=pointer(e),last=outline[outline.length-1];
    if(Math.hypot(p.x-last.x,p.y-last.y)>2){outline.push(p);drawPhoto();}
  });
  const release=e=>{if(!drawing)return;e.preventDefault();drawing=false;drawPhoto();};
  canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',release);
  $('friend-redraw').onclick=()=>{outline=[];drawPhoto();};
  $('friend-crop-save').onclick=saveCrop;
  $('friend-crop-cancel').onclick=()=>{crop.classList.add('hidden');photo=null;outline=[];};
  window.addEventListener('storage',e=>{
    if(e.key===GALLERY||e.key===PLACED){
      if(e.key===PLACED)readPlaced();render();if(modal.classList.contains('flex'))manager();
    }
  });
  window.addEventListener('resize',render);
  readPlaced();render();setInterval(tick,95);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
else if(document.readyState==='interactive')document.addEventListener('DOMContentLoaded',init,{once:true});
else init();
})();