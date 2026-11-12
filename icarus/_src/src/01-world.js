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

/* ================= 街データ ================= */
const BP=100;                // ブロックピッチ
const BOXMAX=4;
const bbuf=new Float32Array(BOXMAX*6);
const sbuf=new Float32Array(BOXMAX*4);  // seed,type,tint,landmark
function blockInfo(i,j){
  // buf: x0,y0,z0,x1,y1,z1 ... ; 返り値は個数
  const cx=i*BP,cz=j*BP;
  const r0=hash3(i,j,1),r1=hash3(i,j,2),r2=hash3(i,j,3),r3=hash3(i,j,4),r4=hash3(i,j,5),r5=hash3(i,j,6),r6=hash3(i,j,7),r7=hash3(i,j,8),r8=hash3(i,j,9),r9=hash3(i,j,10),rL=hash3(i,j,11);
  const dist=Math.hypot(i,j);
  let n=0;
  function put(x0,y0,z0,x1,y1,z1,type,tint,lm){
    const o=n*6;bbuf[o]=x0;bbuf[o+1]=y0;bbuf[o+2]=z0;bbuf[o+3]=x1;bbuf[o+4]=y1;bbuf[o+5]=z1;
    const s=n*4;sbuf[s]=hash3(i,j,20+n);sbuf[s+1]=type;sbuf[s+2]=tint;sbuf[s+3]=lm;n++;
  }
  if(i===0&&j===0){
    put(cx-22,0,cz-22,cx+22,150,cz+22,0,0.12,0);
    put(cx-15,150,cz-15,cx+15,186,cz+15,1,0.12,0);
    return n;
  }
  if(r0<0.11&&dist>1.5)return 0; // 広場
  if(rL<0.045&&dist>3){ // 雲を突き抜ける塔
    const w=15+8*r2,h=335+150*r1;
    put(cx-w/2,0,cz-w/2,cx+w/2,h,cz+w/2,2,r3,1);
    put(cx-w/2-3,0,cz-w/2-3,cx+w/2+3,h*0.45,cz+w/2+3,0,r3,0);
    return n;
  }
  let h=16+74*Math.pow(r1,1.8);
  h*=1+1.7*Math.exp(-dist/5.5);
  const w=34+22*r2,d=34+22*r3;
  const ox=(r4-0.5)*(60-w),oz=(r5-0.5)*(60-d);
  const type=r6<0.5?0:(r6<0.8?1:2);
  put(cx+ox-w/2,0,cz+oz-d/2,cx+ox+w/2,h,cz+oz+d/2,type,r7,0);
  if(r8<0.5){
    const w2=w*(0.5+0.25*r9),d2=d*(0.5+0.25*r7);
    const h2=h*(0.22+0.5*r4);
    const ox2=(r5-0.5)*(w-w2)*0.8,oz2=(r3-0.5)*(d-d2)*0.8;
    put(cx+ox+ox2-w2/2,h,cz+oz+oz2-d2/2,cx+ox+ox2+w2/2,h+h2,cz+oz+oz2+d2/2,(type+1)%3,r7,0);
    if(r9<0.35){
      const w3=4+3*r1;const h3=14+30*r2;
      put(cx+ox+ox2-w3/2,h+h2,cz+oz+oz2-w3/2,cx+ox+ox2+w3/2,h+h2+h3,cz+oz+oz2+w3/2,2,r7,0);
    }
  }
  return n;
}
function isPlaza(i,j){return !(i===0&&j===0)&&hash3(i,j,1)<0.11&&Math.hypot(i,j)>1.5&&!(hash3(i,j,11)<0.045&&Math.hypot(i,j)>3);}

