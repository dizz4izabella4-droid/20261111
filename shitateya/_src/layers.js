// 重ね着の順序と、重なったところで外側の服が内側より外に出るようにする仕上げ
import {add,sub,mul,len,norm,cross,dot} from './lib.js';

export const GAP=0.0022;      // 外側の服と内側の服の最小すき間（m）
const REACH=0.026;            // これより深い食い違いは、重なりではなく別の面とみなす
const LIMIT=0.032;            // 1 つの頂点を動かす量の上限

// [内側, 外側] の組。上から順に処理する（内側が先に決まるように並べる）
const fitted=p=>p.fitted===true, loose=p=>p.fitted!==true;
export const PAIRS=[
  {outer:'shoes',inner:['pants'],when:p=>!p.foot},
  {outer:'skirt',inner:['pants']},
  {outer:'vest',inner:['pants','top','skirt']},
  {outer:'tabard',inner:['pants','top','skirt','vest']},
  {outer:'sash',inner:['pants','top','skirt','vest','tabard']},
  {outer:'tail',inner:['skirt','vest','tabard']},
  {outer:'bracer',inner:['sleeve'],innerWhen:fitted},
  {outer:'sleeve',inner:['bracer'],when:loose},
  {outer:'cape',inner:['top','skirt','vest','tabard','sash','sleeve']},
  {outer:'hood',inner:['cape']},
];

const triangles=part=>{const g=part.pos,nv=g.length,nu=g[0].length,out=[];
  for(let j=0;j+1<nv;j++)for(let i=0;i<(part.closed?nu:nu-1);i++){const k=(i+1)%nu;out.push([[j,i],[j+1,i],[j+1,k]],[[j,i],[j+1,k],[j,k]]);}return out;};
const CELL=0.03;
function lookup(list){ // 三角形を升目に分けて、近いものだけを調べる
  const map=new Map();
  for(const item of list){const t=item.p,lo=[0,1,2].map(c=>Math.floor((Math.min(t[0][c],t[1][c],t[2][c])-REACH)/CELL)),hi=[0,1,2].map(c=>Math.floor((Math.max(t[0][c],t[1][c],t[2][c])+REACH)/CELL));
    for(let x=lo[0];x<=hi[0];x++)for(let y=lo[1];y<=hi[1];y++)for(let z=lo[2];z<=hi[2];z++){const k=x+','+y+','+z;let l=map.get(k);if(!l)map.set(k,l=[]);l.push(item);}}
  return p=>map.get(Math.floor(p[0]/CELL)+','+Math.floor(p[1]/CELL)+','+Math.floor(p[2]/CELL))||[];
}
// 点 o から向き d の直線が三角形と交わる位置（交わらなければ null）
function hit(o,d,[a,b,c]){
  const e1=sub(b,a),e2=sub(c,a),h=cross(d,e2),det=dot(e1,h);if(Math.abs(det)<1e-12)return null;
  const f=1/det,s=sub(o,a),u=f*dot(s,h);if(u<-1e-5||u>1+1e-5)return null;const q=cross(s,e1),v=f*dot(d,q);if(v<-1e-5||u+v>1+1e-5)return null;return f*dot(e2,q);
}

// 服の「外向き」。
// 腰や肩から下がる服は、体の軸から水平に外へ。向きを横にずらすと、前の開きが少しずつ塞がってしまう。
// 肩より上のマントとフードは上向きの面があるので、体の表面から離れる向きを使う。
function outwardOf(bodyOnly,part,shoulderY){
  if(part.kind==='shoes'||part.kind==='bracer'||part.kind==='sleeve'){ // 筒の形は、輪の中心から外へ
    const centers=part.pos.map(row=>mul(row.reduce(add,[0,0,0]),1/row.length));
    return(p,j)=>norm(sub(p,centers[j]));
  }
  const wrap=part.kind==='cape'||part.kind==='hood';
  return p=>{const r=norm([p[0],0,p[2]]);if(wrap&&p[1]>shoulderY){const g=[0,0,0];bodyOnly.at(p[0],p[1],p[2],g);if(len(g)>0.5){const n=norm(g);if(dot(n,r)>0.35)return n;}}return r;};
}

