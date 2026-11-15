/* ================= 演出：光の粒・花びら・光の梯子・渡り鳥 ================= */
const FXU={uPxScale:{value:600}};
function randAttr(n,k){const a=new Float32Array(n*k);for(let i=0;i<a.length;i++)a[i]=rnd();return a;}

/* --- 光の粒（空間の手がかり） --- */
const motes=(function(){
  const N=520;
  const g=new T.BufferGeometry();
  g.setAttribute('position',new T.BufferAttribute(new Float32Array(N*3),3));
  g.setAttribute('aSeed',new T.BufferAttribute(randAttr(N,4),4));
  const m=new T.ShaderMaterial({
    uniforms:Object.assign({uBox:{value:150},uMote:{value:1}},U,FXU),transparent:true,depthWrite:false,blending:T.AdditiveBlending,
    vertexShader:`attribute vec4 aSeed;uniform float uBox,uPxScale,uTime;varying float vA;varying float vT;
    void main(){
      vec3 p=aSeed.xyz*uBox;
      p+=vec3(sin(uTime*0.31+aSeed.w*30.0),sin(uTime*0.23+aSeed.w*17.0),cos(uTime*0.27+aSeed.w*11.0))*2.5;
      vec3 rel=mod(p-cameraPosition+uBox*0.5,uBox)-uBox*0.5;
      vec4 mv=viewMatrix*vec4(cameraPosition+rel,1.0);
      float d=length(rel);
      vA=smoothstep(uBox*0.5,uBox*0.30,d)*smoothstep(0.8,4.0,d);
      vT=0.6+0.4*sin(uTime*(1.5+aSeed.w*3.0)+aSeed.w*40.0);
      gl_PointSize=clamp(uPxScale*(0.05+0.11*aSeed.w)/max(-mv.z,0.3),1.0,22.0);
      gl_Position=projectionMatrix*mv;
    }`,
    fragmentShader:FS_PRE+SKY_GLSL+`uniform float uMote;varying float vA;varying float vT;
    void main(){
      vec2 c=gl_PointCoord-0.5;float r=length(c)*2.0;
      float a=smoothstep(1.0,0.0,r);a*=a;
      vec3 col=mix(vec3(1.0,0.86,0.62),vec3(1.0,0.97,0.9),0.5)*(0.45+0.7*uAlt)*uMote;
      gl_FragColor=vec4(col*a*vA*vT,a*vA*vT);
    }`
  });
  const o=new T.Points(g,m);o.frustumCulled=false;o.renderOrder=20;scene.add(o);
  return o;
})();

/* --- 舞う花びら --- */
const petals=(function(){
  const N=260;
  const g=new T.BufferGeometry();
  g.setAttribute('position',new T.BufferAttribute(new Float32Array(N*3),3));
  g.setAttribute('aSeed',new T.BufferAttribute(randAttr(N,4),4));
  const m=new T.ShaderMaterial({
    uniforms:Object.assign({uBox:{value:170},uAmt:{value:0}},U,FXU),transparent:true,depthWrite:false,blending:T.AdditiveBlending,
    vertexShader:`attribute vec4 aSeed;uniform float uBox,uPxScale,uTime,uAmt;varying float vA;varying vec3 vC;varying float vR;
    void main(){
      vec3 p=aSeed.xyz*uBox;
      p.y-=uTime*(0.9+aSeed.w*1.4);
      p.x+=sin(uTime*0.55+aSeed.w*25.0)*4.0;p.z+=cos(uTime*0.47+aSeed.w*19.0)*4.0;
      vec3 rel=mod(p-cameraPosition+uBox*0.5,uBox)-uBox*0.5;
      vec4 mv=viewMatrix*vec4(cameraPosition+rel,1.0);
      float d=length(rel);
      vA=uAmt*smoothstep(uBox*0.5,uBox*0.28,d)*smoothstep(1.5,7.0,d);
      float k=fract(aSeed.w*5.7);
      vC=k<0.45?vec3(1.0,0.72,0.80):(k<0.8?vec3(1.0,0.88,0.62):vec3(1.0,0.97,0.92));
      vR=uTime*(0.6+aSeed.w)+aSeed.w*40.0;
      gl_PointSize=clamp(uPxScale*(0.20+0.34*aSeed.x)/max(-mv.z,0.3),1.0,40.0);
      gl_Position=projectionMatrix*mv;
    }`,
    fragmentShader:FS_PRE+`varying float vA;varying vec3 vC;varying float vR;
    void main(){
      vec2 c=gl_PointCoord-0.5;
      float cs=cos(vR),sn=sin(vR);c=vec2(cs*c.x-sn*c.y,sn*c.x+cs*c.y);
      float e=dot(c*vec2(1.0,2.4),c*vec2(1.0,2.4))*4.0;
      float a=smoothstep(1.0,0.2,e);
      a*=0.55+0.45*sin(vR*3.0);
      gl_FragColor=vec4(vC*a*vA*1.3,a*vA);
    }`
  });
  const o=new T.Points(g,m);o.frustumCulled=false;o.renderOrder=24;scene.add(o);
  return o;
})();

