// 服の計算は画面を止めないように裏で行う
import {parseBody} from './body.js';
import {makeContext,generate} from './garments.js';
import {finishParts} from './layers.js';

let body=null,contexts={},caches={},latest=0;
const pause=()=>new Promise(r=>setTimeout(r,0));
self.onmessage=async e=>{
  const m=e.data;
  try{
    if(m.type==='body'){body=parseBody(m.bytes);contexts={};caches={};latest=-1;return;}
    if(m.type==='cancel'){latest=m.job;return;}
    if(m.type!=='run')return;
    latest=m.job;const q=m.quality,cancelled=()=>m.job!==latest;
    if(!contexts[q]){self.postMessage({type:'progress',job:m.job,value:0,step:null});await pause();if(cancelled())return;contexts[q]=makeContext(body,q);caches[q]=new Map();}
    const parts=new Map();
    const done=await generate(contexts[q],m.design,caches[q],(id,list)=>{for(const p of list)parts.set(p.name,p);},
      (n,total,id,f)=>self.postMessage({type:'progress',job:m.job,value:(n+f)/total,step:id}),cancelled);
    if(!done)return;
    self.postMessage({type:'progress',job:m.job,value:1,step:'layers'});await pause();if(cancelled())return;
    self.postMessage({type:'done',job:m.job,quality:q,parts:finishParts(contexts[q],[...parts.values()])});
  }catch(err){self.postMessage({type:'error',job:m.job,message:String(err&&err.message||err)});}
};
