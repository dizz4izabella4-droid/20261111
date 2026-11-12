/* ================= 凍結の演出（画面がパリッと凍る） ================= */
const ice=(function(){
  const cv=document.createElement('canvas');cv.id='ice';
  cv.style.cssText='position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;display:none';
  const fr=document.createElement('div');fr.id='frost';
  fr.style.cssText='position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;opacity:0;background:radial-gradient(ellipse at 50% 50%,rgba(200,235,255,0) 38%,rgba(190,228,255,.34) 74%,rgba(235,247,255,.78) 100%)';
  canvas.parentNode.insertBefore(cv,canvas.nextSibling);canvas.parentNode.insertBefore(fr,cv);
  const cx=cv.getContext('2d');
  let segs=[],drawn=0,t=0,on=false,lastOp=-1;
  function gen(){
    const W=window.innerWidth,H=window.innerHeight;
    const dpr=Math.min(window.devicePixelRatio||1,2);
    cv.width=Math.round(W*dpr);cv.height=Math.round(H*dpr);cx.setTransform(dpr,0,0,dpr,0,0);cx.clearRect(0,0,W,H);
    segs=[];drawn=0;t=0;
    const ox=W*(0.35+0.3*Math.random()),oy=H*(0.3+0.3*Math.random());
    const maxD=Math.hypot(W,H);
    function ray(x,y,a,len,w,gen_){
      let d=0,px=x,py=y;
      while(d<len){
        const st=22+Math.random()*40;
        a+=(Math.random()-0.5)*0.5;
        const nx=px+Math.cos(a)*st,ny=py+Math.sin(a)*st;
        segs.push({x0:px,y0:py,x1:nx,y1:ny,w:w,t:Math.hypot(nx-ox,ny-oy)/maxD*0.5+gen_*0.05});
        if(Math.random()<0.22&&w>0.8)ray(nx,ny,a+(Math.random()<0.5?-1:1)*(0.5+Math.random()*0.7),len*0.35*(0.5+Math.random()),w*0.6,gen_+1);
        px=nx;py=ny;d+=st;
      }
    }
    const N=16;for(let i=0;i<N;i++)ray(ox,oy,i/N*Math.PI*2+Math.random()*0.3,maxD*(0.45+0.4*Math.random()),2.6,0);
    // 縁から育つ霜の結晶
    for(let i=0;i<150;i++){
      const side=Math.floor(Math.random()*4);let x,y,a;
      if(side===0){x=Math.random()*W;y=0;a=Math.PI/2;}else if(side===1){x=Math.random()*W;y=H;a=-Math.PI/2;}else if(side===2){x=0;y=Math.random()*H;a=0;}else{x=W;y=Math.random()*H;a=Math.PI;}
      const before=segs.length;ray(x,y,a+(Math.random()-0.5)*0.8,25+Math.random()*130,1.6,1);
      const dly=0.15+Math.random()*0.65;for(let k=before;k<segs.length;k++)segs[k].t=dly+(k-before)*0.012;
    }
    segs.sort((p,q)=>p.t-q.t);
  }
  function start(){gen();on=true;cv.style.display='block';cv.style.opacity=1;fr.style.opacity=1;}
  function clear(){on=false;cv.style.display='none';try{cx.clearRect(0,0,cv.width,cv.height);}catch(_){}segs=[];fr.style.opacity=0;lastOp=-1;}
  function update(dt,frost){
    if(!on){const o=Math.round(clamp(frost*0.9,0,0.9)*50)/50;if(o!==lastOp){fr.style.opacity=o;lastOp=o;}return;}
    t+=dt;
    cx.lineCap='round';
    while(drawn<segs.length&&segs[drawn].t<=t){
      const s=segs[drawn++];
      cx.strokeStyle='rgba(140,200,240,.55)';cx.lineWidth=s.w+2.2;cx.beginPath();cx.moveTo(s.x0,s.y0);cx.lineTo(s.x1,s.y1);cx.stroke();
      cx.strokeStyle='rgba(255,255,255,.95)';cx.lineWidth=s.w;cx.beginPath();cx.moveTo(s.x0,s.y0);cx.lineTo(s.x1,s.y1);cx.stroke();
    }
    lastOp=-1;fr.style.opacity=1;
  }
  return {start:start,clear:clear,update:update};
})();
