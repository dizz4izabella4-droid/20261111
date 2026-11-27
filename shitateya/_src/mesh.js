// 服の格子を、色・骨の重み付きの網目にする。GLB への書き出しもここ
import {add,sub,mul,len,norm,cross,dot,clamp,smooth,writeGLB} from './lib.js';

const lin=hex=>[1,3,5].map(k=>{const c=parseInt(hex.slice(k,k+2),16)/255;return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);});
const mix=(a,b,t)=>{const o={};for(const k in a)o[k]=(o[k]||0)+a[k]*(1-t);for(const k in b)o[k]=(o[k]||0)+b[k]*t;return o;};

// 近い素体頂点を探すための升目
function nearest(body,ids){
  const S=0.04,map=new Map(),key=(x,y,z)=>x+','+y+','+z,P=body.P;
  for(const i of ids){const k=key(Math.floor(P[i*3]/S),Math.floor(P[i*3+1]/S),Math.floor(P[i*3+2]/S));let l=map.get(k);if(!l)map.set(k,l=[]);l.push(i);}
  return p=>{const c=p.map(v=>Math.floor(v/S));let best=Infinity,bi=-1;
    for(let r=0;r<16;r++){if(bi>=0&&best<((r-1)*S)**2)break;
      for(let x=-r;x<=r;x++)for(let y=-r;y<=r;y++)for(let z=-r;z<=r;z++){if(Math.max(Math.abs(x),Math.abs(y),Math.abs(z))!==r)continue;const l=map.get(key(c[0]+x,c[1]+y,c[2]+z));if(!l)continue;
        for(const i of l){const d=(P[i*3]-p[0])**2+(P[i*3+1]-p[1])**2+(P[i*3+2]-p[2])**2;if(d<best){best=d;bi=i;}}}}
    return bi<0?ids[0]:bi;};
}

export function makeSkinner(body){
  const J=body.J,k=body.H/1.533,waist=J.spine[1],S=J.upperarm_l,knee=J.shin_l[1],all=[...Array(body.count).keys()];
  const torso=nearest(body,all.filter(i=>/^(hips|spine|chest|neck|upperarm)/.test(body.dom[i])&&body.P[i*3+1]>waist-0.1*k));
  const lower=nearest(body,all.filter(i=>/^(hips|spine|chest|neck|upperarm)/.test(body.dom[i])&&body.P[i*3+1]>waist-0.1*k||body.P[i*3+1]>knee*1.25&&body.P[i*3+1]<=waist-0.1*k&&Math.abs(body.P[i*3])<0.17*k));
  const arm={};for(const s of['l','r'])arm[s]=nearest(body,all.filter(i=>new RegExp('^((upperarm|forearm|hand)_'+s+'|chest)$').test(body.dom[i])&&(body.P[i*3]*(s==='l'?1:-1))>S[0]*0.5));
  const weightsOf=i=>{const w={};for(let c=0;c<4;c++){const v=body.W[i*4+c];if(v>0){const n=body.names[body.JN[i*4+c]];w[n]=(w[n]||0)+v;}}return w;};
  const lowW=(p,share)=>{const sl=smooth(-0.11*k,0.11*k,p[0]),sh=0.45*smooth(knee+0.075*k,knee-0.185*k,p[1]);return{hips:1-share,thigh_l:share*sl*(1-sh),thigh_r:share*(1-sl)*(1-sh),shin_l:share*sl*sh,shin_r:share*(1-sl)*sh};};
  const shoulders=(p,amount)=>{const sh=amount*smooth(S[0]*0.57,S[0]*0.95,Math.abs(p[0]));return{chest:1-sh,[p[0]>0?'upperarm_l':'upperarm_r']:sh};};
  const softAt=i=>body.soft.map(a=>a[i]);
  return{J,k,waist,S,knee,torso,lower,arm,weightsOf,lowW,shoulders,softAt};
}

