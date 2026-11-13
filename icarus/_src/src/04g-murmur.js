/* ================= ムクドリの群れのような「渦をまく黒い雲」 ================= */
const murmur=(function(){
  const M=1500,NJ=3;
  const g=new T.BufferGeometry();
  g.setAttribute('position',new T.BufferAttribute(new Float32Array(M*3),3));
  const s=new Float32Array(M*4);for(let i=0;i<M*4;i++)s[i]=rnd();
  g.setAttribute('aS',new T.BufferAttribute(s,4));
  const objs=[];
  const base=[[-150,-430,250],[900,300,380],[-700,1100,620]];
  for(let j=0;j<NJ;j++){
    const mat=new T.ShaderMaterial({uniforms:Object.assign({uC:{value:new T.Vector3()},uR:{value:80+30*j},uScare:{value:0}},U),
      vertexShader:`attribute vec4 aS;uniform vec3 uC;uniform float uR,uScare;uniform float uTime;varying vec3 vWP;
      void main(){
        float t=uTime;
        float a=aS.x*6.2832+t*(0.25+0.45*aS.y);
        float r=uR*(0.25+0.75*pow(aS.z,0.6))*(1.0+uScare*1.6);
        vec3 p=vec3(cos(a)*r*(1.0+0.3*sin(t*0.4+aS.x*5.0)),sin(a*2.0+t*0.6+aS.y*6.0)*uR*0.33,sin(a)*r);
        p+=uR*0.3*vec3(sin(t*0.37+p.z*0.03),sin(t*0.29+p.x*0.03),sin(t*0.41+p.y*0.03));
        p+=vec3(sin(t*5.0+aS.w*30.0),sin(t*6.0+aS.w*20.0),cos(t*5.0+aS.w*10.0))*0.9;
        vec4 wp=vec4(uC+p,1.0);vWP=wp.xyz;
        vec4 mv=viewMatrix*wp;gl_Position=projectionMatrix*mv;
        gl_PointSize=clamp(900.0/max(-mv.z,1.0),1.6,6.0);
      }`,
      fragmentShader:FS_PRE+SKY_GLSL+`varying vec3 vWP;
      void main(){vec2 c=gl_PointCoord-0.5;if(dot(c,c)>0.25)discard;
        vec3 col=vec3(0.13,0.10,0.11)*(uSunCol*0.4+vec3(0.55));col=applyFog(col,vWP);gl_FragColor=vec4(col,1.0);}`});
    const o=new T.Points(g,mat);o.frustumCulled=false;o.visible=false;scene.add(o);objs.push({o:o,mat:mat,sc:0});
  }
  function wrapTo(v,c,S){return ((v-c+S*0.5)%S+S)%S-S*0.5+c;}
  function update(t,px,py,pz,dt){
    for(let j=0;j<NJ;j++){
      const B=base[j],O=objs[j];
      const cx=wrapTo(B[0]+Math.cos(t*0.04+j*2)*320,px,2600);
      const cz=wrapTo(B[1]+Math.sin(t*0.05+j)*320,pz,2600);
      let cy=wrapTo(B[2]+Math.sin(t*0.06+j)*50,py,900);if(cy<70)cy+=900*0.5;
      O.mat.uniforms.uC.value.set(cx,cy,cz);
      const d=Math.hypot(cx-px,cy-py,cz-pz);
      const tg=1-sstep(40,190,d);
      O.sc+=(tg-O.sc)*Math.min(1,dt*3);
      O.mat.uniforms.uScare.value=O.sc;
    }
  }
  return {update:update};
})();
