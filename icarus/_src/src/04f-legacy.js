/* ================= 先人の足跡（受け継がれる勇気） ================= */
const legacy=(function(){
  let best=0;
  try{best=parseFloat(localStorage.getItem('icarus_best_wax'))||0;}catch(_){}
  const m=new T.Mesh(new T.PlaneGeometry(4000,4000).rotateX(-Math.PI/2),new T.ShaderMaterial({
    uniforms:Object.assign({},U),transparent:true,depthWrite:false,blending:T.AdditiveBlending,side:T.DoubleSide,
    vertexShader:`varying vec3 vWP;void main(){vec4 wp=modelMatrix*vec4(position,1.0);vWP=wp.xyz;gl_Position=projectionMatrix*viewMatrix*wp;}`,
    fragmentShader:FS_PRE+SKY_GLSL+`varying vec3 vWP;
    void main(){
      vec2 p=vWP.xz;float r=length(p-cameraPosition.xz);
      vec2 g=floor(p/9.0);float h=h21(g);
      float tw=0.5+0.5*sin(uTime*(1.2+2.0*h)+h*40.0);
      vec2 f=fract(p/9.0)-0.5;float d=length(f);
      float sp=step(0.9,h)*smoothstep(0.35,0.0,d)*tw;
      float lin=0.05*exp(-abs(cameraPosition.y-vWP.y)*0.012);
      float a=(sp*1.2+lin)*exp(-r/650.0);
      gl_FragColor=vec4(vec3(1.0,0.85,0.5)*a*1.6,a);
    }`}));
  m.frustumCulled=false;m.renderOrder=24;m.visible=false;scene.add(m);
  function update(x,z){m.visible=best>250;if(best>250)m.position.set(x,best,z);}
  function record(alt){
    if(alt>best){best=alt;try{localStorage.setItem('icarus_best_wax',String(Math.round(alt)));}catch(_){}return true;}
    return false;
  }
  return {update:update,record:record,get best(){return best;}};
})();
