/* ================= 演出：光の粒・風の筋・航跡・羽・輪・上昇気流 ================= */
const FXU={uPxScale:{value:600},uVel:{value:new T.Vector3()},uSpeedAmt:{value:0},uBright:{value:1}};
function randAttr(n,k){const a=new Float32Array(n*k);for(let i=0;i<a.length;i++)a[i]=rnd();return a;}

/* --- 光の粒（空間の手がかり） --- */
const motes=(function(){
  const N=620;
  const g=new T.BufferGeometry();
  g.setAttribute('position',new T.BufferAttribute(new Float32Array(N*3),3));
  g.setAttribute('aSeed',new T.BufferAttribute(randAttr(N,4),4));
  const m=new T.ShaderMaterial({
    uniforms:Object.assign({uBox:{value:150}},U,FXU),transparent:true,depthWrite:false,blending:T.AdditiveBlending,
    vertexShader:`attribute vec4 aSeed;uniform float uBox,uPxScale,uTime;varying float vA;varying float vT;
    void main(){
      vec3 p=aSeed.xyz*uBox;
      p+=vec3(sin(uTime*0.31+aSeed.w*30.0),sin(uTime*0.23+aSeed.w*17.0),cos(uTime*0.27+aSeed.w*11.0))*2.5;
      vec3 rel=mod(p-cameraPosition+uBox*0.5,uBox)-uBox*0.5;
      vec4 mv=viewMatrix*vec4(cameraPosition+rel,1.0);
      float d=length(rel);
      vA=smoothstep(uBox*0.5,uBox*0.30,d)*smoothstep(0.8,4.0,d);
      vT=0.6+0.4*sin(uTime*(1.5+aSeed.w*3.0)+aSeed.w*40.0);
      gl_PointSize=clamp(uPxScale*(0.05+0.11*aSeed.w)/max(-mv.z,0.3),1.0,26.0);
      gl_Position=projectionMatrix*mv;
    }`,
    fragmentShader:FS_PRE+SKY_GLSL+`varying float vA;varying float vT;
    void main(){
      vec2 c=gl_PointCoord-0.5;float r=length(c)*2.0;
      float a=smoothstep(1.0,0.0,r);a*=a;
      vec3 col=mix(vec3(1.0,0.86,0.62),vec3(1.0,0.97,0.9),0.5)*(0.55+0.7*uAlt);
      gl_FragColor=vec4(col*a*vA*vT,a*vA*vT);
    }`
  });
  const o=new T.Points(g,m);o.frustumCulled=false;o.renderOrder=20;scene.add(o);
  return o;
})();

/* --- 風の筋（スピード感） --- */
const streaks=(function(){
  const N=170;
  const g=new T.InstancedBufferGeometry();
  g.setAttribute('position',new T.BufferAttribute(new Float32Array(12),3));
  g.setAttribute('uv',new T.BufferAttribute(new Float32Array([0,0,1,0,0,1,1,1]),2));
  g.setIndex([0,1,2,2,1,3]);
  g.setAttribute('aSeed',new T.InstancedBufferAttribute(randAttr(N,4),4));
  g.instanceCount=N;
  const m=new T.ShaderMaterial({
    uniforms:Object.assign({uBox:{value:120},uLen:{value:0.05},uW:{value:0.05}},U,FXU),transparent:true,depthWrite:false,blending:T.AdditiveBlending,side:T.DoubleSide,
    vertexShader:`attribute vec4 aSeed;uniform float uBox,uLen,uW,uSpeedAmt;uniform vec3 uVel;varying float vA;varying float vU;
    void main(){
      vec3 p=aSeed.xyz*uBox;
      vec3 rel=mod(p-cameraPosition+uBox*0.5,uBox)-uBox*0.5;
      vec3 head=cameraPosition+rel;
      vec3 tail=head+uVel*uLen*(0.6+aSeed.w);
      vec4 a=viewMatrix*vec4(head,1.0),b=viewMatrix*vec4(tail,1.0);
      vec3 sd=cross(b.xyz-a.xyz,a.xyz);
      sd=sd/max(length(sd),1e-5);
      vec3 pv=mix(b.xyz,a.xyz,uv.y)+sd*(uv.x-0.5)*uW*(0.5+aSeed.w);
      float d=length(rel);
      vA=uSpeedAmt*smoothstep(uBox*0.5,uBox*0.3,d)*smoothstep(1.2,6.0,d)*(0.3+0.7*aSeed.w);
      vU=uv.y;
      gl_Position=projectionMatrix*vec4(pv,1.0);
    }`,
    fragmentShader:FS_PRE+`varying float vA;varying float vU;
    void main(){float a=vA*vU*vU;gl_FragColor=vec4(vec3(1.0,0.92,0.78)*a,a);}`
  });
  const o=new T.Mesh(g,m);o.frustumCulled=false;o.renderOrder=21;scene.add(o);
  return o;
})();

