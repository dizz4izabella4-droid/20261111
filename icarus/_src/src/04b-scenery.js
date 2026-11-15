/* ================= 景観：屋上の樹々・浮遊島・滝・崩れた環・漂う岩 ================= */
function mergeG(list){
  let n=0;const gs=list.map(it=>{const g=it.g.index?it.g.toNonIndexed():it.g;n+=g.attributes.position.count;return {g:g,kind:it.kind};});
  const pos=new Float32Array(n*3),nor=new Float32Array(n*3),kd=new Float32Array(n);
  let o=0;
  for(const it of gs){
    const p=it.g.attributes.position,q=it.g.attributes.normal;
    for(let i=0;i<p.count;i++){
      pos[(o+i)*3]=p.getX(i);pos[(o+i)*3+1]=p.getY(i);pos[(o+i)*3+2]=p.getZ(i);
      nor[(o+i)*3]=q.getX(i);nor[(o+i)*3+1]=q.getY(i);nor[(o+i)*3+2]=q.getZ(i);kd[o+i]=it.kind;
    }
    o+=p.count;
  }
  const g=new T.BufferGeometry();
  g.setAttribute('position',new T.BufferAttribute(pos,3));
  g.setAttribute('normal',new T.BufferAttribute(nor,3));
  g.setAttribute('aKind',new T.BufferAttribute(kd,1));
  return g;
}
function lcg(seed){let s=seed>>>0;return function(){s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};}

/* ---------- 樹 ---------- */
function treeGeo(){
  const L=[];
  L.push({g:new T.CylinderGeometry(0.26,0.5,5.4,6,1).translate(0,2.7,0),kind:0});
  const blobs=[[0,6.4,0,3.3],[-2.1,5.3,0.7,2.4],[2.0,5.5,-0.6,2.5],[0.3,8.3,0.2,2.2],[0.5,4.9,-2.1,2.0],[-0.6,5.0,2.2,2.1]];
  for(const b of blobs)L.push({g:new T.IcosahedronGeometry(b[3],1).translate(b[0],b[1],b[2]),kind:1});
  return mergeG(L);
}
const treeMat=new T.ShaderMaterial({
  uniforms:U,
  vertexShader:`attribute float aKind;attribute float aT;
  varying vec3 vWP;varying vec3 vN;varying vec3 vLP;varying float vK;varying float vT;
  uniform float uTime;
  void main(){
    vec3 p=position;
    float ph=instanceMatrix[3].x*0.07+instanceMatrix[3].z*0.05;
    p.xz+=vec2(sin(uTime*1.1+ph),cos(uTime*0.9+ph*1.3))*0.07*aKind*max(p.y-3.0,0.0);
    vec4 wp=modelMatrix*instanceMatrix*vec4(p,1.0);
    vWP=wp.xyz;vLP=position;vK=aKind;vT=aT;
    vN=normalize(mat3(modelMatrix)*mat3(instanceMatrix)*normal);
    gl_Position=projectionMatrix*viewMatrix*wp;
  }`,
  fragmentShader:FS_PRE+SKY_GLSL+`
  uniform float uLamp;
  varying vec3 vWP;varying vec3 vN;varying vec3 vLP;varying float vK;varying float vT;
  void main(){
    vec3 n=normalize(vN);
    bool sacred=vT>1.5;
    vec3 base;
    float cl=h21(floor(vLP.xy*2.2)+floor(vLP.z*2.2)*7.0);
    if(vK<0.5){base=vec3(0.26,0.19,0.14);}
    else{
      base=mix(vec3(0.09,0.26,0.07),vec3(0.24,0.40,0.10),clamp(vT*0.8+cl*0.6,0.0,1.0));
      if(sacred)base=mix(mix(vec3(0.70,0.52,0.26),vec3(0.80,0.40,0.50),cl),vec3(0.80,0.66,0.40),0.2);
    }
    vec3 V=normalize(cameraPosition-vWP);
    float ndl=dot(n,uSunDir);
    float wrap=clamp(ndl*0.5+0.5,0.0,1.0);
    vec3 amb=mix(vec3(0.25,0.20,0.18),uZen*0.5+uMid*0.35+uHor*0.25+vec3(0.04),n.y*0.5+0.5);
    vec3 sunC=uSunCol*(1.25+0.5*uAlt);
    float back=pow(max(dot(-V,uSunDir),0.0),3.0);
    vec3 col=base*(amb*0.85+sunC*wrap*wrap*0.9)+base*sunC*back*0.35*vK;
    col*=(vK>0.5)?(0.68+0.32*smoothstep(-3.0,3.5,vLP.y)):1.0;
    if(sacred)col+=vec3(1.0,0.78,0.52)*vK*(0.10+0.34*uLamp)*(0.6+0.4*sin(uTime*0.6+vLP.y*1.3+cl*6.0));
    col=applyFog(col,vWP);
    gl_FragColor=vec4(col,1.0);
  }`
});
function makeTreeSet(max){
  const g=treeGeo();
  const aT=new T.InstancedBufferAttribute(new Float32Array(max),1);aT.setUsage(T.DynamicDrawUsage);
  g.setAttribute('aT',aT);
  const mesh=new T.InstancedMesh(g,treeMat,max);
  mesh.frustumCulled=false;mesh.count=0;mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
  scene.add(mesh);
  const m4=new T.Matrix4(),q=new T.Quaternion(),pv=new T.Vector3(),sv=new T.Vector3(),ya=new T.Vector3(0,1,0);
  const S={mesh:mesh,aT:aT,n:0,max:max,
    add(x,y,z,s,rot,hue){
      if(S.n>=max)return;
      q.setFromAxisAngle(ya,rot);pv.set(x,y,z);sv.set(s,s*(0.9+0.2*(hue%1)),s);m4.compose(pv,q,sv);
      mesh.setMatrixAt(S.n,m4);aT.array[S.n]=hue;S.n++;
    },
    flush(){mesh.count=S.n;mesh.instanceMatrix.needsUpdate=true;aT.needsUpdate=true;}
  };
  return S;
}
const cityTrees=(function(){
  const S=makeTreeSet(2600);
  function roof(i,j,k,x0,y1,z0,x1,z1,shx,shz,fl){
    if(fl===0&&y1<14)return;
    const r=hash3(i,j,100+k);
    const cnt=fl===3?(r<0.7?2:1):(r<0.35?0:(r<0.7?1:(r<0.92?2:3)));
    const w=x1-x0,d=z1-z0;
    for(let c=0;c<cnt;c++){
      const a=hash3(i,j,110+k*4+c),b=hash3(i,j,120+k*4+c),h2=hash3(i,j,130+k*4+c);
      S.add(x0+shx+w*(0.18+0.64*a),y1-0.2,z0+shz+d*(0.18+0.64*b),1.5+2.0*h2*h2+(fl===3?0.6:0),h2*TAU,hash3(i,j,140+k+c));
    }
  }
  return {begin(){S.n=0;},end(){S.flush();},roof:roof};
})();