// 格子の途中の値（なめらかな曲線でつなぐ）
const spline=(grid,fj,fi,closed)=>{const nv=grid.length,nu=grid[0].length,cr=(a,b,c,d,t)=>[0,1,2].map(k=>0.5*(2*b[k]+(c[k]-a[k])*t+(2*a[k]-5*b[k]+4*c[k]-d[k])*t*t+(3*b[k]-a[k]-3*c[k]+d[k])*t*t*t));
  const ci=i=>closed?((i%nu)+nu)%nu:clamp(i,0,nu-1),ext=(get,n,k)=>k<0?sub(mul(get(0),2),get(1)):k>n-1?sub(mul(get(n-1),2),get(n-2)):get(k);
  const j0=Math.min(nv-2,Math.floor(fj)),tj=fj-j0,i0=closed?Math.floor(fi):Math.min(nu-2,Math.floor(fi)),ti=fi-i0;
  const row=jj=>{const col=i=>closed?grid[jj][ci(i)]:ext(k=>grid[jj][k],nu,i);return cr(col(i0-1),col(i0),col(i0+1),col(i0+2),ti);};
  return cr(ext(row,nv,j0-1),row(j0),row(j0+1),ext(row,nv,j0+2),tj);};
// 色の境目がくっきり出るよう、境目に列を足す
const ticks=(n,bands,closed)=>{let t=Array.from({length:n},(_,i)=>closed?i/n:i/(n-1));for(const[a,b]of bands)for(const e of[a,b])if(e>0.002&&e<0.998){const gap=Math.min(0.0012,(b-a)/4);t=t.filter(x=>x===0||x===1||Math.abs(x-e)>Math.min(0.006,(b-a)/2));t.push(e-gap,e+gap);}return t.sort((a,b)=>a-b);};
const inBand=(x,list)=>list.some(([a,b])=>x>a&&x<b);

// 部品ごとの縁飾りの位置（0〜1 の割合）
function bands(part,design){
  const w=design.trim.width,line=design.trim.line,L=part.length||1,main=[],stripe=[],cols=[],f=v=>clamp(v/L,0,0.45);
  if(w<0.002)return{main,stripe,cols};
  const hem=(width,margin,withLine)=>{const b=1-f(margin),a=b-f(width);main.push([a,b]);if(withLine&&line){const s=a-f(width*0.45);stripe.push([s-f(width*0.4),s]);}};
  switch(part.kind){
    case'top':main.push([0,f(w*0.45)]);break;
    case'skirt':hem(w,w*0.5,true);break;
    case'sleeve':hem(w*(part.fitted?0.7:1),w*0.3,!part.fitted);break;
    case'sash':{const e=clamp(w*0.22/L,0,0.3);main.push([0,e],[1-e,1]);break;}
    case'tail':hem(w*0.9,w*0.5,false);break;
    case'tabard':{hem(w*0.7,w*0.3,false);const e=clamp(w*0.22/(design.tabard.width),0,0.2);cols.push([0,e],[1-e,1]);break;}
    case'cape':{hem(w,w*0.25,false);const e=clamp(w*0.45/part.width,0,0.1);cols.push([0,e],[1-e,1]);break;}
    case'hood':main.push([clamp(1-w*0.7/L,0.5,1),clamp(1-w*0.18/L,0.6,1)]);break;
  }
  return{main,stripe,cols};
}
const GROUP={top:'top',sleeve:'top',skirt:'skirt',sash:'sash',tail:'sash',tabard:'tabard',cape:'cape',hood:'cape',trim:'cape'};

