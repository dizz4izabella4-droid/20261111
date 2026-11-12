/* ================= ゲーム本体 ================= */
const START={x:0,y:187.9,z:-12.2};
const coarse=window.matchMedia&&window.matchMedia('(pointer:coarse)').matches;
const el={title:$('title'),hint:$('hint'),end:$('end'),endTxt:$('endTxt'),go:$('go')};
const G={mode:'title',t:0,modeT:0,bird:makeBird(),heat:0,melt:0,meltT:0,meltShed:0,maxAlt:0,ringCount:0,shake:0,fovKick:0,stun:0,thK:0,mist:0,
  fade:1,fadeTarget:0,fadeSpeed:0.7,flash:0,flapPow:1,hintT:0,hintShown:false,steerSeen:false,flapSeen:false,timeScale:1,endT:0,shedHeat:0,calls:0};
const b=G.bird;
const Y_AXIS=new T.Vector3(0,1,0);
const _v=new T.Vector3(),_w=new T.Vector3(),_q=new T.Quaternion(),_e=new T.Euler(0,0,0,'YXZ');
const tmpB={x:0,y:0,z:0};

/* ---------- 衝突（街） ---------- */
function ringBlocked(x,y,z){
  if(y<8)return true;
  const i=Math.round(x/BP),j=Math.round(z/BP);
  const n=blockInfo(i,j);
  for(let k=0;k<n;k++){const o=k*6;
    if(x>bbuf[o]-3&&x<bbuf[o+3]+3&&y>bbuf[o+1]-3&&y<bbuf[o+4]+3&&z>bbuf[o+2]-3&&z<bbuf[o+5]+3)return true;}
  return false;
}
function ringAreaBlocked(x,y,z,nx,ny,nz){
  if(ringBlocked(x,y,z))return true;
  // 輪の面上の点を調べる
  let ux=-nz,uz=nx,ul=Math.hypot(ux,uz);
  if(ul<1e-3){ux=1;uz=0;ul=1;}ux/=ul;uz/=ul;
  // v = n x u
  const vx=ny*uz-nz*0,vy=nz*ux-nx*uz,vz=nx*0-ny*ux;
  for(let a=0;a<8;a++){
    const th=a/8*TAU,c=Math.cos(th)*RING_R*0.85,s=Math.sin(th)*RING_R*0.85;
    if(ringBlocked(x+ux*c+vx*s,y+vy*s,z+uz*c+vz*s))return true;
  }
  return false;
}
const CR=1.7;
function collide(dt){
  let impact=0,nxs=0,nys=0,nzs=0;
  // 地面
  if(b.y<2.4){b.y=2.4;if(b.vy<0){impact=Math.max(impact,-b.vy);nys=1;b.vy=-b.vy*0.15;b.vx*=0.93;b.vz*=0.93;}}
  const i=Math.round(b.x/BP),j=Math.round(b.z/BP);
  const n=blockInfo(i,j);
  for(let k=0;k<n;k++){
    const o=k*6;
    const x0=bbuf[o]-CR,y0=bbuf[o+1]-(bbuf[o+1]>0?CR:0),z0=bbuf[o+2]-CR,x1=bbuf[o+3]+CR,y1=bbuf[o+4]+CR,z1=bbuf[o+5]+CR;
    if(b.x>x0&&b.x<x1&&b.y>y0&&b.y<y1&&b.z>z0&&b.z<z1){
      let dm=1e9,ax=0,ay=0,az=0;
      let d=b.x-x0;if(d<dm){dm=d;ax=-1;ay=0;az=0;}
      d=x1-b.x;if(d<dm){dm=d;ax=1;ay=0;az=0;}
      d=y1-b.y;if(d<dm){dm=d;ax=0;ay=1;az=0;}
      if(bbuf[o+1]>0){d=b.y-y0;if(d<dm){dm=d;ax=0;ay=-1;az=0;}}
      d=b.z-z0;if(d<dm){dm=d;ax=0;ay=0;az=-1;}
      d=z1-b.z;if(d<dm){dm=d;ax=0;ay=0;az=1;}
      b.x+=ax*dm;b.y+=ay*dm;b.z+=az*dm;
      const vn=b.vx*ax+b.vy*ay+b.vz*az;
      if(vn<0){
        impact=Math.max(impact,-vn);nxs=ax;nys=ay;nzs=az;
        const e=1.15;
        b.vx-=e*vn*ax;b.vy-=e*vn*ay;b.vz-=e*vn*az;
        const f=1-Math.min(0.3,-vn*0.012);b.vx*=f;b.vy*=f;b.vz*=f;
      }
    }
  }
  if(impact>6)onImpact(impact,nxs,nys,nzs);
}
function onImpact(v,nx,ny,nz){
  G.shake=Math.min(1,G.shake+v/55);
  audio.thud(v);
  const cx=b.x-nx*CR,cy=b.y-ny*CR,cz=b.z-nz*CR;
  const sp=Math.min(40,v);
  parts.burst(cx,cy,cz,Math.min(40,Math.floor(v*1.2)),sp*0.6,1.0,0.85,0.6,0.5,0.9,6,1.5,nx,ny,nz,0.9);
  if(G.mode==='fly'){
    if(v>30){G.stun=0.8;b.roll+=(rnd()-0.5)*1.6;b.pitch+=(rnd()-0.5)*0.5;shedFeathers(2);}
    G.flash=Math.max(G.flash,Math.min(0.25,v/160));
  }
}

