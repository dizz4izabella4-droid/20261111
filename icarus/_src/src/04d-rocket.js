/* ================= ロケット（屋上のきらめき） ================= */
const ROCKET_POS={x:32,y:176.6,z:-200};
const rocketItem=(function(){
  const g=new T.Group();scene.add(g);
  const mk=(col,em)=>new T.ShaderMaterial({uniforms:Object.assign({uCol:{value:new T.Color(col)},uEm:{value:em}},U),
    vertexShader:`varying vec3 vN;varying vec3 vWP;void main(){vN=normalize(mat3(modelMatrix)*normal);vec4 wp=modelMatrix*vec4(position,1.0);vWP=wp.xyz;gl_Position=projectionMatrix*viewMatrix*wp;}`,
    fragmentShader:FS_PRE+SKY_GLSL+`uniform vec3 uCol;uniform float uEm;varying vec3 vN;varying vec3 vWP;
    void main(){vec3 n=normalize(vN);vec3 V=normalize(cameraPosition-vWP);float d=max(dot(n,uSunDir),0.0);float r=pow(1.0-abs(dot(n,V)),2.0);
      vec3 c=uCol*(0.35+0.9*d)*uSunCol+uCol*uEm+vec3(1.0,0.85,0.6)*r*0.5;gl_FragColor=vec4(c,1.0);}`});
  const body=new T.Mesh(new T.CylinderGeometry(0.5,0.5,2.4,18),mk(0xf2efe8,0.1));
  const nose=new T.Mesh(new T.ConeGeometry(0.5,1.1,18),mk(0xe8452c,0.25));nose.position.y=1.75;
  const nozzle=new T.Mesh(new T.CylinderGeometry(0.34,0.5,0.45,14),mk(0x33302d,0.0));nozzle.position.y=-1.4;
  const band=new T.Mesh(new T.CylinderGeometry(0.505,0.505,0.3,18),mk(0xe8452c,0.2));band.position.y=0.5;
  g.add(body,nose,nozzle,band);
  for(let k=0;k<3;k++){const f=new T.Mesh(new T.BoxGeometry(0.08,1.0,0.8),mk(0xe8452c,0.2));const a=k/3*TAU;f.position.set(Math.cos(a)*0.7,-0.8,Math.sin(a)*0.7);f.rotation.y=-a;g.add(f);}
  g.scale.setScalar(3.4);
  // きらめき
  const glint=new T.Mesh(new T.PlaneGeometry(1,1),new T.ShaderMaterial({uniforms:Object.assign({uA:{value:0}},U),transparent:true,depthWrite:false,blending:T.AdditiveBlending,
    vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:FS_PRE+`uniform float uA;varying vec2 vUv;
    void main(){vec2 c=vUv-0.5;float r=length(c)*2.0;
      float cr=exp(-abs(c.x)*46.0)*exp(-abs(c.y)*4.0)+exp(-abs(c.y)*46.0)*exp(-abs(c.x)*4.0);
      float ha=exp(-r*7.0);float a=(cr*1.3+ha*0.9)*uA*smoothstep(1.0,0.7,r);
      gl_FragColor=vec4(vec3(1.0,0.93,0.72)*a*1.8,a);}`}));
  glint.frustumCulled=false;glint.renderOrder=26;scene.add(glint);
  g.visible=true;
  let on=true;
  function update(t,dist){
    g.visible=glint.visible=on;if(!on)return;
    g.position.set(ROCKET_POS.x,ROCKET_POS.y+1.5+Math.sin(t*1.6)*0.5,ROCKET_POS.z);
    g.rotation.y=t*0.9;g.rotation.z=0.25;
    glint.position.set(ROCKET_POS.x,ROCKET_POS.y+3.2,ROCKET_POS.z);
    glint.quaternion.copy(cam.quaternion);
    const flash=Math.pow(Math.max(0,Math.sin(t*2.3)),22);
    const near=1-sstep(60,260,dist);
    glint.material.uniforms.uA.value=0.22+0.5*near+1.3*flash;
    const sc=10+dist*0.085+flash*8;glint.scale.set(sc,sc,1);
  }
  return {update:update,setOn:v=>{on=v;g.visible=glint.visible=v;}};
})();
