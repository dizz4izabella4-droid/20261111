/* ================= 積雲のかたまり・鳥たち ================= */
const puffs=(function(){
  const CELL=300,RN=4,PER=2,N=(RN*2+1)*(RN*2+1)*PER;
  const g=new T.InstancedBufferGeometry();
  g.setAttribute('position',new T.BufferAttribute(new Float32Array([-0.5,-0.5,0,0.5,-0.5,0,-0.5,0.5,0,0.5,0.5,0]),3));
  g.setAttribute('uv',new T.BufferAttribute(new Float32Array([0,0,1,0,0,1,1,1]),2));
  g.setIndex([0,1,2,2,1,3]);
  const aC=new Float32Array(N*4),aS=new Float32Array(N*2);
  const ac=new T.InstancedBufferAttribute(aC,4),as=new T.InstancedBufferAttribute(aS,2);
  ac.setUsage(T.DynamicDrawUsage);as.setUsage(T.DynamicDrawUsage);
  g.setAttribute('aC',ac);g.setAttribute('aS',as);g.instanceCount=N;
  const m=new T.ShaderMaterial({
    uniforms:Object.assign({uNoise:{value:noiseTex},uSunV:{value:new T.Vector3(0,0.3,-1)}},U),transparent:true,depthWrite:false,side:T.DoubleSide,
    vertexShader:`attribute vec4 aC;attribute vec2 aS;varying vec2 vUv;varying float vSeed;varying float vD;varying float vY;
    void main(){
      vUv=uv;vSeed=aC.w;vY=aC.y;
      vec4 mv=viewMatrix*vec4(aC.xyz,1.0);
      vD=-mv.z;
      mv.xy+=position.xy*aS.x;
      gl_Position=projectionMatrix*mv;
    }`,
    fragmentShader:FS_PRE+SKY_GLSL+`uniform sampler2D uNoise;uniform vec3 uSunV;
    varying vec2 vUv;varying float vSeed;varying float vD;varying float vY;
    void main(){
      vec2 c=vUv-0.5;float r=length(c)*2.0;
      if(r>1.0)discard;
      float cs=cos(vSeed*6.28),sn=sin(vSeed*6.28);
      vec2 q=vec2(cs*c.x-sn*c.y,sn*c.x+cs*c.y);
      float n=texture2D(uNoise,q*0.9+vSeed*7.0).r*0.6+texture2D(uNoise,q*2.3+vSeed*3.0).g*0.4;
      float body=smoothstep(1.0,0.15,r);
      float d=smoothstep(0.30,0.72,body*0.95+(n-0.5)*0.95);
      vec2 sdir=normalize(uSunV.xy+vec2(1e-4,1e-4));
      float lit=clamp(0.55+0.9*dot(c,sdir)*1.6+0.25*c.y*2.0-(n-0.5)*0.6,0.0,1.0);
      vec3 sunC=uSunCol*(1.15+0.5*uAlt);
      vec3 shadowC=uZen*0.9+vec3(0.10,0.09,0.14)+uHor*0.15;
      vec3 col=mix(shadowC,sunC*0.95+vec3(0.28),lit);
      float a=d*0.92*smoothstep(25.0,140.0,vD)*(1.0-smoothstep(1800.0,3600.0,vD));
      col=mix(col,skyBase(normalize(vec3(c.x,0.1,-1.0))),smoothstep(900.0,3200.0,vD)*0.6);
      gl_FragColor=vec4(col,a);
    }`
  });
  const o=new T.Mesh(g,m);o.frustumCulled=false;o.renderOrder=9;scene.add(o);
  let ci=1e9,cj=1e9;
  function update(x,y,z,sunV){
    o.visible=y>CLOUD_Y+30;
    m.uniforms.uSunV.value.copy(sunV);
    const i0=Math.floor(x/CELL),j0=Math.floor(z/CELL);
    if(i0===ci&&j0===cj)return;
    ci=i0;cj=j0;
    let k=0;
    for(let di=-RN;di<=RN;di++)for(let dj=-RN;dj<=RN;dj++){
      const i=i0+di,j=j0+dj;
      for(let p=0;p<PER;p++){
        const h1=hash3(i,j,50+p),h2=hash3(i,j,60+p),h3=hash3(i,j,70+p),h4=hash3(i,j,80+p);
        const size=170+260*h4;
        aC[k*4]=(i+h1)*CELL;aC[k*4+1]=CLOUD_Y+40+h3*h3*110+size*0.12;aC[k*4+2]=(j+h2)*CELL;aC[k*4+3]=hash3(i,j,90+p);
        aS[k*2]=size;aS[k*2+1]=0;
        k++;
      }
    }
    ac.needsUpdate=true;as.needsUpdate=true;
  }
  return {update:update,mesh:o};
})();