/* ---------- 輪の連なり ---------- */
const chain={list:[],next:0,cp:{x:0,y:0,z:0,yaw:0},n:0,passed:{}};
function angDiff(a){a=(a+Math.PI)%TAU;if(a<0)a+=TAU;return a-Math.PI;}
function chainGen(){
  const cp=chain.cp,n=chain.n++;
  let sp,dy;
  if(n<3){sp=85;dy=-16;}else if(n<9){sp=96;dy=(n%2?4:-6);}else if(cp.y<420){sp=108;dy=30;}else{sp=128;dy=38;}
  cp.yaw+=angDiff(-cp.yaw)*(n<2?0.0:0.28)+(rnd()-0.5)*(n<2?0.15:0.8);
  let x=cp.x-Math.sin(cp.yaw)*sp,z=cp.z-Math.cos(cp.yaw)*sp,y=cp.y+dy;
  let nx=x-cp.x,ny=y-cp.y,nz=z-cp.z;let nl=Math.hypot(nx,ny,nz);nx/=nl;ny/=nl;nz/=nl;
  for(let t=0;t<40&&ringAreaBlocked(x,y,z,nx,ny,nz);t++){y+=7;nx=x-cp.x;ny=y-cp.y;nz=z-cp.z;nl=Math.hypot(nx,ny,nz);nx/=nl;ny/=nl;nz/=nl;}
  cp.x=x;cp.y=y;cp.z=z;
  chain.list.push({x:x,y:y,z:z,nx:nx,ny:ny,nz:nz,i:chain.list.length+chain.base});
}
chain.base=0;
function chainReset(x,y,z,yaw){
  chain.list.length=0;chain.next=0;chain.n=0;chain.base=0;
  chain.cp.x=x;chain.cp.y=y;chain.cp.z=z;chain.cp.yaw=yaw;
  for(let k=0;k<7;k++)chainGen();
}
function chainRegen(){
  const old=chain.list.length?chain.list[chain.next].i:0;
  chain.list.length=0;chain.next=0;
  chain.base=old;
  chain.cp.x=b.x;chain.cp.y=Math.max(b.y,60);chain.cp.z=b.z;chain.cp.yaw=b.yaw;
  chain.n=Math.max(chain.n,10);
  for(let k=0;k<7;k++)chainGen();
}
function ringAdvance(){
  chain.next++;
  while(chain.list.length-chain.next<6)chainGen();
  if(chain.next>16){chain.list.splice(0,10);chain.next-=10;chain.base+=10;}
}
function updateRings(px,py,pz){
  const r=chain.list[chain.next];if(!r)return;
  const s0=(px-r.x)*r.nx+(py-r.y)*r.ny+(pz-r.z)*r.nz;
  const s1=(b.x-r.x)*r.nx+(b.y-r.y)*r.ny+(b.z-r.z)*r.nz;
  if(s0<0&&s1>=0){
    const t=s0/(s0-s1);
    const cx=px+(b.x-px)*t-r.x,cy=py+(b.y-py)*t-r.y,cz=pz+(b.z-pz)*t-r.z;
    const d=Math.hypot(cx,cy,cz);
    if(d<RING_R*1.1)passRing(r);
    else{r.missed=true;ringAdvance();}
  }else{
    const d=Math.hypot(b.x-r.x,b.y-r.y,b.z-r.z);
    if(s1>150&&d>150){r.missed=true;ringAdvance();}
    else if(d>720){chainRegen();}
  }
}
function passRing(r){
  G.ringCount++;
  chain.passed[r.i]=G.t;
  // 加速とごほうび
  birdBasis(b,_bs);
  const boost=10;const cap=FL.VMAX*0.82;
  const sp=Math.hypot(b.vx,b.vy,b.vz);
  const add=Math.max(0,Math.min(boost,cap-sp));
  b.vx+=_bs.fx*add;b.vy+=_bs.fy*add;b.vz+=_bs.fz*add;
  G.heat=Math.max(0,G.heat-0.10);
  G.fovKick=Math.min(14,G.fovKick+9);G.flash=Math.max(G.flash,0.16);
  audio.ring(G.ringCount-1);
  for(let k=0;k<44;k++){
    const a=rnd()*TAU,c=Math.cos(a),s=Math.sin(a);
    // 輪の面に沿って火花
    let ux=-r.nz,uz=r.nx,ul=Math.hypot(ux,uz)||1;ux/=ul;uz/=ul;
    const vx=r.ny*uz,vy=r.nz*ux-r.nx*uz,vz=-r.ny*ux;
    const px=r.x+(ux*c+vx*s)*RING_R,py=r.y+(vy*s)*RING_R,pz=r.z+(uz*c+vz*s)*RING_R;
    parts.spawn(px,py,pz,r.nx*14+(ux*c+vx*s)*6,r.ny*14+vy*s*6,r.nz*14+(uz*c+vz*s)*6,1.0,0.82,0.5,0.7,1.6,0,0.7);
  }
  ringAdvance();
}
function updateRingVisuals(){
  for(const rg of rings)rg.used=false;
  for(let k=-1;k<4;k++){
    const idx=chain.next+k;if(idx<0||idx>=chain.list.length)continue;
    const r=chain.list[idx];const slot=rings[(r.i+10000)%5];
    const m=slot.mesh;
    const pt=chain.passed[r.i];
    const passedAge=pt!==undefined?G.t-pt:-1;
    if(k<0&&(passedAge<0||passedAge>1.1)){continue;}
    slot.used=true;m.visible=true;
    m.position.set(r.x,r.y,r.z);
    _v.set(r.nx,r.ny,r.nz);m.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),_v);
    const u=m.material.uniforms;
    if(passedAge>=0){const a=Math.min(1,passedAge/1.0);m.scale.setScalar(1+a*0.8);u.uPass.value=a;u.uState.value=1;slot.disc.material.uniforms.uOn.value=0;}
    else{m.scale.setScalar(1);u.uPass.value=0;u.uState.value=k===0?1:0.0;slot.disc.material.uniforms.uOn.value=k===0?1:0;}
  }
  for(const rg of rings)if(!rg.used)rg.mesh.visible=false;
}

