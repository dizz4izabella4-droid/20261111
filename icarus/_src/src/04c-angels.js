/* ================= 天使（ゴールに近づくほど、ちらほら見える） ================= */
const angels=(function(){
  const NMAX=8;
  // 翼：羽根ジオメトリを扇状に並べて一枚のメッシュにまとめる
  function wingGeo(){
    const pos=[],uv=[],inf=[],idx=[];
    const fp=FEATHER_GEO.attributes.position,fu=FEATHER_GEO.attributes.uv,fi=FEATHER_GEO.index;
    const M=new T.Matrix4(),Rz=new T.Matrix4(),Rx=new T.Matrix4().makeRotationX(-Math.PI/2),S=new T.Matrix4(),Tm=new T.Matrix4(),v=new T.Vector3();
    const rows=[{n:12,len:1.55,a0:-0.55,a1:1.25,wf:0.62},{n:10,len:1.08,a0:-0.25,a1:1.35,wf:0.8},{n:8,len:0.66,a0:0.05,a1:1.45,wf:1.0}];
    let base=0;
    rows.forEach((r,ri)=>{
      for(let i=0;i<r.n;i++){
        const t=i/(r.n-1);
        const th=r.a0+(r.a1-r.a0)*t;
        const len=r.len*(0.72+0.28*Math.sin(Math.PI*(0.15+0.75*t)));
        const px=0.10+0.30*t,py=0.02+0.42*t+0.06*ri;
        Rz.makeRotationZ(th);Tm.makeTranslation(px,py,-0.02*ri);S.makeScale(len,len,len*r.wf);
        M.copy(Tm).multiply(Rz).multiply(Rx).multiply(S);
        for(let j=0;j<fp.count;j++){v.fromBufferAttribute(fp,j).applyMatrix4(M);pos.push(v.x,v.y,v.z);uv.push(fu.getX(j),fu.getY(j));inf.push(ri/2,t);}
        for(let j=0;j<fi.count;j++)idx.push(fi.getX(j)+base);
        base+=fp.count;
      }
    });
    const g=new T.BufferGeometry();
    g.setAttribute('position',new T.Float32BufferAttribute(pos,3));
    g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
    g.setAttribute('aInfo',new T.Float32BufferAttribute(inf,2));
    g.setIndex(idx);g.computeVertexNormals();
    return g;
  }
  const WG=wingGeo();
  const VS=`attribute vec2 aInfo;varying vec2 vUv;varying vec2 vI;varying vec3 vWP;varying vec3 vNo;varying vec3 vLP;
  void main(){vUv=uv;vI=aInfo;vLP=position;vec4 wp=modelMatrix*vec4(position,1.0);vWP=wp.xyz;vNo=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*viewMatrix*wp;}`;
  const FS_COMMON=`uniform float uFade,uTime;varying vec2 vUv;varying vec2 vI;varying vec3 vWP;varying vec3 vNo;varying vec3 vLP;`;
  function mat(body){
    return new T.ShaderMaterial({uniforms:Object.assign({uFade:{value:0}},U),transparent:true,depthWrite:false,blending:T.AdditiveBlending,side:T.DoubleSide,
      vertexShader:VS,fragmentShader:FS_PRE+FS_COMMON+body});
  }
  const FS_WING=`void main(){
    float u=vUv.x,sd=abs(vUv.y);
    float edge=1.0-smoothstep(0.5,1.0,sd);
    float barb=0.72+0.28*sin((u*26.0-sd*5.0+vI.y*7.0)*6.2831);
    float rach=smoothstep(0.14,0.0,sd)*0.55;
    vec3 c=mix(vec3(1.0,0.84,0.52),vec3(1.0,0.98,0.92),u*0.7+0.25*vI.x);
    float a=(0.26+0.55*edge)*barb*(0.5+0.5*u)+rach;
    a*=1.0-0.35*smoothstep(0.85,1.0,u);
    gl_FragColor=vec4(c*1.5*a*uFade,a*uFade);
  }`;
  const FS_BODY=`void main(){
    vec3 n=normalize(vNo);vec3 V=normalize(cameraPosition-vWP);
    float fr=pow(1.0-abs(dot(n,V)),1.5);
    float a=(0.22+0.65*fr)*(0.6+0.4*smoothstep(-1.8,0.4,vLP.y));
    vec3 c=mix(vec3(1.0,0.9,0.65),vec3(1.0,0.99,0.95),smoothstep(-1.0,0.5,vLP.y));
    gl_FragColor=vec4(c*1.4*a*uFade,a*uFade);
  }`;
  const FS_HALO=`void main(){
    float a=0.9*(0.8+0.2*sin(uTime*2.0));
    gl_FragColor=vec4(vec3(1.0,0.88,0.5)*2.4*a*uFade,a*uFade);
  }`;
  const FS_AURA=`void main(){
    vec2 c=vUv-0.5;float r=length(c)*2.0;
    float a=exp(-r*r*3.2)*0.55;
    gl_FragColor=vec4(vec3(1.0,0.9,0.62)*a*uFade,a*uFade);
  }`;
  const bodyGeo=new T.ConeGeometry(0.46,1.9,18,1,true);bodyGeo.translate(0,-0.95,0);
  const headGeo=new T.SphereGeometry(0.2,14,10);headGeo.translate(0,0.4,0);
  const haloGeo=new T.TorusGeometry(0.34,0.035,8,36);haloGeo.rotateX(Math.PI/2*0.88);haloGeo.translate(0,0.78,0);
  const auraGeo=new T.PlaneGeometry(1,1);
  const list=[];
  for(let i=0;i<NMAX;i++){
    const g=new T.Group();g.visible=false;scene.add(g);
    const mW=mat(FS_WING),mB=mat(FS_BODY),mH=mat(FS_HALO),mA=mat(FS_AURA);
    const wr=new T.Mesh(WG,mW),wl=new T.Mesh(WG,mW);
    wr.position.set(0.16,0.34,-0.12);wl.position.set(-0.16,0.34,-0.12);wl.scale.x=-1;
    const body=new T.Mesh(bodyGeo,mB),head=new T.Mesh(headGeo,mB),halo=new T.Mesh(haloGeo,mH);
    const aura=new T.Mesh(auraGeo,mA);aura.scale.set(11,11,1);aura.position.set(0,0.2,-0.5);
    [wr,wl,body,head,halo,aura].forEach(m=>{m.frustumCulled=false;g.add(m);});
    aura.renderOrder=21;wr.renderOrder=22;wl.renderOrder=22;body.renderOrder=22;head.renderOrder=22;halo.renderOrder=23;
    list.push({g:g,wr:wr,wl:wl,mats:[mW,mB,mH,mA],live:false,age:0,life:0,x:0,y:0,z:0,vx:0,vy:0,vz:0,sc:8,ph:0,fade:0,flapped:false});
  }
  let spawnT=3,seen=0;
  function clear(){for(const a of list){a.live=false;a.g.visible=false;}spawnT=3;seen=0;}
  function spawn(c){
    const a=list.find(q=>!q.live);if(!a)return;
    const pr=c.pr;
    const d=(520-290*pr)*(0.8+0.4*rnd());
    const ang=c.yaw+(rnd()-0.5)*2.2;
    a.x=c.x-Math.sin(ang)*d;a.z=c.z-Math.cos(ang)*d;
    a.y=Math.max(60,c.y+(rnd()-0.3)*140+30);
    a.vx=(rnd()-0.5)*6;a.vy=(rnd()-0.4)*2;a.vz=(rnd()-0.5)*6;
    a.sc=10+6*rnd();a.age=0;a.life=9+7*rnd();a.ph=rnd()*6.28;a.live=true;a.fade=0;a.flapped=false;
    a.g.scale.setScalar(a.sc);a.g.visible=true;seen++;
  }
  let px=0,py=0,pz=0,have=false;
  function update(dt,c){
    const ddx=have?c.x-px:0,ddy=have?c.y-py:0,ddz=have?c.z-pz:0;px=c.x;py=c.y;pz=c.z;have=true;
    const flying=c.mode==='fly'||c.mode==='melt'||c.mode==='end';
    const target=flying?Math.floor(sstep(0.16,0.9,c.pr)*7+0.35):0;
    let active=0;for(const a of list)if(a.live)active++;
    spawnT-=dt;
    if(flying&&active<target&&spawnT<=0&&c.mode!=='end'){spawn(c);spawnT=3.2+3.5*rnd()*(1.2-c.pr);}
    let presence=0;
    for(const a of list){
      if(!a.live)continue;
      a.age+=dt;
      // プレイヤーの動きに「ほぼ」付いてくる＝追いつけない
      a.x+=ddx*0.9+a.vx*dt;a.y+=ddy*0.9+a.vy*dt;a.z+=ddz*0.9+a.vz*dt;
      const dx=c.x-a.x,dy=c.y-a.y,dz=c.z-a.z,dist=Math.hypot(dx,dy,dz);
      let f=Math.min(1,a.age/2.2)*Math.min(1,(a.life-a.age)/2.4);
      if(dist<110)f=Math.min(f,(dist-50)/60);
      if(c.mode==='end')f=Math.min(1,a.age/2.0)*0.85;
      a.fade=Math.max(0,f);
      if(a.age>a.life&&c.mode!=='end'||a.fade<=0&&a.age>3){a.live=false;a.g.visible=false;continue;}
      a.g.position.set(a.x,a.y,a.z);
      a.g.rotation.y=Math.atan2(dx,dz);
      const T0=2.6,ph=(c.t/T0+a.ph)%1;
      const fl=Math.sin(ph*6.2832);
      a.wr.rotation.z=0.08+0.30*fl;a.wl.rotation.z=-(0.08+0.30*fl);
      a.g.position.y+=0.5*Math.sin(c.t*0.9+a.ph);
      for(const m of a.mats){m.uniforms.uFade.value=a.fade;}
      const near=Math.exp(-dist/900);
      presence=Math.max(presence,a.fade*(0.35+0.65*near));
      // 羽ばたきの音（下ろす瞬間）
      if(ph>0.5&&!a.flapped){a.flapped=true;if(a.fade>0.35&&dist<900){const cs=Math.cos(c.yaw),sn=Math.sin(c.yaw);const side=(dx*cs-dz*sn)/Math.max(dist,1);audio.angelFlap(Math.max(-1,Math.min(1,side*1.4)),a.fade*Math.exp(-dist/700));}}
      if(ph<0.5)a.flapped=false;
    }
    return {presence:presence,seen:seen};
  }
  return {update:update,clear:clear,list:list,spawn:spawn};
})();
