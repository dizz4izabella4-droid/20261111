(function(){
'use strict';
const GUIDE={"M-01":["内線番号の表示と実際の発信室は別の記録です。","報告の番号がどこから得られたかを確認する。","番号を見た人と、伝聞で番号を知った人を分ける。","設備の工事前後で番号の対応が変わっていないか調べる。",[["201","表示番号。実際の発信室と同じとは限らない。"],["205","交換機の配線変更が関係する別の客室。"],["配線","電話機と番号を結ぶ設備上の対応。"],["交換盤","内線の呼出し番号が表示される装置。"]]],"M-02":["声を聞いたことと、生きた本人を見たことは違います。","現場で確認できた時刻と見聞きした内容を整理する。","直接聞いた人と、後で聞いた人を分ける。","録音再生と音の経路を調べる。",[["録音","以前の声を保存した音源。"],["再生","保存された音声を流すこと。"],["進行表","予定と実施の記録を区別して読む。"],["客席系統","音声を出すスピーカーの系統。"]]],"M-03":["機械が印字した時刻には、時計のずれが含まれます。","取引があった事実と表示された時刻を分ける。","その時間に人物を直接見た証言があるか探す。","修理履歴で時刻設定を照合する。",[["レシート","会計機器の印字であり、時刻が正確とは限らない。"],["四十七分","点検で判明した時計の進み幅。"],["保守","機器の点検・修理の記録。"],["外灯","自動点灯なら店内に人がいる証明にはならない。"]]],"M-04":["撮影日・処理日・納品日は別々の時間です。","封筒に書かれた数字の意味を確かめる。","話者がどの工程を指しているか分ける。","ネガ袋と納品票の書式を照合する。",[["撮影日","実際に写真を撮った日。"],["現像","撮影後にフィルムを処理する工程。"],["封筒","処理や納品の情報が付くことがある。"],["納品","完成した写真を渡す工程。"]]],"M-05":["エレベーターの記録だけでは、階段の移動は分かりません。","建物の複数の通行経路を確認する。","人影の目撃と人物の同定は別。","通常の施錠規定と工事日の運用を比較する。",[["エレベーター","停止した階は分かっても、階段利用は記録しない。"],["非常階段","昇降機を使わない経路。"],["改築","図面の年代で通路が変わる。"],["停止記録","装置の動作記録であって、人の不在証明ではない。"]]],"M-06":["鍵の所持・書類の由来・供述を別々に照合します。","確実な生存確認時刻と鍵の受領時刻を拾う。","返却したという話と、実際の受領簿を比較する。","紙片と監査表の出所を追う。","最後の認定で供述と独立した物証がどう一致するかを見る。",[["B-4","作業用鍵の個別番号。"],["返却","鍵が戻った時刻。申告と実記録を比べる。"],["断端","破れた紙同士の端が一致するかを調べる。"],["照合表","監査用の数値を比較した資料。"]]],"M-07":["タイムカードの名義人が、押した本人とは限りません。","打刻の数字と人の目撃を分ける。","誰がカードに触れられたか調べる。","機器の仕様と会計記録を照合する。","供述以外の裏付けを確認する。",[["打刻","カードへ時刻を押す行為。本人認証とは別。"],["津村","カードの名義人。実際の操作者とは限らない。"],["高科","経理の担当者。供述と物証を区別する。"],["検算表","会計上の差異を点検する資料。"]]],"M-08":["未回収の物が、必ず誰かに持ち去られたとは限りません。","持参された物と発見時になかった物を整理する。","目撃・伝聞・報道の違いを確認する。","現物を保存できた品と、捜索対象を区別する。","何が足りず人物を一意に絞れないかを読む。",[["書類袋","入所時に確認され、事件後は未回収。"],["測深棒","在庫差だけでは凶器の持出しは分からない。"],["海水","現場の痕跡や物品の所在を変えうる。"],["未回収","見つからなかったことを指し、原因は不明。"]]],"M-09":["証拠品は、どの場所から採取した物かも重要です。","標本の管理番号を複数の台帳で照合する。","関係者の立入り可能性と加害行為を分ける。","採取後の封入方法を確認する。","原資料の欠落により証明できないことを整理する。",[["C-17","調査対象の標本番号。"],["緑紐","共用品のため、同色だけで人物は決まらない。"],["採取位置","物証を拾った場所と実物の対応。"],["採集票","標本の産地・日付を記す基礎資料。"]]]};
const DEDUCTIONS={"M-01":{"level":"可能な推論（犯人は未確定）","topic":"「空室の201号室から電話が来た」は、証拠から確定しているか。","e":[["M-01-001",2,"西館201より着信","帳場日誌には「西館201より着信」と記録されている。これは表示された番号の記録。"],["M-01-002",1,"発信した人を見ていない","帳場係は番号表示を見たが、電話を掛けた人物も室内も見ていない。"],["M-01-003",1,"205号室に対応","改装に伴う作業票に201・205の配線変更があり、表示201が205号室に対応した期間がある。"],["M-01-003",4,"番号の対応が正しい場合","実際の部屋と表示番号の一致は、事件当夜には確認できていない。"]],"steps":["【A＋B】確実なのは「交換盤に201と表示された」ことまで。表示された部屋から誰かが掛けた、とはまだいえない。","【C＋D】配線変更後の表示にはずれが生じうる。201という数字だけで、空室201を発信元と断定する前提が崩れる。","【帰結】『空室から着信した』という不可解さを、人物の行動や犯行を示す証拠として用いることはできない。"],"result":"201号室からの発信は立証されていない。205号室など別の場所からの着信だった可能性を残す。","limit":"事件当夜の配線状態、電話を掛けた人物、殺害者の身元は分からない。205号室からの発信と断定することもできない。"},"M-02":{"level":"可能な推論（死亡時刻は未確定）","topic":"午後8時31分に声が聞こえたことは、磯部の生存を示すか。","e":[["M-02-001",2,"八時三十一分","進行記録には午後8時31分に磯部の声が聞こえたとある。"],["M-02-002",1,"本人の姿は見ていない","証人の稲葉は声を聞いただけで、磯部の姿を見ていない。"],["M-02-003",1,"録音されている","磯部本人の声を録音したテープが存在する。"],["M-02-003",2,"客席用","音響卓は録音を再生したまま音の出口を切り替えられる。"]],"steps":["【A＋B】8時31分に「声」が聞こえたという観察はあるが、その時間に磯部を直接見た証言はない。","【C＋D】録音済みの声を、客席系統で再生する物理的な方法が存在する。","【帰結】8時31分に声が聞こえた事実だけでは、8時31分時点の生存は証明されない。"],"result":"『声を聞いた時刻＝生存していた時刻』という扱いを取り消す必要がある。","limit":"声が実際に録音だったと確定したわけではない。死亡時刻も犯人も、この四資料だけでは決まらない。"},"M-03":{"level":"時刻の信頼性に疑問（犯人は未確定）","topic":"21時58分のレシートから、店主がその時刻まで生きていたといえるか。","e":[["M-03-001",2,"二十一時五十八分","レシートには21時58分と印字されている。"],["M-03-002",1,"午後八時四十分","店主を直接見たアルバイトの確実な証言は午後8時40分頃。"],["M-03-003",1,"四十七分進めた","修理時にレジの内蔵時計を47分進め、補正した記録がない。翌日の点検でも進みが確認された。"],["M-03-003",3,"誰が商品を渡し","売上記録はあるが、誰が取引したかは分からない。"]],"steps":["【A＋C】印字時刻はレジ内部の時計による。時刻の設定がずれていた可能性が高いため、21時58分という表示を実時間として採用できない。","【B＋D】直接の生存目撃は別時刻であり、レシート自体には販売員の身元が記されていない。","【帰結】レシートの印字だけで「店主は21時58分まで生存していた」とする論証は成立しない。"],"result":"取引記録と店主の生存時刻を切り離して考える必要がある。","limit":"時計のずれが事件当夜も正確に47分だったとは確認できない。21時11分という補正時刻を新たな確定時刻にしてはならない。"},"M-04":{"level":"日時の意味を訂正（犯人は未確定）","topic":"『五月十六日 二一・四五』は、その場で撮影した時刻なのか。","e":[["M-04-001",2,"二一・四五","現場の封筒に五月16日21:45のような数字が残る。"],["M-04-002",4,"五月十五日の町内行事","依頼者は写真の元の撮影が五月15日の行事だったと説明する。"],["M-04-003",1,"仕上げ後確認","封筒の数字には「仕上げ後確認」と併記され、封筒の記入方式は処理・納品に関わる。"],["M-04-003",2,"十五日の町内行事","ネガ袋の記録も五月15日の行事を示している。"]],"steps":["【A】封筒の数字はあるが、単独では「何の作業をした時刻か」を示さない。","【B＋D】依頼者の説明とネガ記録が、元の写真の撮影日を五月15日と示している。","【C】封筒の21:45は、撮影でなく別工程の仕上げ確認に関する数字と読む余地がある。","【帰結】五月16日21:45の記載を『助手がその時刻に写真を撮影し、生きていた証拠』として扱うことはできない。"],"result":"撮影・現像・仕上げ確認の時間は別物。封筒だけを最後の生存目撃に置き換えられない。","limit":"仕上げた人が誰か、記入が事件当夜に行われたかは未確定。写真館の殺害者も分からない。"},"M-05":{"level":"経路の存在を確認（人物の行動は未確定）","topic":"エレベーターの停止記録がないことは、10階へ行けなかった証明になるか。","e":[["M-05-001",2,"十階停止の記録がない","特定時間帯にエレベーターが10階で止まった記録はない。"],["M-05-002",2,"管理員に似た人影","10階の居住者は人影を見たが、顔を見ず本人の特定はできない。"],["M-05-003",2,"扉の開放を許可","工事当夜には非常階段の扉を開放する作業命令があった。"],["M-05-003",4,"新図面では通行できる","改築後の図面では非常階段と通路が接続している。"]],"steps":["【A】エレベーターの停止記録がないことは、エレベーターを使ったとする説明への反証候補になる。","【C＋D】当夜は別の経路が通行可能だった。昇降機の記録に関係なく10階へ到達できる。","【A＋B＋C＋Dの帰結】人影の目撃を『エレベーターの記録と矛盾するから虚偽』とはいえない。"],"result":"『10階に行った人間はいない』という否定は資料から導けない。階段経由の移動は可能だった。","limit":"実際に階段を通った人は誰か、人影が被害者だったか、犯人かどうかは証明されていない。"},"M-06":{"level":"資料上の有罪認定（複数の証拠による裏付け）","topic":"鍵の記録から始まり、なぜ瀬戸直人が犯人と認定されたのか。","e":[["M-06-001",2,"八時三十三分","20:33に被害者本人の通話があり、生存確認時刻の手掛かりになる。"],["M-06-002",1,"九時七分に鍵を受け取った","瀬戸は20:18に鍵を返したと述べたが、警備員の受領記録は21:07。説明と記録が合わない。"],["M-06-003",2,"紙の繊維の凹凸","現場の紙片と瀬戸の訂正票の破断端が、個別の形状まで一致した。"],["M-06-003",4,"保守会社の予備資料箱","行方不明の監査照合表が、瀬戸の担当する資料箱から見つかった。"],["M-06-004",2,"公表されていなかった","供述のうち紙が裂けた位置など未公表の現場情報が物証と合致した。"],["M-06-004",5,"有罪の認定","整理された裁判記録では瀬戸に有罪の認定が記されている。"]],"steps":["【A＋B】犯行可能な時間帯に鍵を所持していた疑いがあり、退館時刻の説明が揺らぐ。ただし、鍵を持っていたこと自体で殺害は証明できない。","【C＋D】現場由来の個別の紙片と、隠された監査表の所在から、事件現場と保守会社の資料の間に具体的なつながりが生じる。","【E】未公表の位置関係に関する供述が既に保存された物証と一致し、一般的な噂を繰り返しただけという説明が難しくなる。","【Fの帰結】捜査記録では複数の裏付けを総合し、瀬戸直人の有罪認定を記載している。"],"result":"この事件資料上の結末は『瀬戸直人を犯人として有罪認定』。鍵・紙片・監査表・非公表情報が相互に補強する筋道を追える。","limit":"有罪は『A～Eを数学的に結合しただけで論理必然的に出る』わけではない。証拠の信用性の評価と供述の整合性を踏まえた資料上の認定である。"},"M-07":{"level":"資料上の有罪認定（名義と本人の区別）","topic":"『津村が戻った』という解釈が崩れた後、何が高科恭子へつながったのか。","e":[["M-07-001",2,"九時四分","21:04に津村名義で再入構打刻があるが、目撃者は本人の姿を確認していない。"],["M-07-003",1,"本人の存在を認証する機構はない","機械はカードを受け付けるだけで、押した本人を識別しない。"],["M-07-003",3,"八十箱のみ","納品記録は80箱、会計の支払票は120箱で、実物と帳簿に差がある。"],["M-07-004",2,"銀色の閉じ具","高科は非公表だった袋の特徴と保管場所を説明し、実物が回収された。"],["M-07-004",5,"有罪の認定","裁判記録に、高科の供述と回収物の一致を根拠とした有罪認定が記される。"]],"steps":["【A＋B】『津村名義の打刻』は『津村自身の再入構』を証明しない。最初の嫌疑を支えた前提が崩れる。","【C】架空請求の疑いが具体的な数字で示される。これは高科に関する動機や事情を考える材料だが、それだけで殺人行為は証明しない。","【D】高科の説明した非公表の袋の特徴と回収先が実物と一致し、事件で失われた資料の移動に本人が具体的に関わったことを裏付ける。","【Eの帰結】偽の入構記録、会計の不一致、回収された現物と供述を総合して、事件資料には高科の有罪認定が記される。"],"result":"この事件資料上の結末は『高科恭子を犯人として有罪認定』。津村を示すように見えたカードは本人確認の資料ではなかった。","limit":"津村の薬局での行動が完全に証明されたわけではない。偽の打刻と金銭上の疑いだけでは足りず、回収物と非公表情報の裏付けが重要である。"},"M-08":{"level":"未解決（複数の仮説を区別できない）","topic":"青い書類袋や測深棒が見つからないのに、なぜ犯人を確定できないのか。","e":[["M-08-001",2,"青い防水布","被害者が入所時に青い書類袋を持っていたことは別々の証言で確認される。"],["M-08-002",4,"袋の色や人物の性別は見えず","海側の人影の目撃は、袋の色も人物も特定していない。"],["M-08-003",1,"見つからない理由が流失なのか","現場は浸水しており、袋が流失・移動・持去りのどれで消えたか特定できない。"],["M-08-003",2,"最後に六本を現物確認したのは六月","測深棒の1本不足は確認されたが、事件直前に6本あったことを示せない。"],["M-08-004",5,"人物を特定する証拠が足りない","整理記録は犯人を決めるだけの物証がないと結論づけている。"]],"steps":["【A＋C】『入所時には袋があった／発見後にはなかった』までは示せる。しかし、途中でどう移動したかの資料はない。","【B】人影は袋の持出しの直接目撃にならず、特定人物の行動にも結びつかない。","【D】測深棒の不足も、事件当日に凶器として持ち去ったことを示すわけではない。","【帰結】流失・別所への移動・持去りの複数の筋が残る。犯人を一人へ絞る推論は資料上成立しない。"],"result":"証拠不足のため未解決。決め手となる物の『未回収』は分かるが、『誰が何を持ち去ったか』は分からない。","limit":"事件資料内には確定犯人を置いていない。『もっとも怪しく見える人物』は、証明された殺害者と同じではない。"},"M-09":{"level":"未解決（証拠品の同定が失われた）","topic":"紐の実物が残っているのに、なぜ移動経路や犯人を特定できないのか。","e":[["M-09-001",2,"北沢谷","標本C-17の採集地について、台帳の『北沢谷』と別控えの『南岬丘』が食い違う。"],["M-09-003",1,"一つの紙封筒へまとめられ","机付近と通路の細片が、採取位置を識別しないまま一緒に封入された。"],["M-09-003",3,"正式な採集票原本","標本の由来を確かめる原本が未回収。"],["M-09-004",5,"犯人を特定できる独立の証拠は不足","捜査の再評価では、人物を特定できる証拠は不足すると記録された。"]],"steps":["【A＋C】採集地の記録が食い違うが、どちらが正しいかを確認する原本がない。『誰かが産地を偽った』と決める根拠が不足する。","【B】紐片そのものは残っていても『どちらが机、どちらが通路』という対応を取り戻せない。移動経路の推定に必要な位置情報を失っている。","【A＋B＋Cの帰結】標本を巡る動機も、繊維から特定人物へつなぐ経路も立証できず、捜査記録には未解決と残る。"],"result":"『物証を採った』だけでは十分でない。物証の出所と記録が揃わないため、犯人の特定に進めない。","limit":"採集地の正誤も、標本が消えた時期も、紐片を落とした人物も未確認。関係者の有罪や無罪を確定する材料にはならない。"}};
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

function splitSourceAndCommentary(text){
 const mark="【付記・資料の読み方】",a=text.indexOf(mark);
 if(a<0)return {source:text,legacy:""};
 const b=text.indexOf("〔記録区分：",a+mark.length);
 const commentary=text.slice(a+mark.length,b<0?text.length:b).trim();
 const documentText=text.slice(0,a).trimEnd()+(b>=0?"\n\n"+text.slice(b):"");
 return {source:documentText,legacy:commentary};
}
function guidePanel(doc,legacy){
 const spec=GUIDE[doc.folder],proof=DEDUCTIONS[doc.folder];
 if(!spec||!proof)return null;
 const wrap=make('aside','shoko-lesson');
 wrap.setAttribute('aria-label','学習用解説。原資料ではありません');
 wrap.append(make('div','shoko-lesson-label','学習用解説 / TUTORIAL — 原資料ではありません'));
 wrap.append(make('h2','','この事件の論理を読み解く'));
 wrap.append(make('p','shoko-lesson-intro','この枠は学習用の解説です。上の薄い紙面が元の捜査資料です。根拠の番号を押すと、その資料の該当ページへ移動できます。'));
 wrap.append(make('div','shoko-focus','注目する問い：'+proof.topic));
 const bookNo=Math.max(0,parseInt(doc.id.split('-').at(-1),10)-1);
 wrap.append(make('p','shoko-lesson-intro','この冊子の読み方：'+spec[Math.min(bookNo+1,spec.length-2)]));
 wrap.append(make('h3','','① 何と何を照合するか — 根拠資料'));
 const facts=make('div','shoko-proof-list');
 proof.e.forEach(([ref,page,anchor,explanation],index)=>{
  const item=make('div','shoko-proof');
  item.append(make('div','shoko-proof-letter','ABCDEF'[index]));
  const content=make('div');
  content.append(make('p','',explanation));
  const button=make('button','',ref+' ／ '+page+'ページを見る');
  button.type='button';button.title='根拠の原資料を開く（'+anchor+'）';
  button.addEventListener('click',()=>{
   const target=byId(ref);
   if(!target||!inMode(target.folder))return;
   state.shelf=(SHELVES.find(s=>s.folderIds.includes(target.folder))||SHELVES[0]).id;
   state.folder=target.folder;state.active=target.id;state.view='archive';
   openBookId=target.id;openBookPage=page-1;state.read.add(target.id);store();
   renderAll();switchScreen('reader');
   $('readerPane').scrollTop=0;
  });
  content.append(button);item.append(content);facts.append(item);
 });
 wrap.append(facts);
 wrap.append(make('h3','','② 根拠の組み合わせ → 論理の帰結'));
 const chain=make('ol','shoko-chain');
 for(const step of proof.steps)chain.append(make('li','',step));
 wrap.append(chain);
 const result=make('div','shoko-result');
 result.append(make('span','shoko-result-tag',proof.level),make('strong','',proof.result));
 result.append(make('p','','ここから先は断定できない：'+proof.limit));
 wrap.append(result);
 if(legacy){
  const more=make('details','shoko-old-comment');
  more.append(make('summary','','以前の資料内に混在していた「読み方の付記」を見る'));
  more.append(make('p','',legacy));
  wrap.append(more);
 }
 const glossary=make('div','shoko-glossary');
 glossary.append(make('h3','','③ 用語の確認（原資料の茶色の下線）'));
 for(const [term,meaning] of spec.at(-1)){
  const row=make('p'),bold=make('b','',term);
  row.append(bold,document.createTextNode(meaning));glossary.append(row);
 }
 wrap.append(glossary);
 return wrap;
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
  const parts=splitSourceAndCommentary(content);
  const divider=make('div','shoko-source-divider');divider.append(make('strong','','原資料 / SOURCE RECORD'),make('span','','まず、この原資料を読んでください。茶色の下線は注目する用語です。'));
  frame.insertBefore(divider,paper);
  markBody(body,parts.source,guideMarks(doc,parts.source));
  const panel=guidePanel(doc,parts.legacy);if(panel)frame.insertBefore(panel,paper.nextSibling);
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
intro.append(make('strong','','資料の見方'),make('span','','濃い青緑の枠＝学習用解説／淡い紙面＝原資料。事件ごとに証拠を照合し、そこから導ける結論と、断定できないことまで説明します。'));
head.insertAdjacentElement('afterend',intro);
const title=make('div');title.id='shoko-start';title.setAttribute('aria-label','書庫 タイトル画面');
title.innerHTML='<div class="shoko-start-inner"><div class="shoko-eyebrow">忘れられた記録の、その奥へ</div><h1 class="shoko-title">書庫</h1><p class="shoko-sub">ここには、すべてが保管されている。</p><div class="shoko-choices"><button type="button" id="shoko-guide"><span class="shoko-num">01</span>資料の見方</button><button type="button" id="shoko-room"><span class="shoko-num">02</span>資料室に入る</button></div></div>';
document.body.prepend(title);
const logicalStyle=make('style');logicalStyle.textContent="\n/* 学習用解説と原資料を視覚的に完全分離 */\nbody[data-shoko-mode=\"guide\"] .reader-frame{width:min(100% - 58px,850px)}\n.shoko-lesson{background:#142a34;color:#e8f0ef;border:2px solid #547e8a;border-left:7px solid #7cb8c2;box-shadow:0 14px 30px #040f1370;padding:26px 28px 25px;margin:0 0 23px;line-height:1.8}\n.shoko-lesson-label{font:700 11px/1.6 sans-serif;letter-spacing:.13em;background:#b9e5e8;color:#14313b;display:inline-block;padding:5px 11px;margin-bottom:11px}\n.shoko-lesson h2{font:normal 24px/1.45 \"Yu Mincho\",serif;color:#fff5dc;margin:0 0 8px}\n.shoko-lesson h3{font:700 13px/1.4 sans-serif;letter-spacing:.08em;color:#a7e0e1;margin:22px 0 11px}\n.shoko-lesson .shoko-lesson-intro{font:13px/1.85 sans-serif;color:#d7e3e3;margin:0 0 14px}\n.shoko-lesson .shoko-focus{background:#244450;border:1px solid #5a8390;padding:12px 15px;font-size:14px;color:#f4efdf;margin:13px 0}\n.shoko-proof-list{display:grid;gap:9px}\n.shoko-proof{display:grid;grid-template-columns:34px minmax(0,1fr);gap:12px;background:#223e4a;padding:13px;border:1px solid #456674}\n.shoko-proof-letter{display:grid;place-items:center;width:31px;height:31px;font:700 15px Georgia,serif;background:#e4c689;color:#2d332f}\n.shoko-proof p{margin:0 0 6px;color:#edf3ee;font:13px/1.7 sans-serif}\n.shoko-proof button{background:none;border:0;border-bottom:1px solid #9edbe1;padding:0 0 2px;color:#aeeaf0;cursor:pointer;font:12px/1.5 sans-serif;text-align:left}\n.shoko-proof button:hover{color:#fff;text-decoration:underline}\n.shoko-chain{counter-reset:step;margin:0;padding:0 0 0 5px;list-style:none}\n.shoko-chain li{position:relative;padding:0 0 13px 22px;font:13px/1.85 sans-serif;color:#e5f0ef;border-left:2px solid #7ca2aa;margin-left:8px}\n.shoko-chain li:before{content:\"\";position:absolute;left:-5px;top:6px;width:8px;height:8px;background:#f2d492;border-radius:50%}\n.shoko-chain li:last-child{border-left-color:transparent;padding-bottom:0}\n.shoko-result{border-top:1px solid #547c81;margin:19px 0 0;padding:16px 0 0}\n.shoko-result-tag{display:inline-block;font:700 11px/1.5 sans-serif;background:#e7ca87;color:#302b21;padding:5px 9px;margin:0 0 8px}\n.shoko-result strong{display:block;color:#fff7df;font:normal 17px/1.75 \"Yu Mincho\",serif;margin:0 0 8px}\n.shoko-result p{margin:0;font:12px/1.75 sans-serif;color:#bad4d5}\n.shoko-old-comment{margin:17px 0 0;border:1px dashed #91a4a6;background:#20363e;padding:12px 15px}\n.shoko-old-comment summary{cursor:pointer;color:#b7dce0;font:12px/1.65 sans-serif}\n.shoko-old-comment p{font:12px/1.8 sans-serif;color:#e3ebea;margin:8px 0 0}\n.shoko-glossary{border-top:1px solid #45646e;padding-top:12px;margin-top:17px}\n.shoko-glossary h3{margin:0 0 7px}\n.shoko-glossary p{margin:5px 0;color:#dbe8e7;font:12px/1.7 sans-serif}\n.shoko-glossary b{text-decoration:underline;text-decoration-color:#edbb7a;text-decoration-thickness:2px;text-underline-offset:3px;margin-right:7px}\n.shoko-source-divider{display:flex;justify-content:space-between;align-items:center;gap:15px;background:#d6bc86;color:#312b1f;border-left:6px solid #8d6536;padding:12px 15px;margin:8px 0 15px}\n.shoko-source-divider strong{font:700 15px/1.35 \"Yu Mincho\",serif;white-space:nowrap}\n.shoko-source-divider span{font:11px/1.6 sans-serif}\nbody[data-shoko-mode=\"guide\"] .paper{background:#f0eadc;border:1px solid #e9d8b6;box-shadow:6px 8px 26px #0006}\nbody[data-shoko-mode=\"guide\"] .paper .paper-kicker:before{content:\"原資料 / \";color:#8c5c37}\nbody[data-shoko-mode=\"guide\"] .paper mark.shoko-guide-mark{text-decoration-color:#b97045}\n@media(max-width:650px){body[data-shoko-mode=\"guide\"] .reader-frame{width:calc(100% - 24px)}.shoko-lesson{padding:17px 14px}.shoko-source-divider{flex-direction:column;align-items:flex-start;gap:4px;padding:10px 11px}.shoko-proof{grid-template-columns:27px minmax(0,1fr);gap:9px;padding:10px}.shoko-proof-letter{width:26px;height:26px}}\n";document.head.append(logicalStyle);
const st=make('style');st.textContent="\nbody[data-shoko-stage=\"home\"] .shell{visibility:hidden}\n#shoko-start{position:fixed;inset:0;z-index:100;display:grid;place-items:center;padding:30px 20px;background:radial-gradient(ellipse at center,#374136,#202922 63%,#0d1610);color:#ece2cd;text-align:center;font-family:\"Yu Mincho\",\"Hiragino Mincho ProN\",serif}\nbody:not([data-shoko-stage=\"home\"]) #shoko-start{display:none}\n#shoko-start:before{content:\"\";position:absolute;inset:4%;border:1px solid #b3a07955;pointer-events:none}\n.shoko-start-inner{position:relative;width:min(100%,620px)}\n.shoko-eyebrow{font:11px sans-serif;letter-spacing:.25em;color:#c4b38e}\n.shoko-title{font-size:clamp(78px,17vw,145px);font-weight:400;letter-spacing:.2em;padding-left:.2em;margin:32px 0 12px}\n.shoko-sub{font-size:14px;letter-spacing:.13em}\n.shoko-choices{display:grid;gap:13px;width:min(100%,380px);margin:78px auto 0}\n.shoko-choices button{display:flex;align-items:center;gap:22px;text-align:left;padding:18px 22px;background:#28332b;border:1px solid #9e8b67;color:#efe3d0;font:18px \"Yu Mincho\",serif}\n.shoko-choices button:hover,.shoko-choices button:focus-visible{background:#494b36;border-color:#e1c990}\n.shoko-num{font:13px Georgia,serif;color:#c9b38b}\n.shoko-back{background:transparent;color:#e8dbbd;border:1px solid #8c8061;padding:8px 10px;font-size:11px;white-space:nowrap}\nbody[data-shoko-mode=\"guide\"] .shell{grid-template-rows:72px auto minmax(0,1fr)}\n#shoko-guide-intro{display:none;align-items:center;gap:16px;padding:12px 25px;background:#302f28;border-bottom:1px solid #71664d;color:#e4d6bb;font-size:12px;line-height:1.65}\n#shoko-guide-intro strong{font:normal 21px \"Yu Mincho\",serif;white-space:nowrap}\nbody[data-shoko-mode=\"guide\"] #shoko-guide-intro{display:flex}\nbody[data-shoko-mode=\"guide\"] #showDesk,body[data-shoko-mode=\"guide\"] #shoko-view-lines,body[data-shoko-mode=\"guide\"] .mobile-nav button[data-target=\"desk\"]{display:none}\n.shoko-help{margin:0 0 20px;padding:17px 21px;background:#e6decc;border-left:5px solid #aa8b61;color:#353125}\n.shoko-help h2{font:normal 19px \"Yu Mincho\",serif;margin:0 0 9px}\n.shoko-help p{font:12px/1.8 sans-serif;margin:6px 0}\n.shoko-help .focus{font-weight:600;font-size:13px}\n.shoko-help .glossary{border-top:1px solid #bbae91;margin-top:12px;padding-top:10px}\n.shoko-help .glossary b{margin-right:8px;text-decoration:underline;text-decoration-thickness:2px;text-decoration-color:#ab623e;text-underline-offset:3px}\nmark.shoko-guide-mark{background:transparent;color:inherit;text-decoration:underline;text-decoration-color:#ad5b36;text-decoration-thickness:3px;text-underline-offset:4px;cursor:help}\nmark.shoko-line{background:linear-gradient(transparent 57%,#d0a85b9c 57%);color:inherit}\n.shoko-line-tools{background:#e7ddca;padding:13px 17px;margin:17px 0 0;border:1px solid #b3a281;color:#443c2e}\n.shoko-line-tools p{font:12px/1.6 sans-serif;margin:0 0 9px}\n.shoko-line-tools button{background:#414338;border:0;color:#f5ebd9;padding:9px 13px;margin:0 8px 0 0;font-size:12px}\n.shoko-line-status{font:11px/1.6 sans-serif;min-height:20px;margin-top:9px}\n.shoko-line-card{margin:14px 0;background:#e6decb;color:#343126;padding:16px 20px;border-left:5px solid #c5a65e}\n.shoko-line-card .meta{font-size:11px;color:#6a5e43}\n.shoko-line-card .quote{white-space:pre-wrap;font:15px/1.85 \"Yu Mincho\",serif;margin:12px 0}\n.shoko-line-card button{background:#45493a;border:0;color:#f2e7d3;padding:9px 13px;margin:4px 8px 0 0}\n@media(max-width:850px){body[data-shoko-mode=\"guide\"] .shell{grid-template-rows:72px auto minmax(0,1fr) 49px}#shoko-guide-intro{padding:7px 12px;font-size:11px}}\n@media(max-width:650px){.header{gap:7px;padding:0 47px 0 9px}.header .mark{display:none}.header .brand{min-width:unset}.header .brand strong{font-size:17px}.header .brand small{display:none}.header-end{gap:5px}.menu-top button{padding:8px 5px;font-size:10px}.shoko-back{font-size:10px;padding:8px 5px}.shoko-title{font-size:76px}.shoko-help{padding:14px}}\n";document.head.append(st);
$('shoko-guide').addEventListener('click',()=>setMode('guide'));
$('shoko-room').addEventListener('click',()=>setMode('room'));
$('showArchive').addEventListener('click',()=>linesBtn.classList.remove('active'));
$('showDesk').addEventListener('click',()=>linesBtn.classList.remove('active'));
document.body.dataset.shokoStage='home';document.body.dataset.shokoMode='room';
setMode('room');document.body.dataset.shokoStage='home';
})();