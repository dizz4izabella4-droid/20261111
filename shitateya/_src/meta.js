// 書き出す GLB に入れる情報（部位・重ね順・合わせた素体）。アッセンブル！などが読む
export const APP_VERSION='2.0';

// garmentRegion は torso / arm / leg / foot / head / whole のどれか。layer は数が大きいほど外側
const SLOTS={
  top:['top','torso',1],glove:['glove','arm',1],pants:['pants','leg',2],sleeve:['sleeve','arm',3],skirt:['skirt','leg',3],
  vest:['vest','torso',4],tabard:['tabard','whole',5],sash:['sash','torso',6],tail:['sash','leg',6],
  cape:['cape','whole',8],hood:['hood','torso',9],shoes:['shoes','foot',1],strap:['shoes','foot',1],
  bracer:['bracer','arm',2],hat:['hat','head',10],veil:['hat','head',10],
};
// ひも・留め具などの飾りは、名前から持ち主を決める
const TRIM_OWNER=[[/^cloth_vest/,'vest','torso'],[/^cloth_cape/,'cape','torso'],[/^cloth_hat/,'hat','head']];

export function partInfo(part,design){
  let[slot,garmentRegion,layer]=SLOTS[part.kind]||['top','torso',1];
  if(part.kind==='trim'){const hit=TRIM_OWNER.find(([re])=>re.test(part.name));if(hit){slot=hit[1];garmentRegion=hit[2];layer=SLOTS[slot][2];}}
  if(part.kind==='shoes'||part.kind==='strap')layer=design.shoes.type==='boots'?4:1; // ブーツはズボンの上
  if(part.kind==='bracer')layer=['fit','puff'].includes(design.sleeve.type)?4:2;     // 細い袖では腕当てが上
  if(part.kind==='hood'&&part.up)garmentRegion='head';
  return{slot,garmentRegion,layer};
}

// 同じ内容なら同じ値になる短い指紋（FNV-1a 64bit）
function fnv1a(text){let h=0xcbf29ce484222325n;for(const b of new TextEncoder().encode(text))h=BigInt.asUintN(64,(h^BigInt(b))*0x100000001b3n);return h.toString(16).padStart(16,'0');}
// キーを並べ替えた JSON
export const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);

const sceneExtras=body=>{const js=body.g.js;return(js.scenes&&js.scenes[js.scene||0]||{}).extras||{};};

// 合わせた素体を見分けるための情報
export function bodyInfo(body,bodyName){
  const x=sceneExtras(body),height=Number.isFinite(x.heightMeters)?x.heightMeters:body.H;
  // スペアボディは体型の設定値から。設定値がない素体は、形と骨の名前から
  const fromParams=x.params&&typeof x.params==='object';
  const source=fromParams?canonical(x.params):canonical({joints:body.names,positions:body.P.map(v=>Math.round(v*1e5))});
  return{bodyName,bodyHeightMeters:Math.round(height*1e4)/1e4,bodyHash:'fnv1a64:'+fnv1a(source),bodyHashBasis:fromParams?'params':'geometry'};
}

export function garmentMeta(body,meshes,{bodyName='',designName=''}={}){
  const info=bodyInfo(body,bodyName),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const m of meshes)for(const p of m.prims)for(let i=0;i<p.position.length;i++){const c=i%3;min[c]=Math.min(min[c],p.position[i]);max[c]=Math.max(max[c],p.position[i]);}
  // 衣服の基準点は素体と同じ原点。衣服が原点から遠いとき（帽子だけなど）は書かない
  const reach=Math.max(0.05,Math.hypot(...max.map((v,c)=>v-min[c]))*0.25),near=meshes.length>0&&min.every((v,c)=>v-reach<=0&&max[c]+reach>=0);
  const spare=/^spare-body/.test(String(sceneExtras(body).format||''));
  return{
    schemaVersion:1,partType:'garment',
    coordinateSystem:{up:'Y',forward:'Z',unit:'meter'},
    anchors:{headRoot:null,neckBase:null,neckTop:null,hairRoot:null,garmentRoot:near?[0,0,0]:null},
    rig:{skeletonType:spare?'spare-body':'generic',boneMapping:{}},
    source:{application:'shitateya',version:APP_VERSION,designName,...info},
    bodyHeightMeters:info.bodyHeightMeters,
    garments:meshes.map(m=>({name:m.name,...m.info})),
  };
}