/* --- 翼端の航跡 --- */
function makeTrail(){
  const N=44;
  const pos=new Float32Array(N*2*3),al=new Float32Array(N*2);
  const idx=[];for(let i=0;i<N-1;i++){const a=i*2;idx.push(a,a+1,a+2,a+2,a+1,a+3);}
  const g=new T.BufferGeometry();
  g.setAttribute('position',new T.BufferAttribute(pos,3).setUsage(T.DynamicDrawUsage));
  g.setAttribute('aA',new T.BufferAttribute(al,1).setUsage(T.DynamicDrawUsage));
  g.setIndex(idx);
  const m=new T.ShaderMaterial({uniforms:Object.assign({},U),transparent:true,depthWrite:false,blending:T.AdditiveBlending,side:T.DoubleSide,
    vertexShader:`attribute float aA;varying float vA;void main(){vA=aA;gl_Position=projectionMatrix*viewMatrix*vec4(position,1.0);}`,
    fragmentShader:FS_PRE+SKY_GLSL+`varying float vA;void main(){vec3 c=mix(vec3(1.0,0.78,0.5),vec3(1.0,0.95,0.85),vA)*(0.7+0.8*uAlt);gl_FragColor=vec4(c*vA,vA);}`});
  const o=new T.Mesh(g,m);o.frustumCulled=false;o.renderOrder=22;scene.add(o);
  const ts={N:N,pts:[],mesh:o,pos:pos,al:al,g:g};
  for(let i=0;i<N;i++)ts.pts.push({x:0,y:0,z:0,t:-9});
  return ts;
}
const trails=[makeTrail(),makeTrail()];
let trailAcc=0;
function updateTrails(dt,tipsL,tipsR,amt,now){
  trailAcc+=dt;
  const step=1/36;
  const tips=[tipsL,tipsR];
  if(trailAcc>=step){
    trailAcc=0;
    for(let k=0;k<2;k++){
      const tr=trails[k];const p=tr.pts.pop();
      p.x=tips[k].x;p.y=tips[k].y;p.z=tips[k].z;p.t=now;tr.pts.unshift(p);
    }
  }
  const cp=cam.position;
  for(let k=0;k<2;k++){
    const tr=trails[k];
    for(let i=0;i<tr.N;i++){
      const p=tr.pts[i];
      const prev=tr.pts[Math.min(i+1,tr.N-1)],nxt=tr.pts[Math.max(i-1,0)];
      // 先頭は現在の翼端に追従
      let px=p.x,py=p.y,pz=p.z;
      if(i===0){px=tips[k].x;py=tips[k].y;pz=tips[k].z;}
      let tx=nxt.x-prev.x,ty=nxt.y-prev.y,tz=nxt.z-prev.z;
      const tl=Math.hypot(tx,ty,tz)||1;tx/=tl;ty/=tl;tz/=tl;
      const vx=cp.x-px,vy=cp.y-py,vz=cp.z-pz;
      let sx=ty*vz-tz*vy,sy=tz*vx-tx*vz,sz=tx*vy-ty*vx;
      const sl=Math.hypot(sx,sy,sz)||1;
      const age=i/(tr.N-1);
      const w=0.16*(1-age)*(0.35+amt*0.65);
      sx=sx/sl*w;sy=sy/sl*w;sz=sz/sl*w;
      const o=i*6;
      tr.pos[o]=px+sx;tr.pos[o+1]=py+sy;tr.pos[o+2]=pz+sz;
      tr.pos[o+3]=px-sx;tr.pos[o+4]=py-sy;tr.pos[o+5]=pz-sz;
      const a=Math.pow(1-age,1.6)*amt*(p.t<0?0:1);
      tr.al[i*2]=a;tr.al[i*2+1]=a;
    }
    tr.g.attributes.position.needsUpdate=true;tr.g.attributes.aA.needsUpdate=true;
  }
}

