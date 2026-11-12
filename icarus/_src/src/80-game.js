/* ================= ゲーム本体 ================= */
const START={x:0,y:187.9,z:-12.2};
const coarse=window.matchMedia&&window.matchMedia('(pointer:coarse)').matches;
const el={title:$('title'),hint:$('hint'),end:$('end'),endTxt:$('endTxt'),go:$('go')};
const G={mode:'title',t:0,modeT:0,bird:makeBird(),heat:0,melt:0,meltT:0,meltShed:0,maxAlt:0,damage:0,angelSeen:0,lastSplash:-9,shake:0,fovKick:0,stun:0,thK:0,mist:0,
  fade:1,fadeTarget:0,fadeSpeed:0.7,flash:0,flapPow:1,hintT:0,hintShown:false,steerSeen:false,flapSeen:false,timeScale:1,endT:0,shedHeat:0,calls:0};
const b=G.bird;
const Y_AXIS=new T.Vector3(0,1,0);
const _v=new T.Vector3(),_w=new T.Vector3(),_q=new T.Quaternion(),_e=new T.Euler(0,0,0,'YXZ');
const tmpB={x:0,y:0,z:0};

/* ---------- 衝突（街） ---------- */
const CR=1.7;
function collide(dt){
  let impact=0,nxs=0,nys=0,nzs=0;
  // 海：しぶきを上げて速度を失うが、死にはしない
  if(b.y<2.3){
    const vin=Math.max(0,-b.vy);
    b.y=2.3;
    if(b.vy<0)b.vy=-b.vy*0.06;
    const sp=Math.hypot(b.vx,b.vz);
    const dr=Math.exp(-dt*(0.35+sp*0.025));
    b.vx*=dr;b.vz*=dr;
    if(vin>3||sp>16)onSplash(Math.max(vin,sp*0.35));
  }
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
        const vn=b.vx*ax+b.vy*ay+b.vz*az;
        if(vn<0){
          impact=Math.max(impact,-vn);nxs=ax;nys=ay;nzs=az;
          const e=1.15;
          b.vx-=e*vn*ax;b.vy-=e*vn*ay;b.vz-=e*vn*az;
          const f=1-Math.min(0.3,-vn*0.012);b.vx*=f;b.vy*=f;b.vz*=f;
        }
      }
    }
  }
  if(impact>6)onImpact(impact,nxs,nys,nzs);
}
function onSplash(v){
  if(G.t-(G.lastSplash||-9)<0.18)return;
  G.lastSplash=G.t;
  const k=Math.min(1,v/45);
  audio.splash(k);
  G.shake=Math.min(0.6,G.shake+k*0.25);
  birdBasis(b,_bs);
  parts.burst(b.x+_bs.fx*2,0.6,b.z+_bs.fz*2,Math.floor(10+34*k),6+22*k,0.82,0.93,1.0,0.5,1.1,9,1.0,0,1,0,0.8);
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

/* ---------- 上昇気流 ---------- */
let thAll=[],thAct=[],thFrame=0;
// 太陽へ向かう「光の柱」のルート。行くほど高く、行くほど遠い。
const ROUTE=[];
for(let k=0;k<40;k++)ROUTE.push({x:Math.round(120*Math.sin(0.9*k)),z:-250-430*k,y0:0,top:Math.min(3500,420+250*k),R:46,d:0,k:k});
function buildThermals(x,z){
  for(const t of ROUTE)t.d=Math.hypot(t.x-x,t.z-z);
  thAll=ROUTE.slice().sort((p,q)=>p.d-q.d);
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
      thAy+=26*kk;thAx+=-dz/(r+1)*3.2*kk;thAz+=dx/(r+1)*3.2*kk;K=Math.max(K,kk);
    }
  }
  return K;
}
function updateThermalVisuals(){
  const uTh=thermalPts.material.uniforms.uTh.value,uTop=thermalPts.material.uniforms.uTop.value;
  for(let i=0;i<THN;i++){
    const t=thAct[i],m=thermalMeshes[i];
    if(!t||t.d>4200){m.visible=false;uTh[i].set(0,0,0,0);continue;}
    m.visible=true;
    m.position.set(t.x,t.y0,t.z);m.scale.set(t.R*1.12,t.top-t.y0,t.R*1.12);
    m.material.uniforms.uOn.value=1.5;
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
  G.heat=0;G.melt=0;G.meltT=0;G.meltShed=0;G.maxAlt=0;G.damage=0;G.angelSeen=0;G.shake=0;G.fovKick=0;G.stun=0;G.flash=0;G.timeScale=1;G.shedHeat=0;G.thK=0;
  G.steerSeen=false;G.flapSeen=false;G.hintShown=false;G.above=false;G.lastBreak=-99;
  G.runs=(G.runs||0)+1;el.title.classList.toggle('retry',G.runs>1);
  wings.restore();wings.setLoose(0);
  fallFeathers.clear();
  angels.clear();
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
  el.hint.innerHTML=coarse?'<span>ドラッグで舵</span><span>タップで羽ばたき</span><span>光の柱で上昇</span>':'<span>マウスで舵</span><span>クリック・スペースで羽ばたき</span><span>光の柱で上昇</span>';
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
  if(G.maxAlt<500)line='まだ、空は遠い。';
  else if(G.maxAlt<1500)line='蝋が溶けた。<br>それでも空は、美しかった。';
  else if(G.maxAlt<2600)line='太陽は、まだ遠かった。';
  else line='手を伸ばしても、<br>太陽は、遠かった。';
  if(G.angelSeen>0&&G.maxAlt>=1500)line+='<br><span style="font-size:.62em;opacity:.85">天使たちは、ただ見ていた。</span>';
  el.endTxt.innerHTML=line+'<br><span style="font-size:.5em;letter-spacing:.25em;opacity:.8">到達 '+alt.toLocaleString('ja-JP')+' m ／ 太陽まで 3,000 m</span>';
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
      if(mode==='fly')G.thK=thermalForce();else{G.thK=0;thAx=thAy=thAz=0;}
      const sx=(mode==='fly'&&G.stun<=0)?ctl.sx:0,sy=(mode==='fly'&&G.stun<=0)?ctl.sy:0;
      stepBird(b,h,sx,sy,thAx,thAy,thAz);
      collide(h);
    }
    G.maxAlt=Math.max(G.maxAlt,b.y);
    if(mode==='fly'){
      const alt01=clamp(b.y/2000,0,1);
      // 熱：高く、太陽に向かうほど羽が熱される
      birdBasis(b,_bs);
      const sd=U.uSunDir.value;
      const face=clamp((_bs.fx*sd.x+_bs.fy*sd.y+_bs.fz*sd.z)*1.3+0.35,0,1);
      // 太陽に近づくほど、羽は容赦なく熱される（高さ3000mが「太陽」）
      const pr=clamp(b.y/3000,0,1.1);
      let rate=(0.003+0.11*Math.pow(pr,2.6))*(0.5+0.5*face);
      rate*=1-0.85*G.mist;
      const seaNear=1-sstep(30,260,b.y);
      const cool=(0.020+0.14*seaNear+0.16*G.mist)*(1-sstep(0.3,0.8,pr));
      G.heat+=(rate-cool)*dt;
      G.heat=Math.max(G.heat,sstep(0.4,1.0,pr)*0.85);
      if(G.heat<0)G.heat=0;
      if(G.heat>=1)startMelt();
      // 傷みは戻らない：羽は縮み、ほどけ、抜けていく
      G.damage=Math.max(G.damage,G.heat);
      const dmg=G.damage;
      b.liftScale=1-0.5*sstep(0.3,1,dmg);
      wings.setLoose(clamp((dmg-0.3)*1.3,0,1));
      const want=Math.round(wings.total*(1-0.88*sstep(0.18,1,dmg)));
      if(wings.aliveTotal()>want){
        G.shedHeat+=dt;
        if(G.shedHeat>0.22){G.shedHeat=0;shedFeathers(1);}
      }
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
  const alt01=clamp(b.y/2000,0,1);
  applyAtmosphere(Math.min(1,alt01),Math.min(1,G.heat),b.y);
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
  wings.update(dt,{shrink:sstep(0.05,1,G.damage),tuck:tuck,load:clamp(b.load,-0.3,1.2),heat:Math.min(1,G.heat),melt:G.melt,roll:b.roll,pitch:b.pitch*0.5,seed:0.7,calm:G.mode==='title'?1:(sstep(20,10,sp)*0.8),
    sx:-b.yawRate*0.012,sy:-b.pitchRate*0.01+bob*0.5,sr:0.0});
  // 太陽（画面上の位置）
  const sd=U.uSunDir.value;
  _w.copy(cam.position).addScaledVector(sd,2000);_w.project(cam);
  _v.set(0,0,-1).applyQuaternion(cam.quaternion);
  const align=_v.dot(sd);
  P.sunUV.set(_w.x*0.5+0.5,_w.y*0.5+0.5);
  P.sunVis=sstep(0.15,0.55,align);
  const alt01=Math.min(1,b.y/2000);
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
  const ang=angels.update(dt,{x:b.x,y:b.y,z:b.z,yaw:b.yaw,pr:clamp(b.y/3000,0,1),mode:G.mode,t:G.t});
  if(ang.seen>G.angelSeen)G.angelSeen=ang.seen;
  // 音
  const fallK=G.mode==='melt'?clamp(sp/80,0,1):0;
  audio.update(dt,{speed:sp,mode:G.mode,fallK:fallK,cloud:G.mist,thermal:G.thK>0.05?G.thK:0,heat:Math.min(1,G.heat),alt01:alt01,angel:ang.presence});
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
