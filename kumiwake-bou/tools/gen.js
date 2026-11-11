// 問題の候補を作る:  node gen.js <たて> <よこ> <レベル 1〜3> <個数> <乱数の種> <数字の最少数> [試行回数]
//   例: node gen.js 6 6 2 5 123 20
// 手筋（論理ソルバー）は ../index.html の SOLVER-BEGIN〜SOLVER-END をそのまま読み込んで使う（ゲームのヒントと同じもの）
const fs=require('fs');
const src=fs.readFileSync(process.env.SOLVER_SRC||require('path').join(__dirname,'../index.html'),'utf8').match(/\/\*SOLVER-BEGIN\*\/([\s\S]*?)\/\*SOLVER-END\*\//)[1];
const S=new Function(src+';return {makeGrid,parseClues,logicSolve,isComplete,nextDeductions};')();
module.exports={S,countSolutions,rng,get generate(){return generate},get fmt(){return fmt}};

function rng(seed){ let a=seed>>>0; return ()=>{ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }

// 総当たり（論理ソルバーの手筋とは別に書いた、場合分け＋基本の絞り込み）で解の数を数える。limit 個見つけたら打ち切り
function countSolutions(g,clues,limit=2){
  const st=new Uint8Array(g.EN); let count=0, first=null;
  const edgeCells=[...Array(g.EN)].map(()=>[]); g.cellE.forEach((es,i)=>es.forEach(e=>edgeCells[e].push(i)));
  const trail=[];
  // 辺 e を v に決め、数字と点の本数だけで決まるものを連鎖させる。矛盾したら false
  function assign(e0,v0){
    const q=[[e0,v0]];
    while(q.length){ const [e,v]=q.pop(); if(st[e]){ if(st[e]!==v) return false; continue; } st[e]=v; trail.push(e);
      for(const i of edgeCells[e]){ const n=clues[i]; if(n<0) continue; let L=0,U=0; for(const x of g.cellE[i]){ if(st[x]===1)L++; else if(st[x]===0)U++; }
        if(L>n||L+U<n) return false; if(U){ if(L===n){ for(const x of g.cellE[i]) if(!st[x]) q.push([x,2]); } else if(L+U===n){ for(const x of g.cellE[i]) if(!st[x]) q.push([x,1]); } } }
      for(const w of g.edgeV[e]){ let L=0,U=0; for(const x of g.vertE[w]){ if(st[x]===1)L++; else if(st[x]===0)U++; }
        if(L>2||(L===1&&U===0)) return false; if(U){ if(L===2){ for(const x of g.vertE[w]) if(!st[x]) q.push([x,2]); } else if(L===1&&U===1){ for(const x of g.vertE[w]) if(!st[x]) q.push([x,1]); } else if(L===0&&U===1){ for(const x of g.vertE[w]) if(!st[x]) q.push([x,2]); } } }
    }
    return true;
  }
  // 線が輪を閉じていたら、それが全部の線を含む正解のときだけ可
  function closedBad(){
    const seen=new Uint8Array(g.EN); let LN=0; for(let e=0;e<g.EN;e++) if(st[e]===1) LN++;
    for(let e=0;e<g.EN;e++){ if(st[e]!==1||seen[e]) continue;
      // e を含む線のつながりをたどる
      let n=0, closed=true; const stack=[e]; seen[e]=1;
      while(stack.length){ const x=stack.pop(); n++; for(const w of g.edgeV[x]){ let d=0; for(const y of g.vertE[w]){ if(st[y]===1){ d++; if(!seen[y]){ seen[y]=1; stack.push(y); } } } if(d!==2) closed=false; } }
      if(closed&&n!==LN) return true;
    }
    return false;
  }
  function rec(){
    if(count>=limit) return;
    if(closedBad()) return;
    let e=-1; for(let x=0;x<g.EN;x++) if(!st[x]){ e=x; break; }
    if(e<0){ if(S.isComplete(g,clues,st)){ count++; if(!first) first=Uint8Array.from(st); } return; }
    for(const v of [1,2]){ const mark=trail.length; if(assign(e,v)) rec(); while(trail.length>mark) st[trail.pop()]=0; if(count>=limit) return; }
  }
  rec(); return {count,first};
}

// 1つの輪を作る: 内側のマスのかたまりを1マスずつ広げる（穴を作らない・ななめだけで接しない）
function makeLoop(R,C,rand,target){
  const ins=new Uint8Array(R*C); const at=(r,c)=>(r<0||c<0||r>=R||c>=C)?0:ins[r*C+c];
  function valid(){
    for(let r=0;r<R-1;r++) for(let c=0;c<C-1;c++){ const a=at(r,c),b=at(r,c+1),d=at(r+1,c),e=at(r+1,c+1); if(a===e&&b===d&&a!==b) return false; }
    // 外側がひとつながりか（外周の1マス外も含めて塗る）
    const W=C+2,Hh=R+2, seen=new Uint8Array(W*Hh), q=[0]; seen[0]=1; let n=1;
    while(q.length){ const p=q.pop(), pr=(p/W|0), pc=p%W; for(const [dr,dc] of [[1,0],[-1,0],[0,1],[0,-1]]){ const r=pr+dr,c=pc+dc; if(r<0||c<0||r>=Hh||c>=W) continue; const k=r*W+c; if(seen[k]) continue; if(at(r-1,c-1)) continue; seen[k]=1; n++; q.push(k); } }
    let outside=W*Hh; for(let i=0;i<R*C;i++) if(ins[i]) outside--;
    return n===outside;
  }
  ins[(rand()*R|0)*C+(rand()*C|0)]=1; let size=1, fails=0;
  while(size<target&&fails<400){
    const fr=[]; for(let r=0;r<R;r++) for(let c=0;c<C;c++){ if(ins[r*C+c]) continue; const nb=at(r-1,c)+at(r+1,c)+at(r,c-1)+at(r,c+1); if(nb>=1) fr.push([r*C+c,nb]); }
    if(!fr.length) break;
    // 隣が1つだけのマスを選びやすくして、くねくねした輪にする
    const w=fr.map(([,nb])=>nb===1?6:nb===2?1.5:0.3), tot=w.reduce((a,b)=>a+b,0); let x=rand()*tot, k=0; while(k<fr.length-1&&(x-=w[k])>0) k++;
    const i=fr[k][0]; ins[i]=1; if(valid()){ size++; fails=0; } else { ins[i]=0; fails++; }
  }
  return ins;
}
function cluesOf(R,C,ins){ const at=(r,c)=>(r<0||c<0||r>=R||c>=C)?0:ins[r*C+c]; const cl=[];
  for(let r=0;r<R;r++) for(let c=0;c<C;c++){ const me=at(r,c); cl.push((at(r-1,c)!==me)+(at(r+1,c)!==me)+(at(r,c-1)!==me)+(at(r,c+1)!==me)); } return cl; }
function loopLen(R,C,ins){ return cluesOf(R,C,ins).reduce((a,b,i)=>a+(ins[i]?b:0),0); }

const TIERS={
  1:{allow:{num:1,vert:1,cell:1}},
  2:{allow:{num:1,vert:1,cell:1,pair:1}},
  3:{allow:{num:1,vert:1,cell:1,pair:1,loop:1}},
};
function generate(R,C,tier,rand,minClues){
  const g=S.makeGrid(R,C), N=R*C, allow=TIERS[tier].allow;
  const ins=makeLoop(R,C,rand,Math.round(N*(0.46+rand()*0.14)));
  const full=cluesOf(R,C,ins), clues=full.slice();
  if(!S.logicSolve(g,clues,allow).solved) return null;
  // 点対称の位置にある数字を2つずつ消していく（論理だけで解けるままなら採用）
  const pairs=[]; for(let i=0;i<Math.ceil(N/2);i++) pairs.push(i);
  for(let i=pairs.length-1;i>0;i--){ const j=rand()*(i+1)|0; [pairs[i],pairs[j]]=[pairs[j],pairs[i]]; }
  let n=N;
  for(const i of pairs){ const j=N-1-i, k=(i===j?1:2); if(n-k<minClues) continue;
    const a=clues[i], b=clues[j]; clues[i]=-1; clues[j]=-1;
    if(S.logicSolve(g,clues,allow).solved) n-=k; else { clues[i]=a; clues[j]=b; } }
  const res=S.logicSolve(g,clues,allow);
  return {R,C,ins,clues,n,res,len:loopLen(R,C,ins),g};
}
function fmt(p){ const rows=[]; for(let r=0;r<p.R;r++) rows.push(p.clues.slice(r*p.C,(r+1)*p.C).map(x=>x<0?'.':x).join('')); return rows; }

if(require.main===module){
  const [,,R,C,tier,count,seed,minC,tries]=process.argv; const rand=rng(+seed||1);
  const cands=[];
  for(let t=0;t<(+tries||400);t++){ const p=generate(+R,+C,+tier,rand,+minC); if(!p||!p.res.solved) continue;
    const z=p.clues.filter(x=>x===0).length, th=p.clues.filter(x=>x===3).length;
    const hist=[0,1,2,3].map(k=>p.clues.filter(x=>x===k).length);
    if(z>2||p.n>+minC+3) continue;
    if(hist[1]<2||hist[2]<2||hist[3]<2) continue;
    // 数字のない行・列が続かないこと（見た目のバランス）
    let emptyRow=0; for(let r=0;r<p.R;r++) if(p.clues.slice(r*p.C,(r+1)*p.C).every(x=>x<0)) emptyRow++;
    let emptyCol=0; for(let c=0;c<p.C;c++){ let e=true; for(let r=0;r<p.R;r++) if(p.clues[r*p.C+c]>=0) e=false; if(e) emptyCol++; }
    if(emptyRow||emptyCol) continue;
    const u=p.res.used;
    // 長くてくねった輪、手筋がほどよく混ざるものを高く評価
    p.score=p.len*1.0 - Math.abs(p.n-(+minC))*1.5 + Math.min(u.cell,12)*0.6 + (tier>=2?Math.min(u.pair,6)*1.5:0) + (tier>=3?Math.min(u.loop,4)*3:0) - z*2;
    p.hist=hist; cands.push(p);
  }
  cands.sort((a,b)=>b.score-a.score);
  const picked=[]; for(const p of cands){ if(picked.length>=+count) break;
    if(picked.some(q=>q.ins.join('')===p.ins.join(''))) continue;
    const bf=countSolutions(p.g,p.clues); if(bf.count!==1) { console.error('NOT UNIQUE?!',fmt(p)); continue; }
    picked.push(p); }
  console.error(`candidates ${cands.length}`);
  picked.forEach(p=>console.log(JSON.stringify({rows:fmt(p),n:p.n,len:p.len,used:p.res.used,rounds:p.res.rounds,hist:p.hist,score:+p.score.toFixed(1)})));
}
