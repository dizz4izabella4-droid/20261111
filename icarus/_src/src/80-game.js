/* ================= 映像（5分）と飛行 ================= */
const FILM_LEN=300;
const START={x:0,y:190,z:-12};
const coarse=window.matchMedia&&window.matchMedia('(pointer:coarse)').matches;
const el={title:$('title'),hint:$('hint'),mode:$('mode'),prog:$('prog')};
const G={mode:'title',t:0,modeT:0,ft:12,mt:0,fade:1,fadeTarget:0,fadeSpeed:0.55,pulse:0,camInit:false,afi:0,hintT:0,shake:0,endFired:false,mist:0};
const b={x:START.x,y:START.y,z:START.z,yaw:0,pitch:-0.04,roll:0,speed:0,vx:0,vy:0,vz:-1,yawRate:0,pitchRate:0,boost:0,flapCD:0,load:0};
const _v=new T.Vector3(),_w=new T.Vector3(),_e=new T.Euler(0,0,0,'YXZ');
const FADE_WARM=[0.97,0.92,0.82],FADE_DARK=[0.015,0.022,0.065];

/* ---------- 時刻ごとの空・光（キーフレーム） ----------
   t, 天頂, 地平, 中間, 太陽色, 太陽高度, 太陽方位, 霧, 明るさ, 星, 窓の灯, 露出, ブルーム, 光芒, 光の梯子, 花びら, 画角, 光の粒 */
const KFR=[
  [0,  0x0a1640,0xd88a78,0x55689f,0xff9a68, 0.015,-0.25,0.0013,0.10,0.30,0.00, 0.95,0.50,0.35, 0.00,0.00,72,0.5],
  [30, 0x2854a0,0xb9d9f5,0x87aee2,0xffd6aa, 0.100,-0.22,0.0010,0.22,0.00,0.30, 1.00,0.52,0.40, 0.00,0.00,74,0.8],
  [60, 0x1a68dc,0xa8d8fb,0x6eaef2,0xffe6c9, 0.260,-0.15,0.00060,0.40,0.00,0.15, 0.98,0.46,0.40, 0.10,0.00,76,1.0],
  [100,0x0a5cdc,0xa6d6fa,0x62a8f0,0xfff0dc, 0.400,-0.10,0.00038,0.60,0.00,0.00, 0.92,0.40,0.34, 0.20,0.00,78,1.0],
  [130,0x1260d8,0xaadcfb,0x72b2f2,0xfff5e7, 0.340,-0.20,0.00034,0.70,0.00,0.00, 0.94,0.44,0.45, 0.55,0.10,76,1.0],
  [180,0x4969b5,0xe1ccaa,0xb1caeb,0xffdcae, 0.180,-0.20,0.0005,0.55,0.00,0.00, 0.98,0.62,0.75, 0.90,0.85,72,1.2],
  [215,0x2a3a88,0xff9a5a,0xd88aa8,0xff9050, 0.075,-0.10,0.0005,0.35,0.00,0.40, 0.95,0.68,0.70, 0.60,0.65,70,1.0],
  [245,0x161e5a,0xff6a62,0x8a5a9a,0xff7a52, 0.012, 0.10,0.0005,0.22,0.35,0.80, 0.95,0.60,0.50, 0.25,0.75,72,0.8],
  [275,0x0a1038,0x7a4a8a,0x35306c,0xff6a58,-0.080, 0.20,0.0005,0.12,0.90,1.00, 1.00,0.50,0.25, 0.00,0.90,74,0.6],
  [300,0x050824,0x2e2e68,0x1a1e50,0xff6a58,-0.160, 0.20,0.0005,0.08,1.00,1.00, 1.00,0.45,0.20, 0.00,0.50,76,0.5]
];
const NUMK=['elev','az','fog','lit','star','lamp','expo','bloom','ray','shaft','petal','fov','mote'];
const KF=KFR.map(r=>{const o={t:r[0],zen:new T.Color(r[1]),hor:new T.Color(r[2]),mid:new T.Color(r[3]),sun:new T.Color(r[4])};NUMK.forEach((k,i)=>o[k]=r[5+i]);return o;});
const KS={zen:new T.Color(),hor:new T.Color(),mid:new T.Color(),sun:new T.Color()};
function sampleKF(ft){
  let i=0;while(i<KF.length-2&&ft>=KF[i+1].t)i++;
  const A=KF[i],B=KF[i+1],u=sstep(A.t,B.t,ft);
  KS.zen.lerpColors(A.zen,B.zen,u);KS.hor.lerpColors(A.hor,B.hor,u);KS.mid.lerpColors(A.mid,B.mid,u);KS.sun.lerpColors(A.sun,B.sun,u);
  for(const k of NUMK)KS[k]=lerp(A[k],B[k],u);
}