/* ---------- 岩・遺構の共通マテリアル ---------- */
function makeStoneMat(){
  return new T.ShaderMaterial({
    uniforms:U,side:T.DoubleSide,
    vertexShader:`attribute float aKind;varying vec3 vWP;varying vec3 vN;varying float vK;uniform float uTime;
    void main(){
      vec4 p4=vec4(position,1.0);
      #ifdef USE_INSTANCING
      vec4 wp=modelMatrix*instanceMatrix*p4;
      wp.y+=sin(uTime*0.35+instanceMatrix[3].x*0.05)*1.6;
      vN=normalize(mat3(modelMatrix)*mat3(instanceMatrix)*normal);
      #else
      vec4 wp=modelMatrix*p4;
      vN=normalize(mat3(modelMatrix)*normal);
      #endif
      vWP=wp.xyz;vK=aKind;
      gl_Position=projectionMatrix*viewMatrix*wp;
    }`,
    fragmentShader:FS_PRE+SKY_GLSL+`
    varying vec3 vWP;varying vec3 vN;varying float vK;
    void main(){
      vec3 n=normalize(vN);if(!gl_FrontFacing)n=-n;
      float nz=h21(floor(vWP.xz/6.0)+floor(vWP.y/6.0)*13.0);
      float nz2=h21(floor(vWP.xz/1.4)+floor(vWP.y/1.4)*7.0);
      float up=n.y;
      vec3 base;
      if(vK<0.5){
        vec3 rock=mix(vec3(0.42,0.36,0.31),vec3(0.56,0.50,0.44),nz*0.7+nz2*0.3);
        rock*=0.82+0.18*(0.5+0.5*sin(vWP.y*0.32+nz*3.0));
        vec3 grass=mix(vec3(0.19,0.35,0.10),vec3(0.38,0.48,0.16),nz2);
        float gA=smoothstep(0.50,0.78,up+0.16*(nz-0.5));
        base=mix(rock,grass,gA);
      }else{
        vec3 st=vec3(0.62,0.60,0.55)*(0.78+0.22*nz2);
        st*=0.85+0.15*h21(floor(vec2(vWP.x+vWP.z,vWP.y)/3.0));
        vec3 grass=mix(vec3(0.15,0.29,0.09),vec3(0.30,0.42,0.13),nz2);
        float gA=smoothstep(0.30,0.70,up+0.3*(nz-0.5));
        float cell=floor((vWP.x+vWP.z)/2.0);
        float vine=step(0.68,h21(vec2(cell,1.0)))*h21(vec2(cell,floor(vWP.y/3.0)))*0.8;
        base=mix(st,grass,clamp(gA*0.9+vine*0.6+smoothstep(0.72,0.95,nz)*0.4,0.0,0.95));
      }
      vec3 amb=mix(vec3(0.26,0.20,0.17),uZen*0.5+uMid*0.35+uHor*0.30+vec3(0.04),n.y*0.5+0.5);
      vec3 sunC=uSunCol*(1.25+0.5*uAlt);
      float ndl=max(dot(n,uSunDir),0.0);
      vec3 col=base*(amb*0.95+sunC*ndl*0.95);
      col=applyFog(col,vWP);
      gl_FragColor=vec4(col,1.0);
    }`
  });
}
const stoneMat=makeStoneMat();
const stoneMatInst=makeStoneMat();

