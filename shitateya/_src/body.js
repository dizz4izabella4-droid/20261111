// スペアボディの GLB を読み、服を合わせるための寸法を取り出す
import {readGLB,accessor,add,sub,mul,norm,cross} from './lib.js';
export const NEEDED=['hips','spine','chest','neck','head','upperarm_l','forearm_l','hand_l','upperarm_r','forearm_r','hand_r','thigh_l','shin_l','foot_l','thigh_r','shin_r','foot_r'];
export function parseBody(bytes){
  const g=readGLB(bytes), js=g.js;
  const skin=js.skins&&js.skins[0];
  const nodeIndex=(js.nodes||[]).findIndex(n=>n.mesh!==undefined&&n.skin!==undefined&&!String(n.name||'').startsWith('cloth_'));
  if(!skin||nodeIndex<0) throw new Error('骨の入った素体が見つかりません。スペアボディの「傀儡用に書き出す（GLB）」で作ったファイルを開いてください。');
  const names=skin.joints.map(j=>js.nodes[j].name);
  const missing=NEEDED.filter(n=>!names.includes(n));
  if(missing.length) throw new Error('必要な骨がありません：'+missing.join(', '));
  if(js.nodes.some(n=>n.matrix||(n.rotation&&Math.abs(n.rotation[3])<0.999))) throw new Error('回転した骨を持つ素体には対応していません。立ち姿で書き出した素体を開いてください。');
  const parent={};js.nodes.forEach((n,i)=>(n.children||[]).forEach(c=>parent[c]=i));
  const world=i=>{const t=js.nodes[i].translation||[0,0,0];return parent[i]===undefined?t:add(world(parent[i]),t);};
  const J={};skin.joints.forEach(j=>J[js.nodes[j].name]=world(j));
  const mesh=js.meshes[js.nodes[nodeIndex].mesh];
  const P=[],JN=[],W=[],tris=[],soft=[[],[],[]];let hasSoft=true,base=0;
  for(const p of mesh.primitives){
    const a=p.attributes,pos=accessor(g,a.POSITION),jn=accessor(g,a.JOINTS_0),wt=accessor(g,a.WEIGHTS_0),ix=p.indices!==undefined?accessor(g,p.indices):Uint32Array.from({length:pos.length/3},(_,i)=>i);
    const scale=wt instanceof Float32Array?1:wt instanceof Uint8Array?1/255:1/65535;
    for(let i=0;i<pos.length;i++)P.push(pos[i]);for(let i=0;i<jn.length;i++){JN.push(jn[i]);W.push(wt[i]*scale);}
    const s=['_SOFTNESS','_MAX_OFFSET','_DAMPING'].map(k=>a[k]!==undefined?accessor(g,a[k]):null);
    if(s.some(v=>!v))hasSoft=false;else s.forEach((v,k)=>{for(let i=0;i<v.length;i++)soft[k].push(v[i]);});
    for(let t=0;t<ix.length;t+=3)tris.push([ix[t],ix[t+1],ix[t+2]].map(i=>[pos[i*3],pos[i*3+1],pos[i*3+2]]));
    base+=pos.length/3;
  }
  const count=P.length/3;let H=0,xmax=0,zmin=0,zmax=0;
  for(let i=0;i<count;i++){H=Math.max(H,P[i*3+1]);xmax=Math.max(xmax,Math.abs(P[i*3]));zmin=Math.min(zmin,P[i*3+2]);zmax=Math.max(zmax,P[i*3+2]);}
  const dom=[];for(let i=0;i<count;i++){let m=0;for(let k=1;k<4;k++)if(W[i*4+k]>W[i*4+m])m=k;dom.push(names[JN[i*4+m]]);}
  return{g,nodeIndex,names,J,P,JN,W,dom,tris,soft:hasSoft?soft:null,count,H,xmax,zmin,zmax};
}
