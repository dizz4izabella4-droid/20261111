/* ================= 一人称の翼（骨格＋羽毛＋蝋） ================= */
const VMU={uSunV:{value:new T.Vector3(0,0.3,-1).normalize()},uUpV:{value:new T.Vector3(0,1,0)},uScorch:{value:0},uWaxHeat:{value:0}};

function featherGeometry(){
  const N=10,pos=[],uv=[],idx=[];
  for(let i=0;i<=N;i++){
    const t=i/N;
    const w=0.5*Math.sqrt(Math.max(0,1-Math.pow(t,3.2)))*(0.5+0.5*Math.min(1,t*6))*0.36;
    const a=w*0.62,b=w*1.38;
    const bend=0.07*t*t;
    pos.push(t,bend-0.014,-a, t,bend,0, t,bend-0.014,b);
    uv.push(t,-1, t,0, t,1);
    if(i<N){const o=i*3;idx.push(o,o+3,o+1, o+1,o+3,o+4, o+1,o+4,o+2, o+2,o+4,o+5);}
  }
  const g=new T.BufferGeometry();
  g.setAttribute('position',new T.Float32BufferAttribute(pos,3));
  g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
const FEATHER_GEO=featherGeometry();
const FEATHER_VS=`varying vec2 vUv;varying vec3 vN;varying vec3 vVP;
void main(){vUv=uv;vN=normalMatrix*normal;vec4 mv=modelViewMatrix*vec4(position,1.0);vVP=mv.xyz;gl_Position=projectionMatrix*mv;}`;
const FEATHER_FS=FS_PRE+SKY_GLSL+`
uniform float uSeed,uLoose,uScorch,uWaxHeat;uniform vec3 uSunV,uUpV;
varying vec2 vUv;varying vec3 vN;varying vec3 vVP;
void main(){
  float u=vUv.x,v=vUv.y,sd=abs(v);
  float side=v>0.0?1.0:0.0;
  float nz=h21(vec2(floor(u*44.0+uSeed*40.0),uSeed*13.0+side));
  float slit=step(0.90-uLoose*0.35-uScorch*0.12,nz)*step(0.40,sd)*smoothstep(0.30,0.65,u);
  float rag=0.985-0.12*h21(vec2(floor(u*62.0),uSeed+side))*smoothstep(0.45,1.0,u)-uLoose*0.22*h21(vec2(floor(u*28.0),uSeed*3.0));
  if(slit>0.5||sd>rag)discard;
  float k=u*30.0-sd*6.5+0.4*h21(vec2(floor(u*30.0),uSeed));
  float barb=0.5+0.5*sin(k*6.2831+uSeed*17.0);
  float fine=0.5+0.5*sin((u*190.0-sd*40.0)*6.2831);
  float rach=1.0-smoothstep(0.0,0.06,sd);
  float rachLine=smoothstep(0.0,0.012,abs(sd-0.075))*0.0+smoothstep(0.045,0.06,sd)*(1.0-smoothstep(0.07,0.11,sd));
  vec3 alb=vec3(0.96,0.91,0.82)*(0.78+0.14*barb+0.08*fine)*(0.88+0.12*fract(uSeed*7.3));
  alb*=1.0-0.30*smoothstep(0.78,1.0,sd);
  alb=mix(alb,vec3(0.74,0.64,0.50),rach*0.75);
  alb=mix(alb,alb*1.12+0.03,rachLine*0.5);
  alb=mix(alb,vec3(0.92,0.74,0.46),smoothstep(0.78,1.0,u)*0.40);
  alb=mix(alb,vec3(0.93,0.60,0.20),smoothstep(0.15,0.0,u)*0.9);
  alb=mix(alb,alb*vec3(0.50,0.34,0.22),clamp(uScorch,0.0,1.0)*smoothstep(0.2,1.0,u)*(0.55+0.45*barb));
  vec3 n=normalize(vN);if(!gl_FrontFacing)n=-n;
  vec3 V=normalize(-vVP);vec3 L=normalize(uSunV);
  vec3 Lv=normalize(L+uUpV*0.95);
  float ndl=dot(n,Lv);
  float diff=clamp(ndl*0.62+0.38,0.0,1.0);diff*=diff;
  float trans=max(-dot(n,L),0.0);
  alb*=0.52+0.48*smoothstep(0.0,0.30,u);
  float sk=dot(n,uUpV)*0.5+0.5;
  vec3 amb=mix(vec3(0.46,0.32,0.24),vec3(0.52,0.52,0.60),sk)*0.95;
  vec3 sun=uSunCol*(1.55+0.6*uAlt);
  vec3 col=alb*(amb*0.85+sun*diff*0.95);
  col+=alb*vec3(1.0,0.72,0.42)*sun*trans*0.85*(0.7+0.3*barb);
  float rim=pow(1.0-abs(dot(n,V)),2.5);
  float back=max(dot(L,-V),0.0);
  col+=uSunCol*rim*(0.12+0.9*pow(back,2.5));
  float spec=pow(max(dot(reflect(-L,n),V),0.0),24.0)*rach;
  col+=sun*spec*0.35;
  col+=vec3(1.0,0.45,0.12)*uWaxHeat*smoothstep(0.3,0.0,u)*0.9;
  gl_FragColor=vec4(col,1.0);
}`;
function makeFeatherMat(seed){
  return new T.ShaderMaterial({
    uniforms:Object.assign({uSeed:{value:seed},uLoose:{value:0}},U,VMU),
    vertexShader:FEATHER_VS,fragmentShader:FEATHER_FS,side:T.DoubleSide
  });
}
const WAX_FS=FS_PRE+SKY_GLSL+`
uniform vec3 uSunV,uUpV;uniform float uWaxHeat;
varying vec3 vN;varying vec3 vVP;varying vec2 vUv;
void main(){
  vec3 n=normalize(vN);vec3 V=normalize(-vVP);vec3 L=normalize(uSunV);
  float ndl=dot(n,L);
  float fres=pow(1.0-max(dot(n,V),0.0),2.5);
  vec3 base=mix(vec3(0.82,0.50,0.16),vec3(1.0,0.46,0.08),uWaxHeat);
  vec3 col=base*(0.35+0.75*max(ndl,0.0))*(0.55+0.45*(dot(n,uUpV)*0.5+0.5));
  col+=base*vec3(1.0,0.7,0.35)*max(-ndl,0.0)*0.8*uSunCol;
  float spec=pow(max(dot(reflect(-L,n),V),0.0),48.0);
  col+=vec3(1.0,0.93,0.78)*spec*(1.0+uAlt*1.0);
  col+=vec3(1.0,0.62,0.25)*fres*0.5;
  col+=vec3(1.0,0.4,0.08)*uWaxHeat*(0.9+0.5*sin(vUv.x*40.0+uTime*3.0));
  gl_FragColor=vec4(col,1.0);
}`;
const WAX_VS=`varying vec3 vN;varying vec3 vVP;varying vec2 vUv;uniform float uWaxHeat;
void main(){vUv=uv;vN=normalMatrix*normal;vec3 p=position;
  p+=normal*(0.004*sin(uv.x*60.0)+0.006*uWaxHeat*sin(uv.x*17.0+3.0));
  p.y-=uWaxHeat*0.02*sin(uv.x*3.14159);
  vec4 mv=modelViewMatrix*vec4(p,1.0);vVP=mv.xyz;gl_Position=projectionMatrix*mv;}`;
const waxMat=new T.ShaderMaterial({uniforms:Object.assign({},U,VMU),vertexShader:WAX_VS,fragmentShader:WAX_FS});

const wings=(function(){
  const group=new T.Group();vmScene.add(group);
  const all=[];
  const sides=[];
  function addFeather(parent,x,z,beta,len,wf,seed,kind,lift){
    const m=new T.Mesh(FEATHER_GEO,makeFeatherMat(seed));
    m.rotation.order='YZX';
    m.position.set(x,kind==='cov'?0.018+all.length*0.00035:(kind==='sec'?-0.004-all.length*0.0003:all.length*0.0002),z);
    m.userData={beta:beta,len:len,wf:wf,seed:seed,kind:kind,lift:lift||0,x:x,alive:true,idx:0};
    m.scale.set(len,len,len*wf);
    m.rotation.y=beta-Math.PI/2;
    m.frustumCulled=false;
    parent.add(m);all.push(m);
    return m;
  }
  function waxStrip(parent,x0,x1,r){
    const g=new T.CylinderGeometry(r,r,x1-x0,10,14,false);
    g.rotateZ(Math.PI/2);g.translate((x0+x1)/2,0,0);
    const m=new T.Mesh(g,waxMat);m.frustumCulled=false;parent.add(m);return m;
  }
  const L1=0.46,L2=0.48,L3=0.40;
  function buildSide(sg){
    const S={sg:sg,feathers:[],prim:[],sec:[],cov:[]};
    S.root=new T.Group();S.root.rotation.order='ZYX';
    S.arm=new T.Group();S.fore=new T.Group();S.hand=new T.Group();
    S.fore.position.set(L1,0,0);S.hand.position.set(L2,0,0);
    S.fore.rotation.order='ZYX';S.hand.rotation.order='ZYX';
    S.root.add(S.arm);S.arm.add(S.fore);S.fore.add(S.hand);
    const wrap=new T.Group();wrap.add(S.root);wrap.scale.x=sg;S.wrap=wrap;
    group.add(wrap);
    // 三列風切（上腕）
    for(let i=0;i<6;i++){const t=(i+0.5)/6;const f=addFeather(S.arm,t*L1,0.02,0.05+0.02*i,0.50-0.015*i,0.62,hash3(i,sg,3),'sec',0.02);S.feathers.push(f);S.sec.push(f);}
    // 次列風切（前腕）
    for(let i=0;i<13;i++){const t=(i+0.5)/13;const f=addFeather(S.fore,t*L2,0.02,-0.05+0.07*t,0.56-0.02*t,0.62,hash3(i,sg,5),'sec',0.02);S.feathers.push(f);S.sec.push(f);}
    // 初列風切（手）
    for(let i=0;i<11;i++){const t=i/10;const f=addFeather(S.hand,Math.min(L3,0.04+t*0.36),0.015,0.12+t*0.95,0.60+0.16*Math.sin(Math.min(1,t*1.3)*Math.PI*0.55)-0.04*t,0.66-0.10*t,hash3(i,sg,7),'pri',0.03);S.feathers.push(f);S.prim.push(f);}
    // 雨覆い（2列）
    for(let row=0;row<2;row++){
      for(let i=0;i<7;i++){const t=(i+0.5)/7;const f=addFeather(S.fore,t*L2,0.02-row*0.0,0.08+0.04*t+row*0.05,0.24+0.06*row,1.15,hash3(i,row*9+sg,11),'cov',0.015);S.feathers.push(f);S.cov.push(f);}
      for(let i=0;i<5;i++){const t=(i+0.5)/5;const f=addFeather(S.hand,t*L3,0.02,0.22+0.7*t+row*0.05,0.22+0.05*row,1.15,hash3(i,row*9+sg,13),'cov',0.02);S.feathers.push(f);S.cov.push(f);}
      for(let i=0;i<5;i++){const t=(i+0.5)/5;const f=addFeather(S.arm,t*L1,0.02,0.06+0.03*t+row*0.05,0.22+0.05*row,1.2,hash3(i,row*9+sg,17),'cov',0.01);S.feathers.push(f);S.cov.push(f);}
    }
    // 蝋の帯
    S.wax=[waxStrip(S.arm,0.0,L1+0.02,0.013),waxStrip(S.fore,-0.02,L2+0.02,0.012),waxStrip(S.hand,-0.02,L3,0.010)];
    // 腕の骨（革）
    const bone=new T.MeshBasicMaterial({color:0x2a1c14});
    return S;
  }
  const R_=buildSide(1),L_=buildSide(-1);sides.push(R_,L_);
  // 各 feather の index
  all.forEach((m,i)=>m.userData.idx=i);

  const st={flap:-1,flapDur:0.64,t:0,layout:{lat:0.30,sweep:0.35,y:-0.30,z:-0.62},load:0,tuck:0,heat:0,roll:0,pitch:0,lag:new T.Vector3(),spread:1,shed:0,open:0,calm:0};
  function flap(power){st.flap=0;st.power=power||1;}
  function setLayout(asp){
    const pf=clamp((1.30-asp)/0.85,0,1);
    st.layout.sweep=lerp(0.62,0.98,pf);
    st.layout.lat=lerp(0.30,0.16,pf);
    st.layout.z=lerp(-0.60,-0.50,pf);
    st.layout.y=lerp(-0.27,-0.34,pf);
    st.layout.sc=lerp(0.82,0.90,pf);
  }
  function ease(x){x=clamp(x,0,1);return x*x*(3-2*x)}
  function update(dt,p){
    st.t+=dt;
    const t=st.t;
    // 羽ばたき位相
    let fa=0,fold=0,open=0;
    if(st.flap>=0){
      st.flap+=dt/st.flapDur;
      const f=st.flap;
      if(f>=1){st.flap=-1;}
      else{
        const up=0.75,dn=-0.62;
        if(f<0.18){fa=lerp(0,up,ease(f/0.18));fold=0.2*ease(f/0.18);}
        else if(f<0.42){const k=ease((f-0.18)/0.24);fa=lerp(up,dn,k);fold=lerp(0.2,0,k);open=0;}
        else if(f<0.80){const k=ease((f-0.42)/0.38);fa=lerp(dn,0.25,k);fold=Math.sin(k*Math.PI)*1.0;open=Math.sin(k*Math.PI);}
        else{const k=ease((f-0.80)/0.2);fa=lerp(0.25,0,k);fold=0;}
        fa*=st.power;
      }
    }
    const lay=st.layout;
    const tuck=p.tuck,load=p.load,heat=p.heat,melt=p.melt||0;
    const flut=(a)=>Math.sin(t*a+p.seed);
    for(let si=0;si<2;si++){
      const S=sides[si];
      const sg=S.sg;
      const rollD=-p.roll*0.22*sg; // 傾いた側の翼は下がる
      const dih=0.22+load*0.10+fa+rollD+0.025*flut(2.3+si)+0.05*(1-tuck)*p.calm-heat*0.25-melt*0.5;
      S.root.rotation.z=dih;
      S.root.rotation.y=lay.sweep*(1-tuck*0.82)+(p.sweepAdd||0)+0.05*flut(1.7)-fold*0.12;
      S.root.rotation.x=p.pitch*0.12+0.03*flut(3.1)+load*0.05;
      S.fore.rotation.y=-(0.30+tuck*0.75+fold*0.75+heat*0.15);
      S.fore.rotation.z=0.05+load*0.12-heat*0.2*S.sg*0-melt*0.4;
      S.hand.rotation.y=0.18+fold*0.55-tuck*0.35+0.05*flut(2.9+si);
      S.hand.rotation.z=0.06+load*0.18-heat*0.16-melt*0.5;
      S.wrap.position.set(sg*lay.lat,lay.y,lay.z);
      S.wrap.scale.set(sg*lay.sc,lay.sc,lay.sc);
      // 羽の開き
      const spread=0.05+open*0.18+tuck*(-0.05)+load*0.05+heat*0.04;
      for(const f of S.feathers){
        const d=f.userData;
        if(!d.alive){continue;}
        let b=d.beta;
        if(d.kind==='pri'){b=0.12+(d.beta-0.12)*(1+spread*2.4+0.06*flut(2+d.seed*5));}
        else if(d.kind==='sec'){b=d.beta+open*0.12*(d.x*2)-tuck*0.1;}
        f.rotation.y=b-Math.PI/2;
        f.rotation.z=d.lift+load*(d.kind==='pri'?0.22:0.12)-tuck*0.04+0.02*flut(3+d.seed*9)+heat*(d.kind==='cov'?0.0:0.06)*(d.seed-0.5)+melt*(d.seed-0.5)*0.5;
        f.rotation.x=(d.seed-0.5)*0.10+open*(d.kind==='pri'?0.4*(d.seed-0.5):0)*2;
      }
      for(const w of S.wax)w.scale.y=w.scale.z=1+heat*0.45+melt*0.5;
    }
    // 慣性・ヘッドボブ
    group.position.set(p.sx||0,p.sy||0,0);
    group.rotation.set(0,0,p.sr||0);
    // 光
    VMU.uWaxHeat.value=heat;VMU.uScorch.value=Math.max(heat*0.8,melt);
  }
  function setLoose(v){for(const m of all)m.material.uniforms.uLoose.value=v;}
  // 羽を一枚抜く（返り値: 現在の vm 空間での位置と姿勢）
  function shed(n){
    const out=[];
    const alive=all.filter(m=>m.userData.alive&&m.userData.kind!=='cov');
    for(let i=0;i<n&&alive.length;i++){
      const k=Math.floor(rnd()*alive.length);const m=alive.splice(k,1)[0];
      m.userData.alive=false;m.visible=false;
      m.updateWorldMatrix(true,false);
      out.push(m.matrixWorld.clone());
    }
    return out;
  }
  function restore(){for(const m of all){m.userData.alive=true;m.visible=true;}setLoose(0);}
  function aliveCount(){let c=0;for(const m of all)if(m.userData.alive&&m.userData.kind!=='cov')c++;return c;}
  function sunView(sunDir,q){ // q: camera quaternion
    const inv=q.clone().invert();
    VMU.uSunV.value.copy(sunDir).applyQuaternion(inv);
    VMU.uUpV.value.set(0,1,0).applyQuaternion(inv);
  }
  setLayout(1.7);
  return {group:group,flap:flap,update:update,setLayout:setLayout,setLoose:setLoose,shed:shed,restore:restore,aliveCount:aliveCount,sunView:sunView,st:st,all:all,sides:sides};
})();
