/* ================= 入力（タッチ・マウス・キーボード） ================= */
const inp={sx:0,sy:0,flapReq:false,hold:false,touch:false,seenMove:false,keys:{},mx:0,my:0,mouseActive:false,gesture:0,steerUsed:false,flapUsed:false,wantStart:false};
(function(){
  const cv=canvas;
  let prim=-1,ax=0,ay=0,t0=0,moved=0,holdT=0;
  const radius=()=>Math.max(70,Math.min(130,Math.min(view.cw,view.ch)*0.16));
  cv.addEventListener('pointerdown',e=>{
    e.preventDefault();
    try{cv.setPointerCapture(e.pointerId)}catch(_){}
    audio.init();
    inp.gesture++;
    if(e.pointerType==='mouse'){inp.hold=true;inp.flapReq=true;inp.mouseActive=true;inp.mx=e.clientX;inp.my=e.clientY;return;}
    inp.touch=true;
    if(prim<0){prim=e.pointerId;ax=e.clientX;ay=e.clientY;t0=performance.now();moved=0;holdT=0;inp.sx=0;inp.sy=0;}
    else{inp.flapReq=true;}
  },{passive:false});
  cv.addEventListener('pointermove',e=>{
    if(e.pointerType==='mouse'){inp.mouseActive=true;inp.mx=e.clientX;inp.my=e.clientY;return;}
    if(e.pointerId!==prim)return;
    const R=radius();
    const dx=e.clientX-ax,dy=e.clientY-ay;
    moved=Math.max(moved,Math.hypot(dx,dy));
    // 起点がドラッグに追従する（遠くまで引っ張られても操作しやすい）
    const d=Math.hypot(dx,dy);
    if(d>R*1.4){const k=(d-R*1.4)/d;ax+=dx*k;ay+=dy*k;}
    inp.sx=clamp((e.clientX-ax)/R,-1,1);inp.sy=clamp(-(e.clientY-ay)/R,-1,1);
  });
  function up(e){
    if(e.pointerType==='mouse'){inp.hold=false;return;}
    if(e.pointerId!==prim)return;
    const dt=performance.now()-t0;
    if(dt<260&&moved<14)inp.flapReq=true;
    prim=-1;inp.sx=0;inp.sy=0;inp.hold=false;
  }
  cv.addEventListener('pointerup',up);cv.addEventListener('pointercancel',up);
  cv.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse')inp.mouseActive=false;});
  cv.addEventListener('contextmenu',e=>e.preventDefault());
  window.addEventListener('keydown',e=>{
    const k=e.code;
    if(k==='Space'||k==='Enter'){e.preventDefault();audio.init();inp.hold=true;inp.flapReq=true;inp.gesture++;}
    inp.keys[k]=true;
    if(k.indexOf('Arrow')===0)e.preventDefault();
  });
  window.addEventListener('keyup',e=>{inp.keys[e.code]=false;if(e.code==='Space'||e.code==='Enter')inp.hold=false;});
  // 指を置きっぱなしで羽ばたきを続ける
  inp.poll=function(dt){
    if(prim>=0){
      if(moved<14){holdT+=dt;if(holdT>0.42){inp.hold=true;}}
    }
    let sx=inp.sx,sy=inp.sy;
    if(!inp.touch||prim<0){
      if(inp.mouseActive&&!inp.touch){
        const nx=(inp.mx/view.cw-0.5)*2,ny=-(inp.my/view.ch-0.5)*2;
        const dz=0.06;
        sx=Math.abs(nx)<dz?0:clamp((nx-Math.sign(nx)*dz)*1.5,-1,1);
        sy=Math.abs(ny)<dz?0:clamp((ny-Math.sign(ny)*dz)*1.5,-1,1);
      }
    }
    const K=inp.keys;
    const kx=(K.ArrowRight||K.KeyD?1:0)-(K.ArrowLeft||K.KeyA?1:0);
    const ky=(K.ArrowUp||K.KeyW?1:0)-(K.ArrowDown||K.KeyS?1:0);
    if(kx||ky){sx=clamp(sx+kx,-1,1);sy=clamp(sy+ky,-1,1);}
    return {sx:sx,sy:sy};
  };
})();
document.getElementById('snd').addEventListener('click',e=>{e.stopPropagation();audio.init();audio.setOn(!audio.on);});
document.getElementById('snd').addEventListener('pointerdown',e=>e.stopPropagation());
document.addEventListener('visibilitychange',()=>{try{if(document.hidden)audio.suspend();else audio.resume();}catch(_){}});