/* ---------- 上昇気流 ---------- */
let thAll=[],thAct=[],thFrame=0;
function buildThermals(x,z){
  thAll.length=0;
  const C=420,a0=Math.floor(x/C),b0=Math.floor(z/C);
  for(let da=-4;da<=4;da++)for(let db=-4;db<=4;db++){
    const a=a0+da,bb=b0+db;
    if(hash3(a,bb,31)<0.42){
      const cx=(a+0.2+0.6*hash3(a,bb,32))*C,cz=(bb+0.2+0.6*hash3(a,bb,33))*C;
      thAll.push({x:(Math.round(cx/BP-0.5)+0.5)*BP,z:(Math.round(cz/BP-0.5)+0.5)*BP,y0:0,top:560+200*hash3(a,bb,34),R:36,d:0});
    }
  }
  const C2=900,a1=Math.floor(x/C2),b1=Math.floor(z/C2);
  for(let da=-2;da<=2;da++)for(let db=-2;db<=2;db++){
    const a=a1+da,bb=b1+db;
    if(hash3(a,bb,41)<0.6){
      thAll.push({x:(a+0.15+0.7*hash3(a,bb,42))*C2,z:(bb+0.15+0.7*hash3(a,bb,43))*C2,y0:CLOUD_Y-40,top:1050+350*hash3(a,bb,44),R:62,d:0});
    }
  }
  thAll.push({x:50,z:-150,y0:0,top:640,R:36,d:0});
  for(const t of thAll)t.d=Math.hypot(t.x-x,t.z-z);
  thAll.sort((p,q)=>p.d-q.d);
  thAct=thAll.slice(0,THN);
}
let thAx=0,thAy=0,thAz=0;
function thermalForce(){
  thAx=thAy=thAz=0;let K=0;
  for(const t of thAct){
    const dx=b.x-t.x,dz=b.z-t.z,r=Math.hypot(dx,dz),Rr=t.R*1.3;
    if(r<Rr&&b.y>t.y0-5&&b.y<t.top+40){
      const q=1-(r/Rr)*(r/Rr);
      const v=sstep(t.y0-5,t.y0+25,b.y)*(1-sstep(t.top-140,t.top+30,b.y));
      const kk=q*v;
      thAy+=16*kk;thAx+=-dz/(r+1)*3.2*kk;thAz+=dx/(r+1)*3.2*kk;K=Math.max(K,kk);
    }
  }
  return K;
}
function updateThermalVisuals(){
  const uTh=thermalPts.material.uniforms.uTh.value,uTop=thermalPts.material.uniforms.uTop.value;
  for(let i=0;i<THN;i++){
    const t=thAct[i],m=thermalMeshes[i];
    if(!t||t.d>2600){m.visible=false;uTh[i].set(0,0,0,0);continue;}
    m.visible=true;
    m.position.set(t.x,t.y0,t.z);m.scale.set(t.R*1.12,t.top-t.y0,t.R*1.12);
    m.material.uniforms.uOn.value=1;
    uTh[i].set(t.x,t.y0,t.z,t.R*1.05);uTop[i]=t.top;
  }
}