// cache を渡すと、色を変えるだけのときは形と重みを作り直さない
export function buildMeshes(body,sk,parts,design,cache){
  const{J,k,waist,S}=sk,C={};for(const g in design.colors)C[g]=design.colors[g].map(lin);
  const byName=Object.fromEntries(parts.map(p=>[p.name,p])),meshes=[];
  const top=byName.cloth_top;
  for(const part of parts){
    const kind=part.kind,src=part.pos,nvS=src.length,nuS=src[0].length,closed=part.closed,trim=kind==='trim';
    const group=GROUP[kind],col=C[group],b=trim?{main:[],stripe:[],cols:[]}:bands(part,design);
    const color=(t,u)=>{if(trim)return col[1];if(inBand(t,b.main)||inBand(u,b.cols))return col[1];if(inBand(t,b.stripe))return col[2];return col[0];};
    const paint=g=>{const lining=g.lining,front=new Float32Array(g.uv.length*3),back=lining&&new Float32Array(g.uv.length*3);
      g.uv.forEach(([t,u],v)=>{const c=color(t,u);front.set(c,v*3);if(lining)back.set(c===col[1]?col[1]:col[2],v*3);});
      return{name:part.name,kind,prims:g.prims.map((p,n)=>({...p,color:n?back:front}))};};
    const layout=JSON.stringify(b),hit=cache&&cache.get(part);
    if(hit&&hit.layout===layout){meshes.push(paint(hit));continue;}
    const tj=trim?Array.from({length:nvS},(_,i)=>i/(nvS-1)):ticks(nvS,[...b.main,...b.stripe],false);
    const ti=trim||!b.cols.length?Array.from({length:nuS},(_,i)=>closed?i/nuS:i/(nuS-1)):ticks(nuS,b.cols,closed);
    const nv=tj.length,nu=ti.length,P=[],grid=[];
    tj.forEach((t,j)=>{grid.push([]);ti.forEach((u,i)=>{const p=trim?src[j][i]:spline(src,t*(nvS-1),closed?u*nuS:u*(nuS-1),closed);grid[j].push(p);P.push(p);});});

    // 向き（表が外）をそろえる
    const N=P.map(()=>[0,0,0]),I=[];
    for(let j=0;j+1<nv;j++)for(let i=0;i<(closed?nu:nu-1);i++){const a=j*nu+i,bb=(j+1)*nu+i,c=(j+1)*nu+(i+1)%nu,d=j*nu+(i+1)%nu;I.push(a,bb,c,a,c,d);}
    for(let t=0;t<I.length;t+=3){const[a,bb,c]=[I[t],I[t+1],I[t+2]],n=cross(sub(P[bb],P[a]),sub(P[c],P[a]));for(const v of[a,bb,c])N[v]=add(N[v],n);}
    let side=0;for(let j=0;j<nv;j++){const cen=(kind==='sleeve'||trim)?mul(grid[j].reduce(add,[0,0,0]),1/nu):kind==='hood'?[0,S[1]-0.2*k,0.06*k]:null;
      for(let i=0;i<nu;i++){const p=grid[j][i];side+=kind==='tabard'?N[j*nu+i][2]*part.side:dot(N[j*nu+i],sub(p,cen||[0,p[1],0]));}}
    if(side<0){for(let t=0;t<I.length;t+=3)[I[t+1],I[t+2]]=[I[t+2],I[t+1]];for(let v=0;v<N.length;v++)N[v]=mul(N[v],-1);}
    const Nn=N.map(norm);

    // 骨の重み。もとの格子で求めて、足した列には混ぜて割り当てる
    let grid0=null;
    if(kind==='top'){grid0=src.map(r=>r.map(p=>sk.weightsOf(sk.torso(p))));
      for(let it=0;it<6;it++)grid0=grid0.map((r,j)=>r.map((w,i)=>{const nb=[r[(i+1)%r.length],r[(i+r.length-1)%r.length],grid0[Math.max(0,j-1)][i],grid0[Math.min(grid0.length-1,j+1)][i]];return mix(w,mix(mix(nb[0],nb[1],0.5),mix(nb[2],nb[3],0.5),0.5),0.6);}));}
    let hang=null; // 腰や肩から下がる部分の起点の重み
    if(kind==='skirt')hang=src[0].map(p=>sk.weightsOf(sk.torso(p)));
    if(kind==='tail')hang=src[0].map(()=>sk.weightsOf(sk.torso(top?top.pos[top.pos.length-1][part.waistIndex%top.pos[0].length]:src[0][0])));
    let upperRows=0;if(kind==='tabard'){upperRows=part.upper;const j=Math.round(upperRows*(nvS-1));hang=src[j].map(p=>sk.weightsOf(sk.torso(p)));}
    const weight=(p,t,u)=>{
      if(kind==='top'){const fj=t*(nvS-1),fi=u*nuS,j0=Math.min(nvS-2,Math.floor(fj)),i0=Math.floor(fi),a=fj-j0,bb=fi-i0,g=(j,i)=>grid0[j][i%nuS];return mix(mix(g(j0,i0),g(j0,i0+1),bb),mix(g(j0+1,i0),g(j0+1,i0+1),bb),a);}
      const col0=Math.round(closed?u*nuS:u*(nuS-1))%nuS;
      switch(kind){
        case'skirt':return mix(hang[col0],sk.lowW(p,0.8*smooth(0.08,0.5,t)),smooth(0,0.18,t));
        case'tail':return mix(hang[col0],sk.lowW(p,0.6*smooth(0.2,0.9,t)),smooth(0,0.3,t));
        case'tabard':{if(t<=upperRows)return sk.weightsOf(sk.torso(p));const q=(t-upperRows)/(1-upperRows);return mix(hang[col0],sk.lowW(p,0.7*smooth(0.08,0.6,q)),smooth(0,0.2,q));}
        case'sash':return sk.weightsOf(sk.torso(p));
        case'sleeve':{const s_=part.side;if(part.fitted)return sk.weightsOf(sk.arm[s_](p));const s=t*part.Ls,fore=smooth(part.L1-0.07*k,part.L1+0.07*k,s),ch=0.45*(1-smooth(0,0.11*k,s));return{chest:ch,['upperarm_'+s_]:(1-fore)*(1-ch),['forearm_'+s_]:fore*(1-ch)};}
        case'cape':{const y=p[1],upper=sk.shoulders(p,0.3*(1-smooth(0.02,0.22,t))),mid=mix({spine:1},upper,smooth(waist,S[1]-0.07*k,y)),low=sk.lowW(p,0.35*smooth(J.hips[1],J.shin_l[1]*0.9,y));return mix(low,mid,smooth(waist-0.17*k,waist+0.03*k,y));}
        case'hood':return{chest:1};
        default:return sk.shoulders(p,0.25);
      }
    };
    const maxDist=t=>{switch(kind){case'skirt':return 0.14*smooth(0.12,1,t);case'tail':return 0.1*smooth(0.05,1,t);case'sleeve':return part.fitted?0:0.09*smooth(0.35,1,t);case'cape':return 0.25*smooth(0.1,1,t);case'hood':return 0.03*t;case'tabard':return 0.1*smooth(upperRows,1,t);default:return 0;}};
    const hasSoft=body.soft&&(kind==='top'||kind==='sash'||kind==='skirt'||kind==='tail'||kind==='tabard'||(kind==='sleeve'&&part.fitted));
    const softness=(p,t)=>{const f=kind==='skirt'||kind==='tail'?1-smooth(0.08,0.35,t):kind==='tabard'?1-smooth(upperRows,upperRows+0.2,t):1;if(f<=0)return[0,0,0];
      const[a,m,d]=sk.softAt((kind==='sleeve'?sk.arm[part.side]:sk.lower)(p));return[a*f,m*f,d];};

    const n=P.length,uv=[],W=[],MD=[],So=[];
    tj.forEach((t,j)=>ti.forEach((u,i)=>{const p=grid[j][i];uv.push([t,u]);W.push(weight(p,t,u));MD.push(maxDist(t));if(hasSoft)So.push(softness(p,t));}));
    const jointIndex=new Map(body.names.map((nm,i)=>[nm,i]));
    const pack=(pos,nrm,idx)=>{const o={position:new Float32Array(n*3),normal:new Float32Array(n*3),joints:new Uint16Array(n*4),weights:new Float32Array(n*4),maxDist:Float32Array.from(MD),index:Uint16Array.from(idx),soft:hasSoft?[0,1,2].map(c=>Float32Array.from(So,s=>s[c])):null};
      for(let v=0;v<n;v++){o.position.set(pos[v],v*3);o.normal.set(nrm[v],v*3);
        const e=Object.entries(W[v]).filter(e=>e[1]>1e-4&&jointIndex.has(e[0])).sort((a,b)=>b[1]-a[1]).slice(0,4),sum=e.reduce((s,x)=>s+x[1],0)||1;
        if(!e.length){o.joints[v*4]=jointIndex.get('hips');o.weights[v*4]=1;}else e.forEach(([nm,w],c)=>{o.joints[v*4+c]=jointIndex.get(nm);o.weights[v*4+c]=w/sum;});}
      return o;};
    const lining=kind==='cape'||kind==='hood',mat=trim?'trim_gold':lining?'cloth_single':'cloth_double';
    const prims=[{...pack(P,Nn,I),mat}];
    if(lining){const I2=[];for(let t=0;t<I.length;t+=3)I2.push(I[t],I[t+2],I[t+1]);
      prims.push({...pack(P.map((p,i)=>sub(p,mul(Nn[i],0.0022))),Nn.map(v=>mul(v,-1)),I2),mat});}
    const made={layout,lining,uv,prims};if(cache)cache.set(part,made);meshes.push(paint(made));
  }
  return meshes;
}

