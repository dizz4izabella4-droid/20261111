/* ================= 空・霧 共通GLSL ================= */
const SKY_GLSL=`
uniform float uTime;uniform vec3 uSunDir;uniform vec3 uZen;uniform vec3 uHor;uniform vec3 uMid;uniform vec3 uSunCol;
uniform sampler2D uIvy;uniform sampler2D uMoss;uniform sampler2D uStone;uniform sampler2D uFacade;uniform sampler2D uRoof;uniform sampler2D uSoil;uniform sampler2D uSoil2;uniform float uTexK;
uniform float uSunR;uniform float uAlt;uniform float uHeat;uniform float uFogDen;uniform float uMist;uniform float uMistLow;uniform vec3 uMistCol;
vec3 skyBase(vec3 d){
  float h=d.y;
  float hh=clamp(h,0.0,1.0);
  vec3 c=mix(uHor,uMid,smoothstep(0.0,0.30,hh));
  c=mix(c,uZen,smoothstep(0.22,0.95,hh));
  float s=max(dot(d,uSunDir),0.0);
  float k=0.65+0.9*uAlt+0.8*uHeat;
  c+=uSunCol*(pow(s,4.0)*0.12+pow(s,36.0)*0.28+pow(s,260.0)*0.50)*k;
  c=mix(c,uHor*vec3(0.92,0.96,1.0),smoothstep(0.03,-0.30,h));
  return c;
}
float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  return mix(mix(h21(i),h21(i+vec2(1.0,0.0)),f.x),mix(h21(i+vec2(0.0,1.0)),h21(i+vec2(1.0,1.0)),f.x),f.y);}
float fbm2(vec2 p){return vn(p)*0.55+vn(p*2.07+3.1)*0.30+vn(p*4.3+7.7)*0.15;}
vec3 applyFog(vec3 col,vec3 wp){
  vec3 d=wp-cameraPosition;float dist=length(d);vec3 dir=d/max(dist,1e-3);
  float hAvg=max((wp.y+cameraPosition.y)*0.5,0.0);
  float den=uFogDen*exp(-hAvg*0.0021)+uFogDen*0.10;
  den+=uMist*0.012;
  {float lowB=exp(-hAvg*0.016);float mn=fbm2(wp.xz*0.0011+vec2(uTime*0.012,-uTime*0.008));den+=uMistLow*lowB*(0.25+1.5*mn*mn);}
  float f=1.0-exp(-dist*den);
  vec3 fc=mix(skyBase(dir),uMistCol,clamp(uMist,0.0,1.0));
  return mix(col,fc,min(f,0.992));
}
float h31(vec3 p){p=fract(p*vec3(443.897,441.423,437.195));p+=dot(p,p.yzx+19.19);return fract((p.x+p.y)*p.z);}
`;
const FS_PRE='precision highp float;\n';

/* ---------- 空（星つき） ---------- */
const skyMat=new T.ShaderMaterial({
  uniforms:U,depthTest:false,depthWrite:false,
  vertexShader:`varying vec3 vDir;
  void main(){
    vec4 p=vec4(position.xy,1.0,1.0);
    vec4 v=inverse(projectionMatrix)*p;
    vDir=transpose(mat3(viewMatrix))*(v.xyz/v.w);
    gl_Position=p;
  }`,
  fragmentShader:FS_PRE+SKY_GLSL+`
  uniform float uStar;
  varying vec3 vDir;
  void main(){
    vec3 d=normalize(vDir);
    vec3 c=skyBase(d);
    float ang=acos(clamp(dot(d,uSunDir),-1.0,1.0));
    float disc=1.0-smoothstep(uSunR*0.82,uSunR,ang);
    float below=smoothstep(-0.02,0.02,uSunDir.y+0.02);
    c+=mix(vec3(1.0,0.86,0.62),vec3(1.0,0.97,0.9),0.6)*disc*(18.0+22.0*uHeat)*below;
    float ray=pow(max(dot(d,uSunDir),0.0),14.0);
    vec3 q=cross(d,uSunDir);float a=atan(q.y*1.7+q.x,dot(d,uSunDir));
    c+=uSunCol*ray*0.10*(0.5+0.5*sin(a*23.0+uTime*0.05)*sin(a*7.0-uTime*0.03));
    if(uStar>0.001){
      float st=uStar*smoothstep(0.02,0.30,d.y);
      vec3 sd=d*210.0;vec3 id=floor(sd);float h=h31(id);
      vec3 f=fract(sd)-0.5;
      float tw=0.6+0.4*sin(uTime*(0.8+h*3.0)+h*50.0);
      float s1=step(0.9962,h)*smoothstep(0.38,0.0,length(f))*tw;
      vec3 sd2=d*90.0;vec3 id2=floor(sd2);float h2=h31(id2+7.0);vec3 f2=fract(sd2)-0.5;
      float s2=step(0.9985,h2)*smoothstep(0.42,0.0,length(f2))*(0.7+0.3*sin(uTime+h2*30.0));
      vec3 tint=mix(vec3(0.85,0.9,1.0),vec3(1.0,0.92,0.8),h);
      c+=tint*(s1*1.8+s2*3.0)*st;
      float mb=exp(-pow(dot(d,normalize(vec3(0.35,0.55,-0.45))),2.0)*16.0);
      c+=vec3(0.28,0.25,0.42)*mb*st*0.40*(0.55+0.45*h21(d.xz*55.0+d.y*35.0));
    }
    gl_FragColor=vec4(c,1.0);
  }`
});
const skyMesh=new T.Mesh(triGeo,skyMat);skyMesh.frustumCulled=false;skyMesh.renderOrder=-100;
scene.add(skyMesh);

/* ================= 荒廃した街データ ================= */
const BP=100;
const BOXMAX=8;
const bbuf=new Float32Array(BOXMAX*8);   // x0,y0,z0,x1,y1,z1,傾きx,傾きz
const sbuf=new Float32Array(BOXMAX*4);   // seed,type,tint,flag（0通常 1塔 2半壊 3瓦礫）

