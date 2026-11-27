// 型（デザイン）の定義。長さは身長153.3cmの素体を基準にした値で、素体の身長に比例して拡大・縮小する
export const COLOR_SETS={
  '生成りとえんじ':{top:['#d9ccb0','#c29a45','#7d2136'],skirt:['#d9ccb0','#c29a45','#7d2136'],sash:['#7d2136','#c29a45'],tabard:['#7d2136','#c29a45'],cape:['#235443','#c29a45','#6a1f31'],pants:['#5b3a36','#c29a45','#7d2136'],shoes:['#5a3824','#2b1a10'],vest:['#7d2136','#c29a45'],hat:['#235443','#c29a45','#7d2136']},
  '夜の紺と銀':{top:['#27304f','#b9bfcc','#7f6bb0'],skirt:['#222a47','#b9bfcc','#7f6bb0'],sash:['#4a3a72','#b9bfcc'],tabard:['#4a3a72','#b9bfcc'],cape:['#161b30','#b9bfcc','#4a3a72'],pants:['#1b2038','#b9bfcc','#4a3a72'],shoes:['#23202c','#8d93a3'],vest:['#3a2f5c','#b9bfcc'],hat:['#1c2240','#b9bfcc','#7f6bb0']},
  '森と革':{top:['#c9bd96','#6b4a2b','#4f6b35'],skirt:['#4f6b35','#6b4a2b','#c9bd96'],sash:['#6b4a2b','#b8923f'],tabard:['#8a5a30','#4b3320'],cape:['#34452a','#6b4a2b','#8a6b3a'],pants:['#5a4a33','#33261a','#8a6b3a'],shoes:['#53381f','#2a1c10'],vest:['#6b4a2b','#b8923f'],hat:['#43582f','#6b4a2b','#b8923f']},
  '白と空色':{top:['#eef0ee','#7aa6c9','#c8a64e'],skirt:['#eef0ee','#7aa6c9','#c8a64e'],sash:['#5f8fb8','#eef0ee'],tabard:['#5f8fb8','#e7d9a8'],cape:['#dfe7ee','#5f8fb8','#7aa6c9'],pants:['#cdd8e2','#5f8fb8','#c8a64e'],shoes:['#8b9bb0','#4d5b70'],vest:['#5f8fb8','#e7d9a8'],hat:['#e8edf2','#5f8fb8','#c8a64e']},
  '黒と緋':{top:['#262326','#a8252b','#8d8478'],skirt:['#1f1d20','#a8252b','#8d8478'],sash:['#a8252b','#2a272a'],tabard:['#a8252b','#c9a45c'],cape:['#18161a','#a8252b','#5c1519'],pants:['#232024','#a8252b','#8d8478'],shoes:['#1b181a','#6d1b1f'],vest:['#4a161a','#c9a45c'],hat:['#1c1a1d','#c9a45c','#a8252b']},
  '砂と青緑':{top:['#d8c29a','#1f7a74','#a4552f'],skirt:['#1f7a74','#d9a63c','#d8c29a'],sash:['#a4552f','#d9a63c'],tabard:['#1f7a74','#d9a63c'],cape:['#b98c56','#6a4327','#1f7a74'],pants:['#2a8b83','#d9a63c','#a4552f'],shoes:['#8a5a34','#4a2e1a'],vest:['#a4552f','#d9a63c'],hat:['#1f7a74','#d9a63c','#a4552f']},
  '薔薇と灰':{top:['#e9dfdd','#9c4a62','#b99a63'],skirt:['#9c4a62','#e9dfdd','#b99a63'],sash:['#5c5660','#b99a63'],tabard:['#e9dfdd','#9c4a62'],cape:['#57525c','#b99a63','#9c4a62'],pants:['#5c5660','#b99a63','#9c4a62'],shoes:['#4a3a40','#241a1e'],vest:['#5a3342','#b99a63'],hat:['#8e3f58','#e9dfdd','#b99a63']},
};
export const colorsOf=name=>JSON.parse(JSON.stringify(COLOR_SETS[name]));
const base={
  top:{neck:'round',depth:0.062,ease:0.0075},
  sleeve:{type:'bell',length:1,cuff:0.78,drape:0.24},
  pants:{on:false,type:'slim',length:1,volume:0.5},
  shoes:{on:false,type:'boots',height:0.3},
  skirt:{on:true,shape:'flare',edge:'flat',length:0.95,hem:3.0,pleats:13},
  vest:{on:false,type:'corset',size:0.5},
  bracer:{on:false,length:0.6},
  tabard:{on:false,back:true,width:0.22,length:0.6},
  sash:{on:true,width:0.07,tails:2,tail:0.5},
  cape:{on:true,edge:'flat',length:0.89,width:1.75,clasp:true},
  hood:{on:true,pose:'down',depth:0.28},
  hat:{on:false,type:'witch',height:0.2,brim:0.09,length:0.42},
  trim:{width:0.045,line:true},
  colorSet:'生成りとえんじ',
};
const make=(name,patch,colorSet)=>{const d=JSON.parse(JSON.stringify(base));for(const k in patch)d[k]=typeof patch[k]==='object'?{...d[k],...patch[k]}:patch[k];d.name=name;d.colorSet=colorSet||d.colorSet;d.colors=colorsOf(d.colorSet);return d;};
export const PRESETS=[
  ()=>make('旅の巫女',{}),
  ()=>make('町娘',{top:{neck:'wide',depth:0.04},sleeve:{type:'fit',length:0.55},skirt:{length:0.7,hem:2.4,pleats:16},tabard:{on:true,back:false,width:0.2,length:0.45},sash:{width:0.05,tails:0},cape:{on:false},hood:{on:false},trim:{width:0.025,line:false}},'森と革'),
  ()=>make('魔術師',{top:{neck:'high',depth:0.02},sleeve:{type:'bell',length:1,cuff:0.95,drape:0.42},skirt:{length:0.98,hem:2.2,pleats:9},sash:{width:0.06,tails:1,tail:0.7},cape:{on:true,length:0.95,width:1.5},hood:{on:true,depth:0.34},trim:{width:0.03,line:true}},'夜の紺と銀'),
  ()=>make('神殿の従者',{top:{neck:'v',depth:0.07},sleeve:{type:'fit',length:1},skirt:{length:0.93,hem:1.9,pleats:7},tabard:{on:true,back:true,width:0.24,length:0.75},sash:{width:0.055,tails:0},cape:{on:false},hood:{on:false},trim:{width:0.03,line:false}},'白と空色'),
  ()=>make('旅の剣士',{top:{neck:'v',depth:0.06},sleeve:{type:'fit',length:0.95},pants:{on:true,type:'slim',length:1},shoes:{on:true,type:'boots',height:0.36},skirt:{on:false},vest:{on:true,type:'vest',size:0.7},sash:{width:0.05,tails:1,tail:0.35},bracer:{on:true,length:0.65},cape:{length:0.55,width:1.5,edge:'point'},hood:{on:false},trim:{width:0.025,line:false}},'森と革'),
  ()=>make('魔女',{top:{neck:'square',depth:0.04},sleeve:{type:'puff',length:1,cuff:0.8},shoes:{on:true,type:'boots',height:0.24},skirt:{shape:'tiered',edge:'jag',length:0.82,hem:3.2,pleats:18},vest:{on:true,type:'corset',size:0.45},sash:{on:false},cape:{length:0.75,width:1.7,edge:'jag'},hood:{on:false},hat:{on:true,type:'witch',height:0.22,brim:0.1},trim:{width:0.025,line:false}},'黒と緋'),
  ()=>make('踊り子',{top:{neck:'strapless',depth:0.05},sleeve:{type:'none'},pants:{on:true,type:'balloon',length:0.95,volume:0.7},shoes:{on:true,type:'sandal'},skirt:{on:false},sash:{width:0.065,tails:3,tail:0.55},bracer:{on:true,length:0.5},cape:{on:false},hood:{on:false},hat:{on:true,type:'veil',length:0.45},trim:{width:0.03,line:false}},'砂と青緑'),
  ()=>make('袴の術士',{top:{neck:'v',depth:0.085,ease:0.01},sleeve:{type:'bell',length:0.9,cuff:1.05,drape:0.3},pants:{on:true,type:'hakama',length:0.97,volume:0.65},shoes:{on:true,type:'sandal'},skirt:{on:false},sash:{width:0.09,tails:2,tail:0.4},cape:{on:false},hood:{on:false},hat:{on:true,type:'circlet'},trim:{width:0.03,line:false}},'生成りとえんじ'),
  ()=>make('令嬢',{top:{neck:'square',depth:0.05},sleeve:{type:'bishop',length:1,cuff:0.75},shoes:{on:true,type:'shoes'},skirt:{shape:'tiered',edge:'wave',length:0.94,hem:3.6,pleats:18},vest:{on:true,type:'corset',size:0.3},sash:{on:false},cape:{on:false},hood:{on:false},hat:{on:true,type:'beret',height:0.18},trim:{width:0.025,line:true}},'薔薇と灰'),
  ()=>make('放浪の薬師',{top:{neck:'high',depth:0.02},sleeve:{type:'bishop',length:0.9,cuff:0.6},pants:{on:true,type:'slim',length:0.8},shoes:{on:true,type:'shoes'},skirt:{shape:'open',edge:'back',length:0.85,hem:2.6,pleats:8},vest:{on:true,type:'corset',size:0.35},sash:{on:false},bracer:{on:false},cape:{length:0.7,width:1.6},hood:{on:true,pose:'up',depth:0.3},trim:{width:0.035,line:true}},'砂と青緑'),
];
export const defaultDesign=()=>PRESETS[0]();
// 保存した型を読むとき、足りない項目や範囲外の値を直す
export const RANGES={
  top:{depth:[0,0.1],ease:[0.006,0.022]},sleeve:{length:[0.2,1],cuff:[0.25,1.2],drape:[0,0.5]},pants:{length:[0.3,1],volume:[0,1]},shoes:{height:[0.14,0.42]},
  skirt:{length:[0.3,1],hem:[1.1,4.5],pleats:[0,18]},vest:{size:[0,1]},bracer:{length:[0.25,1]},tabard:{width:[0.12,0.28],length:[0.2,0.95]},sash:{width:[0.03,0.13],tails:[0,3],tail:[0.2,0.75]},
  cape:{length:[0.35,0.98],width:[0.9,2.4]},hood:{depth:[0.18,0.4]},hat:{height:[0.08,0.32],brim:[0.03,0.14],length:[0.2,0.65]},trim:{width:[0,0.09]}};