/* --- 汎用パーティクル（火花・粉・蝋のしずく） --- */
const parts=(function(){
  const N=700;
  const pos=new Float32Array(N*3),col=new Float32Array(N*4),sz=new Float32Array(N);
  const vel=new Float32Array(N*3),life=new Float32Array(N),life0=new Float32Array(N),grav=new Float32Array(N),drag=new Float32Array(N),size0=new Float32Array(N);
  const g=new T.BufferGeometry();
  g.setAttribute('position',new T.BufferAttribute(pos,3).setUsage(T.DynamicDrawUsage));
  g.setAttribute('aCol',new T.BufferAttribute(col,4).setUsage(T.DynamicDrawUsage));
  g.setAttribute('aSize',new T.BufferAttribute(sz,1).setUsage(T.DynamicDrawUsage));
  const m=new T.ShaderMaterial({uniforms:Object.assign({},U,FXU),transparent:true,depthWrite:false,blending:T.AdditiveBlending,
    vertexShader:`attribute vec4 aCol;attribute float aSize;uniform float uPxScale;varying vec4 vC;
    void main(){vC=aCol;vec4 mv=viewMatrix*vec4(position,1.0);gl_PointSize=clamp(uPxScale*aSize/max(-mv.z,0.2),0.0,90.0);gl_Position=projectionMatrix*mv;}`,
    fragmentShader:FS_PRE+`varying vec4 vC;void main(){vec2 c=gl_PointCoord-0.5;float r=length(c)*2.0;float a=smoothstep(1.0,0.0,r);a*=a;gl_FragColor=vec4(vC.rgb*a*vC.a,a*vC.a);}`});
  const o=new T.Points(g,m);o.frustumCulled=false;o.renderOrder=23;scene.add(o);
  let head=0;
  function spawn(x,y,z,vx,vy,vz,r,gc,b,size,lf,gr,dg){
    const i=head;head=(head+1)%N;
    pos[i*3]=x;pos[i*3+1]=y;pos[i*3+2]=z;vel[i*3]=vx;vel[i*3+1]=vy;vel[i*3+2]=vz;
    col[i*4]=r;col[i*4+1]=gc;col[i*4+2]=b;col[i*4+3]=1;
    life[i]=life0[i]=lf;size0[i]=size;grav[i]=gr||0;drag[i]=dg||0;sz[i]=size;
  }
  function update(dt,wvx,wvy,wvz){
    for(let i=0;i<N;i++){
      if(life[i]<=0){sz[i]=0;continue;}
      life[i]-=dt;
      const k=Math.exp(-drag[i]*dt);
      vel[i*3]*=k;vel[i*3+1]=vel[i*3+1]*k-grav[i]*dt;vel[i*3+2]*=k;
      pos[i*3]+=vel[i*3]*dt;pos[i*3+1]+=vel[i*3+1]*dt;pos[i*3+2]+=vel[i*3+2]*dt;
      const f=Math.max(0,life[i]/life0[i]);
      col[i*4+3]=f*f*(3-2*f);
      sz[i]=size0[i]*(0.4+0.6*f);
    }
    g.attributes.position.needsUpdate=true;g.attributes.aCol.needsUpdate=true;g.attributes.aSize.needsUpdate=true;
  }
  function burst(x,y,z,n,spd,r,gc,b,size,lf,gr,dg,ux,uy,uz,spread){
    for(let i=0;i<n;i++){
      let dx=rnd()*2-1,dy=rnd()*2-1,dz=rnd()*2-1;
      const dl=Math.hypot(dx,dy,dz)||1;dx/=dl;dy/=dl;dz/=dl;
      if(ux!==undefined){dx=ux+dx*spread;dy=uy+dy*spread;dz=uz+dz*spread;const l=Math.hypot(dx,dy,dz)||1;dx/=l;dy/=l;dz/=l;}
      const s=spd*(0.35+0.65*rnd());
      spawn(x,y,z,dx*s,dy*s,dz*s,r,gc,b,size*(0.5+rnd()),lf*(0.6+0.7*rnd()),gr,dg);
    }
  }
  return {spawn:spawn,update:update,burst:burst,obj:o};
})();