export const countTriangles=meshes=>meshes.reduce((s,m)=>s+m.prims.reduce((a,p)=>a+p.index.length/3,0),0);

export const MATERIALS={cloth_double:{doubleSided:true,metallic:0,roughness:0.88},cloth_single:{doubleSided:false,metallic:0,roughness:0.88},trim_gold:{doubleSided:true,metallic:0.65,roughness:0.42}};

// 素体の GLB に服を足して、ひとつの GLB にする
export function exportGLB(body,meshes){
  const js=JSON.parse(JSON.stringify(body.g.js)),bin=body.g.bin.subarray(0,js.buffers[0].byteLength);
  const old=new Set();js.nodes.forEach((n,i)=>{if(String(n.name||'').startsWith('cloth_')&&n.mesh!==undefined){delete n.mesh;delete n.skin;old.add(i);}});
  for(const s of js.scenes)s.nodes=(s.nodes||[]).filter(i=>!old.has(i));for(const n of js.nodes)if(n.children)n.children=n.children.filter(i=>!old.has(i));
  js.materials=js.materials||[];const matIndex={};
  for(const[name,m]of Object.entries(MATERIALS)){matIndex[name]=js.materials.length;js.materials.push({name,doubleSided:m.doubleSided,pbrMetallicRoughness:{metallicFactor:m.metallic,roughnessFactor:m.roughness}});}
  const chunks=[bin];let off=bin.length;
  const push=(arr,type,ct,target,minmax)=>{const pad=(4-off%4)%4;if(pad){chunks.push(new Uint8Array(pad));off+=pad;}const bytes=new Uint8Array(arr.buffer,arr.byteOffset,arr.byteLength);chunks.push(bytes);
    js.bufferViews.push({buffer:0,byteOffset:off,byteLength:bytes.length,target});off+=bytes.length;const n={SCALAR:1,VEC3:3,VEC4:4}[type],a={bufferView:js.bufferViews.length-1,componentType:ct,count:arr.length/n,type};
    if(minmax){a.min=[Infinity,Infinity,Infinity];a.max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<arr.length;i++){const c=i%3;a.min[c]=Math.min(a.min[c],arr[i]);a.max[c]=Math.max(a.max[c],arr[i]);}}
    js.accessors.push(a);return js.accessors.length-1;};
  for(const m of meshes){
    const primitives=m.prims.map(p=>({attributes:{POSITION:push(p.position,'VEC3',5126,34962,true),NORMAL:push(p.normal,'VEC3',5126,34962),COLOR_0:push(p.color,'VEC3',5126,34962),JOINTS_0:push(p.joints,'VEC4',5123,34962),WEIGHTS_0:push(p.weights,'VEC4',5126,34962),_MAX_DISTANCE:push(p.maxDist,'SCALAR',5126,34962),
      ...(p.soft?{_SOFTNESS:push(p.soft[0],'SCALAR',5126,34962),_MAX_OFFSET:push(p.soft[1],'SCALAR',5126,34962),_DAMPING:push(p.soft[2],'SCALAR',5126,34962)}:{})},indices:push(p.index,'SCALAR',5123,34963),material:matIndex[p.mat]}));
    js.meshes.push({name:m.name,primitives});js.nodes.push({name:m.name,mesh:js.meshes.length-1,skin:0});js.scenes[js.scene||0].nodes.push(js.nodes.length-1);
  }
  const out=new Uint8Array(off);let o=0;for(const c of chunks){out.set(c,o);o+=c.length;}
  js.buffers[0].byteLength=off;js.asset.generator='spare-body + shitateya';
  return writeGLB(js,out);
}