// 形の選択肢（先頭が不正な値の置き換え先）
export const CHOICES={
  top:{neck:[['round','丸首'],['v','V字'],['square','角えり'],['wide','広く開ける'],['high','立ち襟'],['strapless','肩出し']]},
  sleeve:{type:[['bell','広がる袖'],['fit','細い袖'],['puff','ちょうちん袖'],['bishop','ふくらみ袖'],['none','袖なし']]},
  pants:{type:[['slim','細身'],['hakama','袴風（広い）'],['balloon','ふくらみ']]},
  shoes:{type:[['boots','ブーツ'],['shoes','短靴'],['sandal','サンダル']]},
  skirt:{shape:[['flare','ふんわり'],['straight','まっすぐ'],['tiered','段フリル'],['open','前開き']],edge:[['flat','そろえる'],['back','後ろを長く'],['jag','ギザギザ'],['wave','波形']]},
  vest:{type:[['corset','コルセット'],['vest','前開きのベスト']]},
  cape:{edge:[['flat','そろえる'],['point','中央をとがらせる'],['jag','ギザギザ'],['wave','波形']]},
  hood:{pose:[['down','下ろす'],['up','かぶる']]},
  hat:{type:[['witch','とんがり帽子'],['brim','つば広帽子'],['beret','ベレー帽'],['veil','ベール'],['circlet','額飾り']]},
};
export function sanitize(input){
  const d=defaultDesign();if(!input||typeof input!=='object')return d;
  // 保存されていない部品は、見本の初期値ではなく基本の値にする
  for(const k in base)if(typeof base[k]==='object')d[k]={...base[k]};
  for(const k of Object.keys(RANGES)){const src=input[k]||{};for(const p in d[k]){const v=src[p],dv=d[k][p];if(v===undefined)continue;
    if(typeof dv==='number'&&Number.isFinite(v)){const r=RANGES[k][p];d[k][p]=r?Math.min(r[1],Math.max(r[0],v)):v;}else if(typeof dv===typeof v&&typeof v!=='number')d[k][p]=v;}}
  for(const g in CHOICES)for(const p in CHOICES[g])if(!CHOICES[g][p].some(c=>c[0]===d[g][p]))d[g][p]=CHOICES[g][p][0][0];
  d.skirt.pleats=Math.round(d.skirt.pleats);d.sash.tails=Math.round(d.sash.tails);
  if(typeof input.name==='string')d.name=input.name.slice(0,40);
  if(Object.hasOwn(COLOR_SETS,input.colorSet)){d.colorSet=input.colorSet;d.colors=colorsOf(input.colorSet);}
  for(const g in d.colors){const c=input.colors&&input.colors[g];if(Array.isArray(c))d.colors[g]=d.colors[g].map((v,i)=>/^#[0-9a-f]{6}$/i.test(c[i])?c[i]:v);}
  return d;
}
