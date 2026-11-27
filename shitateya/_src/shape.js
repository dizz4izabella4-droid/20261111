// 形づくりで共通に使う道具
import {add,sub,mul,len,norm,lerp,vlerp,cross,clamp,smooth,TAU} from './lib.js';

export const escapeFrom=(field,p,m=0.012)=>{let q=p.slice();const g=[0,0,0];for(let n=0;n<40;n++){const d=field.at(q[0],q[1],q[2],g);if(d>=m)break;const L=len(g);q=add(q,L>1e-6?mul(g,Math.max(0.002,m-d)/L):[0,0.003,0]);}return q;};
export const pushOut=(field,p,dir,m=0.012)=>{let q=p.slice();for(let n=0;n<200&&field.at(q[0],q[1],q[2])<m;n++)q=add(q,mul(dir,0.003));return q;};
export const spline=(pts,u)=>{const n=pts.length-1,k=Math.min(n-1,Math.floor(u*n)),t=u*n-k,p=i=>pts[clamp(i,0,n)];
  return[0,1,2].map(c=>{const a=p(k-1)[c],b=p(k)[c],d=p(k+1)[c],e=p(k+2)[c];return 0.5*(2*b+(-a+d)*t+(2*a-5*b+4*d-e)*t*t+(-a+3*b-3*d+e)*t*t*t);});};
export const tube=(path,r,n=8)=>path.map((p,j)=>{const t=norm(sub(path[Math.min(j+1,path.length-1)],path[Math.max(j-1,0)])),e1=norm(cross(t,[0.01,1,0.02])),e2=cross(t,e1);return Array.from({length:n},(_,i)=>add(p,add(mul(e1,Math.cos(i/n*TAU)*r),mul(e2,Math.sin(i/n*TAU)*r))));});
// 丸い飾り（留め具や宝石）
export const brooch=(c,nrm,k)=>{const e1=norm(cross(nrm,[0,1,0.001])),e2=cross(nrm,e1),prof=[[0.0005,0.012],[0.007,0.0115],[0.012,0.008],[0.017,0.0095],[0.021,0.005],[0.021,-0.004]];
  return prof.map(([r,off])=>Array.from({length:20},(_,i)=>add(add(c,mul(nrm,off*k)),add(mul(e1,Math.cos(i/20*TAU)*r*k),mul(e2,Math.sin(i/20*TAU)*r*k)))));};
// 横の輪のくぼみは、布が渡るように凸包でふさぐ（amount は効かせる割合）
export function bridge(row,amount){
  const pts=row.map(p=>[p[0],p[2]]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]),cr=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
  const half=s=>{const h=[];for(const q of s){while(h.length>1&&cr(h[h.length-2],h[h.length-1],q)<=0)h.pop();h.push(q);}h.pop();return h;};
  const hull=[...half(pts),...half([...pts].reverse())];
  return row.map(p=>{const r=Math.hypot(p[0],p[2]),dx=p[0]/r,dz=p[2]/r;let best=r;
    for(let e=0;e<hull.length;e++){const a=hull[e],b=hull[(e+1)%hull.length],ex=b[0]-a[0],ez=b[1]-a[1],den=dx*ez-dz*ex;if(Math.abs(den)<1e-12)continue;const t=(a[0]*ez-a[1]*ex)/den,u=(a[0]*dz-a[1]*dx)/den;if(u>=-1e-6&&u<=1+1e-6&&t>best)best=t;}
    const s=lerp(r,best,amount)/r;return[p[0]*s,p[1],p[2]*s];});
}
// 腕の中心線と、そのまわりの向き
export function armPath(J,side,k){
  const sg=side==='l'?1:-1,A=J['upperarm_'+side],E=J['forearm_'+side],H=J['hand_'+side],d1=norm(sub(E,A)),d2=norm(sub(H,E)),L1=len(sub(E,A)),L2=len(sub(H,E)),Ls=L1+L2;
  const path=s=>s<L1?{c:add(A,mul(d1,s)),t:norm(vlerp(d1,d2,smooth(L1-0.06*k,L1,s)*0.5))}:{c:add(E,mul(d2,s-L1)),t:norm(vlerp(d1,d2,0.5+smooth(L1,L1+0.06*k,s)*0.5))};
  const frame=t=>{const e2=norm(sub([0,0,1],mul(t,t[2])));let e1=norm(cross(t,e2));if(e1[0]*sg<0)e1=mul(e1,-1);return[e1,e2];};
  return{sg,L1,L2,Ls,path,frame};
}
// 裾の形。戻り値は、位置 w（0〜1 で一周）で丈を縮める割合
export const EDGE_CUT={flat:()=>0,jag:(w,n)=>0.15*Math.abs(2*(((w*n)%1+1)%1)-1),wave:(w,n)=>0.075*(0.5+0.5*Math.cos(w*n*TAU))};
