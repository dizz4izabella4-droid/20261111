// 三角形を間引く（辺をたたむ方法）。残る頂点は元の位置のままなので、骨の重みなどはそのまま使える
import {sub,add,cross,dot,len,norm} from './lib.js';

export function decimate(pos,tris,target,maxError=4e-6){
  const n=pos.length,T=tris.map(t=>t.slice()),dead=new Uint8Array(T.length),around=Array.from({length:n},()=>new Set()),Q=Array.from({length:n},()=>new Float64Array(10)),ver=new Int32Array(n),gone=new Uint8Array(n),edges=new Map();
  T.forEach((t,f)=>{const[a,b,c]=t,nr=norm(cross(sub(pos[b],pos[a]),sub(pos[c],pos[a]))),d=-dot(nr,pos[a]),[x,y,z]=nr,q=[x*x,x*y,x*z,x*d,y*y,y*z,y*d,z*z,z*d,d*d];
    for(const v of t){around[v].add(f);for(let i=0;i<10;i++)Q[v][i]+=q[i];}
    for(let e=0;e<3;e++){const u=t[e],v=t[(e+1)%3],k=Math.min(u,v)*n+Math.max(u,v);edges.set(k,(edges.get(k)||0)+1);}});
  const locked=new Uint8Array(n);for(const[k,c]of edges)if(c!==2){locked[Math.floor(k/n)]=1;locked[k%n]=1;} // 端（手袋の口）は動かさない
  const error=(u,v)=>{const[x,y,z]=pos[v],q=Q[u].map((a,i)=>a+Q[v][i]);return Math.abs(q[0]*x*x+2*q[1]*x*y+2*q[2]*x*z+2*q[3]*x+q[4]*y*y+2*q[5]*y*z+2*q[6]*y+q[7]*z*z+2*q[8]*z+q[9]);};
  // 小さい順に取り出す待ち行列
  const heap=[],push=item=>{let i=heap.push(item)-1;while(i){const p=(i-1)>>1;if(heap[p].c<=item.c)break;heap[i]=heap[p];i=p;}heap[i]=item;};
  const pop=()=>{const top=heap[0],last=heap.pop();if(heap.length){let i=0;for(;;){let c=i*2+1;if(c>=heap.length)break;if(c+1<heap.length&&heap[c+1].c<heap[c].c)c++;if(heap[c].c>=last.c)break;heap[i]=heap[c];i=c;}heap[i]=last;}return top;};
  const neighbors=v=>{const s=new Set();for(const f of around[v])for(const w of T[f])if(w!==v)s.add(w);return s;};
  const offer=(u,v)=>{if(locked[u])return;const l=len(sub(pos[u],pos[v]));push({u,v,c:error(u,v)+l*l*0.02,vu:ver[u],vv:ver[v]});};
  for(let u=0;u<n;u++)for(const v of neighbors(u))offer(u,v);
  let count=T.length;
  while(count>target&&heap.length){
    const{u,v,vu,vv}=pop();if(gone[u]||gone[v]||ver[u]!==vu||ver[v]!==vv||error(u,v)>maxError)continue;
    const shared=[...around[u]].filter(f=>T[f].includes(v));if(shared.length!==2)continue;
    const nu=neighbors(u),nv=neighbors(v);if([...nu].filter(w=>nv.has(w)).length!==2)continue; // 面がつぶれる形は避ける
    let flips=false;for(const f of around[u]){if(shared.includes(f))continue;const t=T[f],a=t.map(w=>pos[w]),b=t.map(w=>pos[w===u?v:w]),n0=cross(sub(a[1],a[0]),sub(a[2],a[0])),n1=cross(sub(b[1],b[0]),sub(b[2],b[0]));
      if(dot(norm(n0),norm(n1))<0.5||len(n1)<1e-10){flips=true;break;}}
    if(flips)continue;
    for(const f of shared){dead[f]=1;count--;for(const w of T[f])around[w].delete(f);}
    for(const f of around[u]){T[f]=T[f].map(w=>w===u?v:w);around[v].add(f);}
    around[u].clear();gone[u]=1;for(let i=0;i<10;i++)Q[v][i]+=Q[u][i];ver[v]++;
    for(const w of neighbors(v)){offer(v,w);offer(w,v);}
  }
  return T.filter((_,f)=>!dead[f]);
}
