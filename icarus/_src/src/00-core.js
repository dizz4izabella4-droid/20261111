(function(){
'use strict';
const T=THREE;
const $=id=>document.getElementById(id);
const clamp=(x,a,b)=>x<a?a:x>b?b:x;
const lerp=(a,b,t)=>a+(b-a)*t;
const sstep=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t)};
const TAU=Math.PI*2;
let _seed=20261112;
function rnd(){_seed=(Math.imul(_seed,1664525)+1013904223)>>>0;return _seed/4294967296}
function hash3(i,j,k){let n=(Math.imul(i,374761393)+Math.imul(j,668265263)+Math.imul(k,1442695041))|0;n=Math.imul(n^(n>>>13),1274126177);n^=n>>>16;return (n>>>0)/4294967296}

const canvas=$('c');
let renderer;
try{
  renderer=new T.WebGLRenderer({canvas:canvas,antialias:false,alpha:false,powerPreference:'high-performance',stencil:false,depth:true});
  if(!renderer.capabilities.isWebGL2)throw new Error('webgl2');
}catch(e){$('err').style.display='grid';return}
renderer.autoClear=false;
renderer.setClearColor(0x000000,1);
const HALF=renderer.extensions.has('EXT_color_buffer_float')||renderer.extensions.has('EXT_color_buffer_half_float');
const MSAA=renderer.extensions.has('EXT_color_buffer_float')?Math.min(4,renderer.capabilities.maxSamples||0):0;

/* ---------- 共有ユニフォーム ---------- */
const U={
  uTime:{value:0},
  uSunDir:{value:new T.Vector3(0,0.2,-1).normalize()},
  uZen:{value:new T.Color(0x1a2a60)},
  uHor:{value:new T.Color(0xff9a5a)},
  uMid:{value:new T.Color(0x8aa6e0)},
  uSunCol:{value:new T.Color(0xffb060)},
  uSunR:{value:0.035},
  uAlt:{value:0},
  uHeat:{value:0},
  uFogDen:{value:0.0011},
  uMist:{value:0},
  uMistCol:{value:new T.Color(0xdfe3ea)}
};

const scene=new T.Scene();
const cam=new T.PerspectiveCamera(78,1,0.15,12000);
cam.rotation.order='YXZ';
const vmScene=new T.Scene();
const vmCam=new T.PerspectiveCamera(70,1,0.03,40);

/* 全画面三角形 */
const triGeo=new T.BufferGeometry();
triGeo.setAttribute('position',new T.BufferAttribute(new Float32Array([-1,-1,0,3,-1,0,-1,3,0]),3));
const camDummy=new T.Camera();

/* ---------- ポストプロセス ---------- */
const GLSL_FS_HEAD='precision highp float;\n';
const VS_QUAD='varying vec2 vUv;void main(){vUv=position.xy*0.5+0.5;gl_Position=vec4(position.xy,0.0,1.0);}';
function quadMat(fs,uniforms,extra){
  return new T.ShaderMaterial(Object.assign({uniforms:uniforms,vertexShader:VS_QUAD,fragmentShader:fs,depthTest:false,depthWrite:false,blending:T.NoBlending},extra||{}));
}
const matPre=quadMat(`
uniform sampler2D tScene;uniform float uThr;
varying vec2 vUv;
void main(){
  vec3 c=texture2D(tScene,vUv).rgb;
  c=min(c,vec3(24.0));
  float l=max(max(c.r,c.g),c.b);
  float k=max(l-uThr,0.0);
  k=k/max(l,1e-4);
  gl_FragColor=vec4(c*k,1.0);
}`,{tScene:{value:null},uThr:{value:0.9}});
const matDown=quadMat(`
uniform sampler2D tSrc;uniform vec2 uTexel;
varying vec2 vUv;
vec3 S(vec2 o){return texture2D(tSrc,vUv+o*uTexel).rgb;}
void main(){
  vec3 e=S(vec2(0.0));
  vec3 a=S(vec2(-2.,2.)),b=S(vec2(0.,2.)),c=S(vec2(2.,2.));
  vec3 d=S(vec2(-2.,0.)),f=S(vec2(2.,0.));
  vec3 g=S(vec2(-2.,-2.)),h=S(vec2(0.,-2.)),i=S(vec2(2.,-2.));
  vec3 j=S(vec2(-1.,1.)),k=S(vec2(1.,1.)),l=S(vec2(-1.,-1.)),m=S(vec2(1.,-1.));
  vec3 r=e*0.125+(a+c+g+i)*0.03125+(b+d+f+h)*0.0625+(j+k+l+m)*0.125;
  gl_FragColor=vec4(r,1.0);
}`,{tSrc:{value:null},uTexel:{value:new T.Vector2()}});
const matUp=quadMat(`
uniform sampler2D tSrc;uniform vec2 uTexel;uniform float uW;
varying vec2 vUv;
vec3 S(vec2 o){return texture2D(tSrc,vUv+o*uTexel).rgb;}
void main(){
  vec3 r=S(vec2(-1.,1.))+S(vec2(1.,1.))+S(vec2(-1.,-1.))+S(vec2(1.,-1.));
  r+=2.0*(S(vec2(0.,1.))+S(vec2(0.,-1.))+S(vec2(1.,0.))+S(vec2(-1.,0.)));
  r+=4.0*S(vec2(0.));
  gl_FragColor=vec4(r*(1.0/16.0)*uW,1.0);
}`,{tSrc:{value:null},uTexel:{value:new T.Vector2()},uW:{value:1}},{blending:T.CustomBlending,blendEquation:T.AddEquation,blendSrc:T.OneFactor,blendDst:T.OneFactor});