/* ---------- 飛行ルート（時刻つきの通過点をなめらかにつなぐ） ---------- */
const KEYS=[
  [0,0,190,-12],[8,0,188,-70],[20,-10,172,-250],[34,-48,120,-560],[44,-50,62,-790],[60,-50,42,-1130],[75,-50,40,-1460],[88,-40,88,-1760],
  [100,20,230,-1990],[108,70,330,-2160],[118,100,450,-2340],[135,140,560,-2580],[150,150,610,-2800],
  [165,220,640,-3020],[180,120,690,-3260],[195,-20,730,-3480],[207,60,735,-3660],[215,100,732,-3790],
  [232,60,690,-4080],[250,-60,610,-4380],[268,-170,530,-4660],[285,-230,520,-4900],[300,-250,560,-5120]
];
const KM=KEYS.map((k,i)=>{
  if(i===0)return [0,0,0];
  const a=KEYS[Math.max(0,i-1)],c=KEYS[Math.min(KEYS.length-1,i+1)],dt=c[0]-a[0];
  return [(c[1]-a[1])/dt,(c[2]-a[2])/dt,(c[3]-a[3])/dt];
});
const _hp={x:0,y:0,z:0};
function hermite(t){
  t=clamp(t,0,FILM_LEN);
  let i=0;while(i<KEYS.length-2&&t>=KEYS[i+1][0])i++;
  const A=KEYS[i],B=KEYS[i+1],dt=B[0]-A[0],s=(t-A[0])/dt,s2=s*s,s3=s2*s;
  const h00=2*s3-3*s2+1,h10=s3-2*s2+s,h01=-2*s3+3*s2,h11=s3-s2;
  _hp.x=h00*A[1]+h10*dt*KM[i][0]+h01*B[1]+h11*dt*KM[i+1][0];
  _hp.y=h00*A[2]+h10*dt*KM[i][1]+h01*B[2]+h11*dt*KM[i+1][1];
  _hp.z=h00*A[3]+h10*dt*KM[i][2]+h01*B[3]+h11*dt*KM[i+1][2];
  return _hp;
}
/* 街の屋根の高さ（ルート上のビルより必ず高く飛ぶための下限を求める） */
function topNear(x,z,m){
  let top=0;
  const ci=Math.round(x/BP),cj=Math.round(z/BP);
  for(let di=-1;di<=1;di++)for(let dj=-1;dj<=1;dj++){
    const n=blockInfo(ci+di,cj+dj);
    for(let k=0;k<n;k++){
      const o=k*8,shx=bbuf[o+6],shz=bbuf[o+7];
      const x0=Math.min(bbuf[o],bbuf[o]+shx)-m,x1=Math.max(bbuf[o+3],bbuf[o+3]+shx)+m;
      const z0=Math.min(bbuf[o+2],bbuf[o+2]+shz)-m,z1=Math.max(bbuf[o+5],bbuf[o+5]+shz)+m;
      if(x>x0&&x<x1&&z>z0&&z<z1)top=Math.max(top,bbuf[o+4]);
    }
  }
  return top;
}
const PS=0.25,NS=Math.round(FILM_LEN/PS)+1;
const DY=new Float32Array(NS);
(function buildClearance(){
  const sy=new Float32Array(NS),req=new Float32Array(NS);
  for(let k=0;k<NS;k++){
    const t=k*PS,h=hermite(t);sy[k]=h.y;
    const need=t<9?0:topNear(h.x,h.z,9)+14;
    req[k]=Math.max(h.y,need,12);
  }
  const W=Math.round(5/PS),dil=new Float32Array(NS);
  for(let k=0;k<NS;k++){let m=0;for(let j=Math.max(0,k-W);j<=Math.min(NS-1,k+W);j++)m=Math.max(m,req[j]);dil[k]=m;}
  const HW=Math.round(4/PS),ker=[];let ks=0;
  for(let j=-HW;j<=HW;j++){const w=Math.exp(-(j*PS)*(j*PS)/(2*1.8*1.8));ker.push(w);ks+=w;}
  for(let k=0;k<NS;k++){
    let a=0;
    for(let j=-HW;j<=HW;j++)a+=dil[Math.min(NS-1,Math.max(0,k+j))]*ker[j+HW];
    a/=ks;
    DY[k]=Math.max(0,a-sy[k])*sstep(5,10,k*PS);
  }
})();
const _pp={x:0,y:0,z:0};
function pathAt(t){
  const h=hermite(t);
  const f=clamp(t,0,FILM_LEN)/PS,k=Math.min(NS-2,Math.floor(f)),u=f-k;
  _pp.x=h.x;_pp.z=h.z;_pp.y=h.y+DY[k]*(1-u)+DY[k+1]*u;
  return _pp;
}

