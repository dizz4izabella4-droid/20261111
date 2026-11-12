/* ================= 解像度・ループ ================= */
const view={cw:1,ch:1,dpr:1,scale:1,fovBase:78};
function resize(){
  const cw=window.innerWidth,ch=window.innerHeight;
  view.cw=cw;view.ch=ch;
  view.dpr=Math.min(window.devicePixelRatio||1,2);
  const maxPx=2.4e6;
  let s=view.scale;
  let w=Math.round(cw*view.dpr*s),h=Math.round(ch*view.dpr*s);
  const px=w*h;if(px>maxPx){const k=Math.sqrt(maxPx/px);w=Math.round(w*k);h=Math.round(h*k);}
  w=Math.max(64,w);h=Math.max(64,h);
  if(w!==R.w||h!==R.h)buildTargets(w,h);
  cam.aspect=cw/ch;cam.updateProjectionMatrix();
  const asp=cw/ch;
  const vf=asp>=1.25?66:Math.min(112,2*Math.atan(Math.tan(33*Math.PI/180)*1.25/asp)*180/Math.PI);
  vmCam.fov=vf;vmCam.aspect=asp;vmCam.updateProjectionMatrix();
}
window.addEventListener('resize',resize);
window.addEventListener('orientationchange',()=>setTimeout(resize,200));