const P={ // 毎フレーム game から更新される
  sunUV:new T.Vector2(.5,.5),sunVis:0,bloom:0.55,ray:0.5,blur:0,ca:0.0,vig:0.35,expo:1.0,
  veil:0,veilCol:new T.Color(1,0.9,0.7),desat:0,flash:0,grain:0.03,mist:0,dazzle:0,fade:0,fadeCol:new T.Color(0,0,0)
};
const matComp=quadMat(`
uniform sampler2D tScene;uniform sampler2D tBloom;uniform sampler2D tBright;
uniform vec2 uSunUV;uniform float uSunVis,uBloom,uRay,uBlur,uCA,uVig,uExpo,uVeil,uDesat,uFlash,uGrain,uTime,uDazzle,uFade,uAspect;
uniform vec3 uVeilCol,uFadeCol;
varying vec2 vUv;
float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
vec3 aces(vec3 x){return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0);}
void main(){
  vec2 uv=vUv;vec2 c=uv-0.5;
  float r2=dot(c*vec2(uAspect,1.0),c*vec2(uAspect,1.0));
  vec3 col=vec3(0.0);
  float bl=uBlur*(0.30+min(r2,0.35)*2.0);
  for(int i=0;i<6;i++){
    float s=float(i)/5.0;
    col+=texture2D(tScene,uv-c*bl*s).rgb;
  }
  col*=1.0/6.0;
  if(uCA>0.0){
    vec2 o=c*uCA*(0.4+r2*3.0);
    col.r=mix(col.r,texture2D(tScene,uv-o).r,0.85);
    col.b=mix(col.b,texture2D(tScene,uv+o).b,0.85);
  }
  vec3 bloom=texture2D(tBloom,uv).rgb;
  col+=bloom*uBloom;
  if(uRay>0.0&&uSunVis>0.0){
    vec2 dl=(uSunUV-uv)*(1.0/18.0)*0.95;
    vec2 p=uv;vec3 acc=vec3(0.0);float w=1.0;
    for(int i=0;i<18;i++){p+=dl;acc+=texture2D(tBright,p).rgb*w;w*=0.935;}
    col+=acc*(1.0/18.0)*uRay*uSunVis*vec3(1.0,0.82,0.6);
  }
  if(uSunVis>0.01){
    vec2 ctr=vec2(0.5);vec2 dv=ctr-uSunUV;vec3 gh=vec3(0.0);
    for(int i=0;i<4;i++){
      float k=i==0?0.38:(i==1?0.72:(i==2?-0.28:1.25));float rr=i==0?0.045:(i==1?0.08:(i==2?0.03:0.13));
      vec2 gp=uSunUV+dv*(1.0+k);vec2 d2=(uv-gp)*vec2(uAspect,1.0);
      float ring=smoothstep(rr,rr*0.82,length(d2))*(1.0-smoothstep(rr*0.5,rr*0.8,length(d2)));
      vec3 tint=i==0?vec3(1.0,0.7,0.4):(i==1?vec3(0.5,0.8,1.0):(i==2?vec3(1.0,0.9,0.7):vec3(1.0,0.6,0.5)));
      gh+=tint*(ring*0.9+smoothstep(rr,0.0,length(d2))*0.10);
    }
    float onS=smoothstep(0.9,0.2,length((uSunUV-0.5)*1.6));
    col+=gh*0.07*uSunVis*onS*(1.0+uDazzle*4.0);
  }
  col*=uExpo;
  col+=vec3(1.0,0.88,0.62)*uDazzle*(0.15+0.85*exp(-length((uv-uSunUV)*vec2(uAspect,1.0))*2.2));
  float lum=dot(col,vec3(0.2126,0.7152,0.0722));
  col=mix(col,vec3(lum),uDesat);
  col=mix(col,col*uVeilCol*1.35,min(1.0,uVeil*2.4));col+=uVeilCol*uVeil*1.0;
  col+=vec3(1.0,0.95,0.85)*uFlash;
  col=aces(col*1.02);
  col=pow(col,vec3(1.0/2.2));
  float lm2=dot(col,vec3(0.299,0.587,0.114));col=mix(vec3(lm2),col,1.14);
  col*=mix(vec3(1.0),vec3(0.60,0.44,0.40),uVig*smoothstep(0.18,0.95,r2*1.9));
  col+=(h21(uv*vec2(1731.0,977.0)+uTime*61.0)-0.5)*uGrain;
  col=mix(col,uFadeCol,uFade);
  gl_FragColor=vec4(col,1.0);
}`,{tScene:{value:null},tBloom:{value:null},tBright:{value:null},uSunUV:{value:P.sunUV},uSunVis:{value:0},uBloom:{value:0},uRay:{value:0},uBlur:{value:0},uCA:{value:0},uVig:{value:0},uExpo:{value:1},uVeil:{value:0},uDesat:{value:0},uFlash:{value:0},uGrain:{value:0},uTime:{value:0},uDazzle:{value:0},uFade:{value:0},uAspect:{value:1},uVeilCol:{value:P.veilCol},uFadeCol:{value:P.fadeCol}});

