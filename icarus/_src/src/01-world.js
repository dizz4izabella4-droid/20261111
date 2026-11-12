/* ================= 空・霧 共通GLSL ================= */
const SKY_GLSL=`
uniform float uTime;uniform vec3 uSunDir;uniform vec3 uZen;uniform vec3 uHor;uniform vec3 uMid;uniform vec3 uSunCol;
uniform float uSunR;uniform float uAlt;uniform float uHeat;uniform float uFogDen;uniform float uMist;uniform vec3 uMistCol;
vec3 skyBase(vec3 d){
  float h=d.y;
  float hh=clamp(h,0.0,1.0);
  vec3 c=mix(uHor,uMid,smoothstep(0.0,0.30,hh));
  c=mix(c,uZen,smoothstep(0.22,0.95,hh));
  float s=max(dot(d,uSunDir),0.0);
  float k=0.65+0.9*uAlt+0.8*uHeat;
  c+=uSunCol*(pow(s,4.0)*0.12+pow(s,36.0)*0.28+pow(s,260.0)*0.50)*k;
  c=mix(c,uHor*vec3(0.78,0.70,0.76),smoothstep(0.03,-0.30,h));
  return c;
}
vec3 applyFog(vec3 col,vec3 wp){
  vec3 d=wp-cameraPosition;float dist=length(d);vec3 dir=d/max(dist,1e-3);
  float hAvg=max((wp.y+cameraPosition.y)*0.5,0.0);
  float den=uFogDen*exp(-hAvg*0.0021)+uFogDen*0.10;
  den+=uMist*0.012;
  float f=1.0-exp(-dist*den);
  vec3 fc=mix(skyBase(dir),uMistCol,clamp(uMist,0.0,1.0));
  return mix(col,fc,min(f,0.992));
}
float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float h31(vec3 p){p=fract(p*vec3(443.897,441.423,437.195));p+=dot(p,p.yzx+19.19);return fract((p.x+p.y)*p.z);}
`;
const FS_PRE='precision highp float;\n';