/* ---------- カメラワーク（景色へ顔を向ける） ---------- */
// [t0,t1,なめらかさ,上下,左右]　または　[t0,t1,なめらかさ,x,y,z,強さ]（'sun'で太陽）
const LOOKS=[
  [6,26,6,'sun',0,0,0.55],
  [46,62,5,0.26,-0.22],
  [66,82,5,-0.08,0.30],
  [112,136,5,-0.42,0.0],
  [158,176,5,360,610,-2900,0.7],
  [180,205,6,-330,830,-3420,0.8],
  [232,262,6,'sun',0,0,0.5],
  [272,300,6,0.32,0.0]
];
const AF=[2.5,19,40,63,86,97,103,109,115,121,145,172,198,224,258,283]; // 羽ばたく時刻（少なめ・ゆったり）
let cyaw=0,cpitch=0,pYaw=0,yawRateS=0;
function autoPose(dt){
  const ft=G.ft;
  const p0=pathAt(ft),px0=p0.x,py0=p0.y,pz0=p0.z;
  b.x=px0;b.y=py0;b.z=pz0;
  const a=pathAt(ft+0.6),ax=a.x,ay=a.y,az=a.z;
  const c=pathAt(ft+2.4);
  const dx=c.x-ax,dy=c.y-ay,dz=c.z-az;
  const hy=Math.atan2(-dx,-dz),hp=Math.atan2(dy,Math.hypot(dx,dz))*0.85;
  const sp=Math.hypot(c.x-px0,c.y-py0,c.z-pz0)/2.4;
  if(!G.camInit){cyaw=hy;cpitch=hp;pYaw=cyaw;G.camInit=true;}
  const k=1-Math.exp(-dt*1.4);
  cyaw+=wrapAng(hy-cyaw)*k;cpitch+=(hp-cpitch)*k;
  let oy=0,op=0;
  for(const L of LOOKS){
    const env=sstep(L[0],L[0]+L[2],ft)*(1-sstep(L[1]-L[2],L[1],ft));
    if(env<=0)continue;
    if(L.length===5){op+=L[3]*env;oy+=L[4]*env;continue;}
    let tx=L[3],ty=L[4],tz=L[5];
    if(tx==='sun'){const sd=U.uSunDir.value;tx=b.x+sd.x*1000;ty=b.y+sd.y*1000;tz=b.z+sd.z*1000;}
    const ddx=tx-b.x,ddy=ty-b.y,ddz=tz-b.z;
    const wy=Math.atan2(-ddx,-ddz),wp=Math.atan2(ddy,Math.hypot(ddx,ddz));
    oy+=wrapAng(wy-cyaw)*L[6]*env;op+=(wp-cpitch)*L[6]*env;
  }
  const yr=dt>0?wrapAng(cyaw-pYaw)/dt:0;pYaw=cyaw;
  yawRateS+=(yr-yawRateS)*(1-Math.exp(-dt*2.0));
  b.yawRate=yawRateS;
  const roll=clamp(-yawRateS*1.5,-0.5,0.5)+0.018*Math.sin(G.t*0.45);
  b.roll+=(roll-b.roll)*(1-Math.exp(-dt*2.5));
  b.yaw=cyaw+oy;
  b.pitch=cpitch+op+0.012*Math.sin(G.t*0.6+1.0);
  b.speed=sp;
  b.load+=(clamp(Math.max(0,dy/Math.max(1,Math.hypot(dx,dz)))*1.4,0,0.9)-b.load)*(1-Math.exp(-dt*1.2));
  // ゆったりした羽ばたき
  while(G.afi<AF.length&&ft>=AF[G.afi]){if(ft-AF[G.afi]<1.5){wings.flap(0.85);audio.flap(0.8);}G.afi++;}
}