/* --- 舞い落ちる羽 --- */
const fallFeathers=(function(){
  const N=70;
  const geo=FEATHER_GEO.clone();
  const sa=new Float32Array(N);for(let i=0;i<N;i++)sa[i]=rnd();
  geo.setAttribute('aSeed',new T.InstancedBufferAttribute(sa,1));
  const fs=FEATHER_FS.replace('uniform float uSeed,uLoose,uScorch,uWaxHeat;','varying float vSeedI;uniform float uLoose,uScorch,uWaxHeat;').replace(/uSeed/g,'vSeedI');
  const m=new T.ShaderMaterial({uniforms:Object.assign({uLoose:{value:0.12}},U,VMU,{uScorch:{value:0.08},uWaxHeat:{value:0}}),side:T.DoubleSide,
    vertexShader:`attribute float aSeed;varying vec2 vUv;varying vec3 vN;varying vec3 vVP;varying float vSeedI;
    void main(){vUv=uv;vSeedI=aSeed;vN=normalMatrix*mat3(instanceMatrix)*normal;vec4 mv=modelViewMatrix*instanceMatrix*vec4(position,1.0);vVP=mv.xyz;gl_Position=projectionMatrix*mv;}`,
    fragmentShader:fs});
  const mesh=new T.InstancedMesh(geo,m,N);mesh.frustumCulled=false;mesh.count=N;
  const st=[];
  const mat=new T.Matrix4(),q=new T.Quaternion(),e=new T.Euler(),pv=new T.Vector3(),sv=new T.Vector3(),zero=new T.Matrix4().makeScale(0,0,0);
  for(let i=0;i<N;i++){st.push({life:0,x:0,y:0,z:0,vx:0,vy:0,vz:0,a:0,b:0,c:0,wa:0,wb:0,wc:0,ph:0,len:0.6});mesh.setMatrixAt(i,zero);}
  mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
  scene.add(mesh);
  let head=0;
  function spawn(x,y,z,vx,vy,vz,len,life){
    const s=st[head];head=(head+1)%N;
    s.life=s.life0=life||9;s.x=x;s.y=y;s.z=z;s.vx=vx;s.vy=vy;s.vz=vz;s.len=len||0.7;
    s.a=rnd()*TAU;s.b=rnd()*TAU;s.c=rnd()*TAU;s.wa=(rnd()-0.5)*3;s.wb=(rnd()-0.5)*3;s.wc=(rnd()-0.5)*3;s.ph=rnd()*TAU;
  }
  function update(dt,t,wvx,wvy,wvz){
    for(let i=0;i<N;i++){
      const s=st[i];
      if(s.life<=0)continue;
      s.life-=dt;
      if(s.life<=0){mesh.setMatrixAt(i,zero);continue;}
      // ゆらゆら落ちる
      const tvy=-1.6;
      s.vy+=(tvy-s.vy)*Math.min(1,dt*1.3);
      s.vx+=(Math.sin(t*1.9+s.ph)*1.6-s.vx)*Math.min(1,dt*0.8);
      s.vz+=(Math.cos(t*1.5+s.ph)*1.6-s.vz)*Math.min(1,dt*0.8);
      s.x+=(s.vx)*dt;s.y+=s.vy*dt;s.z+=s.vz*dt;
      s.a+=s.wa*dt;s.b+=s.wb*dt*0.6;s.c+=s.wc*dt;
      e.set(s.a,s.b,s.c);q.setFromEuler(e);
      const k=Math.min(1,s.life/1.2)*s.len;
      pv.set(s.x,s.y,s.z);sv.set(k,k,k);
      mat.compose(pv,q,sv);mesh.setMatrixAt(i,mat);
    }
    mesh.instanceMatrix.needsUpdate=true;
  }
  function clear(){for(let i=0;i<N;i++){st[i].life=0;mesh.setMatrixAt(i,zero);}mesh.instanceMatrix.needsUpdate=true;}
  return {spawn:spawn,update:update,clear:clear};
})();

