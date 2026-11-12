/* ================= 起動 ================= */
resize();
el.go.textContent=coarse?'タップで飛び立つ':'クリックで飛び立つ';
wings.setLayout(view.cw/view.ch);
window.addEventListener('resize',()=>wings.setLayout(view.cw/view.ch));
resetRun();
G.fade=1;G.fadeTarget=0;
window.__pose=function(x,y,z,yaw,pitch,roll,heat,spd){G.freeze=true;G.fzSpeed=spd||30;b.x=x;b.y=y;b.z=z;b.yaw=yaw;b.pitch=pitch;b.roll=roll||0;G.heat=heat||0;b.vx=-Math.sin(yaw)*(spd||30);b.vz=-Math.cos(yaw)*(spd||30);b.vy=0;if(G.mode==='title')setMode('fly');el.title.classList.remove('on');el.hint.classList.remove('on');};
window.__sim=function(n,dt,pol){
  G.auto=function(){return pol(b,G,{route:ROUTE,act:thAct});};
  const log=[];
  for(let i=0;i<n;i++){
    update(dt);
    if(i%Math.round(5/dt)===0)log.push({t:+G.t.toFixed(1),m:G.mode,y:Math.round(b.y),sp:Math.round(b.speed),heat:+G.heat.toFixed(2),dmg:+G.damage.toFixed(2),k:+G.thK.toFixed(2),x:Math.round(b.x),z:Math.round(b.z),alive:wings.aliveCount()});
    if(G.mode==='end')break;
  }
  G.auto=null;
  return log;
};
window.__icarus={blockInfo:blockInfo,sbuf:sbuf,bbuf:bbuf,G:G,b:b,cam:cam,wings:wings,view:view,route:ROUTE,angels:angels,startMelt:startMelt,launch:launch,flapNow:flapNow,P:P,U:U,inp:inp,finish:finish};
requestAnimationFrame(frame);