/* ---------- くぐれる崩壊構造物（門・トンネル・高架・橋）。当たり判定は街のブロックと同じ ---------- */
const STRUCT=new Map();
const STRUCT_LIST=[];
(function(){
  function cell(b){return Math.round((b[0]+b[3])/2/BP)+','+Math.round((b[2]+b[5])/2/BP);}
  function add(b){const k=cell(b);let a=STRUCT.get(k);if(!a){a=[];STRUCT.set(k,a);}a.push(b);}
  function clear(x0,z0,x1,z1){
    for(let i=Math.floor((x0-48)/BP);i<=Math.ceil((x1+48)/BP);i++)for(let j=Math.floor((z0-48)/BP);j<=Math.ceil((z1+48)/BP);j++){
      const cx=i*BP,cz=j*BP;if(cx<x0-48||cx>x1+48||cz<z0-48||cz>z1+48)continue;
      const k=i+','+j;if(!STRUCT.has(k))STRUCT.set(k,[]);
    }
  }
  // list: [u0,y0,v0,u1,y1,v1,type,tint,flag,shu,shv]  u=通り抜ける方向に直角、v=通り抜ける方向
  function place(cx,cz,ori,list){
    let x0=1e9,z0=1e9,x1=-1e9,z1=-1e9;const out=[];
    for(const q of list){
      const b=ori==='z'?[cx+q[0],q[1],cz+q[2],cx+q[3],q[4],cz+q[5],q[6],q[7],q[8],q[9],q[10]]
                       :[cx+q[2],q[1],cz+q[0],cx+q[5],q[4],cz+q[3],q[6],q[7],q[8],q[10],q[9]];
      out.push(b);x0=Math.min(x0,b[0],b[0]+b[9]);x1=Math.max(x1,b[3],b[3]+b[9]);
      z0=Math.min(z0,b[2],b[2]+b[10]);z1=Math.max(z1,b[5],b[5]+b[10]);
    }
    clear(x0,z0,x1,z1);for(const b of out)add(b);
    STRUCT_LIST.push({cx:cx,cz:cz,ori:ori});
  }
  const S={
    A(G,h){ // 倒れ込んだ二棟（頂部が重なるA字の隙間）
      const d=36,tw=40,s=G/2+8;
      return [[-G/2-tw,0,-d/2,-G/2,h,d/2,0,0.30,0,s,0],[G/2,0,-d/2,G/2+tw,h,d/2,1,0.55,2,-s,0],
              [-G*0.38,h-12,-d/2+2,G*0.38,h+12,d/2-2,2,0.60,0,0,6]];
    },
    S(W){ // 二棟に斜めに渡った崩れた床スラブ（下をくぐる）
      return [[-W/2-40,0,-18,-W/2,150,18,1,0.20,0,10,0],[W/2,0,-18,W/2+38,140,18,0,0.40,2,-6,0],
              [-W/2-30,72,-16,W/2+16,96,16,2,0.62,0,0,18],[-W/2+10,0,-13,-W/2+40,14,13,0,0.50,3,6,-4]];
    },
    T(Wd,Ho){ // 門型のトンネルビル（低層を貫く通路）
      const D=100,Ht=Ho+85;
      return [[-Wd/2-30,0,-D/2,-Wd/2,Ht,D/2,0,0.25,0,3,0],[Wd/2,0,-D/2,Wd/2+30,Ht,D/2,1,0.45,0,-3,0],
              [-Wd/2-30,Ho,-D/2,Wd/2+30,Ht+8,D/2,2,0.35,0,0,0]];
    },
    V(L,Y){ // 崩れた高架（下をくぐる／上を飛ぶ）
      return [[-L/2,Y,-11,L/2,Y+12,11,2,0.50,0,0,4],[-L/2,0,-8,-L/2+15,Y,8,0,0.30,0,0,0],[L/2-15,0,-8,L/2,Y,8,0,0.60,2,2,0],
              [L/2-70,Y-26,-10,L/2-4,Y-12,10,2,0.45,0,0,-5]];
    },
    B(G,h,Yb){ // 二棟の間に渡った橋
      return [[-G/2-38,0,-18,-G/2,h,18,1,0.15,0,6,0],[G/2,0,-18,G/2+38,h*0.92,18,0,0.70,0,-6,0],
              [-G/2-6,Yb,-9,G/2+6,Yb+13,9,2,0.50,0,0,6],[-G/2-6,Yb-48,-8,G*0.1,Yb-36,8,2,0.40,0,10,0]];
    }
  };
  // 飛行ルート上（x=-50 の通り）
  place(-50,-1000,'z',S.A(120,130));
  place(-50,-1360,'z',S.S(100));
  place(-50,-1500,'z',S.T(110,95));
  place(-50,-1200,'x',S.V(200,105));
  // 脇道（手動で飛ぶ人向けの隙間）
  place(250,-700,'z',S.A(110,120));
  place(-420,-1300,'x',S.A(130,140));
  place(300,-1700,'x',S.S(110));
  place(-300,-500,'x',S.T(100,85));
  place(400,-1000,'z',S.V(180,90));
  place(-500,-1800,'x',S.V(190,110));
  place(180,-1500,'z',S.B(100,125,82));
  place(-250,-1900,'x',S.B(110,140,90));
  place(500,-400,'x',S.B(90,110,78));
  place(-450,-2200,'z',S.T(120,100));
  place(600,-1900,'z',S.A(120,135));
})();
function blockInfo(i,j){
  const cx=i*BP,cz=j*BP;
  const r0=hash3(i,j,1),r1=hash3(i,j,2),r2=hash3(i,j,3),r3=hash3(i,j,4),r4=hash3(i,j,5),r5=hash3(i,j,6),r6=hash3(i,j,7),r7=hash3(i,j,8),r8=hash3(i,j,9),r9=hash3(i,j,10),rL=hash3(i,j,11);
  const dist=Math.hypot(i,j);
  let n=0;
  function put(x0,y0,z0,x1,y1,z1,type,tint,flag,shx,shz){
    const o=n*8;bbuf[o]=x0;bbuf[o+1]=y0;bbuf[o+2]=z0;bbuf[o+3]=x1;bbuf[o+4]=y1;bbuf[o+5]=z1;bbuf[o+6]=shx||0;bbuf[o+7]=shz||0;
    const s=n*4;sbuf[s]=hash3(i,j,20+n);sbuf[s+1]=type;sbuf[s+2]=tint;sbuf[s+3]=flag;n++;
  }
  if(i===0&&j===0){
    put(cx-22,0,cz-22,cx+22,150,cz+22,0,0.12,0,0,0);
    put(cx-15,150,cz-15,cx+15,186,cz+15,1,0.12,0,0,0);
    return n;
  }
  const stc=STRUCT.get(i+','+j);
  if(stc){for(const q of stc)put(q[0],q[1],q[2],q[3],q[4],q[5],q[6],q[7],q[8],q[9],q[10]);return n;}
  if(r0<0.15&&dist>1.5)return 0;
  if(rL<0.05&&dist>3){
    const w=30+14*r2,h=250+130*r1;
    put(cx-w/2,0,cz-w/2,cx+w/2,h,cz+w/2,2,r3,1,(r4-0.5)*0.12*h,(r5-0.5)*0.12*h);
    return n;
  }
  let h=16+74*Math.pow(r1,1.8);
  h*=1+1.5*Math.exp(-dist/5.5);
  const w=40+20*r2,d=40+20*r3;
  const ox=(r4-0.5)*(60-w),oz=(r5-0.5)*(60-d);
  const type=r6<0.5?0:(r6<0.8?1:2);
  const kind=r7;
  if(kind<0.16){
    put(cx+ox-w/2,0,cz+oz-d/2,cx+ox+w/2,h,cz+oz+d/2,type,r8,0,0,0);
    let topY=h,tw=w,td=d;
    if(h>26&&r8<0.7){ // 上階がセットバックして細くなる（ニューヨークの段状ビル）
      const w2=w*(0.62+0.2*r9),d2=d*(0.62+0.2*r2),h2=h*(0.22+0.35*r4);
      put(cx+ox-w2/2,h,cz+oz-d2/2,cx+ox+w2/2,h+h2,cz+oz+d2/2,(type+1)%3,r8,0,0,0);
      topY=h+h2;tw=w2;td=d2;
      if(h>55&&r9<0.45){
        const w3=w2*0.62,d3=d2*0.62,h3=h*(0.10+0.16*r3);
        put(cx+ox-w3/2,topY,cz+oz-d3/2,cx+ox+w3/2,topY+h3,cz+oz+d3/2,type,r8,0,0,0);
        topY+=h3;tw=w3;td=d3;
      }
    }
    if(r5>0.35){ // 屋上の給水タンクと設備
      const tz=Math.min(tw,td)*0.22;
      put(cx+ox-tw*0.3-tz/2,topY,cz+oz-td*0.25-tz/2,cx+ox-tw*0.3+tz/2,topY+tz*1.1,cz+oz-td*0.25+tz/2,2,r6,0,0,0);
    }
    if(r6>0.55){ // アンテナ
      put(cx+ox+tw*0.2,topY,cz+oz+td*0.15,cx+ox+tw*0.2+1.4,topY+9+16*r9,cz+oz+td*0.15+1.4,1,r2,1,0,0);
    }
  }else if(kind<0.46){
    const lim=Math.min(0.5*h,46);
    const sg=r8<0.5?-1:1;
    const shx=(r9<0.5?sg:0.35*sg)*lim*(0.5+0.5*r3),shz=(r9<0.5?0.3:1)*lim*(r2-0.5)*1.3;
    put(cx+ox-w/2,0,cz+oz-d/2,cx+ox+w/2,h,cz+oz+d/2,type,r8,0,shx,shz);
  }else if(kind<0.84){
    put(cx+ox-w/2,0,cz+oz-d/2,cx+ox+w/2,h*(0.75+0.35*r9),cz+oz+d/2,type,r8,2,(r3-0.5)*0.2*h,(r2-0.5)*0.2*h);
    for(let q=0;q<3;q++){ // 崩れた瓦礫が根元に積もる
      const a=(r8*6.28)+q*2.1+r4*3,rr=Math.max(w,d)*0.5+4+6*hash3(i,j,40+q);
      const bx=Math.max(-44,Math.min(44,ox+Math.cos(a)*rr)),bz=Math.max(-44,Math.min(44,oz+Math.sin(a)*rr));
      const sz=4+7*hash3(i,j,50+q),hh=2.5+6*hash3(i,j,60+q);
      put(cx+bx-sz/2,0,cz+bz-sz/2,cx+bx+sz/2,hh,cz+bz+sz/2,2,r8,3,(hash3(i,j,70+q)-0.5)*4,(hash3(i,j,80+q)-0.5)*4);
    }
  }else{
    const hh=5+16*r1;
    put(cx+ox-w/2-4,0,cz+oz-d/2-4,cx+ox+w/2+4,hh,cz+oz+d/2+4,type,r8,3,(r3-0.5)*14,(r2-0.5)*14);
  }
  return n;
}