/* ---------- 大気・色 ---------- */
const colA={zen:new T.Color(0x0e2a72),hor:new T.Color(0xff7c40),sun:new T.Color(0xff9448),mid:new T.Color(0x8e86c4)};
const colB={zen:new T.Color(0x1b52b8),hor:new T.Color(0xffc47c),sun:new T.Color(0xffdfa6),mid:new T.Color(0x6ea6e8)};
const colH={hor:new T.Color(0xfff1d6),sun:new T.Color(0xfff6e0),mid:new T.Color(0xffd89a)};
function applyAtmosphere(alt01,heat,y){
  U.uAlt.value=alt01;U.uHeat.value=heat*heat;
  U.uZen.value.lerpColors(colA.zen,colB.zen,alt01);
  U.uHor.value.lerpColors(colA.hor,colB.hor,alt01).lerp(colH.hor,heat*0.45);
  U.uMid.value.lerpColors(colA.mid,colB.mid,alt01).lerp(colH.mid,heat*0.6);
  U.uSunCol.value.lerpColors(colA.sun,colB.sun,alt01).lerp(colH.sun,heat*0.4);
  const elev=lerp(0.11,0.60,sstep(0,1.0,alt01));
  U.uSunDir.value.set(-0.10,Math.sin(elev),-Math.cos(elev)).normalize();
  U.uSunR.value=lerp(0.026,0.075,alt01)*(1+heat*0.45);
  U.uFogDen.value=lerp(0.00085,0.00055,alt01);
  const mist=sstep(285,306,y)*(1-sstep(352,380,y));
  G.mist+=(mist-G.mist)*0.15;
  U.uMist.value=G.mist*0.9;
}

/* ---------- 羽の脱落 ---------- */
function shedFeathers(n){
  const ms=wings.shed(n);
  for(const m of ms){
    _v.setFromMatrixPosition(m).applyQuaternion(cam.quaternion).add(cam.position);
    fallFeathers.spawn(_v.x,_v.y,_v.z,b.vx*0.5+(rnd()-0.5)*5,b.vy*0.5+rnd()*2,b.vz*0.5+(rnd()-0.5)*5,0.7+rnd()*0.3,10);
  }
  if(ms.length)audio.shed();
}

