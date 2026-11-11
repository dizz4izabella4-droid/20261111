// 収録問題の検査:  node verify.js
//  1. そのレベルで使ってよい手筋だけで、論理的に最後まで解けるか
//  2. 総当たり（手筋とは別の方法）で数えて、答えがちょうど1つか。その答えが論理で出した答えと同じか
//  3. 数字の配置が点対称か
const fs=require('fs'), path=require('path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const {S,countSolutions}=require('./gen.js');
const PUZZLES=new Function('return '+html.match(/const PUZZLES=(\{[\s\S]*?\n\});/)[1])();
const LEVELS=new Function('return '+html.match(/const LEVELS=(\[[\s\S]*?\n\]);/)[1])();
let bad=0;
for(const id of Object.keys(PUZZLES)){
  const rows=PUZZLES[id], lv=LEVELS.find(l=>l.key===id[0]), g=S.makeGrid(rows.length,rows[0].length), clues=S.parseClues(rows);
  const r=S.logicSolve(g,clues,lv.allow), bf=countSolutions(g,clues,3);
  const same=bf.first&&r.st.every((x,e)=>x===bf.first[e]);
  const sym=clues.every((x,i)=>(x<0)===(clues[clues.length-1-i]<0));
  const n=clues.filter(x=>x>=0).length, len=r.st.filter(x=>x===1).length;
  const ok=r.solved&&bf.count===1&&same&&sym; if(!ok) bad++;
  console.log(id,lv.name,rows.length+'x'+rows[0].length,'数字',n,'輪の長さ',len,'手筋',JSON.stringify(r.used),'解の数',bf.count,'点対称',sym,ok?'OK':'NG');
}
console.log(bad?('NG '+bad+' 問'):'すべて OK（'+Object.keys(PUZZLES).length+' 問）'); process.exit(bad?1:0);
