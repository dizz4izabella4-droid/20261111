/* ================= 音（すべて合成。素材ファイルなし）：風・水・遠い合唱・5分の楽曲 ================= */
const audio=(function(){
  let ctx=null,master=null,fadeG=null,comp=null,rev=null,revSend=null,on=true;
  let windG,windF,airG,choirG,wfG,wfPan,noiseBuf,chordIdx=-99,arpT=0,lastLevel=1,level=1;
  // 和音（15秒ごと）。[根音を含む構成音(Hz)]
  const CH=[
    [146.83,220,329.63],[123.47,185,293.66],[146.83,220,293.66,369.99],[98,146.83,246.94,293.66],
    [123.47,185,293.66,369.99],[110,164.81,277.18,329.63],[98,146.83,246.94,369.99],[92.5,220,293.66,440],
    [164.81,246.94,293.66,392],[110,164.81,277.18,329.63],[146.83,220,293.66,369.99,440],[123.47,185,293.66,369.99],
    [98,146.83,246.94,369.99],[146.83,220,293.66,369.99],[123.47,185,293.66,369.99],[98,146.83,246.94,293.66],
    [146.83,220,293.66,369.99],[110,164.81,293.66,329.63],[146.83,220,293.66,369.99],[146.83,220,329.63]
  ];
  const PENTA=[0,2,4,7,9]; // D ペンタトニック
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
    fadeG=ctx.createGain();fadeG.gain.value=0;
    comp=ctx.createDynamicsCompressor();comp.threshold.value=-16;comp.ratio.value=3;
    master.connect(fadeG);fadeG.connect(comp);comp.connect(ctx.destination);
    rev=ctx.createConvolver();
    const len=Math.floor(ctx.sampleRate*4.2),ir=ctx.createBuffer(2,len,ctx.sampleRate);
    for(let c=0;c<2;c++){const d=ir.getChannelData(c);for(let i=0;i<len;i++){const t=i/len;d[i]=(Math.random()*2-1)*Math.pow(1-t,2.4)*(t<0.01?t*100:1);}}
    rev.buffer=ir;
    revSend=ctx.createGain();revSend.gain.value=0.7;revSend.connect(rev);
    const revOut=ctx.createGain();revOut.gain.value=1.0;rev.connect(revOut);revOut.connect(master);
    // 風（やわらかく）
    const ws=loopNoise(false);const wbp=ctx.createBiquadFilter();wbp.type='bandpass';wbp.frequency.value=420;wbp.Q.value=0.5;
    windF=wbp;windG=ctx.createGain();windG.gain.value=0;ws.connect(wbp);wbp.connect(windG);windG.connect(master);
    // 高い空気のささやき
    const as=loopNoise(true);const af=ctx.createBiquadFilter();af.type='highpass';af.frequency.value=1800;
    airG=ctx.createGain();airG.gain.value=0;as.connect(af);af.connect(airG);airG.connect(master);airG.connect(revSend);
    // 神域の合唱（D・F#・A の和音）
    choirG=ctx.createGain();choirG.gain.value=0;
    const cf=ctx.createBiquadFilter();cf.type='lowpass';cf.frequency.value=1300;cf.Q.value=0.4;
    const lfo=ctx.createOscillator(),lg=ctx.createGain();lfo.frequency.value=4.2;lg.gain.value=3.2;lfo.start();
    [146.83,220,293.66,369.99,440,587.33].forEach((f,i)=>{
      const o=ctx.createOscillator();o.type=i%2?'triangle':'sine';o.frequency.value=f;o.detune.value=(i-2.5)*3;
      lfo.connect(lg);lg.connect(o.detune);
      const g=ctx.createGain();g.gain.value=0.5/(1+i*0.35);o.connect(g);g.connect(cf);o.start();
    });
    cf.connect(choirG);choirG.connect(master);choirG.connect(revSend);
    // 滝の音（素材：30秒ループ）
    wfG=ctx.createGain();wfG.gain.value=0;
    wfPan=ctx.createStereoPanner?ctx.createStereoPanner():null;
    if(wfPan){wfPan.connect(wfG);}
    wfG.connect(master);
    try{
      const bin=atob(ASSET.waterfall),u8=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);
      const ok=function(buf){const s=ctx.createBufferSource();s.buffer=buf;s.loop=true;s.connect(wfPan||wfG);s.start();};
      const pr=ctx.decodeAudioData(u8.buffer,ok,function(){});if(pr&&pr.catch)pr.catch(function(){});
    }catch(e){}
    setOn(on);
    fadeG.gain.setTargetAtTime(level,ctx.currentTime,0.3);
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
    const g=ctx.createGain();g.gain.setValueAtTime(0,t0);g.gain.linearRampToValueAtTime(gain,t0+dur*0.35);g.gain.exponentialRampToValueAtTime(0.0001,t0+dur);
    s.connect(f);f.connect(g);g.connect(master);if(send){const k=ctx.createGain();k.gain.value=send;g.connect(k);k.connect(revSend);}
    s.start(t0,Math.random()*1.5);s.stop(t0+dur+0.05);
  }
  // 羽ばたき：低くやわらかい「ふわり」。うるさくならないよう小さく
  function flap(power){
    if(!ctx)return;const t=ctx.currentTime;
    noiseHit(t,0.55,320,820,0.6,0.055*(0.6+0.4*(power||1)),'lowpass',0.25);
    noiseHit(t+0.16,0.5,700,260,0.5,0.03,'lowpass',0.2);
  }
  function puff(a){
    if(!ctx)return;const t=ctx.currentTime;noiseHit(t,1.6,260,800,0.5,0.10*a,'lowpass',0.4);
    [0,7,12,16].forEach((d,i)=>tone(293.66*Math.pow(2,d/12),t+0.12*i+0.3,3.2,'sine',0.035,0.5,1.0));
  }
  function padNote(f,t0,dur,gain,cut){
    const g=ctx.createGain();
    g.gain.setValueAtTime(0,t0);g.gain.linearRampToValueAtTime(gain,t0+3.4);
    g.gain.setValueAtTime(gain,t0+Math.max(3.5,dur-4.5));g.gain.linearRampToValueAtTime(0.0001,t0+dur);
    const lp=ctx.createBiquadFilter();lp.type='lowpass';lp.frequency.value=cut;lp.Q.value=0.3;
    [-7,6].forEach(d=>{const o=ctx.createOscillator();o.type='sawtooth';o.frequency.value=f;o.detune.value=d;o.connect(lp);o.start(t0);o.stop(t0+dur+0.1);});
    lp.connect(g);g.connect(master);const s=ctx.createGain();s.gain.value=0.9;g.connect(s);s.connect(revSend);
  }
  function bell(f,t0,gain){
    [1,2.005,3.01].forEach((m,i)=>tone(f*m,t0,3.2-i*0.7,'sine',gain/(i+1),0.01,0.9));
  }
  function endNote(){
    if(!ctx)return;const t=ctx.currentTime+0.1;
    [0,7,12,16].forEach((d,i)=>tone(146.83*Math.pow(2,d/12),t+i*0.4,7,'sine',0.05,1.2,1.0));
  }
  // 楽曲：映像時刻 ft に合わせて和音と鈴を重ねる
  function score(dt,ft,live){
    const t=ctx.currentTime;
    const idx=Math.min(CH.length-1,Math.floor(ft/15));
    const dens=live?(ft<20?0:(ft<90?0.30:(ft<150?0.45:(ft<210?0.80:(ft<270?0.42:0.16))))):0;
    const cut=650+800*sstep(60,150,ft)+600*sstep(150,190,ft)-700*sstep(230,295,ft);
    if(idx!==chordIdx&&live){
      chordIdx=idx;
      const ch=CH[idx];
      const g=(0.012+0.010*sstep(30,150,ft))*(ft>288?0.6:1);
      ch.forEach((f,i)=>padNote(f*(i===0?1:1),t,17,g/(1+i*0.15),cut));
      tone(ch[0]*0.5,t,15,'sine',0.055,2.5,0.7);
    }
    arpT-=dt;
    if(live&&arpT<=0&&dens>0){
      arpT=1.3+Math.random()*2.6/(0.4+dens);
      if(Math.random()<dens){
        const ch=CH[idx];const root=ch[Math.min(1,ch.length-1)];
        const oct=ft>150&&ft<215?(Math.random()<0.5?4:2):2;
        const f=root*oct*Math.pow(2,PENTA[(Math.random()*5)|0]/12);
        bell(f,t+Math.random()*0.2,0.028+0.02*dens);
      }
    }
  }
  function update(dt,p){
    if(!ctx)return;const t=ctx.currentTime;
    const wg=Math.min(1,p.speed/45);
    windG.gain.setTargetAtTime(0.012+0.045*wg*wg+p.cloud*0.03,t,0.4);
    windF.frequency.setTargetAtTime(240+p.speed*8+p.cloud*200,t,0.3);
    airG.gain.setTargetAtTime(0.004+0.012*p.alt01,t,0.6);
    choirG.gain.setTargetAtTime(p.choir*0.06,t,1.2);
    if(wfG){wfG.gain.setTargetAtTime(0.6*(p.wf||0),t,0.5);if(wfPan)wfPan.pan.setTargetAtTime(p.wpan||0,t,0.4);}
    if(p.level!==undefined&&Math.abs(p.level-lastLevel)>0.004){lastLevel=p.level;fadeG.gain.setTargetAtTime(p.level,t,0.25);}
    score(dt,p.ft,p.live);
  }
  function reset(){chordIdx=-99;arpT=1;}
  return {suspend:function(){try{ctx&&ctx.state==='running'&&ctx.suspend();}catch(e){}},resume:function(){try{ctx&&ctx.state==='suspended'&&ctx.resume();}catch(e){}},init:init,setOn:setOn,flap:flap,puff:puff,endNote:endNote,update:update,reset:reset,get on(){return on},get ready(){return !!ctx}};
})();