/* ---------- 状態遷移 ---------- */
function setMode(m){G.mode=m;G.modeT=0;}
function resetRun(){
  Object.assign(b,makeBird());
  b.x=START.x;b.y=START.y;b.z=START.z;b.yaw=0;b.pitch=-0.04;b.roll=0;
  G.heat=0;G.melt=0;G.meltT=0;G.meltShed=0;G.maxAlt=0;G.ringCount=0;G.shake=0;G.fovKick=0;G.stun=0;G.flash=0;G.timeScale=1;G.shedHeat=0;G.thK=0;
  G.steerSeen=false;G.flapSeen=false;G.hintShown=false;G.above=false;G.lastBreak=-99;
  G.runs=(G.runs||0)+1;el.title.classList.toggle('retry',G.runs>1);
  wings.restore();wings.setLoose(0);
  fallFeathers.clear();
  chain.passed={};
  chainReset(START.x,START.y,START.z,0);
  cityI=1e9;
  setMode('title');
  el.end.classList.remove('on');
  el.title.classList.add('on');
  el.hint.classList.remove('on');
  G.fade=1;G.fadeTarget=0;G.fadeSpeed=0.55;
  P.fadeCol.set(0.95,0.88,0.75);
}
function launch(){
  audio.launch();
  setMode('fly');
  b.vx=0;b.vy=3.2;b.vz=-21;b.pitch=0.02;
  b.flapCD=0;
  flapNow();
  G.fovKick=22;G.flash=0.22;
  parts.burst(b.x,b.y-1.5,b.z-1,40,14,1.0,0.9,0.7,0.5,1.2,4,1.2,0,-1,-1,1.2);
  el.title.classList.remove('on');
  el.hint.innerHTML=coarse?'<span>ドラッグで舵</span><span>タップで羽ばたき</span>':'<span>マウスで舵</span><span>クリック・スペースで羽ばたき</span>';
  el.hint.classList.add('on');G.hintT=0;G.hintShown=true;
}
function flapNow(){
  if(!flapBird(b))return false;
  wings.flap(1);audio.flap(1);
  G.flapSeen=true;
  const pw=Math.min(1,Math.max(0.2,1.15-b.speed/62));
  // 羽ばたきで光の粒をまき、時々羽が舞う
  birdBasis(b,_bs);
  for(let k=0;k<7;k++)parts.spawn(b.x+_bs.rx*(rnd()*2-1)*1.6-_bs.fx*0.5,b.y-0.3+rnd()*0.4,b.z+_bs.rz*(rnd()*2-1)*1.6-_bs.fz*0.5,b.vx*0.6,b.vy*0.6-1,b.vz*0.6,1.0,0.9,0.75,0.28,0.8,0,0.5);
  if(rnd()<0.22){
    const s=rnd()<0.5?-1:1;
    fallFeathers.spawn(b.x+_bs.rx*s*1.1-_bs.fx*0.5,b.y-0.4,b.z+_bs.rz*s*1.1-_bs.fz*0.5,b.vx*0.35,b.vy*0.35,b.vz*0.35,0.55,9);
  }
  return true;
}
function startMelt(){
  setMode('melt');G.meltT=0;G.meltShed=0;
  audio.melt();G.flash=0.7;G.shake=1;
  G.fadeTarget=0;
  el.hint.classList.remove('on');
}
function finish(){
  if(G.mode==='end')return;
  el.title.classList.remove('on');
  setMode('end');G.endT=0;
  audio.endChord();
  const alt=Math.round(G.maxAlt);
  let line;
  if(G.maxAlt<650)line='まだ、空は遠い。';
  else if(G.maxAlt<1050)line='蝋が溶けた。<br>それでも空は、美しかった。';
  else line='太陽に、触れた。';
  el.endTxt.innerHTML=line+'<br><span style="font-size:.5em;letter-spacing:.25em;opacity:.8">到達 '+alt.toLocaleString('ja-JP')+' m　輪 '+G.ringCount+'</span>';
  G.fadeTarget=1;G.fadeSpeed=0.55;P.fadeCol.set(0.97,0.93,0.84);
  setTimeout(()=>{if(G.mode==='end')el.end.classList.add('on');},1500);
}