/* ---------- 浮遊島 ---------- */
const ISL=[
  {x:360,y:610,z:-2900,R:80,H:120,fall:2.2,seed:1,ruin:3,trees:8},
  {x:-60,y:560,z:-3100,R:130,H:190,fall:0.6,seed:2,ruin:5,trees:14},
  {x:-330,y:650,z:-3420,R:240,H:330,fall:5.6,seed:3,ruin:10,trees:34,sacred:true},
  {x:260,y:720,z:-3500,R:70,H:100,fall:null,seed:4,ruin:2,trees:6},
  {x:-300,y:560,z:-4300,R:100,H:150,fall:1.2,seed:5,ruin:4,trees:10},
  {x:160,y:640,z:-4500,R:90,H:130,fall:null,seed:6,ruin:3,trees:9},
  {x:-520,y:650,z:-4900,R:140,H:200,fall:3.0,seed:7,ruin:5,trees:14},
  {x:100,y:500,z:-4950,R:60,H:90,fall:5.2,seed:8,ruin:2,trees:5}
];
function topAt(I,dx,dz){const r=Math.hypot(dx,dz)/I.R;return 0.07*I.R*Math.sqrt(Math.max(0,1-r*r));}
const islTrees=makeTreeSet(500);
const SACRED={x:0,y:0,z:0,top:0,s:26};
function buildIsland(I){
  const rr=lcg(I.seed*977+13);
  const base=new T.IcosahedronGeometry(1,3);
  const p=base.attributes.position;
  const nzf=(x,y,z)=>Math.sin(x*5.1+z*3.7+I.seed)*Math.cos(y*4.3+x*2.9)*0.5+Math.sin(z*7.7-y*3.1+I.seed*2)*0.5;
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
    let X,Y,Z;
    if(y>=0){X=x*I.R;Z=z*I.R;Y=0.07*I.R*y;}
    else{
      const d=-y,tp=1-0.6*Math.pow(d,0.9),wob=1+0.16*nzf(x*3,y*3,z*3);
      X=x*I.R*tp*wob;Z=z*I.R*tp*wob;Y=-I.H*Math.pow(d,1.25)*(1+0.10*nzf(x*4,y*4,z*4));
    }
    p.setXYZ(i,X,Y,Z);
  }
  base.computeVertexNormals();
  const L=[{g:base,kind:0}];
  const sc=Math.sqrt(I.R/100);
  for(let k=0;k<I.ruin;k++){
    let px,pz,h,w;
    if(I.sacred&&k<8){const a=k/8*TAU+0.3;px=Math.cos(a)*I.R*0.52;pz=Math.sin(a)*I.R*0.52;h=(26+30*rr())*sc;w=(5+3*rr())*sc;}
    else{const a=rr()*TAU,r=I.R*(0.2+0.5*rr());px=Math.cos(a)*r;pz=Math.sin(a)*r;h=(8+34*rr())*sc;w=(3.5+4*rr())*sc;}
    const bg=new T.BoxGeometry(w,h,w*(0.6+0.8*rr())).toNonIndexed();
    bg.translate(0,h/2,0);bg.rotateX((rr()-0.5)*0.16);bg.rotateZ((rr()-0.5)*0.16);bg.rotateY(rr()*TAU);
    bg.translate(px,topAt(I,px,pz)-0.8,pz);
    L.push({g:bg,kind:1});
    if(I.sacred&&k<8&&k%2===0){ // 対の柱をつなぐ崩れかけの梁
      const a2=(k+1)/8*TAU+0.3,qx=Math.cos(a2)*I.R*0.52,qz=Math.sin(a2)*I.R*0.52;
      const len=Math.hypot(qx-px,qz-pz);
      const lg=new T.BoxGeometry(len*0.92,4.2*sc,4.6*sc).toNonIndexed();
      lg.rotateY(-Math.atan2(qz-pz,qx-px));lg.rotateZ((rr()-0.5)*0.05);
      lg.translate((px+qx)/2,topAt(I,(px+qx)/2,(pz+qz)/2)+h*0.86,(pz+qz)/2);
      L.push({g:lg,kind:1});
    }
  }
  const mesh=new T.Mesh(mergeG(L),stoneMat);
  mesh.position.set(I.x,I.y,I.z);mesh.frustumCulled=false;scene.add(mesh);
  // 木々
  for(let k=0;k<I.trees;k++){
    const a=rr()*TAU,r=I.R*(0.08+0.78*Math.sqrt(rr()));
    const dx=Math.cos(a)*r,dz=Math.sin(a)*r;
    const s=(2.0+2.2*rr())*(0.65+I.R/250);
    const hue=I.sacred?(rr()<0.65?2.0:rr()):rr();
    islTrees.add(I.x+dx,I.y+topAt(I,dx,dz)-0.6,I.z+dz,s,rr()*TAU,hue);
  }
  if(I.sacred){
    SACRED.x=I.x;SACRED.z=I.z;SACRED.top=I.y+topAt(I,0,0)-1;SACRED.y=SACRED.top;
    islTrees.add(I.x,SACRED.top,I.z,SACRED.s,0.6,2.0);
  }
  // 滝
  if(I.fall!==null){
    const a=I.fall,er=I.R*0.93;
    const ex=Math.cos(a)*er,ez=Math.sin(a)*er,ey=topAt(I,ex,ez);
    const Lf=Math.min(I.y-6,900);
    const wF=10+I.R*0.14;
    for(let c=0;c<2;c++){
      const wm=new T.Mesh(waterGeo,waterMat);
      wm.scale.set(wF,Lf,1);wm.position.set(I.x+ex,I.y+ey,I.z+ez);
      wm.rotation.y=Math.PI/2-a+c*Math.PI/2;wm.frustumCulled=false;wm.renderOrder=10;
      scene.add(wm);
    }
  }
}
const waterGeo=new T.PlaneGeometry(1,1,8,40);waterGeo.translate(0,-0.5,0);
const waterMat=new T.ShaderMaterial({
  uniforms:U,transparent:true,depthWrite:false,side:T.DoubleSide,
  vertexShader:`varying vec2 vUv;varying vec3 vWP;uniform float uTime;
  void main(){
    vUv=uv;vec3 p=position;
    float k=1.0-uv.y;
    p.x*=1.0+1.4*k;
    p.x+=sin(k*14.0-uTime*1.5)*0.03*k;
    vec4 wp=modelMatrix*vec4(p,1.0);vWP=wp.xyz;
    gl_Position=projectionMatrix*viewMatrix*wp;
  }`,
  fragmentShader:FS_PRE+SKY_GLSL+`varying vec2 vUv;varying vec3 vWP;
  void main(){
    float k=1.0-vUv.y;
    float flow=h21(vec2(floor(vUv.x*22.0),floor(k*70.0+uTime*16.0)));
    float flow2=h21(vec2(floor(vUv.x*9.0+3.0),floor(k*30.0+uTime*9.0)));
    float s=0.45+0.55*(flow*0.6+flow2*0.4);
    float a=s*smoothstep(0.0,0.14,vUv.x)*smoothstep(1.0,0.86,vUv.x)*(1.0-smoothstep(0.45,1.0,k))*smoothstep(0.0,0.02,k);
    vec3 c=mix(vec3(0.72,0.86,0.96),vec3(1.0,0.97,0.92)*uSunCol*1.1,0.25+0.4*flow)*(0.55+0.55*uAlt);
    c=applyFog(c,vWP);
    gl_FragColor=vec4(c,a*0.85);
  }`
});
ISL.forEach(buildIsland);
islTrees.flush();