const quadMesh=new T.Mesh(triGeo,matPre);quadMesh.frustumCulled=false;
const quadScene=new T.Scene();quadScene.add(quadMesh);
function pass(mat,target){quadMesh.material=mat;renderer.setRenderTarget(target);renderer.render(quadScene,camDummy);}

const R={w:2,h:2,sceneRT:null,bright:null,chain:[]};
function mkRT(w,h,depth,samples){
  const rt=new T.WebGLRenderTarget(w,h,{type:HALF?T.HalfFloatType:T.UnsignedByteType,format:T.RGBAFormat,minFilter:T.LinearFilter,magFilter:T.LinearFilter,depthBuffer:!!depth,stencilBuffer:false,generateMipmaps:false});
  rt.texture.generateMipmaps=false;
  if(samples)rt.samples=samples;
  return rt;
}
function buildTargets(w,h){
  R.w=w;R.h=h;
  if(R.sceneRT){R.sceneRT.dispose();R.bright.dispose();R.chain.forEach(r=>r.dispose());}
  R.sceneRT=mkRT(w,h,true,MSAA);
  const hw=Math.max(2,w>>1),hh=Math.max(2,h>>1);
  R.bright=mkRT(hw,hh,false,0);
  R.chain=[];
  let cw=hw,ch=hh;
  for(let i=0;i<4;i++){cw=Math.max(2,cw>>1);ch=Math.max(2,ch>>1);R.chain.push(mkRT(cw,ch,false,0));}
  renderer.setSize(w,h,false);
  matComp.uniforms.uAspect.value=w/h;
}
function renderFrame(){
  // 本編
  renderer.setRenderTarget(R.sceneRT);
  renderer.clear(true,true,false);
  renderer.render(scene,cam);
  renderer.clearDepth();
  renderer.render(vmScene,vmCam);
  // ブルーム
  matPre.uniforms.tScene.value=R.sceneRT.texture;
  pass(matPre,R.bright);
  let src=R.bright;
  for(let i=0;i<R.chain.length;i++){
    matDown.uniforms.tSrc.value=src.texture;
    matDown.uniforms.uTexel.value.set(1/src.width,1/src.height);
    pass(matDown,R.chain[i]);
    src=R.chain[i];
  }
  for(let i=R.chain.length-1;i>=1;i--){
    matUp.uniforms.tSrc.value=R.chain[i].texture;
    matUp.uniforms.uTexel.value.set(1/R.chain[i].width,1/R.chain[i].height);
    matUp.uniforms.uW.value=1.0;
    pass(matUp,R.chain[i-1]);
  }
  const cu=matComp.uniforms;
  cu.tScene.value=R.sceneRT.texture;cu.tBloom.value=R.chain[0].texture;cu.tBright.value=R.bright.texture;
  cu.uSunVis.value=P.sunVis;cu.uBloom.value=P.bloom;cu.uRay.value=P.ray;cu.uBlur.value=P.blur;cu.uCA.value=P.ca;cu.uVig.value=P.vig;
  cu.uExpo.value=P.expo;cu.uVeil.value=P.veil;cu.uDesat.value=P.desat;cu.uFlash.value=P.flash;cu.uGrain.value=P.grain;
  cu.uTime.value=U.uTime.value%100;cu.uDazzle.value=P.dazzle;cu.uFade.value=P.fade;
  pass(matComp,null);
}