/* ================= 街インスタンス ================= */
const RAD=19;               // 半径(ブロック)
const MAXI=7200;
const boxGeo=new T.BoxGeometry(1,1,1);boxGeo.translate(0,0.5,0);
const styleAttr=new T.InstancedBufferAttribute(new Float32Array(MAXI*4),4);
styleAttr.setUsage(T.DynamicDrawUsage);
boxGeo.setAttribute('aStyle',styleAttr);
const cityMat=new T.ShaderMaterial({
  uniforms:U,
  vertexShader:`
  attribute vec4 aStyle;
  varying vec3 vWP;varying vec3 vN;varying vec4 vS;varying vec3 vSc;varying vec3 vBase;
  void main(){
    vec4 wp=modelMatrix*instanceMatrix*vec4(position,1.0);
    vBase=instanceMatrix[3].xyz;
    vWP=wp.xyz;vN=normal;vS=aStyle;
    vSc=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));
    gl_Position=projectionMatrix*viewMatrix*wp;
  }`,
  fragmentShader:FS_PRE+SKY_GLSL+`
  varying vec3 vWP;varying vec3 vN;varying vec4 vS;varying vec3 vSc;varying vec3 vBase;
  vec3 pal(float k,float tint){
    // 漆喰・テラコッタ・淡い青・黄土
    vec3 a=vec3(0.86,0.80,0.70),b=vec3(0.78,0.52,0.38),c=vec3(0.62,0.70,0.78),d=vec3(0.82,0.66,0.40),e=vec3(0.92,0.90,0.86);
    float t=fract(k*7.31+tint*3.17);
    vec3 r=t<0.34?a:(t<0.52?b:(t<0.66?c:(t<0.82?d:e)));
    return r;
  }
  void main(){
    vec3 n=normalize(vN);
    vec3 V=normalize(cameraPosition-vWP);
    float seed=vS.x,type=vS.y,tint=vS.z,lm=vS.w;
    vec3 base=pal(seed,tint);
    if(lm>0.5)base=mix(base,vec3(0.95,0.92,0.86),0.7);
    float h=vWP.y;
    vec3 sunC=uSunCol*(1.25+0.5*uAlt);
    vec3 amb=mix(vec3(0.26,0.18,0.15),uZen*0.55+uMid*0.30+uHor*0.28+vec3(0.04),n.y*0.5+0.5);
    float ndl=max(dot(n,uSunDir),0.0);
    // 谷の陰：低層ほど暗く、高さで光が当たる
    float ao=mix(0.28,1.0,smoothstep(2.0,95.0+uAlt*40.0,h));
    float sunShade=smoothstep(-6.0,70.0,h);
    vec3 col;
    if(abs(n.y)>0.5){
      // 屋根
      vec2 g=vWP.xz;
      float gg=h21(floor(g/9.0)+seed*13.0);
      vec3 rc=mix(base*0.92,vec3(0.55,0.60,0.42),step(0.80,gg)*0.6);
      float dd=length(vWP-cameraPosition);
      rc*=1.0-0.06*h21(floor(g/3.0))*(1.0-smoothstep(30.0,120.0,dd));
      vec3 lc=(vWP-vBase)/vSc;float eR=min(min(lc.x,1.0-lc.x)*vSc.x,min(lc.z,1.0-lc.z)*vSc.z);
      rc=mix(rc*1.12+0.03,rc,smoothstep(0.5,1.4,eR));rc*=0.9+0.1*smoothstep(0.0,3.0,eR);
      col=rc*(amb*0.8+sunC*ndl*0.95);
    }else{
      float u=abs(n.x)>0.5?vWP.z:vWP.x;
      float cw=3.8+type*0.6,ch=3.5;
      vec2 cell=vec2(u/cw,vWP.y/ch);
      vec2 f=fract(cell);vec2 id=floor(cell);
      float win=step(0.2,f.x)*step(f.x,0.78)*step(0.24,f.y)*step(f.y,0.80);
      if(type>1.5)win=step(0.12,f.x)*step(f.x,0.88)*step(0.10,f.y)*step(f.y,0.90)*step(0.35,fract(cell.x*0.5+0.25));
      float farF=smoothstep(110.0,380.0,length(cameraPosition-vWP));
      win=mix(win,0.58,farF);
      float lit=mix(step(0.80-0.18*(1.0-uAlt),h21(id+seed*37.0)),0.2*(1.0-uAlt),farF);
      float gl=smoothstep(0.0,1.0,0.55+0.45*sin(id.x*1.7+id.y*2.3+seed*20.0));
      // 床の帯
      float band=smoothstep(0.0,0.08,f.y)*(1.0-smoothstep(0.92,1.0,f.y));
      vec3 wall=base*(0.93+0.07*h21(id*0.3+seed));
      wall*=0.84+0.16*band;
      vec3 shade=amb*0.85+sunC*ndl*sunShade;
      vec3 wc=wall*shade;
      // ガラス：空を映す
      vec3 R=reflect(-V,n);
      vec3 glass=skyBase(normalize(vec3(R.x,max(R.y,0.02)+0.12,R.z)))*(0.55+0.45*gl)*0.75;
      float spec=pow(max(dot(R,uSunDir),0.0),70.0);
      glass+=uSunCol*spec*14.0;
      glass+=vec3(1.0,0.66,0.30)*lit*(1.0-uAlt*0.8)*0.75;
      col=mix(wc,glass,win*0.92);
      col*=ao;
      vec3 lc=(vWP-vBase)/vSc;
      float u01=abs(n.x)>0.5?lc.z:lc.x;float ext=abs(n.x)>0.5?vSc.z:vSc.x;
      float eD=min(u01,1.0-u01)*ext;
      col*=0.72+0.28*smoothstep(0.0,2.4,eD);
      col*=0.93+0.07*smoothstep(0.0,2.5,(1.0-lc.y)*vSc.y);
      col*=mix(0.9+0.1*smoothstep(0.0,0.35,f.y),1.0,farF);
    }
    // 縁をやわらかく
    col=applyFog(col,vWP);
    gl_FragColor=vec4(col,1.0);
  }`
});
const city=new T.InstancedMesh(boxGeo,cityMat,MAXI);
city.frustumCulled=false;city.count=0;
scene.add(city);
const _m4=new T.Matrix4(),_q0=new T.Quaternion(),_v1=new T.Vector3(),_v2=new T.Vector3();
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
      const o=k*6,s=k*4;
      const x0=bbuf[o],y0=bbuf[o+1],z0=bbuf[o+2],x1=bbuf[o+3],y1=bbuf[o+4],z1=bbuf[o+5];
      const e=c*16;
      arr[e]=x1-x0;arr[e+1]=0;arr[e+2]=0;arr[e+3]=0;
      arr[e+4]=0;arr[e+5]=y1-y0;arr[e+6]=0;arr[e+7]=0;
      arr[e+8]=0;arr[e+9]=0;arr[e+10]=z1-z0;arr[e+11]=0;
      arr[e+12]=x0;arr[e+13]=y0;arr[e+14]=z0;arr[e+15]=1;
      const q=c*4;sa[q]=sbuf[s];sa[q+1]=sbuf[s+1];sa[q+2]=sbuf[s+2];sa[q+3]=sbuf[s+3];
      c++;
    }
  }
  city.count=c;
  city.instanceMatrix.needsUpdate=true;styleAttr.needsUpdate=true;
}