/* ================= 街インスタンス ================= */
const RAD=19;
const MAXI=7200;
/* ビルの形：壁(8枚) + 屋根の面取り(8枚) + 屋上(2枚) = 18枚（従来の箱は12枚）。x,z は 0〜1。
   aK: 0=足もと 1=壁の上端（面取りぶん下がる） 2=屋上の縁（面取りぶん内側へ） */
function makeBuildingGeo(){
  const pos=[],nor=[],kk=[];
  const cx=[0,1,1,0],cz=[0,0,1,1];
  function quad(A,B,C,D,n){ // 各点 [x,y,z,k]。外向きになるよう巻き方向を自動で揃える
    const v=function(a){const d=0.12;let x=a[0],y=a[1],z=a[2];
      if(a[3]===1)y-=d;if(a[3]===2){x+=(x<0.5?d:-d);z+=(z<0.5?d:-d);}return [x,y,z];};
    const a=v(A),b=v(B),c=v(C);
    const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
    const cr=[uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx];
    const flip=(cr[0]*n[0]+cr[1]*n[1]+cr[2]*n[2])<0;
    const tris=flip?[[A,C,B],[A,D,C]]:[[A,B,C],[A,C,D]];
    for(const tr of tris)for(const q of tr){pos.push(q[0],q[1],q[2]);nor.push(n[0],n[1],n[2]);kk.push(q[3]);}
  }
  const S=0.7071;
  for(let s=0;s<4;s++){
    const a=s,b=(s+1)%4;
    const ox=(cx[a]+cx[b])/2-0.5,oz=(cz[a]+cz[b])/2-0.5;           // 外向き（軸方向）
    const o=[Math.round(ox*2),0,Math.round(oz*2)];
    quad([cx[a],0,cz[a],0],[cx[b],0,cz[b],0],[cx[b],1,cz[b],1],[cx[a],1,cz[a],1],o);                 // 壁
    quad([cx[a],1,cz[a],1],[cx[b],1,cz[b],1],[cx[b],1,cz[b],2],[cx[a],1,cz[a],2],[o[0]*S,S,o[2]*S]);   // 面取り
  }
  quad([0,1,0,2],[1,1,0,2],[1,1,1,2],[0,1,1,2],[0,1,0]);                                            // 屋上
  quad([0,0,0,0],[1,0,0,0],[1,0,1,0],[0,0,1,0],[0,-1,0]);                                           // 底
  const g=new T.BufferGeometry();
  g.setAttribute('position',new T.Float32BufferAttribute(pos,3));
  g.setAttribute('normal',new T.Float32BufferAttribute(nor,3));
  g.setAttribute('aK',new T.Float32BufferAttribute(kk,1));
  return g;
}
const boxGeo=makeBuildingGeo();
const styleAttr=new T.InstancedBufferAttribute(new Float32Array(MAXI*4),4);
styleAttr.setUsage(T.DynamicDrawUsage);
boxGeo.setAttribute('aStyle',styleAttr);
const cityMat=new T.ShaderMaterial({
  uniforms:U,side:T.DoubleSide,
  vertexShader:`
  attribute vec4 aStyle;attribute float aK;
  varying vec3 vWP;varying vec3 vN;varying vec4 vS;varying vec3 vSc;varying vec3 vBase;varying vec2 vSh;
  void main(){
    vec3 sc=vec3(instanceMatrix[0].x,instanceMatrix[1].y,instanceMatrix[2].z);
    float cb=(aStyle.w<1.5)?(0.9+1.6*fract(aStyle.x*7.3)):0.0;
    cb=min(cb,0.18*min(sc.x,min(sc.y,sc.z)));
    vec3 pp=position;
    if(aK>0.5&&aK<1.5)pp.y-=cb/sc.y;
    if(aK>1.5){pp.x+=(pp.x<0.5?1.0:-1.0)*cb/sc.x;pp.z+=(pp.z<0.5?1.0:-1.0)*cb/sc.z;}
    vec4 wp=modelMatrix*instanceMatrix*vec4(pp,1.0);
    vBase=instanceMatrix[3].xyz;
    vSc=vec3(instanceMatrix[0].x,instanceMatrix[1].y,instanceMatrix[2].z);
    vSh=vec2(instanceMatrix[1].x,instanceMatrix[1].z);
    vWP=wp.xyz;vN=normal;vS=aStyle;
    gl_Position=projectionMatrix*viewMatrix*wp;
  }`,
  fragmentShader:FS_PRE+SKY_GLSL+`
  uniform float uLamp;uniform float uRefl;uniform sampler2D uNoise;
  varying vec3 vWP;varying vec3 vN;varying vec4 vS;varying vec3 vSc;varying vec3 vBase;varying vec2 vSh;
  vec3 pal(float k,float tint){
    vec3 a=vec3(0.78,0.72,0.62),b=vec3(0.64,0.44,0.34),c=vec3(0.52,0.58,0.64),d=vec3(0.70,0.58,0.38),e=vec3(0.80,0.78,0.74);
    float t=fract(k*7.31+tint*3.17);
    return t<0.34?a:(t<0.52?b:(t<0.66?c:(t<0.82?d:e)));
  }
  void main(){
    if(uRefl>0.5&&vWP.y<-0.3)discard;
    vec3 n=normalize(vN);
    float seed=vS.x,type=vS.y,tint=vS.z,flag=vS.w;
    vec3 lc;lc.y=(vWP.y-vBase.y)/vSc.y;
    lc.x=(vWP.x-vBase.x-vSh.x*lc.y)/vSc.x;lc.z=(vWP.z-vBase.z-vSh.y*lc.y)/vSc.z;
    bool broken=flag>1.5&&flag<2.5;
    vec2 q=vec2(lc.x*vSc.x,lc.z*vSc.z);
    if(broken){
      if(vN.y>0.5)discard;
      float alx=abs(vN.x)>0.5?vWP.z:vWP.x;
      float kc=floor(alx/4.2);
      vec4 kn=texture2D(uNoise,fract(vec2(kc*0.6180339+seed*0.71,kc*0.3819+seed*0.37)));
      float jr=smoothstep(0.30,0.70,kn.g);float jr2=smoothstep(0.30,0.70,kn.b);
      float fl=3.6;
      float nf=1.0+floor(jr*jr*4.2+0.5*(texture2D(uNoise,vec2(alx*0.0021+seed,0.61)).r-0.3)*3.0);
      float cutLow=vBase.y+vSc.y-max(nf,1.0)*fl;
      float bandH=fl*(1.0+floor(jr2*2.2));
      // 抜け落ちた階：その上の階は残る（約四割の柱で、上段が宙に残る）
      bool rem=jr2>0.58;
      if(rem){if(vWP.y>cutLow&&vWP.y<cutLow+bandH)discard;}
      else if(vWP.y>cutLow)discard;
    }
    if(abs(vN.y)<0.5&&lc.y>0.25&&flag<2.5){
      vec2 hc=floor(vec2(q.x+q.y,vWP.y)/9.0);
      float hole=smoothstep(0.30,0.70,texture2D(uNoise,fract(vec2(hc.x*0.6180339+hc.y*0.2377+seed*0.53,hc.x*0.1313-hc.y*0.7071+seed*0.17))).b);
      if(hole>(broken?0.86:0.955))discard;
    }
    if(!gl_FrontFacing){
      vec3 inside=vec3(0.085,0.068,0.060)*(0.85+0.3*vn(vWP.xz*0.07+vWP.y*0.05));
      {// 中身のごまかし：床スラブ・柱の影・窓の明かり（レイと床面の交差だけ。軽量）
        vec3 dd=normalize(vWP-cameraPosition);
        float yrel=vWP.y-vBase.y;float chh=3.6;
        float fi=floor(yrel/chh);
        bool hit=false;
        if(abs(dd.y)>0.12&&abs(vN.y)<0.5){
          float yf=vBase.y+(dd.y<0.0?fi+1.0:fi)*chh;
          float sdist=(yf-vWP.y)/(-dd.y);
          vec3 Q=vWP-dd*sdist;
          float lyq=(yf-vBase.y)/vSc.y;
          vec2 lq=vec2((Q.x-vBase.x-vSh.x*lyq)/vSc.x,(Q.z-vBase.z-vSh.y*lyq)/vSc.z);
          if(lq.x>0.02&&lq.x<0.98&&lq.y>0.02&&lq.y<0.98&&lyq<0.995&&yf>0.0&&sdist<vSc.x*1.2){
            float pil=smoothstep(0.0,0.05,abs(fract(lq.x*vSc.x/9.0)-0.5)*2.0-0.80)*0.0;
            inside=vec3(0.13,0.115,0.105)*(0.75+0.5*vn(Q.xz*0.22))*exp(-sdist*0.012);
            float gx=abs(fract(Q.x/9.0+Q.z/13.0)-0.5);inside*=0.8+0.4*smoothstep(0.05,0.12,gx);
            hit=true;
          }
        }
        if(!hit&&abs(vN.y)<0.5){
          float ub=abs(vN.x)>0.5?lc.z*vSc.z:lc.x*vSc.x;
          float fl=fract(yrel/chh);
          inside*=0.55+0.45*smoothstep(0.0,0.10,fl)*(1.0-smoothstep(0.88,1.0,fl)*0.5);
          vec2 wc=vec2(ub/4.2,yrel/chh);vec2 wf=fract(wc);
          float wl=smoothstep(0.15,0.25,wf.x)*(1.0-smoothstep(0.75,0.85,wf.x))*smoothstep(0.25,0.35,wf.y)*(1.0-smoothstep(0.80,0.90,wf.y));
          float wa=min(fwidth(wc.x)*3.0,1.0);
          inside=mix(inside,skyBase(normalize(vec3(0.0,0.3,-1.0)))*0.15,wl*(0.5-wa*0.4)*step(0.45,h21(floor(wc)+seed*3.0)));
        }
      }
      gl_FragColor=vec4(applyFog(inside,vWP),1.0);return;
    }
    vec3 V=normalize(cameraPosition-vWP);
    vec3 base=mix(pal(seed,tint),vec3(0.40,0.37,0.35),0.55)*0.66;
    if(flag>0.5&&flag<1.5)base=mix(base,vec3(0.72,0.70,0.66),0.5);
    if(flag>2.5)base*=0.7;
    float h=vWP.y;
    vec3 sunC=uSunCol*(1.25+0.5*uAlt);
    vec3 amb=mix(vec3(0.26,0.18,0.15),uZen*0.55+uMid*0.30+uHor*0.28+vec3(0.04),n.y*0.5+0.5);
    float ndl=max(dot(n,uSunDir),0.0);
    float ao=mix(0.34,1.0,smoothstep(2.0,95.0+uAlt*40.0,h));
    float sunShade=smoothstep(-6.0,60.0,h);
    vec3 col;
    if(abs(n.y)>0.5){
      vec2 g=q+vec2(seed*41.0,seed*17.0);
      vec3 rc=mix(base*0.9,vec3(0.34,0.36,0.30),step(0.78,h21(floor(g/9.0)+seed*13.0))*0.7);
      float ddR=length(vWP-cameraPosition);
      float gm=fbm2(g*0.085+seed*11.0);
      float gAmt=smoothstep(0.34,0.50,gm+(flag>2.5?0.25:0.0)+0.08)*step(0.0,n.y);
      float lf=mix(vn(g*0.35+seed),vn(g*1.7+seed*3.0),1.0-smoothstep(60.0,260.0,ddR));
      vec3 gcol=mix(vec3(0.10,0.34,0.07),vec3(0.34,0.56,0.14),lf);
      gcol=mix(gcol,texture2D(uMoss,g*0.045).rgb*1.25,uTexK*0.75);
      rc=mix(rc,texture2D(uRoof,g*0.05+seed*0.13).rgb*1.35,uTexK*0.85);
      rc=mix(rc,gcol,gAmt*0.95);
      float dd=length(vWP-cameraPosition);
      rc*=1.0-0.10*h21(floor(g/3.0))*(1.0-smoothstep(30.0,120.0,dd));
      float eR=min(min(lc.x,1.0-lc.x)*vSc.x,min(lc.z,1.0-lc.z)*vSc.z);
      rc*=0.9+0.1*smoothstep(0.0,3.0,eR);
      col=rc*(amb*0.8+sunC*ndl*0.9);
    }else{
      float u=abs(n.x)>0.5?lc.z*vSc.z:lc.x*vSc.x;
      float cw=3.8+type*0.6,ch=3.5;
      vec2 cell=vec2(u/cw,vWP.y/ch);
      vec2 f=fract(cell);vec2 id=floor(cell);
      vec2 aw=min(fwidth(cell),vec2(0.5))*0.75+vec2(0.004);
      float win=smoothstep(0.2-aw.x,0.2+aw.x,f.x)*(1.0-smoothstep(0.78-aw.x,0.78+aw.x,f.x))*smoothstep(0.24-aw.y,0.24+aw.y,f.y)*(1.0-smoothstep(0.80-aw.y,0.80+aw.y,f.y));
      if(type>1.5){float fx2=fract(cell.x*0.5+0.25);win=smoothstep(0.12-aw.x,0.12+aw.x,f.x)*(1.0-smoothstep(0.88-aw.x,0.88+aw.x,f.x))*smoothstep(0.10-aw.y,0.10+aw.y,f.y)*(1.0-smoothstep(0.90-aw.y,0.90+aw.y,f.y))*smoothstep(0.35-aw.x*0.5,0.35+aw.x*0.5,fx2);}
      float aaF=smoothstep(0.22,0.45,max(aw.x,aw.y));
      float farF=smoothstep(110.0,380.0,length(cameraPosition-vWP));
      win=mix(win,0.55,max(farF,aaF));
      float st=h21(id+seed*37.0);
      float gl=smoothstep(0.0,1.0,0.55+0.45*sin(id.x*1.7+id.y*2.3+seed*20.0));
      vec3 wall=base*(0.92+0.08*mix(h21(id*0.3+seed),0.5,max(farF,aaF)));
      wall*=0.62+0.38*h21(vec2(floor(u/2.6),floor(vWP.y/15.0)+seed*3.0));
      wall*=1.0-0.45*smoothstep(0.35,1.0,h21(vec2(floor(u*0.7),seed)))*(0.3+0.7*(1.0-lc.y));
      wall=mix(wall,wall*vec3(0.55,0.5,0.48),smoothstep(0.55,1.0,h21(vec2(floor(u*0.35),floor(vWP.y/22.0)+seed*5.0))));
      // 蔦と苔：壁をつたって緑が戻ってくる
      // 階の構造：床スラブの影と庇、雨だれ、1階の暗いアーケード、屋上の笠木
      wall*=1.0-0.26*(1.0-smoothstep(0.0,0.12,f.y))*(1.0-aaF)+0.05*smoothstep(0.9,1.0,f.y)*(1.0-aaF);
      {float stn=fbm2(vec2(u*0.9+seed*7.0,vWP.y*0.022));wall*=1.0-0.24*smoothstep(0.56,0.80,stn)*(1.0-0.4*lc.y);}
      if(vBase.y<1.0){float gf=1.0-smoothstep(4.0,7.5,vWP.y);float pier=step(0.5,fract(u/8.0));
        wall*=1.0-gf*(0.50-0.18*pier);win*=1.0-gf;}
      float depthTop=vBase.y+vSc.y-vWP.y;
      wall=mix(wall,wall*1.18+0.02,smoothstep(2.4,0.6,depthTop)*(1.0-aaF));
      float ddW=length(vWP-cameraPosition);
      float nearW=1.0-smoothstep(70.0,300.0,ddW);
      float cu=vn(vec2(u*0.42,seed*9.0));
      float vlen=10.0+70.0*cu*cu;
      float streak=fbm2(vec2(u*1.15+seed*5.0,vWP.y*0.16));
      float vine=smoothstep(vlen,vlen-14.0,depthTop)*smoothstep(0.30,0.52,streak+(cu-0.45)*0.55);
      float grow=(1.0-smoothstep(4.0,55.0,vWP.y))*smoothstep(0.34,0.56,fbm2(vec2(u*0.45,vWP.y*0.10)+seed*3.0));
      float mossP=smoothstep(0.50,0.74,fbm2(vec2(u,vWP.y)*0.11+seed*7.0))*0.75;
      float leaf=mix(vn(vec2(u,vWP.y)*0.30+seed),vn(vec2(u,vWP.y)*1.9+seed*2.0),nearW);
      vec3 gw=mix(vec3(0.08,0.30,0.06),vec3(0.30,0.52,0.13),leaf);
      vec3 iv=texture2D(uIvy,vec2(u,vWP.y)*0.07).rgb;
      vec3 ms=texture2D(uMoss,vec2(u,vWP.y)*0.055).rgb;
      gw=mix(gw,iv*1.2,uTexK*0.92);
      float vcov=max(vine*0.97,grow*0.95);
      float gcov=clamp(vcov+mossP,0.0,0.97);
      float mshare=mossP/(vcov+mossP+1e-3)*(1.0-vcov);
      vec3 fc=texture2D(uFacade,vec2(u/23.0+seed*0.37,vWP.y/21.0)).rgb;
      wall=mix(wall,fc*1.35*(0.85+0.3*tint),uTexK*0.88);
      float win0=win;
      win*=1.0-uTexK*0.55;
      wall=mix(wall,mix(gw,ms*1.3,mshare*uTexK),gcov);
      win*=1.0-gcov*0.85;
      {float fz=1.0-smoothstep(0.0,4.5,vWP.y-0.5+fbm2(vec2(u*0.35,vWP.y*0.2+uTime*0.15))*3.5);
       wall=mix(wall,vec3(0.90,0.96,1.0),fz*0.75);win*=1.0-fz;}
      vec3 shade=amb*0.85+sunC*ndl*sunShade;
      vec3 wc=wall*shade;
      vec3 R=reflect(-V,n);
      vec3 glass=skyBase(normalize(vec3(R.x,max(R.y,0.02)+0.12,R.z)))*(0.20+0.2*gl)*0.7;
      float spec=pow(max(dot(R,uSunDir),0.0),70.0);
      glass+=uSunCol*spec*mix(mix(1.0,6.0,smoothstep(0.45,0.55,st)),2.5,max(farF,aaF));
      glass=mix(glass,vec3(0.012,0.010,0.010),step(st,0.58)*(1.0-max(farF,aaF)));
      col=mix(wc,glass,win*0.9);
      {float lampOn=step(0.996-0.085*uLamp,st);
       float flick=0.85+0.15*sin(uTime*0.0+st*91.0);
       vec3 lc2=mix(vec3(1.0,0.70,0.36),vec3(1.0,0.82,0.55),fract(st*37.0));
       col+=lc2*lampOn*win0*(1.0-gcov*0.9)*(0.15+uLamp*2.4)*(1.0-uAlt*0.85*(1.0-uLamp))*flick;}
      col*=ao;
      float u01=abs(n.x)>0.5?lc.z:lc.x;float ext=abs(n.x)>0.5?vSc.z:vSc.x;
      float eD=min(u01,1.0-u01)*ext;
      col*=0.72+0.28*smoothstep(0.0,2.4,eD);
      col*=mix(0.88+0.12*smoothstep(0.0,0.35,f.y),1.0,max(farF,aaF));
    }
    float wet=1.0-smoothstep(0.0,7.0,h);
    col*=1.0-0.5*wet;
    float foam=exp(-max(h,0.0)*1.3)*(0.45+0.55*h21(floor(vec2(vWP.x+vWP.z,seed*9.0)*1.6)));
    col=mix(col,vec3(0.82,0.88,0.9)*(0.5+0.6*uSunCol),clamp(foam*step(-0.5,h),0.0,0.85));
    if(vWP.y<0.0)col=mix(col,vec3(0.03,0.15,0.19)*0.9,clamp(0.12-vWP.y/34.0*0.85,0.0,0.97));
    col=applyFog(col,vWP);
    gl_FragColor=vec4(col,1.0);
  }`
});
const city=new T.InstancedMesh(boxGeo,cityMat,MAXI);
city.frustumCulled=false;city.count=0;
scene.add(city);
let cityI=1e9,cityJ=1e9;
function rebuildCity(pi,pj){
  cityI=pi;cityJ=pj;
  let c=0;
  const arr=city.instanceMatrix.array,sa=styleAttr.array;
  for(let di=-RAD;di<=RAD;di++)for(let dj=-RAD;dj<=RAD;dj++){
    if(di*di+dj*dj>RAD*RAD)continue;
    const n=blockInfo(pi+di,pj+dj);
    for(let k=0;k<n;k++){
      if(c>=MAXI)break;
      const o=k*8,s=k*4;
      const x0=bbuf[o],y0=bbuf[o+1],z0=bbuf[o+2],x1=bbuf[o+3],y1=bbuf[o+4],z1=bbuf[o+5],shx=bbuf[o+6],shz=bbuf[o+7];
      const yb=y0<=0?-34:y0;
      const e=c*16;
      arr[e]=x1-x0;arr[e+1]=0;arr[e+2]=0;arr[e+3]=0;
      arr[e+4]=shx;arr[e+5]=y1-yb;arr[e+6]=shz;arr[e+7]=0;
      arr[e+8]=0;arr[e+9]=0;arr[e+10]=z1-z0;arr[e+11]=0;
      arr[e+12]=x0;arr[e+13]=yb;arr[e+14]=z0;arr[e+15]=1;
      const q=c*4;sa[q]=sbuf[s];sa[q+1]=sbuf[s+1];sa[q+2]=sbuf[s+2];sa[q+3]=sbuf[s+3];
      c++;
      const fl=sbuf[s+3];
    }
  }
  city.count=c;
  city.instanceMatrix.needsUpdate=true;styleAttr.needsUpdate=true;
}

