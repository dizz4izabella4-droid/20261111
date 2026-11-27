// 型（デザイン）の定義。長さは身長153.3cmの素体を基準にした値で、素体の身長に比例して拡大・縮小する
export const COLOR_SETS={
  '生成りとえんじ':{top:['#d9ccb0','#c29a45','#7d2136'],skirt:['#d9ccb0','#c29a45','#7d2136'],sash:['#7d2136','#c29a45'],tabard:['#7d2136','#c29a45'],cape:['#235443','#c29a45','#6a1f31']},
  '夜の紺と銀':{top:['#27304f','#b9bfcc','#7f6bb0'],skirt:['#222a47','#b9bfcc','#7f6bb0'],sash:['#4a3a72','#b9bfcc'],tabard:['#4a3a72','#b9bfcc'],cape:['#161b30','#b9bfcc','#4a3a72']},
  '森と革':{top:['#c9bd96','#6b4a2b','#4f6b35'],skirt:['#4f6b35','#6b4a2b','#c9bd96'],sash:['#6b4a2b','#b8923f'],tabard:['#8a5a30','#4b3320'],cape:['#34452a','#6b4a2b','#8a6b3a']},
  '白と空色':{top:['#eef0ee','#7aa6c9','#c8a64e'],skirt:['#eef0ee','#7aa6c9','#c8a64e'],sash:['#5f8fb8','#eef0ee'],tabard:['#5f8fb8','#e7d9a8'],cape:['#dfe7ee','#5f8fb8','#7aa6c9']},
  '黒と緋':{top:['#262326','#a8252b','#8d8478'],skirt:['#1f1d20','#a8252b','#8d8478'],sash:['#a8252b','#2a272a'],tabard:['#a8252b','#c9a45c'],cape:['#18161a','#a8252b','#5c1519']},
};
export const colorsOf=name=>JSON.parse(JSON.stringify(COLOR_SETS[name]));
const base={
  top:{neck:'round',depth:0.062,ease:0.0075},
  sleeve:{type:'bell',length:1,cuff:0.78,drape:0.24},
  skirt:{on:true,length:0.95,hem:3.0,pleats:13},
  tabard:{on:false,back:true,width:0.22,length:0.6},
  sash:{on:true,width:0.07,tails:2,tail:0.5},
  cape:{on:true,length:0.89,width:1.75,clasp:true},
  hood:{on:true,depth:0.28},
  trim:{width:0.045,line:true},
  colorSet:'生成りとえんじ',
};
const make=(name,patch,colorSet)=>{const d=JSON.parse(JSON.stringify(base));for(const k in patch)d[k]=typeof patch[k]==='object'?{...d[k],...patch[k]}:patch[k];d.name=name;d.colorSet=colorSet||d.colorSet;d.colors=colorsOf(d.colorSet);return d;};
export const PRESETS=[
  ()=>make('旅の巫女',{}),
  ()=>make('町娘',{top:{neck:'wide',depth:0.04},sleeve:{type:'fit',length:0.55},skirt:{length:0.7,hem:2.4,pleats:16},tabard:{on:true,back:false,width:0.2,length:0.45},sash:{width:0.05,tails:0},cape:{on:false},hood:{on:false},trim:{width:0.025,line:false}},'森と革'),
  ()=>make('魔術師',{top:{neck:'high',depth:0.02},sleeve:{type:'bell',length:1,cuff:0.95,drape:0.42},skirt:{length:0.98,hem:2.2,pleats:9},sash:{width:0.06,tails:1,tail:0.7},cape:{on:true,length:0.95,width:1.5},hood:{on:true,depth:0.34},trim:{width:0.03,line:true}},'夜の紺と銀'),
  ()=>make('神殿の従者',{top:{neck:'v',depth:0.07},sleeve:{type:'fit',length:1},skirt:{length:0.93,hem:1.9,pleats:7},tabard:{on:true,back:true,width:0.24,length:0.75},sash:{width:0.055,tails:0},cape:{on:false},hood:{on:false},trim:{width:0.03,line:false}},'白と空色'),
];
export const defaultDesign=()=>PRESETS[0]();
// 保存した型を読むとき、足りない項目や範囲外の値を直す
export const RANGES={
  top:{depth:[0,0.1],ease:[0.006,0.022]},sleeve:{length:[0.2,1],cuff:[0.25,1.2],drape:[0,0.5]},skirt:{length:[0.3,1],hem:[1.1,4.5],pleats:[0,18]},
  tabard:{width:[0.12,0.28],length:[0.2,0.95]},sash:{width:[0.03,0.13],tails:[0,3],tail:[0.2,0.75]},cape:{length:[0.35,0.98],width:[0.9,2.4]},hood:{depth:[0.18,0.4]},trim:{width:[0,0.09]}};
export function sanitize(input){
  const d=defaultDesign();if(!input||typeof input!=='object')return d;
  for(const k of Object.keys(RANGES)){const src=input[k]||{};for(const p in d[k]){const v=src[p],dv=d[k][p];if(v===undefined)continue;
    if(typeof dv==='number'&&Number.isFinite(v)){const r=RANGES[k][p];d[k][p]=r?Math.min(r[1],Math.max(r[0],v)):v;}else if(typeof dv===typeof v&&typeof v!=='number')d[k][p]=v;}}
  if(!['round','v','wide','high'].includes(d.top.neck))d.top.neck='round';
  if(!['bell','fit','none'].includes(d.sleeve.type))d.sleeve.type='bell';
  d.skirt.pleats=Math.round(d.skirt.pleats);d.sash.tails=Math.round(d.sash.tails);
  if(typeof input.name==='string')d.name=input.name.slice(0,40);
  if(COLOR_SETS[input.colorSet]){d.colorSet=input.colorSet;d.colors=colorsOf(input.colorSet);}
  for(const g in d.colors){const c=input.colors&&input.colors[g];if(Array.isArray(c))d.colors[g]=d.colors[g].map((v,i)=>/^#[0-9a-f]{6}$/i.test(c[i])?c[i]:v);}
  return d;
}
