/* ================= 飛行モデル（アーケード・エネルギー式） ================= */
const FL={G:9.2,KL:0.0145,MAXL:34,CD:0.0010,CDL:0.012,ALIGN:2.3,VMAX:104,STALL:15};
function makeBird(){
  return {x:0,y:0,z:0,vx:0,vy:0,vz:-1,yaw:0,pitch:0,roll:0,speed:0,vf:0,
    liftScale:1,free:false,flapT:0,flapCD:0,tuck:0,load:0,lift:0,ax:0,ay:0,az:0,yawRate:0,pitchRate:0,sx:0,sy:0,stallK:0};
}
function birdBasis(b,out){
  const cp=Math.cos(b.pitch),sp=Math.sin(b.pitch),cy=Math.cos(b.yaw),sy=Math.sin(b.yaw);
  const fx=-sy*cp,fy=sp,fz=-cy*cp;
  const r0x=cy,r0y=0,r0z=-sy;
  // u0 = r0 x f
  const u0x=r0y*fz-r0z*fy,u0y=r0z*fx-r0x*fz,u0z=r0x*fy-r0y*fx;
  const cr=Math.cos(b.roll),sr=Math.sin(b.roll);
  out.fx=fx;out.fy=fy;out.fz=fz;
  out.rx=r0x*cr-u0x*sr;out.ry=r0y*cr-u0y*sr;out.rz=r0z*cr-u0z*sr;
  out.ux=u0x*cr+r0x*sr;out.uy=u0y*cr+r0y*sr;out.uz=u0z*cr+r0z*sr;
  return out;
}
const _bs={};
/* in: sx(右+), sy(上+) -1..1 / wind: {ax,ay,az} 追加加速度 */
function stepBird(b,dt,sx,sy,wx,wy,wz){
  birdBasis(b,_bs);
  const fx=_bs.fx,fy=_bs.fy,fz=_bs.fz;
  let sp=Math.hypot(b.vx,b.vy,b.vz);
  if(sp>0.5){
    // 気流に機首を合わせる：速度の向きだけを機首へ回す（エネルギーは保存、曲げた分だけ少し失う）
    const al=1-Math.exp(-dt*FL.ALIGN);
    let dx=b.vx/sp*(1-al)+fx*al,dy=b.vy/sp*(1-al)+fy*al,dz=b.vz/sp*(1-al)+fz*al;
    const dl=Math.hypot(dx,dy,dz)||1;dx/=dl;dy/=dl;dz/=dl;
    const cosA=(b.vx*fx+b.vy*fy+b.vz*fz)/sp;
    sp*=1-al*0.30*(1-Math.max(-1,cosA));
    b.vx=dx*sp;b.vy=dy*sp;b.vz=dz*sp;
  }
  const vF=Math.max(0,b.vx*fx+b.vy*fy+b.vz*fz);
  // 揚力
  const stall=sstepF(5,FL.STALL+1,vF);
  let L=Math.min(FL.KL*vF*vF,FL.MAXL)*stall*b.liftScale;
  const cr=Math.max(0.35,Math.cos(b.roll));
  L/=cr;               // バンクしても落ちにくく
  L=Math.min(L,FL.MAXL*1.15);
  let ax=_bs.ux*L,ay=_bs.uy*L-FL.G,az=_bs.uz*L;
  b.lift=L;
  // 抗力（タックで減る）
  const dm=(1-0.42*b.tuck)*(1+0.55*Math.abs(Math.sin(b.roll)))*(1+0.35*Math.max(0,b.pitch)*(b.pitch>0?1:0));
  if(sp>0.01){
    const d=(FL.CD*sp*sp+FL.CDL*sp)*dm;
    ax-=b.vx/sp*d;ay-=b.vy/sp*d;az-=b.vz/sp*d;
  }
  // 羽ばたき推力
  if(b.flapT>0){
    const k=Math.min(dt,b.flapT);b.flapT-=dt;
    const pw=Math.min(1,Math.max(0.2,1.15-sp/62))*b.liftScale;
    const A=7.5*pw,B=4.6*pw;
    ax+=(fx*A+_bs.ux*B)*k/dt;ay+=(fy*A+_bs.uy*B)*k/dt;az+=(fz*A+_bs.uz*B)*k/dt;
  }
  if(b.flapCD>0)b.flapCD-=dt;
  ax+=wx;ay+=wy;az+=wz;
  b.vx+=ax*dt;b.vy+=ay*dt;b.vz+=az*dt;
  sp=Math.hypot(b.vx,b.vy,b.vz);
  if(sp>FL.VMAX){const k=FL.VMAX/sp;b.vx*=k;b.vy*=k;b.vz*=k;sp=FL.VMAX;}
  b.x+=b.vx*dt;b.y+=b.vy*dt;b.z+=b.vz*dt;
  b.speed=sp;b.vf=vF;
  if(!b.free){
  // 姿勢
  const rt=sx*0.95;
  b.roll+=(rt-b.roll)*(1-Math.exp(-dt*4.6));
  const yr=-1.55*Math.sin(b.roll)/(1+vF/85);
  b.yawRate=yr;b.yaw+=yr*dt;
  // ピッチ
  let pr=sy*1.35;
  if(Math.abs(sy)<0.05){ // 手を離したら進行方向に落ち着く
    const vp=Math.atan2(b.vy,Math.hypot(b.vx,b.vz)+1e-3);
    pr+=(vp-b.pitch)*0.9;
  }
  // 失速：機首が下がる
  b.stallK=Math.max(0,(FL.STALL-vF)/FL.STALL);
  pr-=b.stallK*1.5;
  pr-=Math.sin(b.roll)*Math.sin(b.roll)*0.25*Math.sign(b.pitch+0.001)*0; 
  b.pitchRate+=(pr-b.pitchRate)*(1-Math.exp(-dt*6));
  b.pitch+=b.pitchRate*dt;
  if(b.pitch>1.38){b.pitch=1.38;b.pitchRate=Math.min(0,b.pitchRate);}
  if(b.pitch<-1.45){b.pitch=-1.45;b.pitchRate=Math.max(0,b.pitchRate);}
  }
  // タック（急降下で翼をたたむ）
  const tk=sstepF(-0.35,-0.8,b.pitch)*sstepF(30,55,sp);
  b.tuck+=(tk-b.tuck)*(1-Math.exp(-dt*5));
  // G（見た目用）
  b.load+=(clamp((L/FL.G-1)*0.5,-0.5,1.2)-b.load)*(1-Math.exp(-dt*6));
}
function sstepF(a,b,x){const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t)}
function flapBird(b){
  if(b.flapCD>0)return false;
  b.flapT=0.24;b.flapCD=0.36;return true;
}