/* ---------- マニュアル：押さなくても滑空、押すとぐっと上昇 ---------- */
const CR=1.7;
function collide(dt){
  let impact=0;
  if(b.y<3.5){b.y=3.5;if(b.pitch<0)b.pitch*=0.4;}
  const ci=Math.round(b.x/BP),cj=Math.round(b.z/BP);
  for(let di=-1;di<=1;di++)for(let dj=-1;dj<=1;dj++){
    const n=blockInfo(ci+di,cj+dj);
    for(let k=0;k<n;k++){
      const o=k*8,fl=sbuf[k*4+3];
      const by0=bbuf[o+1],by1=bbuf[o+4];
      const yb=by0<=0?-8:by0;
      const top=(fl>1.5&&fl<2.5)?by1-10:by1;
      if(b.y<yb-CR||b.y>top+CR)continue;
      const ly=clamp((b.y-yb)/(by1-yb),0,1);
      const px=b.x-bbuf[o+6]*ly,pz=b.z-bbuf[o+7]*ly;
      const x0=bbuf[o]-CR,y0=by0-(by0>0?CR:0),z0=bbuf[o+2]-CR,x1=bbuf[o+3]+CR,y1=top+CR,z1=bbuf[o+5]+CR;
      if(px>x0&&px<x1&&b.y>y0&&b.y<y1&&pz>z0&&pz<z1){
        let dm=1e9,ax=0,ay=0,az=0;
        let d=px-x0;if(d<dm){dm=d;ax=-1;ay=0;az=0;}
        d=x1-px;if(d<dm){dm=d;ax=1;ay=0;az=0;}
        d=y1-b.y;if(d<dm){dm=d;ax=0;ay=1;az=0;}
        if(by0>0){d=b.y-y0;if(d<dm){dm=d;ax=0;ay=-1;az=0;}}
        d=pz-z0;if(d<dm){dm=d;ax=0;ay=0;az=-1;}
        d=z1-pz;if(d<dm){dm=d;ax=0;ay=0;az=1;}
        b.x+=ax*dm;b.y+=ay*dm;b.z+=az*dm;
        impact=Math.max(impact,b.speed*0.5);
      }
    }
  }
  for(const I of ISL){
    const ry=(I.H+0.07*I.R)/2+2,cy=I.y+0.07*I.R-ry+2,rx=I.R+2;
    const dx=b.x-I.x,dz=b.z-I.z,dy=b.y-cy;
    const e=(dx*dx+dz*dz)/(rx*rx)+dy*dy/(ry*ry);
    if(e<1){const l=Math.sqrt(e)||0.01;b.x=I.x+dx/l;b.z=I.z+dz/l;b.y=cy+dy/l;impact=Math.max(impact,b.speed*0.5);}
  }
  for(let i=0;i<COLS.length;i++){
    const c=COLS[i],dx=b.x-c.x,dy=b.y-c.y,dz=b.z-c.z,r=c.r+2,d2=dx*dx+dy*dy+dz*dz;
    if(d2<r*r){const d=Math.sqrt(d2)||0.01;b.x=c.x+dx/d*r;b.y=c.y+dy/d*r;b.z=c.z+dz/d*r;impact=Math.max(impact,b.speed*0.5);}
  }
  if(impact>3){b.speed*=0.55;G.shake=Math.min(0.7,G.shake+impact/60);}
}
function manualStep(dt,ctl){
  if(inp.flapReq){G.pulse=0.9;inp.flapReq=false;}
  G.pulse=Math.max(0,G.pulse-dt);
  const want=(inp.hold||G.pulse>0)?1:0;
  b.boost+=(want-b.boost)*(1-Math.exp(-dt*(want?1.7:0.8)));
  b.flapCD-=dt;
  if(want&&b.flapCD<=0){wings.flap(0.85);audio.flap(0.8);b.flapCD=2.1;}
  const rt=ctl.sx*0.75;
  b.roll+=(rt-b.roll)*(1-Math.exp(-dt*2.6));
  const yr=-1.1*Math.sin(b.roll);
  b.yawRate+=(yr-b.yawRate)*(1-Math.exp(-dt*3));
  b.yaw+=b.yawRate*dt;
  let pt=-0.02+ctl.sy*0.6+b.boost*0.55;
  if(b.y>1150)pt=Math.min(pt,-0.05-(b.y-1150)*0.002);
  if(b.y<16)pt=Math.max(pt,0.06+0.25*(16-b.y)/16);
  b.pitchRate+=((pt-b.pitch)*2.4-b.pitchRate)*(1-Math.exp(-dt*5));
  b.pitch=clamp(b.pitch+b.pitchRate*dt,-1.1,1.0);
  const sp=Math.sin(b.pitch);
  const vt=30-18*Math.max(0,sp)+14*Math.max(0,-sp);
  b.speed+=(vt-b.speed)*(1-Math.exp(-dt*0.55));
  const cp=Math.cos(b.pitch);
  b.vx=-Math.sin(b.yaw)*cp*b.speed;b.vy=sp*b.speed;b.vz=-Math.cos(b.yaw)*cp*b.speed;
  b.x+=b.vx*dt;b.y+=b.vy*dt;b.z+=b.vz*dt;
  b.load+=(clamp(b.boost*0.7,0,0.9)-b.load)*(1-Math.exp(-dt*3));
  collide(dt);
}