/* ================= 雲 ================= */
function makeNoiseTex(){
  const N=256,data=new Uint8Array(N*N*4);
  function lat(seed,gs){
    const g=new Float32Array(gs*gs);let s=seed;
    for(let i=0;i<g.length;i++){s=(Math.imul(s,1664525)+1013904223)>>>0;g[i]=s/4294967296;}
    return g;
  }
  function vn(g,gs,x,y){
    const xi=Math.floor(x),yi=Math.floor(y);const fx=x-xi,fy=y-yi;
    const sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy);
    const x0=((xi%gs)+gs)%gs,y0=((yi%gs)+gs)%gs,x1=(x0+1)%gs,y1=(y0+1)%gs;
    const a=g[y0*gs+x0],b=g[y0*gs+x1],c=g[y1*gs+x0],d=g[y1*gs+x1];
    return a+(b-a)*sx+(c-a)*sy+(a-b-c+d)*sx*sy;
  }
  const chans=[11,57,303];
  for(let ch=0;ch<3;ch++){
    const octs=[];
    for(let o=0;o<5;o++){const gs=4<<o;octs.push({gs:gs,g:lat(chans[ch]*31+o*7+1,gs)});}
    for(let y=0;y<N;y++)for(let x=0;x<N;x++){
      let v=0,amp=0.5,tot=0;
      for(let o=0;o<5;o++){const gs=octs[o].gs;v+=amp*vn(octs[o].g,gs,x/N*gs,y/N*gs);tot+=amp;amp*=0.52;}
      data[(y*N+x)*4+ch]=Math.max(0,Math.min(255,Math.round(v/tot*255)));
    }
  }
  for(let i=0;i<N*N;i++)data[i*4+3]=255;
  const tex=new T.DataTexture(data,N,N,T.RGBAFormat);
  tex.wrapS=tex.wrapT=T.RepeatWrapping;tex.minFilter=T.LinearMipmapLinearFilter;tex.magFilter=T.LinearFilter;
  tex.generateMipmaps=true;tex.anisotropy=4;tex.needsUpdate=true;
  return tex;
}
const noiseTex=makeNoiseTex();
cityMat.uniforms=Object.assign({},U,{uNoise:{value:noiseTex}});
const ISLSH=`uniform vec4 uIsl[8];
float islShadow(vec3 wp){float s=0.0;float ly=max(uSunDir.y,0.18);
  for(int i=0;i<8;i++){vec4 I=uIsl[i];float h=I.y-wp.y;if(h<=0.0)continue;
    vec2 c=I.xz-uSunDir.xz*(h/ly);float d=length(wp.xz-c);float R=I.w*0.95;
    s=max(s,1.0-smoothstep(R*0.55,R*1.05+h*0.06,d));}
  return s;}
`;
const CLOUD_Y=300,CLOUD_N=5;
const cloudLayers=[];
function makeCloudMat(k){
  return new T.ShaderMaterial({
    uniforms:Object.assign({},U,{uNoise:{value:noiseTex},uLY:{value:CLOUD_Y+k*12},uScale:{value:0.00028+k*0.000035},uCover:{value:0.36+k*0.055},uSeed:{value:k*0.37},uK:{value:k/(CLOUD_N-1)}}),
    transparent:true,depthWrite:false,side:T.DoubleSide,
    vertexShader:`varying vec3 vWP;void main(){vec4 wp=modelMatrix*vec4(position,1.0);vWP=wp.xyz;gl_Position=projectionMatrix*viewMatrix*wp;}`,
    fragmentShader:FS_PRE+SKY_GLSL+`
    uniform sampler2D uNoise;uniform float uLY,uScale,uCover,uSeed,uK;
    ${ISLSH}
    varying vec3 vWP;
    float dens(vec2 uv){
      vec4 a=texture2D(uNoise,uv);
      vec4 b=texture2D(uNoise,uv*2.7+vec2(0.31,0.17));
      float n=a.r*0.62+b.g*0.26+texture2D(uNoise,uv*6.1+0.5).b*0.12;
      return n;
    }
    void main(){
      vec2 wind=vec2(uTime*0.0000032,uTime*0.0000011)*(1.0+uSeed);
      vec2 uv=vWP.xz*uScale+wind+uSeed;
      float n=dens(uv);
      float d=smoothstep(uCover,uCover+0.16,n);
      vec2 sdir=normalize(uSunDir.xz+vec2(1e-4))*0.0045;
      float n2=dens(uv+sdir*(1.0+uSeed));
      float lit=clamp(0.50+(n-n2)*13.0,0.0,1.0);
      vec3 vdir=vWP-cameraPosition;float dist=length(vdir);vdir/=dist;
      bool above=cameraPosition.y>uLY;
      vec3 sunC=uSunCol*(1.15+0.5*uAlt);
      vec3 shadowC=mix(vec3(0.17,0.30,0.52),vec3(0.38,0.58,0.82),0.24+0.12*uAlt);
      vec3 col;
      float sg=pow(max(dot(vdir,uSunDir),0.0),5.0);
      if(above){
        col=mix(shadowC,vec3(0.86,0.92,1.0)*(0.82+0.18*uAlt),lit);
        col*=mix(0.50,1.0,uK);
        col+=uSunCol*sg*0.35*(1.0-d*0.6);
      }else{
        col=mix(shadowC,vec3(0.90,0.95,1.0),0.36)*0.93+uHor*0.05;
        col=mix(col,col*vec3(0.88,0.95,1.08),0.6);
        col+=sunC*pow(lit,2.0)*0.55*(1.0-d)*(0.35+sg*2.5);
        col+=uSunCol*sg*0.6*(1.0-d*0.8);
        col+=sunC*(d*(1.0-d)*4.0)*lit*0.22;
      }
      {float ev=1.0-smoothstep(0.08,0.40,uSunDir.y);
       col+=uSunCol*vec3(1.0,0.72,0.38)*(d*(1.0-d)*4.0)*ev*(0.35+pow(max(dot(vdir,uSunDir),0.0),3.0)*1.6)*0.55;}
      col*=1.0-0.34*islShadow(vec3(vWP.x,uLY,vWP.z));
      float a=d*0.84;
      a*=1.0-smoothstep(1800.0,5600.0,dist);
      float dy=abs(cameraPosition.y-uLY);
      a*=smoothstep(1.5,26.0,dy);
      col=mix(col,skyBase(vdir),smoothstep(500.0,4600.0,dist)*0.8);
      gl_FragColor=vec4(col,a);
    }`
  });
}
const cloudGeo=new T.PlaneGeometry(1,1).rotateX(-Math.PI/2);
for(let k=0;k<CLOUD_N;k++){
  const m=new T.Mesh(cloudGeo,makeCloudMat(k));
  m.scale.set(12000,1,12000);m.position.y=CLOUD_Y+k*12;m.frustumCulled=false;m.renderOrder=2+k;
  scene.add(m);cloudLayers.push(m);
}