/* --- 輪 --- */
const RING_R=17;
const ringMat=function(){
  return new T.ShaderMaterial({
    uniforms:Object.assign({uState:{value:0},uPass:{value:0}},U),transparent:true,depthWrite:false,blending:T.AdditiveBlending,side:T.DoubleSide,
    vertexShader:`varying vec2 vUv;varying vec3 vWP;varying vec3 vNw;
    void main(){vUv=uv;vec4 wp=modelMatrix*vec4(position,1.0);vWP=wp.xyz;vNw=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*viewMatrix*wp;}`,
    fragmentShader:FS_PRE+SKY_GLSL+`uniform float uState,uPass;varying vec2 vUv;varying vec3 vWP;varying vec3 vNw;
    void main(){
      vec3 V=normalize(cameraPosition-vWP);
      float fr=pow(1.0-abs(dot(normalize(vNw),V)),1.5);
      float flow=0.5+0.5*sin(vUv.x*6.2831*10.0-uTime*3.2);
      float flow2=0.5+0.5*sin(vUv.x*6.2831*3.0+uTime*1.3);
      float core=0.55+0.45*fr;
      float a=core*(0.55+0.45*flow)*mix(0.5,1.0,uState);
      vec3 c=mix(vec3(1.0,0.78,0.42),vec3(1.0,0.97,0.88),fr*0.8+flow2*0.2)*(1.6+uState*1.8);
      float dist=length(cameraPosition-vWP);
      a*=smoothstep(3200.0,500.0,dist)*(1.0-uPass);
      c=mix(c,vec3(1.0,0.9,0.7),uPass);
      gl_FragColor=vec4(c*a,a);
    }`});
};
const rings=[];
for(let i=0;i<5;i++){
  const g=new T.TorusGeometry(RING_R,0.55,10,72);
  const m=new T.Mesh(g,ringMat());m.frustumCulled=false;m.visible=false;m.renderOrder=24;scene.add(m);
  // 内側のうっすらした面
  const disc=new T.Mesh(new T.CircleGeometry(RING_R*0.98,40),new T.ShaderMaterial({uniforms:Object.assign({uOn:{value:0}},U),transparent:true,depthWrite:false,blending:T.AdditiveBlending,side:T.DoubleSide,
    vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:FS_PRE+`uniform float uOn,uTime;varying vec2 vUv;void main(){vec2 c=vUv-0.5;float r=length(c)*2.0;float a=smoothstep(0.55,1.0,r)*0.10*uOn*(0.7+0.3*sin(uTime*2.0+r*8.0));gl_FragColor=vec4(vec3(1.0,0.82,0.5)*a,a);}`}));
  disc.frustumCulled=false;disc.renderOrder=24;m.add(disc);
  rings.push({mesh:m,disc:disc,used:false,passT:-1});
}

