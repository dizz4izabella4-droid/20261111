/* ================= 太陽の門（届かない、でも行ってみたくなるゴール） ================= */
const sunGate=(function(){
  const mat=new T.ShaderMaterial({uniforms:Object.assign({uAng:{value:0.16},uOn:{value:1}},U),transparent:true,depthWrite:false,depthTest:true,blending:T.AdditiveBlending,side:T.DoubleSide,
    vertexShader:`uniform float uAng;uniform vec3 uSunDir;varying vec2 vQ;
    void main(){
      vec3 sd=normalize(uSunDir);vec3 rg=normalize(cross(vec3(0.0,1.0,0.0),sd));vec3 up=cross(sd,rg);
      vec3 wp=cameraPosition+(sd+(rg*position.x+up*position.y)*uAng)*5000.0;
      vec4 cp=projectionMatrix*viewMatrix*vec4(wp,1.0);cp.z=cp.w*0.99999;gl_Position=cp;vQ=position.xy;
    }`,
    fragmentShader:FS_PRE+`uniform float uOn;uniform float uTime;varying vec2 vQ;
    void main(){
      vec2 q=vQ;float r=length(q);float a=atan(q.y,q.x);float t=uTime;
      float ring=smoothstep(0.045,0.0,abs(r-0.80));
      float ring2=smoothstep(0.012,0.0,abs(r-0.93));
      float ring3=smoothstep(0.02,0.0,abs(r-0.60));
      float ticks=smoothstep(0.6,0.97,0.5+0.5*cos(a*48.0+t*0.15))*smoothstep(0.03,0.0,abs(r-0.70));
      float arches=pow(0.5+0.5*cos(a*12.0-t*0.25),6.0)*smoothstep(0.09,0.0,abs(r-0.67));
      float halo=exp(-pow((r-0.8)*5.0,2.0))*0.4;
      float rays=pow(0.5+0.5*cos(a*18.0+t*0.1),12.0)*exp(-max(r-0.8,0.0)*3.0)*step(0.8,r)*0.3;
      float rp=fract(t*0.14);
      float ripple=smoothstep(0.035,0.0,abs(r-(1.0-rp)*0.95))*(1.0-rp)*0.9;
      float pulse=0.82+0.18*sin(t*0.8);
      float edge=smoothstep(1.0,0.86,r);
      vec3 c=mix(vec3(1.0,0.78,0.42),vec3(1.0,0.97,0.88),ring);
      float A=(ring*1.5+ring2*0.9+ring3*0.55+ticks*1.0+arches*1.0+halo+rays+ripple)*pulse*edge*uOn;
      gl_FragColor=vec4(c*A*1.8,A);
    }`});
  const m=new T.Mesh(new T.PlaneGeometry(2,2),mat);m.frustumCulled=false;m.renderOrder=-5;scene.add(m);
  function update(y){
    const pr=clamp(y/3000,0,1);
    mat.uniforms.uAng.value=lerp(0.17,0.62,Math.pow(pr,0.8));
  }
  return {update:update};
})();