/* ================= 海（地面） ================= */
const groundMat=new T.ShaderMaterial({
  uniforms:Object.assign({},U,{uNoise:{value:noiseTex},uReflection:{value:null},uReflectVP:{value:new T.Matrix4()}}),
  vertexShader:`varying vec3 vWP;void main(){vec4 wp=modelMatrix*vec4(position,1.0);vWP=wp.xyz;gl_Position=projectionMatrix*viewMatrix*wp;}`,
  fragmentShader:FS_PRE+SKY_GLSL+`
  varying vec3 vWP;uniform sampler2D uReflection,uNoise;uniform mat4 uReflectVP;
  ${ISLSH}
  vec2 wv(vec2 p,vec2 k,float sp,float a,float t){float ph=dot(p,k)+t*sp;return k*a*cos(ph);}
  void main(){
    vec2 p=vWP.xz;float t=uTime;
    vec2 q=p+vec2(sin(p.y*0.013+t*0.2),cos(p.x*0.011-t*0.17))*6.0;
    vec2 g=vec2(0.0);
    g+=wv(q,vec2(0.061,0.023),1.1,5.0,t);
    g+=wv(q,vec2(-0.037,0.071),1.5,4.0,t);
    g+=wv(q,vec2(0.113,-0.087),1.9,2.4,t);
    g+=wv(q,vec2(-0.171,-0.121),2.5,1.5,t);
    g+=wv(q,vec2(0.29,0.23),3.3,0.8,t);
    g+=wv(q,vec2(-0.37,0.41),4.0,0.5,t);
    float dist=length(cameraPosition-vWP);
    g*=1.0/(1.0+dist*0.0016);
    vec3 n=normalize(vec3(-g.x*0.55,1.0,-g.y*0.55));
    vec3 V=normalize(cameraPosition-vWP);
    vec3 R=reflect(-V,n);R.y=abs(R.y);
    float F=0.025+0.975*pow(1.0-max(dot(n,V),0.0),5.0);
    vec3 sky=skyBase(R);
    vec3 deep=vec3(0.03,0.15,0.19)+uZen*0.07;
    vec3 sss=vec3(0.10,0.42,0.44)*(0.5+0.5*uSunCol)*(0.55+0.45*clamp(g.x*0.5+0.5,0.0,1.0));
    vec3 col=mix(mix(deep,sss,0.48*(1.0-F)),sky*0.86,clamp(F,0.0,1.0));
    vec4 rcp=uReflectVP*vec4(vWP.x,0.0,vWP.z,1.0);
    vec2 ruv=rcp.xy/max(rcp.w,1e-3)*0.5+0.5;
    ruv+=g*0.00022+vec2(sin(vWP.x*0.018+uTime*0.7),cos(vWP.z*0.016-uTime*0.6))*0.0012;
    vec3 reflection=texture2D(uReflection,clamp(ruv,vec2(0.002),vec2(0.998))).rgb;
    float inside=step(0.0,rcp.w)*step(0.0,ruv.x)*step(ruv.x,1.0)*step(0.0,ruv.y)*step(ruv.y,1.0);
    col=mix(col,reflection,inside*(0.58+0.34*F));
    {vec2 cuv=(vWP.xz+uSunDir.xz*900.0)*0.00028+vec2(uTime*0.0000032,uTime*0.0000011);
     float cn=texture2D(uNoise,cuv).r*0.62+texture2D(uNoise,cuv*2.7+vec2(0.31,0.17)).g*0.26+texture2D(uNoise,cuv*6.1+0.5).b*0.12;
     float cs=smoothstep(0.31,0.47,cn);
     col*=1.0-cs*0.30*(0.4+0.6*uAlt)*(1.0-smoothstep(1500.0,5000.0,dist));}
    {float crest=smoothstep(0.55,1.1,length(g))*(1.0-smoothstep(1500.0,4500.0,dist));
     float fn=texture2D(uNoise,vWP.xz*0.011+vec2(uTime*0.004,0.0)).g;
     col=mix(col,vec3(0.92,0.97,1.0)*(0.55+0.45*uAlt),clamp(crest*(0.35+fn*0.9)*0.45,0.0,0.5));
     vec2 cq=vWP.xz*0.045+g*0.6;
     float c1=texture2D(uNoise,cq+vec2(uTime*0.010,uTime*0.006)).r,c2=texture2D(uNoise,cq*1.37-vec2(uTime*0.008,uTime*0.011)).b;
     float cau=pow(1.0-abs(c1-c2),9.0);
     col+=vec3(0.30,0.62,0.66)*cau*0.20*(0.3+0.7*uAlt)*(1.0-F)*(1.0-smoothstep(300.0,1800.0,dist));}
    col*=1.0-0.42*islShadow(vec3(vWP.x,0.0,vWP.z))*(1.0-smoothstep(2500.0,6000.0,dist));
    float sd=max(dot(R,uSunDir),0.0);
    col+=uSunCol*pow(sd,420.0)*60.0+uSunCol*pow(sd,40.0)*0.55*F;
    col=applyFog(col,vWP);
    gl_FragColor=vec4(col,0.80);
  }`
});
groundMat.transparent=true;
const deepMat=new T.ShaderMaterial({uniforms:U,depthWrite:true,
  vertexShader:`varying vec3 vWP;void main(){vec4 wp=modelMatrix*vec4(position,1.0);vWP=wp.xyz;gl_Position=projectionMatrix*viewMatrix*wp;}`,
  fragmentShader:FS_PRE+SKY_GLSL+`varying vec3 vWP;void main(){vec3 deep=vec3(0.03,0.15,0.19)+uZen*0.07;gl_FragColor=vec4(applyFog(deep*0.8,vWP),1.0);}`});
const deepPlane=new T.Mesh(new T.PlaneGeometry(1,1).rotateX(-Math.PI/2),deepMat);
deepPlane.scale.set(10000,1,10000);deepPlane.position.y=-44;deepPlane.frustumCulled=false;deepPlane.renderOrder=-50;scene.add(deepPlane);
const ground=new T.Mesh(new T.PlaneGeometry(1,1).rotateX(-Math.PI/2),groundMat);
ground.scale.set(10000,1,10000);ground.frustumCulled=false;ground.renderOrder=-1;scene.add(ground);