/* ---------- 状態遷移 ---------- */
function setFadeCol(c){P.fadeCol.setRGB(c[0],c[1],c[2]);}
function showMode(on,label){el.mode.textContent=label||el.mode.textContent;el.mode.classList.toggle('on',!!on);el.prog.classList.toggle('on',G.mode==='auto');}
function toTitle(){
  G.mode='title';G.modeT=0;G.ft=12;G.camInit=false;
  Object.assign(b,{x:START.x,y:START.y,z:START.z,yaw:0,pitch:-0.04,roll:0,speed:0,boost:0,yawRate:0,pitchRate:0,load:0});
  G.fade=1;G.fadeTarget=0;G.fadeSpeed=0.5;
  el.hint.classList.remove('on');el.title.classList.add('on');showMode(false);
  cityI=1e9;audio.reset();
}
function startAuto(){
  audio.init();audio.reset();
  G.mode='auto';G.modeT=0;G.ft=0;G.afi=0;G.camInit=false;G.endFired=false;
  setFadeCol(FADE_WARM);G.fade=1;
  el.title.classList.remove('on');showMode(true,'マニュアルで飛ぶ');
  cityI=1e9;
}
function startManual(fromAuto){
  audio.init();
  if(!fromAuto){
    audio.reset();G.mt=0;G.ft=0;
    Object.assign(b,{x:START.x,y:START.y,z:START.z-6,yaw:0,pitch:0.02,roll:0,speed:22,boost:0,yawRate:0,pitchRate:0,flapCD:0,load:0});
    setFadeCol(FADE_WARM);G.fade=1;G.fadeTarget=0;G.fadeSpeed=0.55;
    wings.flap(1);audio.flap(1);
    cityI=1e9;
  }else{
    // 映像の途中から、そのまま自分の翼で飛び始める
    const ftc=Math.min(G.ft,270);
    G.mt=600/TAU*Math.acos(clamp(1-ftc/135,-1,1));
    b.speed=Math.max(24,b.speed);b.boost=0;b.pitchRate=0;b.flapCD=1.5;
    G.fadeTarget=0;G.fadeSpeed=0.9;G.fade=Math.min(G.fade,0.0);
  }
  G.mode='manual';G.modeT=0;inp.flapReq=false;G.pulse=0;
  el.title.classList.remove('on');
  el.hint.innerHTML=coarse?'<span>ドラッグで操作</span><span>押し続けると、ぐっと上昇</span>':'<span>マウスで操作</span><span>押し続ける／スペースで、ぐっと上昇</span>';
  el.hint.classList.add('on');G.hintT=0;
  showMode(true,'タイトルへ戻る');
}
function filmEnd(){
  if(G.endFired)return;G.endFired=true;
  audio.endNote();
  setTimeout(()=>{if(G.mode==='auto')toTitle();},900);
}