const birds=(function(){
  const PER=7,NF=14,FB=13,N=PER*THN+NF*FB;
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
      float f=sin(uTime*7.0+aPh);
      p.y+=aW*f*abs(position.x)*1.6;
      vec4 wp=im*vec4(p,1.0);vWP=wp.xyz;vW=aW;
      gl_Position=projectionMatrix*viewMatrix*wp;
    }`,
    fragmentShader:FS_PRE+SKY_GLSL+`varying vec3 vWP;varying float vW;
    void main(){
      vec3 V=normalize(cameraPosition-vWP);
      vec3 col=vec3(0.16,0.12,0.13)*(0.7+0.3*vW)*(uSunCol*0.5+vec3(0.5));
      col=applyFog(col,vWP);
      gl_FragColor=vec4(col,1.0);
    }`});
  const aM=[0,1,2,3].map(()=>{const a=new T.InstancedBufferAttribute(new Float32Array(N*4),4);a.setUsage(T.DynamicDrawUsage);return a;});
  aM.forEach((a,i)=>g.setAttribute('aM'+i,a));
  const o=new T.Mesh(g,mat);o.frustumCulled=false;scene.add(o);
  const seeds=[];for(let i=0;i<N;i++)seeds.push([rnd(),rnd(),rnd(),rnd()]);
  const mm=new T.Matrix4(),qq=new T.Quaternion(),ee=new T.Euler(),pp=new T.Vector3(),ss=new T.Vector3(1,1,1);
  function update(t,ths){
    for(let i=0;i<THN;i++){
      const th=ths[i];
      for(let k=0;k<PER;k++){
        const idx=i*PER+k,sd=seeds[idx];
        let x=0,y=-9999,z=0,yaw=0;
        if(th&&th.d<2600){
          const w=0.42+0.12*sd[1];
          const ang=sd[0]*TAU+t*w;
          const r=th.R*(0.5+0.45*sd[2]);
          const H=th.top-th.y0;
          x=th.x+Math.cos(ang)*r;z=th.z+Math.sin(ang)*r;
          y=th.y0+((sd[3]*H+t*(6+sd[1]*6))%H);
          const tx=-Math.sin(ang),tz=Math.cos(ang);
          yaw=Math.atan2(-tx,-tz);
        }
        ee.set(0,yaw,0.35,'YXZ');qq.setFromEuler(ee);pp.set(x,y,z);mm.compose(pp,qq,ss);
        const e=mm.elements;
        aM[0].setXYZW(idx,e[0],e[1],e[2],e[3]);aM[1].setXYZW(idx,e[4],e[5],e[6],e[7]);aM[2].setXYZW(idx,e[8],e[9],e[10],e[11]);aM[3].setXYZW(idx,e[12],e[13],e[14],e[15]);
      }
    }
    aM.forEach(a=>a.needsUpdate=true);
  }
  // 渡り鳥の群れ（V字）：プレイヤーのまわりを周回する空間に、いつも何組か飛んでいる
  const flocks=[];for(let f=0;f<NF;f++){const h=rnd()*TAU,sp=14+9*rnd();flocks.push({bx:rnd()*3000,bz:rnd()*3000,by:rnd()*1400,yaw:h,sp:sp,sc:3.4+3.0*rnd(),ph:rnd()*6});}
  const SX=2200,SY=1000;
  function wrapTo(v,c,S){return ((v-c+S*0.5)%S+S)%S-S*0.5+c;}
  function updateFlocks(t,px,py,pz){
    for(let f=0;f<NF;f++){
      const F=flocks[f];
      const dx=-Math.sin(F.yaw),dz=-Math.cos(F.yaw);
      const cx=wrapTo(F.bx+dx*F.sp*t,px,SX),cz=wrapTo(F.bz+dz*F.sp*t,pz,SX);
      let cy=wrapTo(F.by+Math.sin(t*0.05+F.ph)*30,py,SY);if(cy<60)cy+=SY*0.4;
      for(let k=0;k<FB;k++){
        const idx=PER*THN+f*FB+k;
        const rank=Math.ceil(k/2),side=(k%2?1:-1)*(k?1:0);
        const lx=side*rank*5.5*F.sc,lz=rank*5.5*F.sc;
        const cyw=Math.cos(F.yaw),syw=Math.sin(F.yaw);
        const wx=cx+lx*cyw+lz*syw,wz=cz-lx*syw+lz*cyw;
        const wy=cy+Math.sin(t*1.3+k*0.9+F.ph)*0.7+rank*0.4;
        ee.set(0,F.yaw,0.08*Math.sin(t*0.7+k),'YXZ');qq.setFromEuler(ee);pp.set(wx,wy,wz);ss.set(F.sc,F.sc,F.sc);mm.compose(pp,qq,ss);
        const e=mm.elements;
        aM[0].setXYZW(idx,e[0],e[1],e[2],e[3]);aM[1].setXYZW(idx,e[4],e[5],e[6],e[7]);aM[2].setXYZW(idx,e[8],e[9],e[10],e[11]);aM[3].setXYZW(idx,e[12],e[13],e[14],e[15]);
      }
    }
    ss.set(1,1,1);
  }
  return {update:update,updateFlocks:updateFlocks};
})();