// 素体の内側に埋まって、どのポーズでも見えない面に印を付ける（ズボンの左右の合わせ面、靴の中の面）
export function markBuried(bodyOnly,parts){
  return parts.map(p=>{
    if(!['pants','shoes','strap'].includes(p.kind))return p;
    const buried=p.pos.map(row=>row.map(v=>(p.kind!=='pants'||Math.abs(v[0])<0.002)&&bodyOnly.at(v[0],v[1],v[2])<-0.004));
    return buried.some(r=>r.includes(true))?{...p,buried}:p;
  });
}

// parts を作り直して返す（渡された部品は書き換えない）
export function separateLayers(bodyOnly,parts,shoulderY=Infinity){
  const list=parts.slice();
  for(const rule of PAIRS){
    for(let n=0;n<list.length;n++){
      const outer=list[n];
      if(outer.kind!==rule.outer||rule.when&&!rule.when(outer))continue;
      const inners=list.filter(p=>rule.inner.includes(p.kind)&&(!rule.innerWhen||rule.innerWhen(p)));
      if(!inners.length)continue;
      const innerTris=[],innerPoints=[];
      for(const p of inners){for(const t of triangles(p))innerTris.push({p:t.map(([j,i])=>p.pos[j][i])});for(const row of p.pos)for(const v of row)innerPoints.push(v);}
      const nearInner=lookup(innerTris),tris=triangles(outer);
      let pos=outer.pos,changed=false;
      const moved=pos.map(r=>new Float64Array(r.length));
      for(let pass=0;pass<5;pass++){
        const NV=pos.length,NU=pos[0].length,dirOf=outwardOf(bodyOnly,{...outer,pos},shoulderY),need=pos.map(r=>new Float64Array(r.length));let count=0;
        const first=outer.kind==='cape'?1:0; // マントの肩の列は、留め具の位置なので動かさない
        // 1) 外側の頂点が、内側の面より下にある
        pos.forEach((row,j)=>j>=first&&row.forEach((v,i)=>{const d=dirOf(v,j);for(const t of nearInner(v)){const h=hit(v,d,t.p);if(h!==null&&h>-GAP&&h<REACH&&h+GAP>need[j][i]){need[j][i]=h+GAP;count++;}}}));
        // 2) 内側の頂点が、外側の面の中ほどから突き出ている
        const nearOuter=lookup(tris.map(t=>({p:t.map(([j,i])=>pos[j][i]),at:t})));
        for(const u of innerPoints){let top=-Infinity,at=null;
          for(const t of nearOuter(u)){const d=dirOf(u,t.at[0][0]),h=hit(u,d,t.p);if(h!==null&&h<REACH&&h>top){top=h;at=t.at;}} // いちばん外側で覆っている面
          if(!at||top>=GAP-1e-5||top<=-REACH)continue;const push=GAP-top;
          for(const[j,i]of at)if(j>=first&&push>need[j][i]){need[j][i]=push;count++;}}
        if(!count)break;
        // 周りの頂点にも少し分けて、角が立たないようにする
        let spread=need;
        for(let it=0;it<2;it++)spread=spread.map((r,j)=>r.map((v,i)=>{if(j<first)return 0;let s=0,m=0;
          for(const[a,b]of[[j-1,i],[j+1,i],[j,i-1],[j,i+1]]){if(a<0||a>=NV)continue;const bb=outer.closed?(b+NU)%NU:b;if(bb<0||bb>=NU)continue;s+=spread[a][bb];m++;}
          return Math.max(v,m?s/m*0.85:0);}));
        pos=pos.map((row,j)=>row.map((v,i)=>{const move=Math.min(spread[j][i],LIMIT-moved[j][i]);if(!(move>0))return v;moved[j][i]+=move;return add(v,mul(dirOf(v,j),move));}));changed=true;
      }
      if(changed)list[n]={...outer,pos};
    }
  }
  return list;
}

// 形ができたあとの仕上げ：重ね着を整えてから、埋まって見えない面に印を付ける
export const finishParts=(ctx,parts)=>markBuried(ctx.bodyOnly,separateLayers(ctx.bodyOnly,parts,ctx.S[1]-0.04*ctx.k));