/* ---------- メイン更新 ---------- */
function update(dt){
  G.t+=dt;G.modeT+=dt;U.uTime.value=G.t;
  const ctl=inp.poll(dt);
  const mode=G.mode;
  if(mode==='title'){
    b.yaw=Math.sin(G.t*0.13)*0.09;b.pitch=-0.05+Math.sin(G.t*0.21)*0.015;b.roll=Math.sin(G.t*0.17)*0.02;
    b.x=START.x;b.y=START.y+Math.sin(G.t*0.9)*0.05;b.z=START.z;b.speed=0;b.yawRate=0;
    inp.flapReq=false;
  }else if(mode==='auto'){
    G.ft+=dt;
    autoPose(dt);
    inp.flapReq=false;
    // 最初は暖かい白から、最後は深い夜へ溶ける
    const fin=1-sstep(0,3.5,G.ft),fout=sstep(288,FILM_LEN,G.ft);
    if(G.ft>100)setFadeCol(FADE_DARK);
    G.fade=Math.max(fin,fout);
    if(G.ft>=FILM_LEN)filmEnd();
  }else if(mode==='manual'){
    manualStep(dt,ctl);
    G.mt+=dt;G.ft=135*(1-Math.cos(TAU*G.mt/600));
    G.shake=Math.max(0,G.shake-dt*1.6);
    G.hintT+=dt;if(G.hintT>9)el.hint.classList.remove('on');
  }
  if(mode!=='auto'){G.fade+=(G.fadeTarget-G.fade)*Math.min(1,dt*G.fadeSpeed*3.2);}
  const ci=Math.round(b.x/BP),cj=Math.round(b.z/BP);
  if(ci!==cityI||cj!==cityJ)rebuildCity(ci,cj);
  for(const m of cloudLayers){m.position.x=b.x;m.position.z=b.z;}
  ground.position.x=Math.floor(b.x/10)*10;ground.position.z=Math.floor(b.z/10)*10;
  deepPlane.position.x=ground.position.x;deepPlane.position.z=ground.position.z;
  if(mode==='auto')el.prog.style.width=(G.ft/FILM_LEN*100).toFixed(2)+'%';
}

