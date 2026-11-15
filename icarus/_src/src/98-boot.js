/* ================= 起動 ================= */
resize();
wings.setLayout(view.cw/view.ch);
window.addEventListener('resize',()=>wings.setLayout(view.cw/view.ch));
toTitle();
G.fade=1;
// ボタン
function uiBtn(id,fn){const e=document.getElementById(id);e.addEventListener('pointerdown',ev=>ev.stopPropagation());e.addEventListener('click',ev=>{ev.stopPropagation();fn();});}
uiBtn('bAuto',startAuto);
uiBtn('bMan',()=>startManual(false));
uiBtn('mode',()=>{audio.init();if(G.mode==='auto')startManual(true);else if(G.mode==='manual'){G.fadeTarget=0;toTitle();}});
// iOS：ダブルタップ拡大・ピンチ拡大を止める／全画面・向き
(function(){
  let lastTap=0;
  document.addEventListener('touchend',e=>{const n=Date.now();if(n-lastTap<320)e.preventDefault();lastTap=n;},{passive:false});
  ['gesturestart','gesturechange','gestureend'].forEach(t=>document.addEventListener(t,e=>e.preventDefault()));
  document.addEventListener('dblclick',e=>e.preventDefault());
  const de=document.documentElement;
  uiBtn('fs',()=>{
    try{
      if(document.fullscreenElement||document.webkitFullscreenElement){(document.exitFullscreen||document.webkitExitFullscreen).call(document);}
      else{const f=de.requestFullscreen||de.webkitRequestFullscreen;if(f)f.call(de);}
    }catch(_){}
  });
  let ori=0; // 0 自動 / 1 縦 / 2 横
  const labels=['向き：自動','向き：縦','向き：横'];
  const ob=document.getElementById('ori');ob.textContent=labels[0];
  uiBtn('ori',()=>{
    ori=(ori+1)%3;ob.textContent=labels[ori];
    try{
      if(ori===0){screen.orientation.unlock();}
      else{
        const lock=()=>screen.orientation.lock(ori===1?'portrait':'landscape').catch(()=>{});
        if(!document.fullscreenElement&&!document.webkitFullscreenElement&&de.requestFullscreen){de.requestFullscreen().then(lock).catch(lock);}else lock();
      }
    }catch(_){}
  });
})();
// 検証・デバッグ用
window.__icarus={G:G,b:b,KF:KF,U:U,P:P,ISL:ISL,RING:RING,pathAt:pathAt,DY:DY,PS:PS,
  jump:function(ft){G.mode='auto';G.ft=ft;G.camInit=false;G.afi=AF.findIndex(x=>x>ft);if(G.afi<0)G.afi=AF.length;G.endFired=false;el.title.classList.remove('on');G.fade=0;cityI=1e9;},
  startAuto:startAuto,startManual:startManual,
  collideAt:function(x,y,z,m){const ci=Math.round(x/BP),cj=Math.round(z/BP);let hit=0;
    for(let di=-1;di<=1;di++)for(let dj=-1;dj<=1;dj++){const n=blockInfo(ci+di,cj+dj);for(let k=0;k<n;k++){const o=k*8,fl=sbuf[k*4+3];const by0=bbuf[o+1],by1=bbuf[o+4];const yb=by0<=0?-8:by0;const top=(fl>1.5&&fl<2.5)?by1-10:by1;
      if(y<yb-m||y>top+m)continue;const ly=clamp((y-yb)/(by1-yb),0,1);const px=x-bbuf[o+6]*ly,pz=z-bbuf[o+7]*ly;
      if(px>bbuf[o]-m&&px<bbuf[o+3]+m&&pz>bbuf[o+2]-m&&pz<bbuf[o+5]+m)hit=1;}}
    for(const I of ISL){const ry=(I.H+0.07*I.R)/2,cy=I.y+0.07*I.R-ry;const dx=x-I.x,dz=z-I.z,dy=y-cy;const rx=I.R+m,ry2=ry+m;if((dx*dx+dz*dz)/(rx*rx)+dy*dy/(ry2*ry2)<1)hit=2;}
    return hit;}
};
requestAnimationFrame(frame);