/* ---------- メイン更新 ---------- */
let lastT=0,emaDt=16,slowT=0,fastT=0;
const camQ=new T.Quaternion();
function update(dt){
  G.t+=dt;G.modeT+=dt;U.uTime.value=G.t;
  const ctl=G.auto?G.auto():inp.poll(dt);
  // 入力の使用状況
  if(Math.abs(ctl.sx)>0.35||Math.abs(ctl.sy)>0.35)G.steerSeen=true;
  const mode=G.mode;
  const tsc=G.timeScale;
  if(G.freeze){G.t+=0;}
  const sdt=dt*tsc;
  if(mode==='title'){
    if((inp.flapReq||inp.hold)&&G.modeT>0.5){inp.flapReq=false;launch();}
    // 待機の揺らぎ
    b.yaw=Math.sin(G.t*0.13)*0.09;b.pitch=-0.05+Math.sin(G.t*0.21)*0.015;b.roll=Math.sin(G.t*0.17)*0.02;
    b.x=START.x;b.y=START.y+Math.sin(G.t*0.9)*0.05;b.z=START.z;b.speed=0;
  }else if(G.freeze){
    b.speed=G.fzSpeed||30;
  }else if(mode==='fly'||mode==='melt'){
    // 羽ばたき入力
    if(mode==='fly'){
      if(inp.flapReq||inp.hold||ctl.flap){if(G.stun<=0)flapNow();inp.flapReq=false;}
      G.stun=Math.max(0,G.stun-dt);
    }else inp.flapReq=false;
    const steps=sdt>1/40?2:1,h=sdt/steps;
    for(let s=0;s<steps;s++){
      const px=b.x,py=b.y,pz=b.z;
      G.thK=thermalForce();
      const sx=(mode==='fly'&&G.stun<=0)?ctl.sx:0,sy=(mode==='fly'&&G.stun<=0)?ctl.sy:0;
      stepBird(b,h,sx,sy,thAx,thAy,thAz);
      collide(h);
      if(mode==='fly')updateRings(px,py,pz);
    }
    G.maxAlt=Math.max(G.maxAlt,b.y);
    if(mode==='fly'){
      const alt01=clamp(b.y/1300,0,1.2);
      // 熱：高く、太陽に向かうほど羽が熱される
      birdBasis(b,_bs);
      const sd=U.uSunDir.value;
      const face=clamp((_bs.fx*sd.x+_bs.fy*sd.y+_bs.fz*sd.z)*1.3+0.35,0,1);
      const expo=sstep(560,1250,b.y);
      let rate=0.085*expo*(0.3+0.7*face)*(1+0.8*sstep(1300,1700,b.y));
      rate*=1-0.85*G.mist;
      const cool=0.07*(1-expo)+0.03;
      G.heat+=(rate-cool*(rate>0.001?0.2:1))*dt;
      if(G.heat<0)G.heat=0;
      if(G.heat>=1)startMelt();
      // 熱で羽がほどけていく
      if(G.heat>0.55){
        G.shedHeat+=dt*(G.heat-0.5)*3.2;
        if(G.shedHeat>1){G.shedHeat=0;shedFeathers(1);}
      }
      wings.setLoose(clamp((G.heat-0.35)*1.2,0,1));
      // しずくのような蝋
      if(G.heat>0.45&&rnd()<dt*40*G.heat){
        const sd2=rnd()<0.5?-1:1;
        _v.set(sd2*(0.5+rnd()*1.2),-0.35,-0.7-rnd()*0.4).applyQuaternion(cam.quaternion).add(cam.position);
        parts.spawn(_v.x,_v.y,_v.z,b.vx*0.9,b.vy*0.9,b.vz*0.9,1.0,0.55,0.18,0.25,1.4,9,0.1);
      }
      if(G.hintShown){
        G.hintT+=dt;
        if((G.flapSeen&&G.steerSeen&&G.hintT>4)||G.hintT>14)el.hint.classList.remove('on');
      }
    }else{ // melt
      G.meltT+=dt;
      G.melt=sstep(0,1.8,G.meltT);
      G.timeScale=lerp(0.45,1,sstep(0.2,2.4,G.meltT));
      b.liftScale=1-sstep(0,1.0,G.meltT);
      G.heat=1-0.75*sstep(0.4,4.5,G.meltT);
      const tgt=Math.floor(G.meltT*16);
      if(tgt>G.meltShed){shedFeathers(1);G.meltShed=tgt;}
      if(G.meltT>0.7){
        b.free=true;
        b.pitch+=(-1.25-b.pitch)*Math.min(1,dt*1.0);
        b.roll+=dt*(1.0+G.meltT*0.6);
        b.yaw+=dt*0.25;
      }
      if(rnd()<dt*60){
        _v.set((rnd()<0.5?-1:1)*(0.4+rnd()*1.3),-0.3,-0.7).applyQuaternion(cam.quaternion).add(cam.position);
        parts.spawn(_v.x,_v.y,_v.z,b.vx*0.8,b.vy*0.8+2,b.vz*0.8,1.0,0.55,0.15,0.35,1.6,9,0.1);
      }
      if(b.y<CLOUD_Y-40&&G.meltT>2.5)finish();
      else if(b.y<12&&G.meltT>1.5)finish();
    }
  }else if(mode==='end'){
    G.endT+=dt;
    // 静かに落ち続ける
    b.vy=Math.max(b.vy-9*dt,-40);b.y+=b.vy*dt*0.3;
    if(inp.flapReq&&G.endT>2.2){inp.flapReq=false;resetRun();}
    inp.flapReq=false;
  }
  if(mode!=='end'&&mode!=='title')inp.flapReq=false;
  // 街の再構築
  const ci=Math.round(b.x/BP),cj=Math.round(b.z/BP);
  if(ci!==cityI||cj!==cityJ){rebuildCity(ci,cj);}
  // 上昇気流の候補
  thFrame++;if(thFrame%12===1||mode==='title')buildThermals(b.x,b.z);
  if(thFrame%6===1)updateThermalVisuals();
  thermalPts.material.uniforms.uTh.value;
  // フェード
  G.fade+=(G.fadeTarget-G.fade)*Math.min(1,dt*G.fadeSpeed*3.2);
  G.flash=Math.max(0,G.flash-dt*0.9);
  G.fovKick*=Math.exp(-dt*2.6);
  G.shake=Math.max(0,G.shake-dt*1.6);
  // 大気
  const alt01=clamp(b.y/1300,0,1.2);
  applyAtmosphere(Math.min(1,alt01),Math.min(1,G.heat),b.y);
  updateRingVisuals();
  // 雲の移動
  for(const m of cloudLayers){m.position.x=b.x;m.position.z=b.z;}
  ground.position.x=Math.floor(b.x/10)*10;ground.position.z=Math.floor(b.z/10)*10;
  // 雲海を突き抜ける瞬間
  if(mode==='fly'){
    if(b.y>CLOUD_Y+70&&!G.above&&b.vy>0&&G.t-(G.lastBreak||-99)>10){G.above=true;G.lastBreak=G.t;G.flash=Math.max(G.flash,0.42);G.fovKick=Math.min(18,G.fovKick+12);audio.rise();parts.burst(b.x,b.y,b.z,50,30,1.0,0.9,0.7,0.7,2.2,0,0.9);}
    if(b.y<CLOUD_Y+30)G.above=false;
  }
  // 雲に入る音
  const mistNow=G.mist;
  if(Math.abs(mistNow-(update.lastMist||0))>0.0&&((update.lastMist||0)<0.25&&mistNow>=0.25||(update.lastMist||0)>0.25&&mistNow<=0.25))audio.puff(Math.min(1,b.speed/50));
  update.lastMist=mistNow;
}