/* ---------- 崩れかけた巨大な環（くぐり抜ける門） ---------- */
const RING={x:100,y:732,z:-3790,R:230,tube:15};
(function(){
  const tg=new T.TorusGeometry(RING.R,RING.tube,10,140,5.0).rotateZ(-0.6);
  const m=new T.Mesh(mergeG([{g:tg,kind:1}]),stoneMat);
  m.position.set(RING.x,RING.y,RING.z);m.frustumCulled=false;scene.add(m);
  const gg=new T.TorusGeometry(RING.R-RING.tube*0.92,1.7,6,140,5.0).rotateZ(-0.6);
  const gm=new T.Mesh(gg,new T.ShaderMaterial({uniforms:U,transparent:true,depthWrite:false,blending:T.AdditiveBlending,
    vertexShader:`varying vec3 vWP;void main(){vec4 wp=modelMatrix*vec4(position,1.0);vWP=wp.xyz;gl_Position=projectionMatrix*viewMatrix*wp;}`,
    fragmentShader:FS_PRE+SKY_GLSL+`varying vec3 vWP;uniform float uLamp;
    void main(){
      float a=atan(vWP.y-${RING.y.toFixed(1)},vWP.x-${RING.x.toFixed(1)});
      float p=0.65+0.35*sin(a*9.0-uTime*0.6);
      vec3 c=vec3(1.0,0.84,0.55)*p*(1.5+1.2*uLamp);
      gl_FragColor=vec4(c,0.9);
    }`}));
  gm.position.copy(m.position);gm.frustumCulled=false;gm.renderOrder=18;scene.add(gm);
})();