/* ---------- 空・光・カメラ・演出（毎フレーム） ---------- */
function applyAtmosphere(){
  sampleKF(G.ft);
  U.uZen.value.copy(KS.zen);U.uHor.value.copy(KS.hor);U.uMid.value.copy(KS.mid);U.uSunCol.value.copy(KS.sun);
  const ce=Math.cos(KS.elev);
  U.uSunDir.value.set(Math.sin(KS.az)*ce,Math.sin(KS.elev),-Math.cos(KS.az)*ce).normalize();
  U.uSunR.value=lerp(0.058,0.032,clamp(KS.elev/0.35,0,1));
  U.uFogDen.value=KS.fog;U.uAlt.value=KS.lit;U.uHeat.value=0;
  U.uLamp.value=KS.lamp;U.uStar.value=KS.star;
  U.uMistLow.value=0.0007+0.0016*(1-clamp(KS.lit,0,1))*(1-sstep(0.05,-0.1,KS.elev)*0.5);
  {const day=clamp(KS.elev/0.3,0,1);const cu=P.gradeS,ch=P.gradeH;
   cu.set(lerp(0.10,-0.02,day)+0.0,lerp(0.05,0.0,day),lerp(0.14,0.10,day)); // 影：青〜紫
   ch.set(0.012*KS.sun.r,0.010*KS.sun.g,0.006*KS.sun.b);}
}
let cloudPuffed=false;
function updateView(dt){
  applyAtmosphere();
  const sp=b.speed;
  // 雲を抜けるとき、白いもやに包まれる
  const cm=Math.exp(-Math.pow((b.y-(CLOUD_Y+26))/24,2));
  G.mist+=(cm-G.mist)*Math.min(1,dt*3);
  U.uMist.value=G.mist*0.9;
  if(G.mist>0.35&&!cloudPuffed&&G.mode!=='title'){cloudPuffed=true;audio.puff(1);}
  if(G.mist<0.12)cloudPuffed=false;
  // カメラ
  const shk=G.shake*G.shake;
  const nx=(Math.sin(G.t*47.1)+Math.sin(G.t*31.7))*0.5,ny=(Math.sin(G.t*43.3)+Math.sin(G.t*27.9))*0.5;
  cam.position.set(b.x+nx*shk*0.4,b.y+ny*shk*0.3,b.z);
  _e.set(b.pitch*0.95+ny*shk*0.06,b.yaw+nx*shk*0.06,-b.roll*0.95,'YXZ');
  cam.quaternion.setFromEuler(_e);
  const fov=(G.mode==='manual'?77+3*b.boost:KS.fov)+(G.mode==='title'?-2:0)+3.5*(G.enc||0)+4*Math.min(G.exitB||0,0.5);
  if(Math.abs(cam.fov-fov)>0.02){cam.fov+=(fov-cam.fov)*Math.min(1,dt*2.5);cam.updateProjectionMatrix();}
  cam.updateMatrixWorld(true);
  // 一人称の翼
  wings.sunView(U.uSunDir.value,cam.quaternion);
  const tuck=G.mode==='manual'?sstep(-0.35,-0.8,b.pitch)*sstep(34,48,b.speed):0;
  wings.update(dt,{tuck:tuck,load:clamp(b.load,-0.3,1.0),roll:b.roll,pitch:b.pitch*0.5,seed:0.7,calm:G.mode==='title'?1:0.9,
    sx:-b.yawRate*0.012,sy:-b.pitchRate*0.01,sr:0.0});
  // 太陽（画面上の位置）
  const sd=U.uSunDir.value;
  _w.copy(cam.position).addScaledVector(sd,2000);_w.project(cam);
  _v.set(0,0,-1).applyQuaternion(cam.quaternion);
  const align=_v.dot(sd);
  P.sunUV.set(_w.x*0.5+0.5,_w.y*0.5+0.5);
  P.sunVis=sstep(0.15,0.55,align)*(sd.y>-0.12?1:0);
  const sunFace=sstep(0.82,1.0,align)*sstep(-0.1,0.02,sd.y);
  P.ray=KS.ray*(0.4+0.6*P.sunVis);
  P.bloom=KS.bloom;
  P.dazzle=sunFace*0.10;
  // 門・トンネルをくぐるとき：入口で少し暗く、抜けた瞬間にぱっと明るく戻る
  {let enc=0;for(const S of STRUCT_LIST){const dx=b.x-S.cx,dz=b.z-S.cz;const dd=Math.hypot(dx,dz);if(dd<90)enc=Math.max(enc,1-sstep(18,90,dd));}
   G.exitB=G.exitB||0;G.enc=G.enc||0;
   const ne=G.enc+(enc-G.enc)*Math.min(1,dt*4);
   if(ne<G.enc)G.exitB+=(G.enc-ne)*1.4;
   G.enc=ne;G.exitB*=Math.exp(-dt*1.6);G.exitB=Math.min(G.exitB,0.5);}
  P.expo=KS.expo-0.12*sunFace-0.16*G.enc+0.22*G.exitB;
  P.streak=clamp((G.mode==='manual'?sstep(34,54,b.speed)*0.9:0)+G.exitB*1.4,0,1);
  P.blur=0;P.ca=0.0012+G.shake*0.004;
  P.vig=0.28;
  P.veil=G.mist*0.38;P.veilCol.setRGB(1.0,0.97,0.92);
  P.desat=0;P.flash=0;P.fade=G.fade;P.grain=0.028;
  // 光の粒・花びら・光の梯子
  FXU.uPxScale.value=R.h/(2*Math.tan(cam.fov*Math.PI/360));
  motes.material.uniforms.uMote.value=KS.mote;
  petals.material.uniforms.uAmt.value=KS.petal;
  shafts.material.uniforms.uAmt.value=KS.shaft*(1+1.2*G.exitB);
  shafts.material.uniforms.uTop.value=clamp(b.y+250,520,1200);
  birds.update(G.t,b.x,b.y,b.z);
  sceneryUpdate();
  // 音
  const live=G.mode==='auto'||G.mode==='manual';
  let wfv=0,wpan=0;
  for(let i=0;i<ISL.length;i++){const I=ISL[i];if(I.fall===null)continue;
    const dx=I.x-b.x,dz=I.z-b.z,d=Math.hypot(dx,(I.y-b.y)*0.5,dz)-I.R;
    const w=Math.pow(clamp(1-(d-80)/700,0,1),1.8);
    if(w>wfv){wfv=w;_v.set(dx,0,dz).normalize();_w.set(1,0,0).applyQuaternion(cam.quaternion);wpan=clamp(_v.dot(_w),-1,1)*0.8;}
  }
  audio.update(dt,{wf:wfv,wpan:wpan,speed:sp,cloud:G.mist,alt01:clamp(b.y/900,0,1),choir:sstep(150,175,G.ft)*(1-sstep(205,225,G.ft)),ft:G.ft,live:live,level:1-G.fade*0.98});
}

/* ---------- ループ ---------- */
let lastT=0,emaDt=16,slowT=0,fastT=0;
function frame(now){
  requestAnimationFrame(frame);
  if(!lastT)lastT=now;
  let dt=(now-lastT)/1000;lastT=now;
  if(dt>0.1)dt=0.1;if(dt<=0)return;
  emaDt+=(dt*1000-emaDt)*0.06;
  if(emaDt>24){slowT+=dt;fastT=0;if(slowT>1.4&&view.scale>0.5){view.scale=Math.max(0.5,view.scale*0.86);slowT=0;resize();}}
  else if(emaDt<15.5){fastT+=dt;slowT=0;if(fastT>5&&view.scale<1){view.scale=Math.min(1,view.scale*1.08);fastT=0;resize();}}
  else{slowT=0;fastT=0;}
  update(dt);
  updateView(dt);
  renderFrame();
}