/* --- 上昇気流 --- */
const THN=8;
const thermalMeshes=[];
const thermalGeo=new T.CylinderGeometry(1,1,1,28,1,true);thermalGeo.translate(0,0.5,0);
for(let i=0;i<THN;i++){
  const m=new T.Mesh(thermalGeo,new T.ShaderMaterial({uniforms:Object.assign({uOn:{value:0}},U),transparent:true,depthWrite:false,blending:T.AdditiveBlending,side:T.DoubleSide,
    vertexShader:`varying vec2 vUv;varying vec3 vWP;varying vec3 vNw;
    void main(){vUv=uv;vec4 wp=modelMatrix*vec4(position,1.0);vWP=wp.xyz;vNw=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*viewMatrix*wp;}`,
    fragmentShader:FS_PRE+SKY_GLSL+`uniform float uOn;varying vec2 vUv;varying vec3 vWP;varying vec3 vNw;
    void main(){
      vec3 V=normalize(cameraPosition-vWP);
      float fr=pow(1.0-abs(dot(normalize(vNw),V)),1.2);
      float rise=vWP.y*0.03-uTime*0.9;
      float n=h21(vec2(floor(vUv.x*36.0),floor(rise*1.3)));
      float s=0.5+0.5*sin(vUv.x*6.2831*4.0+vWP.y*0.04-uTime*0.8);
      float a=(0.07+0.34*n*s)*(0.35+fr)*smoothstep(0.0,0.06,vUv.y)*smoothstep(1.0,0.55,vUv.y);
      float dist=length(cameraPosition-vWP);
      a*=smoothstep(2600.0,300.0,dist)*uOn;
      vec3 c=vec3(1.0,0.74,0.38)*(1.1+0.8*uAlt);
      gl_FragColor=vec4(c*a,a);
    }`}));
  m.frustumCulled=false;m.visible=false;m.renderOrder=19;scene.add(m);thermalMeshes.push(m);
}
const thermalPts=(function(){
  const PER=44,N=PER*THN;
  const g=new T.BufferGeometry();
  const sd=randAttr(N,4);for(let i=0;i<N;i++)sd[i*4+3]=Math.floor(i/PER);
  g.setAttribute('position',new T.BufferAttribute(new Float32Array(N*3),3));
  g.setAttribute('aSeed',new T.BufferAttribute(sd,4));
  const uTh=[];for(let i=0;i<THN;i++)uTh.push(new T.Vector4(0,0,0,0));
  const m=new T.ShaderMaterial({uniforms:Object.assign({uTh:{value:uTh},uTop:{value:uTh.map(()=>600)}},U,FXU),transparent:true,depthWrite:false,blending:T.AdditiveBlending,
    vertexShader:`attribute vec4 aSeed;uniform vec4 uTh[${THN}];uniform float uTop[${THN}];uniform float uTime,uPxScale;varying float vA;
    void main(){
      vec4 th=uTh[int(aSeed.w+0.5)];
      float top=uTop[int(aSeed.w+0.5)];
      float H=top-th.y;
      float ang=aSeed.x*6.2831+uTime*(0.5+aSeed.y*0.5);
      float r=th.w*(0.15+0.8*aSeed.y);
      float y=mod(aSeed.z*H+uTime*(10.0+aSeed.y*8.0),H);
      vec3 wp=vec3(th.x+cos(ang+y*0.01)*r,th.y+y,th.z+sin(ang+y*0.01)*r);
      vec4 mv=viewMatrix*vec4(wp,1.0);
      vA=step(1.0,th.w)*smoothstep(0.0,40.0,y)*smoothstep(H,H-150.0,y)*smoothstep(2200.0,300.0,length(mv.xyz));
      gl_PointSize=clamp(uPxScale*(0.45+0.8*aSeed.x)/max(-mv.z,0.5),1.0,22.0);
      gl_Position=projectionMatrix*mv;
    }`,
    fragmentShader:FS_PRE+`varying float vA;void main(){vec2 c=gl_PointCoord-0.5;float a=smoothstep(1.0,0.0,length(c)*2.0);a*=a;gl_FragColor=vec4(vec3(1.0,0.8,0.5)*a*vA*1.6,a*vA);}`});
  const o=new T.Points(g,m);o.frustumCulled=false;o.renderOrder=25;scene.add(o);
  return o;
})();