/* ---------- 漂う岩（島と環のまわり） ---------- */
(function(){
  const N=260;
  const g=mergeG([{g:new T.IcosahedronGeometry(1,0),kind:1}]);
  const mesh=new T.InstancedMesh(g,stoneMatInst,N);
  const m4=new T.Matrix4(),q=new T.Quaternion(),e=new T.Euler(),pv=new T.Vector3(),sv=new T.Vector3();
  const rr=lcg(4242);
  let c=0;
  function put(x,y,z,s){
    if(c>=N)return;
    e.set(rr()*TAU,rr()*TAU,rr()*TAU);q.setFromEuler(e);pv.set(x,y,z);sv.set(s,s*(0.6+0.5*rr()),s*(0.7+0.5*rr()));
    m4.compose(pv,q,sv);mesh.setMatrixAt(c++,m4);
  }
  for(const I of ISL){
    const n=Math.round(5+I.R/18);
    for(let k=0;k<n;k++){
      const a=rr()*TAU,r=I.R*(1.05+0.7*rr());
      put(I.x+Math.cos(a)*r,I.y-I.H*0.5*rr()+I.R*0.05*rr(),I.z+Math.sin(a)*r,2+rr()*rr()*(5+I.R/16));
    }
  }
  for(let k=0;k<80;k++){ // 環の崩れた断片
    const a=-0.6+5.0+rr()*1.2-0.3,r=RING.R+(rr()-0.5)*90;
    put(RING.x+Math.cos(a)*r+(rr()-0.5)*50,RING.y+Math.sin(a)*r+(rr()-0.5)*40,RING.z+(rr()-0.5)*120,3+rr()*rr()*20);
  }
  while(c<N){const a=rr()*TAU,r=300+rr()*1300;put(Math.cos(a)*r*0.5+60,500+rr()*400,-2600-rr()*2600,2+rr()*rr()*9);}
  mesh.count=c;mesh.instanceMatrix.needsUpdate=true;mesh.frustumCulled=false;scene.add(mesh);
})();

/* ---------- 聖なる樹のまわりの光 ---------- */
const sacredGlow=(function(){
  const m=new T.Mesh(new T.PlaneGeometry(1,1),new T.ShaderMaterial({uniforms:U,transparent:true,depthWrite:false,blending:T.AdditiveBlending,
    vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:FS_PRE+SKY_GLSL+`varying vec2 vUv;uniform float uLamp;
    void main(){vec2 c=vUv-0.5;float r=length(c)*2.0;
      float a=exp(-r*r*3.4)*(0.30+0.45*uLamp)+exp(-r*r*14.0)*0.16;
      gl_FragColor=vec4(vec3(1.0,0.84,0.58)*a,a);}`}));
  m.position.set(SACRED.x,SACRED.top+SACRED.s*6.6,SACRED.z);m.scale.set(SACRED.s*17,SACRED.s*17,1);
  m.frustumCulled=false;m.renderOrder=17;scene.add(m);
  return m;
})();
function sceneryUpdate(){sacredGlow.quaternion.copy(cam.quaternion);}