/* --- 光の梯子（雲の切れ間から差す、斜めの光の帯） --- */
const shafts=(function(){
  const N=30;
  const g=new T.InstancedBufferGeometry();
  g.setAttribute('position',new T.BufferAttribute(new Float32Array([-0.5,0,0, 0.5,0,0, -0.5,1,0, 0.5,1,0]),3));
  g.setIndex([0,1,2,2,1,3]);
  g.setAttribute('aSeed',new T.InstancedBufferAttribute(randAttr(N,4),4));
  g.instanceCount=N;
  const m=new T.ShaderMaterial({
    uniforms:Object.assign({uBox:{value:2600},uAmt:{value:0},uTop:{value:800}},U),transparent:true,depthWrite:false,blending:T.AdditiveBlending,side:T.DoubleSide,
    vertexShader:FS_PRE+SKY_GLSL+`attribute vec4 aSeed;uniform float uBox,uAmt,uTop;varying float vA;varying vec2 vQ;
    void main(){
      vec2 rel=mod(aSeed.xy*uBox-cameraPosition.xz+uBox*0.5,uBox)-uBox*0.5;
      float dist=length(rel);
      float topY=uTop+260.0*aSeed.z;
      float L=min(560.0+700.0*aSeed.w,topY-6.0);
      vec3 P0=vec3(cameraPosition.x+rel.x,topY,cameraPosition.z+rel.y);
      vec3 ax=normalize(vec3(-uSunDir.x*0.55,-1.0,-uSunDir.z*0.55));
      vec3 P=P0+ax*L*position.y;
      vec3 w=normalize(cross(ax,P0-cameraPosition));
      float W=16.0+54.0*fract(aSeed.x*7.7+aSeed.w*3.1);
      P+=w*position.x*W*(0.6+0.9*position.y);
      vA=uAmt*smoothstep(140.0,420.0,dist)*(1.0-smoothstep(uBox*0.30,uBox*0.5,dist))*(0.35+0.65*fract(aSeed.z*13.0));
      vQ=vec2(position.x+0.5,position.y);
      gl_Position=projectionMatrix*viewMatrix*vec4(P,1.0);
    }`,
    fragmentShader:FS_PRE+SKY_GLSL+`varying float vA;varying vec2 vQ;
    void main(){
      float x=abs(vQ.x*2.0-1.0);
      float edge=pow(max(1.0-x,0.0),2.0);
      float streak=0.62+0.38*sin(vQ.x*44.0+h21(vec2(floor(vQ.x*12.0),vQ.y*0.0))*6.3);
      float along=smoothstep(0.0,0.10,vQ.y)*(1.0-smoothstep(0.50,1.0,vQ.y));
      float a=vA*edge*streak*along*0.20;
      vec3 c=mix(uSunCol,vec3(1.0,0.95,0.86),0.55)*1.2;
      gl_FragColor=vec4(c*a,a);
    }`
  });
  const o=new T.Mesh(g,m);o.frustumCulled=false;o.renderOrder=19;scene.add(o);
  return o;
})();

