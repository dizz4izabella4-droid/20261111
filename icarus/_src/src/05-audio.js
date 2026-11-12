/* ================= 音（すべて合成。素材ファイルなし） ================= */
const audio=(function(){
  let ctx=null,master=null,comp=null,rev=null,revSend=null,on=true;
  let windG,windF,rumbleG,thermG,heatG,whistleO,whistleG,noiseBuf,padT=0,hbT=0,lastFlap=0;
  const SCALE=[0,2,4,7,9]; // ペンタトニック（D）
  function noiseBuffer(sec,color){
    const n=Math.floor(ctx.sampleRate*sec),b=ctx.createBuffer(1,n,ctx.sampleRate),d=b.getChannelData(0);
    let l=0;for(let i=0;i<n;i++){const w=Math.random()*2-1;l=color?(l*0.985+w*0.15):w;d[i]=color?l*3.2:w;}
    return b;
  }
  function loopNoise(color){const s=ctx.createBufferSource();s.buffer=noiseBuf[color?1:0];s.loop=true;s.start();return s;}
  function init(){
    if(ctx){if(ctx.state==='suspended')ctx.resume();return;}
    try{ctx=new (window.AudioContext||window.webkitAudioContext)();ctx.resume&&ctx.resume();}catch(e){return;}
    noiseBuf=[noiseBuffer(2.5,false),noiseBuffer(2.5,true)];
    master=ctx.createGain();master.gain.value=0;
    comp=ctx.createDynamicsCompressor();comp.threshold.value=-14;comp.ratio.value=3;
    master.connect(comp);comp.connect(ctx.destination);
    // リバーブ
    rev=ctx.createConvolver();
    const len=Math.floor(ctx.sampleRate*3.2),ir=ctx.createBuffer(2,len,ctx.sampleRate);
    for(let c=0;c<2;c++){const d=ir.getChannelData(c);for(let i=0;i<len;i++){const t=i/len;d[i]=(Math.random()*2-1)*Math.pow(1-t,2.6)*(t<0.01?t*100:1);}}
    rev.buffer=ir;
    revSend=ctx.createGain();revSend.gain.value=0.55;revSend.connect(rev);
    const revOut=ctx.createGain();revOut.gain.value=0.9;rev.connect(revOut);revOut.connect(master);
    // 風
    const ws=loopNoise(false);const wbp=ctx.createBiquadFilter();wbp.type='bandpass';wbp.frequency.value=500;wbp.Q.value=0.55;
    windF=wbp;windG=ctx.createGain();windG.gain.value=0;ws.connect(wbp);wbp.connect(windG);windG.connect(master);
    const rs=loopNoise(true);const rl=ctx.createBiquadFilter();rl.type='lowpass';rl.frequency.value=260;
    rumbleG=ctx.createGain();rumbleG.gain.value=0;rs.connect(rl);rl.connect(rumbleG);rumbleG.connect(master);
    // 上昇気流のきらめき
    const ts=loopNoise(false);const tf=ctx.createBiquadFilter();tf.type='bandpass';tf.frequency.value=3200;tf.Q.value=4;
    thermG=ctx.createGain();thermG.gain.value=0;ts.connect(tf);tf.connect(thermG);thermG.connect(master);thermG.connect(revSend);
    // 熱（低いうなり）
    const ho=ctx.createOscillator();ho.type='sawtooth';ho.frequency.value=54;const hf=ctx.createBiquadFilter();hf.type='lowpass';hf.frequency.value=180;
    heatG=ctx.createGain();heatG.gain.value=0;ho.connect(hf);hf.connect(heatG);heatG.connect(master);ho.start();
    // 落下の笛
    whistleO=ctx.createOscillator();whistleO.type='sine';whistleO.frequency.value=900;
    whistleG=ctx.createGain();whistleG.gain.value=0;whistleO.connect(whistleG);whistleG.connect(master);whistleG.connect(revSend);whistleO.start();
    setOn(on);
  }
  function setOn(v){
    on=v;
    if(master)master.gain.setTargetAtTime(on?0.9:0,ctx.currentTime,0.12);
    const b=document.getElementById('snd');if(b)b.classList.toggle('off',!on);
  }
  function tone(freq,t0,dur,type,gain,attack,send){
    const o=ctx.createOscillator(),g=ctx.createGain();o.type=type;o.frequency.value=freq;
    g.gain.setValueAtTime(0,t0);g.gain.linearRampToValueAtTime(gain,t0+attack);g.gain.exponentialRampToValueAtTime(0.0001,t0+dur);
    o.connect(g);g.connect(master);if(send){const s=ctx.createGain();s.gain.value=send;g.connect(s);s.connect(revSend);}
    o.start(t0);o.stop(t0+dur+0.05);
  }
  function noiseHit(t0,dur,f0,f1,q,gain,type,send){
    const s=ctx.createBufferSource();s.buffer=noiseBuf[0];s.loop=true;
    const f=ctx.createBiquadFilter();f.type=type||'bandpass';f.Q.value=q;f.frequency.setValueAtTime(f0,t0);f.frequency.exponentialRampToValueAtTime(f1,t0+dur);
    const g=ctx.createGain();g.gain.setValueAtTime(0,t0);g.gain.linearRampToValueAtTime(gain,t0+dur*0.3);g.gain.exponentialRampToValueAtTime(0.0001,t0+dur);
    s.connect(f);f.connect(g);g.connect(master);if(send){const k=ctx.createGain();k.gain.value=send;g.connect(k);k.connect(revSend);}
    s.start(t0,Math.random()*1.5);s.stop(t0+dur+0.05);
  }
  function flap(power){
    if(!ctx)return;const t=ctx.currentTime;
    noiseHit(t,0.34,500,1700,0.8,0.30*(0.6+0.4*power),'bandpass',0.15);
    noiseHit(t+0.1,0.3,1500,500,0.7,0.15,'bandpass',0.1);
    const o=ctx.createOscillator(),g=ctx.createGain();o.type='sine';o.frequency.setValueAtTime(110,t);o.frequency.exponentialRampToValueAtTime(48,t+0.25);
    g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(0.32,t+0.03);g.gain.exponentialRampToValueAtTime(0.0001,t+0.3);o.connect(g);g.connect(master);o.start(t);o.stop(t+0.35);
  }
  function ring(n){
    if(!ctx)return;const t=ctx.currentTime;
    const deg=SCALE[n%5]+12*Math.floor(n/5%3);
    const f=293.66*Math.pow(2,deg/12);
    [1,2.005,3.01,5.02].forEach((m,i)=>tone(f*m,t,2.4-i*0.4,'sine',0.17/(i+1),0.008,0.6));
    tone(f*2,t+0.09,1.8,'triangle',0.06,0.01,0.7);
    noiseHit(t,0.6,2000,6000,1.2,0.12,'bandpass',0.4);
  }
  function thud(v){
    if(!ctx)return;const t=ctx.currentTime;
    noiseHit(t,0.35,600,120,0.6,0.28*Math.min(1,v/40),'lowpass',0.1);
    const o=ctx.createOscillator(),g=ctx.createGain();o.type='sine';o.frequency.setValueAtTime(90,t);o.frequency.exponentialRampToValueAtTime(35,t+0.3);
    g.gain.setValueAtTime(0.35*Math.min(1,v/40),t);g.gain.exponentialRampToValueAtTime(0.0001,t+0.35);o.connect(g);g.connect(master);o.start(t);o.stop(t+0.4);
  }
  function launch(){
    if(!ctx)return;const t=ctx.currentTime;
    noiseHit(t,1.4,300,2600,0.5,0.35,'bandpass',0.4);
    [0,4,7,12].forEach((d,i)=>tone(293.66*Math.pow(2,d/12),t+0.05*i,3.2,'sine',0.09,0.25,0.8));
  }
  function puff(a){
    if(!ctx)return;const t=ctx.currentTime;noiseHit(t,0.9,250,900,0.5,0.22*a,'lowpass',0.2);
  }
  function shed(){
    if(!ctx)return;const t=ctx.currentTime;
    noiseHit(t,0.12,3000,1200,2,0.12,'bandpass',0.3);
    tone(880*(0.8+Math.random()*0.5),t,0.5,'triangle',0.03,0.005,0.6);
  }
  function melt(){
    if(!ctx)return;const t=ctx.currentTime;
    noiseHit(t,2.2,4000,300,0.7,0.35,'bandpass',0.5);
    const o=ctx.createOscillator(),g=ctx.createGain();o.type='sine';o.frequency.setValueAtTime(220,t);o.frequency.exponentialRampToValueAtTime(55,t+2.4);
    g.gain.setValueAtTime(0.0,t);g.gain.linearRampToValueAtTime(0.25,t+0.1);g.gain.exponentialRampToValueAtTime(0.0001,t+2.6);o.connect(g);g.connect(master);g.connect(revSend);o.start(t);o.stop(t+2.7);
  }
  function rise(){
    if(!ctx)return;const t=ctx.currentTime;
    [0,4,7,12,16,19].forEach((d,i)=>tone(293.66*Math.pow(2,d/12),t+0.07*i,3.4,'sine',0.11,0.04,1.0));
    noiseHit(t,1.6,400,5000,0.5,0.22,'bandpass',0.6);
  }
  function endChord(){
    if(!ctx)return;const t=ctx.currentTime+0.2;
    [0,7,12,16].forEach((d,i)=>tone(146.83*Math.pow(2,d/12),t+i*0.18,6,'sine',0.07,0.8,1.0));
  }
  // 毎フレーム
  function update(dt,p){
    if(!ctx)return;const t=ctx.currentTime;
    const sp=p.speed;
    const wg=Math.min(1,sp/90);
    windG.gain.setTargetAtTime(p.mode==='fly'||p.mode==='fall'?0.03+0.55*Math.pow(wg,1.4)+p.fallK*0.35:0.04,t,0.12);
    windF.frequency.setTargetAtTime(280+sp*22+p.fallK*900,t,0.12);
    rumbleG.gain.setTargetAtTime(0.05+0.3*wg+p.cloud*0.08,t,0.2);
    thermG.gain.setTargetAtTime(p.thermal*0.07,t,0.2);
    heatG.gain.setTargetAtTime(Math.max(0,p.heat-0.35)*0.28,t,0.3);
    whistleG.gain.setTargetAtTime(p.fallK*0.05,t,0.2);
    whistleO.frequency.setTargetAtTime(500+p.fallK*900-(p.mode==='end'?300:0),t,0.3);
    // 熱の鼓動
    if(p.heat>0.45&&p.mode==='fly'){
      hbT-=dt;
      if(hbT<=0){hbT=0.75-0.4*p.heat;tone(58,t,0.22,'sine',0.35*p.heat,0.01,0);tone(52,t+0.17,0.22,'sine',0.24*p.heat,0.01,0);}
      if(Math.random()<dt*14*p.heat)noiseHit(t,0.05,5000,2500,3,0.04,'bandpass',0.1);
    }
    // 環境のやさしい和音（高度で上がる）
    padT-=dt;
    if(padT<=0&&(p.mode==='fly'||p.mode==='title')){
      padT=2.2+Math.random()*1.6;
      const ch=[0,2,4,7,9,12,14,16];
      const base=146.83*Math.pow(2,(Math.floor(p.alt01*7))/12*0+0);
      const n=ch[Math.floor(Math.random()*ch.length)];
      const oct=p.alt01>0.5?2:1;
      tone(base*oct*Math.pow(2,n/12),t,5.5,'sine',0.05,1.4,1.0);
      if(Math.random()<0.5)tone(base*oct*2*Math.pow(2,ch[(Math.random()*ch.length)|0]/12),t+0.3,4.5,'triangle',0.02,1.2,1.0);
    }
  }
  return {suspend:function(){try{ctx&&ctx.state==='running'&&ctx.suspend();}catch(e){}},resume:function(){try{ctx&&ctx.state==='suspended'&&ctx.resume();}catch(e){}},init:init,setOn:setOn,flap:flap,ring:ring,thud:thud,launch:launch,puff:puff,shed:shed,melt:melt,rise:rise,endChord:endChord,update:update,get on(){return on},get ready(){return !!ctx}};
})();
