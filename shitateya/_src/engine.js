// 服を作る処理の本体。ふだんは裏（Worker）で動かし、裏が使えない環境では画面側で同じものを動かす
import {parseBody} from './body.js';
import {makeContextAsync,generate} from './garments.js';
import {finishParts} from './layers.js';

const SHARE={draft:0.3,fine:0.15}; // 進み具合のうち、素体の測定にあてる割合
export function createEngine(post){
  let body=null,contexts={},caches={},measured={},latest=0,quality='draft',epoch=0;
  const pause=()=>new Promise(r=>setTimeout(r,0));
  return async function handle(m){
    try{
      if(m.type==='body'){body=parseBody(m.bytes);contexts={};caches={};measured={};latest=-1;epoch++;return;}
      if(m.type==='cancel'){latest=m.job;return;}
      if(m.type!=='run')return;
      latest=m.job;quality=m.quality;const q=m.quality,cancelled=()=>m.job!==latest;
      // スマホは記憶容量が少ないので、使っていない画質の測定結果は捨てる
      if(m.light)for(const other in contexts)if(other!==q){delete contexts[other];delete caches[other];delete measured[other];}
      const share=measured[q]?0:SHARE[q];
      if(!contexts[q]){const mine=epoch;caches[q]=new Map();
        contexts[q]=makeContextAsync(body,q,async f=>{if(mine===epoch&&q===quality)post({type:'progress',job:latest,value:f*SHARE[q],step:null});await pause();});}
      const waiting=contexts[q],cache=caches[q];let ctx;
      try{ctx=await waiting;}catch(err){if(contexts[q]===waiting)delete contexts[q];throw err;}
      if(contexts[q]===waiting)measured[q]=true;
      if(cancelled())return;
      const parts=new Map();
      const done=await generate(ctx,m.design,cache,(id,list)=>{for(const p of list)parts.set(p.name,p);},
        (n,total,id,f)=>post({type:'progress',job:m.job,value:share+(1-share)*(n+f)/total,step:id}),cancelled);
      if(!done)return;
      post({type:'progress',job:m.job,value:1,step:'layers'});await pause();if(cancelled())return;
      post({type:'done',job:m.job,quality:q,parts:finishParts(ctx,[...parts.values()])});
    }catch(err){post({type:'error',job:m.job,message:String(err&&err.message||err)});}
  };
}