/* --- 渡り鳥（V字の群れ） --- */
const birds=(function(){
  const NF=14,FB=13,N=NF*FB;
  const pos=[-0.0,0,-0.45, -0.1,0,0.3, 0.1,0,0.3,   0,0,-0.2, 0,0,0.28, -1.05,0,0.2,   0,0,-0.2, 0,0,0.28, 1.05,0,0.2];
  const wv=[0,0,0, 0,0,1, 0,0,1];
  const g=new T.InstancedBufferGeometry();
  g.setAttribute('position',new T.BufferAttribute(new Float32Array(pos),3));
  g.setAttribute('aW',new T.BufferAttribute(new Float32Array(wv),1));
  g.setAttribute('aPh',new T.InstancedBufferAttribute((()=>{const a=new Float32Array(N);for(let i=0;i<N;i++)a[i]=rnd()*TAU;return a;})(),1));
  g.instanceCount=N;
  const mat=new T.ShaderMaterial({uniforms:Object.assign({},U),side:T.DoubleSide,
    vertexShader:`attribute float aW;attribute float aPh;attribute vec4 aM0;attribute vec4 aM1;attribute vec4 aM2;attribute vec4 aM3;uniform float uTime;varying vec3 vWP;varying float vW;
    void main(){
      mat4 im=mat4(aM0,aM1,aM2,aM3);
      vec3 p=position*2.2;
      float f=sin(uTime*4.2+aPh);
      p.y+=aW*f*abs(position.x)*1.5;
      vec4 wp=im*vec4(p,1.0);vWP=wp.xyz;vW=aW;
      gl_Position=projectionMatrix*viewMatrix*wp;
    }`,
    fragmentShader:FS_PRE+SKY_GLSL+`varying vec3 vWP;varying float vW;
    void main(){
      vec3 col=vec3(0.90,0.88,0.84)*(uZen*0.45+uHor*0.30+vec3(0.20)+uSunCol*0.40)*(0.78+0.22*vW);
      col=applyFog(col,vWP);
      gl_FragColor=vec4(col,1.0);
    }`});
  const aM=[0,1,2,3].map(()=>{const a=new T.InstancedBufferAttribute(new Float32Array(N*4),4);a.setUsage(T.DynamicDrawUsage);return a;});
  aM.forEach((a,i)=>g.setAttribute('aM'+i,a));
  const o=new T.Mesh(g,mat);o.frustumCulled=false;scene.add(o);
  const mm=new T.Matrix4(),qq=new T.Quaternion(),ee=new T.Euler(),pp=new T.Vector3(),ss=new T.Vector3(1,1,1);
  const flocks=[];for(let f=0;f<NF;f++){const h=rnd()*TAU,sp=11+8*rnd();flocks.push({bx:rnd()*3000,bz:rnd()*3000,by:30+rnd()*900,yaw:h,sp:sp,sc:3.4+3.0*rnd(),ph:rnd()*6});}
  const SX=2400,SY=1100;
  function wrapTo(v,c,S){return ((v-c+S*0.5)%S+S)%S-S*0.5+c;}
  function update(t,px,py,pz){
    for(let f=0;f<NF;f++){
      const F=flocks[f];
      const dx=-Math.sin(F.yaw),dz=-Math.cos(F.yaw);
      const cx=wrapTo(F.bx+dx*F.sp*t,px,SX),cz=wrapTo(F.bz+dz*F.sp*t,pz,SX);
      let cy=wrapTo(F.by+Math.sin(t*0.05+F.ph)*30,py,SY);if(cy<60)cy+=SY*0.4;
      for(let k=0;k<FB;k++){
        const idx=f*FB+k;
        const rank=Math.ceil(k/2),side=(k%2?1:-1)*(k?1:0);
        const lx=side*rank*5.5*F.sc,lz=rank*5.5*F.sc;
        const cyw=Math.cos(F.yaw),syw=Math.sin(F.yaw);
        const wx=cx+lx*cyw+lz*syw,wz=cz-lx*syw+lz*cyw;
        const wy=cy+Math.sin(t*1.0+k*0.9+F.ph)*0.7+rank*0.4;
        ee.set(0,F.yaw,0.08*Math.sin(t*0.7+k),'YXZ');qq.setFromEuler(ee);pp.set(wx,wy,wz);ss.set(F.sc,F.sc,F.sc);mm.compose(pp,qq,ss);
        const e=mm.elements;
        aM[0].setXYZW(idx,e[0],e[1],e[2],e[3]);aM[1].setXYZW(idx,e[4],e[5],e[6],e[7]);aM[2].setXYZW(idx,e[8],e[9],e[10],e[11]);aM[3].setXYZW(idx,e[12],e[13],e[14],e[15]);
      }
    }
    aM.forEach(a=>a.needsUpdate=true);
  }
  return {update:update};
})();