/* ---------- カメラ・演出（毎フレーム） ---------- */
function updateView(dt){
  const sp=b.speed;
  // カメラ
  const shk=G.shake*G.shake;
  const nx=(Math.sin(G.t*47.1)+Math.sin(G.t*31.7))*0.5,ny=(Math.sin(G.t*43.3)+Math.sin(G.t*27.9))*0.5;
  const fl=wings.st.flap>=0?wings.st.flap:-1;
  let bob=0;
  if(fl>=0)bob=Math.sin(Math.min(1,fl/0.45)*Math.PI)*0.012;
  const spShake=sstep(55,100,sp)*0.004+G.heat*G.heat*0.006;
  cam.position.set(b.x+nx*shk*0.4,b.y+ny*shk*0.3-bob*3,b.z);
  _e.set(b.pitch*0.92+ny*(shk*0.06+spShake)-bob,b.yaw+nx*(shk*0.06+spShake),-b.roll*0.95+nx*shk*0.05,'YXZ');
  cam.quaternion.setFromEuler(_e);
  const baseFov=G.mode==='title'?72:76;
  const fov=baseFov+26*sstep(20,92,sp)+G.fovKick+(G.mode==='end'?0:0);
  if(Math.abs(cam.fov-fov)>0.02){cam.fov=fov;cam.updateProjectionMatrix();}
  cam.updateMatrixWorld(true);
  // 一人称の翼
  wings.sunView(U.uSunDir.value,cam.quaternion);
  const tuck=b.tuck;
  wings.update(dt,{tuck:tuck,load:clamp(b.load,-0.3,1.2),heat:Math.min(1,G.heat),melt:G.melt,roll:b.roll,pitch:b.pitch*0.5,seed:0.7,calm:G.mode==='title'?1:(sstep(20,10,sp)*0.8),
    sx:-b.yawRate*0.012,sy:-b.pitchRate*0.01+bob*0.5,sr:0.0});
  // 太陽（画面上の位置）
  const sd=U.uSunDir.value;
  _w.copy(cam.position).addScaledVector(sd,2000);_w.project(cam);
  _v.set(0,0,-1).applyQuaternion(cam.quaternion);
  const align=_v.dot(sd);
  P.sunUV.set(_w.x*0.5+0.5,_w.y*0.5+0.5);
  P.sunVis=sstep(0.15,0.55,align);
  const alt01=Math.min(1,b.y/1300);
  const sunFace=sstep(0.82,1.0,align);
  P.ray=(0.20+0.32*alt01)*(0.4+0.6*P.sunVis);
  P.bloom=0.42+0.18*alt01+G.heat*0.12;
  P.dazzle=sunFace*(0.06+0.16*alt01)+G.heat*G.heat*0.10*sunFace;
  P.expo=1.0-0.14*sunFace+G.heat*0.10;
  P.blur=sstep(45,105,sp)*0.06+G.fovKick*0.003;
  P.ca=sstep(40,100,sp)*0.0045+G.shake*0.004+G.heat*0.003;
  P.vig=(0.26+0.20*sstep(45,95,sp)+G.heat*0.08)*(G.mode==='melt'?0.5:1);
  // 雲の中の白いもや／熱のまぶしさ
  const veilMist=G.mist*0.30,veilHeat=G.mode==='melt'?(0.34*(1-sstep(0.3,3.2,G.meltT))+0.04):Math.pow(Math.min(1,G.heat),2.2)*0.34;
  P.veil=Math.max(veilMist,veilHeat);
  {const th=veilHeat/(veilHeat+veilMist+1e-4);P.veilCol.setRGB(lerp(0.8,1.0,th),lerp(0.9,0.68,th),lerp(1.0,0.34,th));}
  P.desat=0;
  P.flash=G.flash;P.fade=G.fade;
  P.grain=0.03;
  // 光の粒・風の筋
  const pxs=R.h/(2*Math.tan(cam.fov*Math.PI/360));
  FXU.uPxScale.value=pxs;
  FXU.uVel.value.set(b.vx,b.vy,b.vz);
  FXU.uSpeedAmt.value=sstep(22,80,sp)*0.5*(G.mode==='fly'||G.mode==='melt'?1:0);
  // 翼端の航跡
  const tr=(G.mode==='fly')?clamp(sstep(24,62,sp)*0.55+sstep(0.25,0.8,Math.abs(b.roll))*0.5*sstep(18,36,sp),0,1):(G.mode==='melt'?0.3:0);
  const tl=cam.localToWorld(new T.Vector3(-1.25,-0.22,0.15)),trg=cam.localToWorld(new T.Vector3(1.25,-0.22,0.15));
  updateTrails(dt,tl,trg,tr,G.t);
  parts.update(dt);
  fallFeathers.update(dt,G.t);
  puffs.update(cam.position.x,cam.position.y,cam.position.z,VMU.uSunV.value);
  birds.update(G.t,thAct);
  // 音
  const fallK=G.mode==='melt'?clamp(sp/80,0,1):0;
  audio.update(dt,{speed:sp,mode:G.mode,fallK:fallK,cloud:G.mist,thermal:G.thK>0.05?G.thK:0,heat:Math.min(1,G.heat),alt01:alt01});
}

/* ---------- ループ ---------- */
function frame(now){
  requestAnimationFrame(frame);
  if(!lastT)lastT=now;
  let dt=(now-lastT)/1000;lastT=now;
  if(dt>0.1)dt=0.1;if(dt<=0)return;
  emaDt+=(dt*1000-emaDt)*0.06;
  // 動的解像度
  if(emaDt>24){slowT+=dt;fastT=0;if(slowT>1.4&&view.scale>0.5){view.scale=Math.max(0.5,view.scale*0.86);slowT=0;resize();}}
  else if(emaDt<15.5){fastT+=dt;slowT=0;if(fastT>5&&view.scale<1){view.scale=Math.min(1,view.scale*1.08);fastT=0;resize();}}
  else{slowT=0;fastT=0;}
  update(dt);
  updateView(dt);
  renderFrame();
}