/* ---------- 空 ---------- */
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
  varying vec3 vDir;
  void main(){
    vec3 d=normalize(vDir);
    vec3 c=skyBase(d);
    float ang=acos(clamp(dot(d,uSunDir),-1.0,1.0));
    float disc=1.0-smoothstep(uSunR*0.82,uSunR,ang);
    c+=mix(vec3(1.0,0.86,0.62),vec3(1.0,0.97,0.9),0.6)*disc*(18.0+22.0*uHeat);
    float ray=pow(max(dot(d,uSunDir),0.0),14.0);
    // うっすらした光芒（空に筋）
    vec3 q=cross(d,uSunDir);float a=atan(q.y*1.7+q.x,dot(d,uSunDir));
    c+=uSunCol*ray*0.10*(0.5+0.5*sin(a*23.0+uTime*0.05)*sin(a*7.0-uTime*0.03));
    gl_FragColor=vec4(c,1.0);
  }`
});
const skyMesh=new T.Mesh(triGeo,skyMat);skyMesh.frustumCulled=false;skyMesh.renderOrder=-100;
scene.add(skyMesh);

/* ================= 荒廃した街データ ================= */
const BP=100;                // ブロックピッチ
const BOXMAX=4;
const bbuf=new Float32Array(BOXMAX*8);   // x0,y0,z0,x1,y1,z1,傾きx,傾きz（頂部のずれ）
const sbuf=new Float32Array(BOXMAX*4);   // seed,type,tint,flag（0通常 1塔 2半壊 3瓦礫）
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
  if(i===1&&j===-2){ // ロケットの屋上
    put(cx-16,0,cz-20,cx+24,170,cz+20,0,0.3,0,0,0);
    return n;
  }
  if(r0<0.15&&dist>1.5)return 0;                 // 水没した区画
  if(rL<0.05&&dist>3){                            // 雲を突き抜ける塔（かすかに傾く）
    const w=15+8*r2,h=335+150*r1;
    put(cx-w/2,0,cz-w/2,cx+w/2,h,cz+w/2,2,r3,1,(r4-0.5)*0.12*h,(r5-0.5)*0.12*h);
    return n;
  }
  let h=16+74*Math.pow(r1,1.8);
  h*=1+1.5*Math.exp(-dist/5.5);
  const w=34+22*r2,d=34+22*r3;
  const ox=(r4-0.5)*(60-w),oz=(r5-0.5)*(60-d);
  const type=r6<0.5?0:(r6<0.8?1:2);
  const kind=r7;
  if(kind<0.16){                                  // 無傷に近い
    put(cx+ox-w/2,0,cz+oz-d/2,cx+ox+w/2,h,cz+oz+d/2,type,r8,0,0,0);
    if(r8<0.4){
      const w2=w*(0.5+0.25*r9),d2=d*(0.5+0.25*r2),h2=h*(0.2+0.4*r4);
      put(cx+ox-w2/2,h,cz+oz-d2/2,cx+ox+w2/2,h+h2,cz+oz+d2/2,(type+1)%3,r8,0,0,0);
    }
  }else if(kind<0.46){                            // 傾いたビル
    const lim=Math.min(0.42*h,34);
    const sg=r8<0.5?-1:1;
    const shx=(r9<0.5?sg:0.35*sg)*lim*(0.5+0.5*r3),shz=(r9<0.5?0.3:1)*lim*(r2-0.5)*1.3;
    put(cx+ox-w/2,0,cz+oz-d/2,cx+ox+w/2,h,cz+oz+d/2,type,r8,0,shx,shz);
  }else if(kind<0.84){                            // 半壊のビル（上が欠け、壁に穴）
    put(cx+ox-w/2,0,cz+oz-d/2,cx+ox+w/2,h*(0.75+0.35*r9),cz+oz+d/2,type,r8,2,(r3-0.5)*0.2*h,(r2-0.5)*0.2*h);
  }else{                                          // 崩れた瓦礫
    const hh=5+16*r1;
    put(cx+ox-w/2-4,0,cz+oz-d/2-4,cx+ox+w/2+4,hh,cz+oz+d/2+4,type,r8,3,(r3-0.5)*14,(r2-0.5)*14);
  }
  return n;
}

/* ================= 街インスタンス ================= */
const RAD=19;               // 半径(ブロック)
const MAXI=7200;
const boxGeo=new T.BoxGeometry(1,1,1);boxGeo.translate(0,0.5,0);
const styleAttr=new T.InstancedBufferAttribute(new Float32Array(MAXI*4),4);
styleAttr.setUsage(T.DynamicDrawUsage);
boxGeo.setAttribute('aStyle',styleAttr);
const cityMat=new T.ShaderMaterial({
  uniforms:U,side:T.DoubleSide,
  vertexShader:`
  attribute vec4 aStyle;
  varying vec3 vWP;varying vec3 vN;varying vec4 vS;varying vec3 vSc;varying vec3 vBase;varying vec2 vSh;
  void main(){
    vec4 wp=modelMatrix*instanceMatrix*vec4(position,1.0);
    vBase=instanceMatrix[3].xyz;
    vSc=vec3(instanceMatrix[0].x,instanceMatrix[1].y,instanceMatrix[2].z);
    vSh=vec2(instanceMatrix[1].x,instanceMatrix[1].z);
    vWP=wp.xyz;vN=normal;vS=aStyle;
    gl_Position=projectionMatrix*viewMatrix*wp;
  }`,
  fragmentShader:FS_PRE+SKY_GLSL+`
  varying vec3 vWP;varying vec3 vN;varying vec4 vS;varying vec3 vSc;varying vec3 vBase;varying vec2 vSh;
  vec3 pal(float k,float tint){
    vec3 a=vec3(0.78,0.72,0.62),b=vec3(0.64,0.44,0.34),c=vec3(0.52,0.58,0.64),d=vec3(0.70,0.58,0.38),e=vec3(0.80,0.78,0.74);
    float t=fract(k*7.31+tint*3.17);
    return t<0.34?a:(t<0.52?b:(t<0.66?c:(t<0.82?d:e)));
  }
  void main(){
    vec3 n=normalize(vN);
    float seed=vS.x,type=vS.y,tint=vS.z,flag=vS.w;
    vec3 lc;lc.y=(vWP.y-vBase.y)/vSc.y;
    lc.x=(vWP.x-vBase.x-vSh.x*lc.y)/vSc.x;lc.z=(vWP.z-vBase.z-vSh.y*lc.y)/vSc.z;
    bool broken=flag>1.5&&flag<2.5;
    vec2 q=vec2(lc.x*vSc.x,lc.z*vSc.z);
    if(broken){
      float jag=4.0+17.0*h21(floor(q/4.2)+seed*7.0)+(lc.x-0.5)*16.0+(lc.z-0.5)*11.0;
      if(vWP.y>vBase.y+vSc.y-jag)discard;
    }
    if(abs(vN.y)<0.5&&lc.y>0.25&&flag<2.5){
      float hole=h21(floor(vec2(q.x+q.y,vWP.y)/9.0)+seed*5.0);
      if(hole>(broken?0.86:0.955))discard;
    }
    if(!gl_FrontFacing){
      vec3 inside=vec3(0.07,0.055,0.05)*(0.5+h21(floor(vWP.xz*0.5)+floor(vWP.y*0.25)));
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
      vec2 g=vWP.xz;
      vec3 rc=mix(base*0.9,vec3(0.34,0.36,0.30),step(0.78,h21(floor(g/9.0)+seed*13.0))*0.7);
      float dd=length(vWP-cameraPosition);
      rc*=1.0-0.10*h21(floor(g/3.0))*(1.0-smoothstep(30.0,120.0,dd));
      float eR=min(min(lc.x,1.0-lc.x)*vSc.x,min(lc.z,1.0-lc.z)*vSc.z);
      rc*=0.9+0.1*smoothstep(0.0,3.0,eR);
      col=rc*(amb*0.8+sunC*ndl*0.9);
    }else{
      float u=abs(n.x)>0.5?vWP.z:vWP.x;
      float cw=3.8+type*0.6,ch=3.5;
      vec2 cell=vec2(u/cw,vWP.y/ch);
      vec2 f=fract(cell);vec2 id=floor(cell);
      float win=step(0.2,f.x)*step(f.x,0.78)*step(0.24,f.y)*step(f.y,0.80);
      if(type>1.5)win=step(0.12,f.x)*step(f.x,0.88)*step(0.10,f.y)*step(f.y,0.90)*step(0.35,fract(cell.x*0.5+0.25));
      float farF=smoothstep(110.0,380.0,length(cameraPosition-vWP));
      win=mix(win,0.55,farF);
      float st=h21(id+seed*37.0);
      float gl=smoothstep(0.0,1.0,0.55+0.45*sin(id.x*1.7+id.y*2.3+seed*20.0));
      vec3 wall=base*(0.92+0.08*h21(id*0.3+seed));
      wall*=0.62+0.38*h21(vec2(floor(u/2.6),floor(vWP.y/15.0)+seed*3.0));
      wall*=1.0-0.45*smoothstep(0.35,1.0,h21(vec2(floor(u*0.7),seed)))*(0.3+0.7*(1.0-lc.y));
      wall=mix(wall,wall*vec3(0.55,0.5,0.48),smoothstep(0.55,1.0,h21(vec2(floor(u*0.35),floor(vWP.y/22.0)+seed*5.0))));
      vec3 shade=amb*0.85+sunC*ndl*sunShade;
      vec3 wc=wall*shade;
      vec3 R=reflect(-V,n);
      vec3 glass=skyBase(normalize(vec3(R.x,max(R.y,0.02)+0.12,R.z)))*(0.20+0.2*gl)*0.7;
      float spec=pow(max(dot(R,uSunDir),0.0),70.0);
      glass+=uSunCol*spec*(st<0.5?1.0:6.0);
      glass=mix(glass,vec3(0.012,0.010,0.010),step(st,0.58)*(1.0-farF));
      glass+=vec3(1.0,0.66,0.30)*step(0.997,st)*0.5*(1.0-uAlt*0.8);
      col=mix(wc,glass,win*0.9);
      col*=ao;
      float u01=abs(n.x)>0.5?lc.z:lc.x;float ext=abs(n.x)>0.5?vSc.z:vSc.x;
      float eD=min(u01,1.0-u01)*ext;
      col*=0.72+0.28*smoothstep(0.0,2.4,eD);
      col*=mix(0.88+0.12*smoothstep(0.0,0.35,f.y),1.0,farF);
    }
    // 水際：濡れた壁と白い泡
    float wet=1.0-smoothstep(0.0,7.0,h);
    col*=1.0-0.5*wet;
    float foam=exp(-max(h,0.0)*1.3)*(0.45+0.55*h21(floor(vec2(vWP.x+vWP.z,seed*9.0)*1.6)));
    col=mix(col,vec3(0.82,0.88,0.9)*(0.5+0.6*uSunCol),clamp(foam*step(-0.5,h),0.0,0.85));
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
      const yb=y0<=0?-8:y0;
      const e=c*16;
      arr[e]=x1-x0;arr[e+1]=0;arr[e+2]=0;arr[e+3]=0;
      arr[e+4]=shx;arr[e+5]=y1-yb;arr[e+6]=shz;arr[e+7]=0;
      arr[e+8]=0;arr[e+9]=0;arr[e+10]=z1-z0;arr[e+11]=0;
      arr[e+12]=x0;arr[e+13]=yb;arr[e+14]=z0;arr[e+15]=1;
      const q=c*4;sa[q]=sbuf[s];sa[q+1]=sbuf[s+1];sa[q+2]=sbuf[s+2];sa[q+3]=sbuf[s+3];
      c++;
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
  function vn(g,gs,x,y){ // 周期 gs の value noise
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
const CLOUD_Y=300,CLOUD_N=5;
const cloudLayers=[];
function makeCloudMat(k){
  return new T.ShaderMaterial({
    uniforms:Object.assign({},U,{uNoise:{value:noiseTex},uLY:{value:CLOUD_Y+k*12},uScale:{value:0.00038+k*0.00005},uCover:{value:0.27+k*0.075},uSeed:{value:k*0.37},uK:{value:k/(CLOUD_N-1)}}),
    transparent:true,depthWrite:false,side:T.DoubleSide,
    vertexShader:`varying vec3 vWP;void main(){vec4 wp=modelMatrix*vec4(position,1.0);vWP=wp.xyz;gl_Position=projectionMatrix*viewMatrix*wp;}`,
    fragmentShader:FS_PRE+SKY_GLSL+`
    uniform sampler2D uNoise;uniform float uLY,uScale,uCover,uSeed,uK;
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
      vec3 shadowC=mix(uZen*0.9+vec3(0.10,0.09,0.14),uHor*0.5,0.30);
      vec3 col;
      float sg=pow(max(dot(vdir,uSunDir),0.0),5.0);
      if(above){
        col=mix(shadowC,sunC*0.95+vec3(0.28),lit);
        col*=mix(0.50,1.0,uK);
        col+=uSunCol*sg*0.35*(1.0-d*0.6);
        col=mix(col,col*0.8+uHor*0.2,smoothstep(0.0,0.3,0.35-n)*0.0);
      }else{
        // 下から見た雲：暗く、縁だけ陽に透ける
        col=shadowC*0.62+uHor*0.10;
        col+=sunC*pow(lit,2.0)*0.55*(1.0-d)*(0.35+sg*2.5);
        col+=uSunCol*sg*0.6*(1.0-d*0.8);
      }
      float a=d;
      a*=1.0-smoothstep(1800.0,5200.0,dist);
      float dy=abs(cameraPosition.y-uLY);
      a*=smoothstep(1.5,26.0,dy);
      // 遠景はスカイに溶ける
      col=mix(col,skyBase(vdir),smoothstep(500.0,4200.0,dist)*0.8);
      gl_FragColor=vec4(col,a);
    }`
  });
}
const cloudGeo=new T.PlaneGeometry(1,1).rotateX(-Math.PI/2);
for(let k=0;k<CLOUD_N;k++){
  const m=new T.Mesh(cloudGeo,makeCloudMat(k));
  m.scale.set(11000,1,11000);m.position.y=CLOUD_Y+k*12;m.frustumCulled=false;m.renderOrder=2+k;
  m.visible=false;scene.add(m);cloudLayers.push(m);
}

/* ================= 海（地面） ================= */
const groundMat=new T.ShaderMaterial({
  uniforms:Object.assign({},U),
  vertexShader:`varying vec3 vWP;void main(){vec4 wp=modelMatrix*vec4(position,1.0);vWP=wp.xyz;gl_Position=projectionMatrix*viewMatrix*wp;}`,
  fragmentShader:FS_PRE+SKY_GLSL+`
  varying vec3 vWP;
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
    vec3 deep=vec3(0.012,0.055,0.068)+uZen*0.10;
    vec3 sss=vec3(0.03,0.16,0.15)*(0.4+0.6*uSunCol)*(0.5+0.5*clamp(g.x*0.5+0.5,0.0,1.0));
    vec3 col=mix(mix(deep,sss,0.35*(1.0-F)),sky*0.85,clamp(F,0.0,1.0));
    float sd=max(dot(R,uSunDir),0.0);
    col+=uSunCol*pow(sd,420.0)*60.0+uSunCol*pow(sd,40.0)*0.55*F;
    col=applyFog(col,vWP);
    gl_FragColor=vec4(col,1.0);
  }`
});
const ground=new T.Mesh(new T.PlaneGeometry(1,1).rotateX(-Math.PI/2),groundMat);
ground.scale.set(9000,1,9000);ground.frustumCulled=false;scene.add(ground);