/* ================= 地面 ================= */
const groundMat=new T.ShaderMaterial({
  uniforms:U,
  vertexShader:`varying vec3 vWP;void main(){vec4 wp=modelMatrix*vec4(position,1.0);vWP=wp.xyz;gl_Position=projectionMatrix*viewMatrix*wp;}`,
  fragmentShader:FS_PRE+SKY_GLSL+`
  varying vec3 vWP;
  void main(){
    vec2 p=vWP.xz;
    vec2 l=p-floor(p/100.0+0.5)*100.0;
    vec2 a=abs(l);
    float inBlock=step(a.x,31.0)*step(a.y,31.0);
    float side=step(a.x,35.0)*step(a.y,35.0);
    vec3 asph=vec3(0.17,0.16,0.17);
    vec3 plaza=vec3(0.62,0.56,0.46);
    vec3 side_c=vec3(0.50,0.46,0.40);
    // 道路の白線
    float line=0.0;
    float ax=abs(a.x-50.0),az=abs(a.y-50.0);
    float dashX=step(0.5,fract(p.y/8.0));float dashZ=step(0.5,fract(p.x/8.0));
    if(a.y<35.0)line=max(line,step(ax,0.35)*dashX*0.6);
    if(a.x<35.0)line=max(line,step(az,0.35)*dashZ*0.6);
    vec3 c=asph*(0.85+0.3*h21(floor(p*2.0)));
    c=mix(c,vec3(0.7,0.66,0.55),line);
    c=mix(c,side_c,side);
    c=mix(c,plaza*(0.9+0.2*h21(floor(p/3.0))),inBlock);
    float canyon=mix(0.30,1.0,inBlock);
    // 低い太陽の筋
    float shaft=0.6+0.4*sin(p.x*0.021+sin(p.y*0.013)*2.0)*sin(p.y*0.017);
    canyon*=mix(1.0,0.55+0.9*shaft,(1.0-inBlock)*0.65);
    vec3 sunC=uSunCol*(1.0+0.5*uAlt);
    c*=(uZen*0.5+uHor*0.35)+sunC*0.65*canyon;
    c=applyFog(c,vWP);
    gl_FragColor=vec4(c,1.0);
  }`
});
const ground=new T.Mesh(new T.PlaneGeometry(1,1).rotateX(-Math.PI/2),groundMat);
ground.scale.set(9000,1,9000);ground.frustumCulled=false;scene.add(ground);

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
  scene.add(m);cloudLayers.push(m);
}
