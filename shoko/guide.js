(function(){
'use strict';
const GUIDE={"M-01":["内線番号の表示と実際の発信室は別の記録です。","報告の番号がどこから得られたかを確認する。","番号を見た人と、伝聞で番号を知った人を分ける。","設備の工事前後で番号の対応が変わっていないか調べる。",[["201","表示番号。実際の発信室と同じとは限らない。"],["205","交換機の配線変更が関係する別の客室。"],["配線","電話機と番号を結ぶ設備上の対応。"],["交換盤","内線の呼出し番号が表示される装置。"]]],"M-02":["声を聞いたことと、生きた本人を見たことは違います。","現場で確認できた時刻と見聞きした内容を整理する。","直接聞いた人と、後で聞いた人を分ける。","録音再生と音の経路を調べる。",[["録音","以前の声を保存した音源。"],["再生","保存された音声を流すこと。"],["進行表","予定と実施の記録を区別して読む。"],["客席系統","音声を出すスピーカーの系統。"]]],"M-03":["機械が印字した時刻には、時計のずれが含まれます。","取引があった事実と表示された時刻を分ける。","その時間に人物を直接見た証言があるか探す。","修理履歴で時刻設定を照合する。",[["レシート","会計機器の印字であり、時刻が正確とは限らない。"],["四十七分","点検で判明した時計の進み幅。"],["保守","機器の点検・修理の記録。"],["外灯","自動点灯なら店内に人がいる証明にはならない。"]]],"M-04":["撮影日・処理日・納品日は別々の時間です。","封筒に書かれた数字の意味を確かめる。","話者がどの工程を指しているか分ける。","ネガ袋と納品票の書式を照合する。",[["撮影日","実際に写真を撮った日。"],["現像","撮影後にフィルムを処理する工程。"],["封筒","処理や納品の情報が付くことがある。"],["納品","完成した写真を渡す工程。"]]],"M-05":["エレベーターの記録だけでは、階段の移動は分かりません。","建物の複数の通行経路を確認する。","人影の目撃と人物の同定は別。","通常の施錠規定と工事日の運用を比較する。",[["エレベーター","停止した階は分かっても、階段利用は記録しない。"],["非常階段","昇降機を使わない経路。"],["改築","図面の年代で通路が変わる。"],["停止記録","装置の動作記録であって、人の不在証明ではない。"]]],"M-06":["鍵の所持・書類の由来・供述を別々に照合します。","確実な生存確認時刻と鍵の受領時刻を拾う。","返却したという話と、実際の受領簿を比較する。","紙片と監査表の出所を追う。","最後の認定で供述と独立した物証がどう一致するかを見る。",[["B-4","作業用鍵の個別番号。"],["返却","鍵が戻った時刻。申告と実記録を比べる。"],["断端","破れた紙同士の端が一致するかを調べる。"],["照合表","監査用の数値を比較した資料。"]]],"M-07":["タイムカードの名義人が、押した本人とは限りません。","打刻の数字と人の目撃を分ける。","誰がカードに触れられたか調べる。","機器の仕様と会計記録を照合する。","供述以外の裏付けを確認する。",[["打刻","カードへ時刻を押す行為。本人認証とは別。"],["津村","カードの名義人。実際の操作者とは限らない。"],["高科","経理の担当者。供述と物証を区別する。"],["検算表","会計上の差異を点検する資料。"]]],"M-08":["未回収の物が、必ず誰かに持ち去られたとは限りません。","持参された物と発見時になかった物を整理する。","目撃・伝聞・報道の違いを確認する。","現物を保存できた品と、捜索対象を区別する。","何が足りず人物を一意に絞れないかを読む。",[["書類袋","入所時に確認され、事件後は未回収。"],["測深棒","在庫差だけでは凶器の持出しは分からない。"],["海水","現場の痕跡や物品の所在を変えうる。"],["未回収","見つからなかったことを指し、原因は不明。"]]],"M-09":["証拠品は、どの場所から採取した物かも重要です。","標本の管理番号を複数の台帳で照合する。","関係者の立入り可能性と加害行為を分ける。","採取後の封入方法を確認する。","原資料の欠落により証明できないことを整理する。",[["C-17","調査対象の標本番号。"],["緑紐","共用品のため、同色だけで人物は決まらない。"],["採取位置","物証を拾った場所と実物の対応。"],["採集票","標本の産地・日付を記す基礎資料。"]]]};
const TUTORIAL_IDS=new Set(Object.keys(GUIDE));
const BASE_SHELVES=SHELVES.map(s=>({...s,folderIds:s.folderIds.slice()}));
let mode='room',pending=null,selectionTimer=0;
const HIGHLIGHT_KEY='shoko.manualHighlights.v1';
let highlights={};
try{const o=JSON.parse(localStorage.getItem(HIGHLIGHT_KEY)||'{}');if(o&&typeof o==='object'&&!Array.isArray(o))highlights=o;}catch(e){}
const $=id=>document.getElementById(id);
const make=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!==undefined)n.textContent=txt;return n};
function save(){try{localStorage.setItem(HIGHLIGHT_KEY,JSON.stringify(highlights))}catch(e){console.warn('ライン保存失敗',e)}}
function inMode(folder){return mode==='guide'?TUTORIAL_IDS.has(folder):!TUTORIAL_IDS.has(folder)}
function lineTotal(){return Object.values(highlights).reduce((n,x)=>n+(Array.isArray(x)?x.length:0),0)}
function updateCounts(){
 $('shoko-line-count').textContent=String(lineTotal());
 const active=docs.filter(d=>inMode(d.folder));
 $('totalCount').textContent=active.length+' FILES';
 $('shelfCount').textContent=String(SHELVES.length);
 document.querySelector('.shelf-head h2').textContent=mode==='guide'?'演習資料':'資料棚';
 document.querySelector('.shelf-head p').textContent=mode==='guide'?'下線と解説を参考に捜査資料を読んでください。':'棚を選び、収蔵箱から資料を閲覧します。';
}
function setMode(next){
 mode=next;document.body.dataset.shokoMode=next;document.body.dataset.shokoStage=next;
 SHELVES.splice(0,SHELVES.length,...BASE_SHELVES.map(s=>({...s,folderIds:s.folderIds.filter(inMode)})).filter(s=>next==='room'||s.folderIds.length));
 state.shelf=SHELVES[0].id;state.folder=SHELVES[0].folderIds[0]||'';state.active='';state.view='archive';state.screen='shelf';pending=null;
 renderAll();updateCounts();
 if(innerWidth<=850)switchScreen('shelf');else $('workspace').dataset.screen='reader';
}
function markBody(body,text,ranges){
 let pos=0;body.replaceChildren();
 for(const x of ranges.filter(x=>Number.isInteger(x.from)&&Number.isInteger(x.to)&&x.from>=0&&x.to>x.from&&x.to<=text.length).sort((a,b)=>a.from-b.from)){
  if(x.from<pos)continue;
  if(x.from>pos)body.append(document.createTextNode(text.slice(pos,x.from)));
  const m=make('mark',x.kind==='guide'?'shoko-guide-mark':'shoko-line',text.slice(x.from,x.to));
  if(x.tip){m.title=x.tip;m.tabIndex=0;m.setAttribute('aria-label',m.textContent+'：'+x.tip)}
  body.append(m);pos=x.to;
 }
 body.append(document.createTextNode(text.slice(pos)));
}
function guideMarks(doc,text){
 const spec=GUIDE[doc.folder];if(!spec)return [];
 const arr=[],start=Math.max(0,text.indexOf('\n\n',65)+2);
 for(const [word,tip] of spec.at(-1)){
  let searchAt=start,c=0;
  while(c<2){
   const i=text.indexOf(word,searchAt);if(i<0)break;
   if(!arr.some(x=>i<x.to&&i+word.length>x.from)){arr.push({from:i,to:i+word.length,tip,kind:'guide'});c++}
   searchAt=i+word.length;
  }
 }
 return arr.slice(0,10);
}
function guidePanel(doc){
 const spec=GUIDE[doc.folder];if(!spec)return null;
 const div=make('aside','shoko-help'),bookIndex=+doc.id.split('-').at(-1)-1;
 div.append(make('h2','','資料の読み方'),make('p','focus',spec[0]),make('p','',spec[Math.min(bookIndex+1,spec.length-2)]));
 const glossary=make('div','glossary');glossary.append(make('p','','下線の用語'));
 for(const [word,tip] of spec.at(-1)){const row=make('p'),b=make('b','',word);row.append(b,document.createTextNode(tip));glossary.append(row)}
 div.append(glossary);return div;
}
function findSelection(body,doc,page){
 const sel=getSelection();if(!sel||sel.isCollapsed||!sel.rangeCount)return null;
 const r=sel.getRangeAt(0);
 if(!body.contains(r.startContainer)||!body.contains(r.endContainer))return null;
 const q=document.createRange();q.selectNodeContents(body);q.setEnd(r.startContainer,r.startOffset);
 const a=q.toString().length,b=a+r.toString().length;
 return b>a?{id:doc.id,page,from:a,to:b}:null;
}
function adjust(text,a,b,kind){
 if(typeof Intl.Segmenter!=='function')return[a,b];
 const seg=[...new Intl.Segmenter('ja',{granularity:'word'}).segment(text)].filter(x=>x.segment.trim());
 const start=seg.find(x=>x.index<=a&&a<x.index+x.segment.length)||seg.find(x=>x.index>=a);
 if(!start)return[a,b];
 if(kind==='word')return[start.index,start.index+start.segment.length];
 const end=[...seg].reverse().find(x=>x.index<b&&x.index+x.segment.length>=b)||[...seg].reverse().find(x=>x.index<b);
 return[start.index,end?Math.max(b,end.index+end.segment.length):b];
}
function lineTools(doc,content,page,body){
 const box=make('div','shoko-line-tools'),intro=make('p','','本文をダブルクリック・長押し・ドラッグで選択。単語は一語に、文節は選んだ語句の両端を語の境目に自動調整します。');
 const buttons=make('div'),info=make('div','shoko-line-status','ラインは自動保存され、上部の「ライン一覧」から見返せます。');
 function capture(){const r=findSelection(body,doc,page);if(r){pending=r;info.textContent=content.slice(r.from,r.to).replace(/\s+/g,' ').slice(0,65)+' を選択中'}}
 function add(kind){
  capture();
  if(!pending||pending.id!==doc.id||pending.page!==page){info.textContent='先に本文の文字を選択してください。';return}
  let [from,to]=adjust(content,pending.from,pending.to,kind);
  if(from>=to||to-from>260){info.textContent='1〜260文字以内の範囲を選んでください。';return}
  const current=Array.isArray(highlights[doc.id])?highlights[doc.id]:[];
  const overlap=current.filter(x=>x.page===page&&x.from<to&&x.to>from);
  if(overlap.length){from=Math.min(from,...overlap.map(x=>x.from));to=Math.max(to,...overlap.map(x=>x.to))}
  highlights[doc.id]=current.filter(x=>!overlap.includes(x)).concat([{id:Date.now()+'-'+Math.random(),page,from,to,quote:content.slice(from,to)}]);
  pending=null;getSelection()?.removeAllRanges();save();renderReader();updateCounts();
 }
 for(const [label,kind] of [['単語にライン','word'],['選択した文節にライン','phrase']]){
  const btn=make('button','',label);btn.type='button';btn.addEventListener('pointerdown',capture);btn.addEventListener('click',()=>add(kind));buttons.append(btn)
 }
 body.addEventListener('mouseup',capture);body.addEventListener('touchend',()=>setTimeout(capture,30));
 // ページ移動後に古い本文への選択を使わない。
 box.append(intro,buttons,info);return box;
}
function showLines(){
 const container=$('readerContent');container.replaceChildren();
 const page=make('div','desk-page');
 page.append(make('div','eyebrow','HIGHLIGHTS'),make('h2','desk-title','ライン一覧'),make('p','desk-help','保存した部分から元の資料を開き、確認・削除できます。'));
 const entries=Object.entries(highlights).flatMap(([id,items])=>{
  const doc=byId(id);
  return doc&&inMode(doc.folder)&&Array.isArray(items)?items.map(item=>({...item,doc})):[];
 }).sort((a,b)=>a.doc.id.localeCompare(b.doc.id)||a.page-b.page||a.from-b.from);
 if(!entries.length)page.append(make('p','desk-empty','まだラインはありません。資料室で本文の語句を選んでください。'));
 for(const item of entries){
  const card=make('section','shoko-line-card'),meta=make('div','meta',item.doc.id+' / '+item.doc.title+(item.doc.pages?' / '+(item.page+1)+'頁':'')),quote=make('div','quote',item.quote);
  const go=make('button','','元の資料を開く'),remove=make('button','','ラインを削除');
  go.addEventListener('click',()=>{
   state.shelf=(SHELVES.find(s=>s.folderIds.includes(item.doc.folder))||SHELVES[0]).id;
   state.folder=item.doc.folder;state.active=item.doc.id;state.view='archive';openBookId=item.doc.id;openBookPage=item.page;
   store();renderAll();switchScreen('reader');
   const marks=$('readerContent').querySelectorAll('mark.shoko-line');
   const t=[...marks].find(m=>m.textContent===item.quote)||marks[0];if(t)t.scrollIntoView({block:'center'});
  });
  remove.addEventListener('click',()=>{
   highlights[item.doc.id]=(highlights[item.doc.id]||[]).filter(x=>x.id!==item.id);
   if(!highlights[item.doc.id].length)delete highlights[item.doc.id];
   save();showLines();updateCounts();
  });
  card.append(meta,quote,go,remove);page.append(card);
 }
 container.append(page);
}
const prevReader=renderReader;
renderReader=function(){
 pending=null;
 if(state.view==='lines'){showLines();return}
 prevReader();
 const doc=byId(state.active);
 if(!doc||!inMode(doc.folder)||state.view==='desk')return;
 const container=$('readerContent'),body=container.querySelector('.paper-body'),paper=container.querySelector('.paper'),frame=container.querySelector('.reader-frame');
 if(!body||!paper||!frame)return;
 const page=doc.pages?openBookPage:0,content=doc.pages?doc.pages[page]:doc.body;
 if(mode==='guide'){
  const panel=guidePanel(doc);if(panel)frame.insertBefore(panel,paper);
  markBody(body,content,guideMarks(doc,content));
 }else{
  markBody(body,content,(Array.isArray(highlights[doc.id])?highlights[doc.id]:[]).filter(x=>x.page===page).map(x=>({...x,kind:'user'})));
  const tools=lineTools(doc,content,page,body);
  const footer=paper.querySelector('.paper-footer');
  if(footer)paper.insertBefore(tools,footer);else paper.append(tools);
 }
};
const prevShelf=renderShelf;
renderShelf=function(){prevShelf();updateCounts()};
const prevDesk=renderDesk;
renderDesk=function(){
 const original=state.desk;
 state.desk=new Set([...original].filter(id=>{const d=byId(id);return d&&inMode(d.folder)}));
 try{prevDesk()}finally{state.desk=original}
};
const head=document.querySelector('.header');
document.querySelector('.brand strong').textContent='書庫';
document.querySelector('.brand small').textContent='PRIVATE ARCHIVE';
const back=make('button','shoko-back','タイトルへ');back.type='button';back.addEventListener('click',()=>{document.body.dataset.shokoStage='home';pending=null});
document.querySelector('.header-end').append(back);
const linesBtn=make('button','','ライン一覧 ');linesBtn.type='button';linesBtn.id='shoko-view-lines';
const lineCount=make('span','','0');lineCount.id='shoko-line-count';linesBtn.append(lineCount);
linesBtn.addEventListener('click',()=>{if(mode==='guide')return;state.view='lines';renderReader();$('showArchive').classList.remove('active');$('showDesk').classList.remove('active');linesBtn.classList.add('active');switchScreen('reader')});
document.querySelector('.menu-top').append(linesBtn);
const intro=make('div');intro.id='shoko-guide-intro';
intro.append(make('strong','','資料の見方'),make('span','','現在の殺人事件9件は演習用資料です。下線の用語と解説を参照して読み進めてください。元の資料本文は維持しています。'));
head.insertAdjacentElement('afterend',intro);
const title=make('div');title.id='shoko-start';title.setAttribute('aria-label','書庫 タイトル画面');
title.innerHTML='<div class="shoko-start-inner"><div class="shoko-eyebrow">忘れられた記録の、その奥へ</div><h1 class="shoko-title">書庫</h1><p class="shoko-sub">ここには、すべてが保管されている。</p><div class="shoko-choices"><button type="button" id="shoko-guide"><span class="shoko-num">01</span>資料の見方</button><button type="button" id="shoko-room"><span class="shoko-num">02</span>資料室に入る</button></div></div>';
document.body.prepend(title);
const st=make('style');st.textContent="\nbody[data-shoko-stage=\"home\"] .shell{visibility:hidden}\n#shoko-start{position:fixed;inset:0;z-index:100;display:grid;place-items:center;padding:30px 20px;background:radial-gradient(ellipse at center,#374136,#202922 63%,#0d1610);color:#ece2cd;text-align:center;font-family:\"Yu Mincho\",\"Hiragino Mincho ProN\",serif}\nbody:not([data-shoko-stage=\"home\"]) #shoko-start{display:none}\n#shoko-start:before{content:\"\";position:absolute;inset:4%;border:1px solid #b3a07955;pointer-events:none}\n.shoko-start-inner{position:relative;width:min(100%,620px)}\n.shoko-eyebrow{font:11px sans-serif;letter-spacing:.25em;color:#c4b38e}\n.shoko-title{font-size:clamp(78px,17vw,145px);font-weight:400;letter-spacing:.2em;padding-left:.2em;margin:32px 0 12px}\n.shoko-sub{font-size:14px;letter-spacing:.13em}\n.shoko-choices{display:grid;gap:13px;width:min(100%,380px);margin:78px auto 0}\n.shoko-choices button{display:flex;align-items:center;gap:22px;text-align:left;padding:18px 22px;background:#28332b;border:1px solid #9e8b67;color:#efe3d0;font:18px \"Yu Mincho\",serif}\n.shoko-choices button:hover,.shoko-choices button:focus-visible{background:#494b36;border-color:#e1c990}\n.shoko-num{font:13px Georgia,serif;color:#c9b38b}\n.shoko-back{background:transparent;color:#e8dbbd;border:1px solid #8c8061;padding:8px 10px;font-size:11px;white-space:nowrap}\nbody[data-shoko-mode=\"guide\"] .shell{grid-template-rows:72px auto minmax(0,1fr)}\n#shoko-guide-intro{display:none;align-items:center;gap:16px;padding:12px 25px;background:#302f28;border-bottom:1px solid #71664d;color:#e4d6bb;font-size:12px;line-height:1.65}\n#shoko-guide-intro strong{font:normal 21px \"Yu Mincho\",serif;white-space:nowrap}\nbody[data-shoko-mode=\"guide\"] #shoko-guide-intro{display:flex}\nbody[data-shoko-mode=\"guide\"] #showDesk,body[data-shoko-mode=\"guide\"] #shoko-view-lines,body[data-shoko-mode=\"guide\"] .mobile-nav button[data-target=\"desk\"]{display:none}\n.shoko-help{margin:0 0 20px;padding:17px 21px;background:#e6decc;border-left:5px solid #aa8b61;color:#353125}\n.shoko-help h2{font:normal 19px \"Yu Mincho\",serif;margin:0 0 9px}\n.shoko-help p{font:12px/1.8 sans-serif;margin:6px 0}\n.shoko-help .focus{font-weight:600;font-size:13px}\n.shoko-help .glossary{border-top:1px solid #bbae91;margin-top:12px;padding-top:10px}\n.shoko-help .glossary b{margin-right:8px;text-decoration:underline;text-decoration-thickness:2px;text-decoration-color:#ab623e;text-underline-offset:3px}\nmark.shoko-guide-mark{background:transparent;color:inherit;text-decoration:underline;text-decoration-color:#ad5b36;text-decoration-thickness:3px;text-underline-offset:4px;cursor:help}\nmark.shoko-line{background:linear-gradient(transparent 57%,#d0a85b9c 57%);color:inherit}\n.shoko-line-tools{background:#e7ddca;padding:13px 17px;margin:17px 0 0;border:1px solid #b3a281;color:#443c2e}\n.shoko-line-tools p{font:12px/1.6 sans-serif;margin:0 0 9px}\n.shoko-line-tools button{background:#414338;border:0;color:#f5ebd9;padding:9px 13px;margin:0 8px 0 0;font-size:12px}\n.shoko-line-status{font:11px/1.6 sans-serif;min-height:20px;margin-top:9px}\n.shoko-line-card{margin:14px 0;background:#e6decb;color:#343126;padding:16px 20px;border-left:5px solid #c5a65e}\n.shoko-line-card .meta{font-size:11px;color:#6a5e43}\n.shoko-line-card .quote{white-space:pre-wrap;font:15px/1.85 \"Yu Mincho\",serif;margin:12px 0}\n.shoko-line-card button{background:#45493a;border:0;color:#f2e7d3;padding:9px 13px;margin:4px 8px 0 0}\n@media(max-width:850px){body[data-shoko-mode=\"guide\"] .shell{grid-template-rows:72px auto minmax(0,1fr) 49px}#shoko-guide-intro{padding:7px 12px;font-size:11px}}\n@media(max-width:650px){.header{gap:7px;padding:0 47px 0 9px}.header .mark{display:none}.header .brand{min-width:unset}.header .brand strong{font-size:17px}.header .brand small{display:none}.header-end{gap:5px}.menu-top button{padding:8px 5px;font-size:10px}.shoko-back{font-size:10px;padding:8px 5px}.shoko-title{font-size:76px}.shoko-help{padding:14px}}\n";document.head.append(st);
$('shoko-guide').addEventListener('click',()=>setMode('guide'));
$('shoko-room').addEventListener('click',()=>setMode('room'));
$('showArchive').addEventListener('click',()=>linesBtn.classList.remove('active'));
$('showDesk').addEventListener('click',()=>linesBtn.classList.remove('active'));
document.body.dataset.shokoStage='home';document.body.dataset.shokoMode='room';
setMode('room');document.body.dataset.shokoStage='home';
})();