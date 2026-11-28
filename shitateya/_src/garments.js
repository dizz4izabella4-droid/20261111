// 型と素体から、服の形を作る。寸法は素体の骨と表面から決める
import {add,sub,mul,len,norm,lerp,vlerp,cross,dot,clamp,smooth,TAU,ringLen,Field,simulate,gridTris} from './lib.js';
import {escapeFrom,pushOut,spline,tube,brooch,bridge,armPath,EDGE_CUT} from './shape.js';
import {extraRunners} from './extras.js';

export const QUALITY={
  draft:{label:'下書き',cell:0.009,nu:64,skirtV:30,tail:[5,20],sleeve:[28,26],cape:[34,32],tabard:[12,28],pants:[44,40],foot:28,hat:48,hood:37,veil:[22,26],frames:0.55,sub:0.7},
  fine:{label:'仕上げ',cell:0.0065,nu:96,skirtV:40,tail:[6,26],sleeve:[40,34],cape:[48,44],tabard:[18,38],pants:[60,56],foot:40,hat:72,hood:49,veil:[32,34],frames:1,sub:1},
};
export const STEP_LABEL={top:'上衣',pants:'ズボン',shoes:'靴',skirt:'スカート',vest:'胴着',tabard:'前掛け',sash:'帯',bracer:'腕当て',sleeve:'袖',cape:'マント',hood:'フード',hat:'帽子',glove:'手袋',layers:'重ね着の調整'};

function emptyField(body,Q){
  const k=body.H/1.533,half=Math.max(0.75*k,body.xmax+0.3);
  return new Field([-half,-0.04,-0.88*k],[half,body.H+0.07,0.62*k],Q.cell,Math.max(0.036,Q.cell*5));
}
// 素体の測定を小分けにする版。step(0〜1) で進み具合を知らせ、そのたびに一息入れる
export async function makeContextAsync(body,quality,step){
  const field=emptyField(body,QUALITY[quality]),T=body.tris,parts=24;
  for(let n=0;n<parts;n++){await step(n/(parts+2));field.splat(T.slice(Math.floor(T.length*n/parts),Math.floor(T.length*(n+1)/parts)),0);}
  await step(parts/(parts+2));field.signSolid(T);await step((parts+1)/(parts+2));
  return makeContext(body,quality,field);
}
export function makeContext(body,quality,measured){
  const Q=QUALITY[quality],J=body.J,k=body.H/1.533;
  let field=measured;if(!field){field=emptyField(body,Q);field.addSolid(body.tris);}
  const bodyOnly=field.clone();
  const waist=J.spine[1]-0.007*k, neckY=J.neck[1], S=J.upperarm_l, z0=J.neck[2];
  const march=(o,d,ease,max=0.35)=>{let r=0.01;while(r<max&&bodyOnly.at(o[0]+d[0]*r,o[1]+d[1]*r,o[2]+d[2]*r)<ease)r+=0.0015;return r;};
  const neckR=march([0,neckY+0.025*k,z0],[1,0,0],0,0.12), neckD=march([0,neckY+0.025*k,z0],[0,0,1],0,0.12);
  // 頭・足・股の寸法
  const box=test=>{const mn=[Infinity,Infinity,Infinity],mx=[-Infinity,-Infinity,-Infinity];for(let i=0;i<body.count;i++)if(test(body.dom[i]))for(let c=0;c<3;c++){const v=body.P[i*3+c];mn[c]=Math.min(mn[c],v);mx[c]=Math.max(mx[c],v);}return Number.isFinite(mn[0])?{mn,mx}:null;};
  const hb=box(n=>n==='head')||{mn:[-0.068*k,J.head[1],-0.095*k],mx:[0.068*k,body.H,0.075*k]};
  const head={hx:Math.max(-hb.mn[0],hb.mx[0]),hz:(hb.mx[2]-hb.mn[2])/2,zc:(hb.mx[2]+hb.mn[2])/2,top:hb.mx[1]};
  const feet={};for(const s of['l','r']){const b=box(n=>n==='foot_'+s||n==='toe_'+s)||{mn:[0,0,J['foot_'+s][2]-0.055*k],mx:[0,0,J['foot_'+s][2]+0.165*k]};feet[s]={zmin:b.mn[2],zmax:b.mx[2]};}
  let crotch=J.hips[1];while(crotch>J.hips[1]-0.2*k&&bodyOnly.at(0,crotch,J.hips[2])<0)crotch-=0.002;
  return{body,J,k,Q,quality,field,bodyOnly,waist,neckY,S,z0,neckR,neckD,march,head,feet,crotch};
}

// 服を作る順番と、各工程の形に関わる設定（これが同じなら作り直さない）
export function plan(design){
  const d=design,steps=[],push=(id,key=d[id])=>steps.push({id,key}),up=d.cape.on&&d.hood.on&&d.hood.pose==='up';
  push('top');
  if(d.pants.on)push('pants',{...d.pants,under:d.skirt.on});
  if(d.shoes.on)push('shoes');
  if(d.skirt.on)push('skirt');
  if(d.vest.on)push('vest');
  if(d.tabard.on)push('tabard');
  if(d.sash.on)push('sash');
  if(d.bracer.on)push('bracer',{...d.bracer,sleeve:d.sleeve.type});
  if(d.sleeve.type!=='none')push('sleeve');
  if(d.cape.on)push('cape');
  if(d.cape.on&&d.hood.on)push('hood');
  if(d.hat.on&&!(up&&d.hat.type!=='circlet'))push('hat'); // かぶったフードと帽子は重ねない
  if(d.glove.on)push('glove');
  let chain='';for(const s of steps){chain+=s.id+JSON.stringify(s.key)+';';s.hash=chain;}
  return steps;
}

// inner（内側の服）のうち、outer（外側の服）より表へ出た頂点を内側へ戻す。rim は外側の服の端から何列を対象外にするか
function tuckUnder(inner,cape,rim=1.5){
  const NV=cape.length,NU=cape[0].length,samples=[];
  const at=(fj,fi)=>{const j=Math.min(NV-2,Math.floor(fj)),i=Math.min(NU-2,Math.floor(fi));return vlerp(vlerp(cape[j][i],cape[j][i+1],fi-i),vlerp(cape[j+1][i],cape[j+1][i+1],fi-i),fj-j);};
  for(let fj=0;fj<=NV-1;fj+=0.5)for(let fi=0;fi<=NU-1;fi+=0.5){const p=at(fj,fi);let n=norm(cross(sub(at(fj,Math.min(NU-1,fi+0.5)),at(fj,Math.max(0,fi-0.5))),sub(at(Math.min(NV-1,fj+0.5),fi),at(Math.max(0,fj-0.5),fi))));
    if(dot(n,[p[0],0.15,p[2]])<0)n=mul(n,-1);samples.push({p,n,edge:fi<rim||fi>NU-1-rim||fj>NV-rim});}
  const moved=[],out=inner.map((row,j)=>row.map((v,i)=>{if(j<2)return v;let best=0.11**2,hit=null;
    for(const c of samples){const d=(c.p[0]-v[0])**2+(c.p[1]-v[1])**2+(c.p[2]-v[2])**2;if(d<best){best=d;hit=c;}}
    if(!hit||hit.edge)return v;const h=dot(sub(v,hit.p),hit.n);if(h<=-0.01)return v;moved.push([j,i]);return sub(v,mul(hit.n,h+0.01));}));
  for(let it=0;it<2;it++)for(const[j,i]of moved){if(j>=out.length-1)continue;const n=out[j].length,avg=mul([out[j-1][i],out[j+1][i],out[j][(i+1)%n],out[j][(i+n-1)%n]].reduce(add,[0,0,0]),0.25);out[j][i]=vlerp(out[j][i],avg,0.35);}
  return out;
}

function makeRunner(ctx,results,tick){
  const{field,bodyOnly,J,k,Q,waist,neckY,S,z0}=ctx;
  const sim=(gr,o,frac=[0,1])=>simulate(field,gr,{...o,frames:Math.round(o.frames*Q.frames),sub:Math.max(10,Math.round(o.sub*Q.sub))},f=>tick(frac[0]+f*(frac[1]-frac[0])));
  return{
    ...extraRunners(ctx,results),
    top(d){ // 身頃：素体の表面から少し離して作る
      const NU=Q.nu,NV=Math.round(NU/4),O0=lerp(waist,neckY,0.47),ease=d.ease,rows=[];
      const high=d.neck==='high',square=d.neck==='square',bare=d.neck==='strapless',wide=d.neck==='wide'||square;
      const a=high?ctx.neckR+0.012*k:ctx.neckR*(wide?2.7:1.62),b=high?ctx.neckD+0.012*k:ctx.neckD*(wide?1.6:1.38);
      const ySide=high?neckY+0.022*k:neckY-(wide?0.032:0.016)*k;
      // 肩出し：胸の上で一周するふち
      const edgeY=th=>S[1]-0.052*k-d.depth*k*0.3*Math.pow(Math.max(0,Math.cos(th)),10)+0.006*k*Math.pow(Math.max(0,Math.cos(th*1)),2)*Math.pow(Math.sin(th*3),2);
      const neckline=th=>{const w=Math.atan2(Math.sin(th),Math.cos(th));let dip=0;
        if(square){dip=d.depth*k*clamp((1.0-Math.abs(w))/0.22,0,1);const s=Math.sin(th),c=Math.cos(th),n=1/Math.pow(Math.pow(Math.abs(s),4)+Math.pow(Math.abs(c),4),0.25);return[a*s*n*0.93,ySide-dip,z0-0.002*k+b*c*n*0.93];}
        if(d.neck==='v')dip=d.depth*k*Math.max(0,1-Math.abs(w)/0.95);else if(!high)dip=d.depth*k*Math.pow(Math.max(0,Math.cos(th)),3);else dip=d.depth*k*0.5*Math.pow(Math.max(0,Math.cos(th)),6);
        return[a*Math.sin(th),ySide-dip,z0-0.002*k+b*Math.cos(th)];};
      for(let j=0;j<NV;j++){const v=j/(NV-1),row=[];
        for(let i=0;i<NU;i++){const th=i/NU*TAU,hd=[Math.sin(th),0,Math.cos(th)],neck=bare?null:neckline(th);
          let o,dir;if(bare){o=[0,lerp(edgeY(th),waist,v),0];dir=hd;}else if(v<0.5){o=[0,O0,0];const t=v/0.5;dir=norm(vlerp(norm(sub(neck,o)),hd,Math.pow(t,1.15)));}else{o=[0,lerp(O0,waist,(v-0.5)/0.5),0];dir=hd;}
          let p=add(o,mul(dir,ctx.march(o,dir,ease,0.35*k)));
          const lim=lerp(S[0]*0.855,S[0]*1.05,smooth(S[1]-0.115*k,S[1]-0.033*k,p[1]));if(Math.abs(p[0])>lim){const s=lim/Math.abs(p[0]);p=[p[0]*s,p[1],p[2]*(0.35+0.65*s)];}
          row.push(p);}
        rows.push(row);}
      for(let j=bare?0:1;j<NV;j++)rows[j]=bridge(rows[j],bare?smooth(-0.3,0.2,j/(NV-1)):smooth(0.08,0.35,j/(NV-1))); // 胸の谷間などのくぼみは、布が渡るようにふさぐ
      for(let it=0;it<5;it++){const src=rows.map(r=>r.map(p=>p.slice()));
        for(let j=1;j<NV-1;j++)for(let i=0;i<NU;i++){let p=[0,0,0];for(const q of[src[j-1][i],src[j+1][i],src[j][(i+1)%NU],src[j][(i+NU-1)%NU]])p=add(p,mul(q,0.25));p=vlerp(src[j][i],p,0.6);
          const g=[0,0,0],dd=bodyOnly.at(p[0],p[1],p[2],g),min=ease-0.0007;if(dd<min)p=add(p,mul(norm(g),min-dd));rows[j][i]=p;}}
      results.waistRing=rows[NV-1];results.top=rows;results.neckFront=bare?[0,edgeY(0),rows[0][0][2]]:neckline(0);
      return{parts:[{name:'cloth_top',kind:'top',pos:rows,closed:true,length:(neckY-waist)}],layers:[{pos:rows,closed:true,thick:0.003}]};
    },
    skirt(d){
      const waistRing=results.waistRing,NU=waistRing.length,NV=Q.skirtV,L=(waist-0.04*k)*d.length,wc=ringLen(waistRing,true),shape=d.shape,open=shape==='open',straight=shape==='straight',tiered=shape==='tiered';
      let hip=0;for(const t of[0.2,0.5,0.8]){const y=lerp(waist,J.hips[1]-0.06*k,t);for(const th of[0,Math.PI/2,Math.PI,-Math.PI/2])hip=Math.max(hip,ctx.march([0,y,0],[Math.sin(th),0,Math.cos(th)],0,0.28*k));}
      const rHip=hip+0.033*k;
      const HEM=straight?TAU*rHip*1.1:clamp(d.hem*k,wc*1.35,wc+TAU*L*0.6),N=tiered?Math.max(14,d.pleats):d.pleats;
      const rHem=Math.max(rHip,HEM/TAU*0.8),pos=[],h=[],v=[];
      const around=t=>{if(tiered){const at=n=>Math.max(HEM*[0.5,0.73,1][n],wc*1.2),f=t*3,n=Math.min(2,Math.floor(f)),c=n?lerp(at(n-1),at(n),smooth(0,0.22,f-n)):at(0);return lerp(wc,c,smooth(0,0.22,t));}
        return lerp(wc,HEM,Math.pow(t,0.8));};
      // 列ごとの丈
      const cut=EDGE_CUT[d.edge==='back'?'flat':d.edge],teeth=d.edge==='wave'?9:Q.nu>80?12:10;
      const step=(j,i)=>{const t=j/(NV-1),th=i/NU*TAU,col=d.edge==='back'?0.58+0.42*(1-Math.cos(th))/2:1,c=cut(i/NU,teeth);return L/(NV-1)*col*(t>0.68?1-c/0.32:1);};
      const drop=new Array(NU).fill(0);
      for(let j=0;j<NV;j++){const t=j/(NV-1),C=around(t),s=smooth(0,0.3,t);
        if(j)for(let i=0;i<NU;i++)drop[i]+=step(j,i);
        const y=waist-(drop.reduce((a,b)=>a+b,0)/NU)*0.98;
        const Rm=Math.min(lerp(rHip,rHem,t),Math.max(C/TAU,rHip*0.8));
        const ring=amp=>waistRing.map((w,i)=>{const th=i/NU*TAU,rw=Math.hypot(w[0],w[2]),r=lerp(rw,Rm*(1+amp*s*Math.sin(N*th+0.6)),s);return[r*Math.sin(th),waist-drop[i]*0.98,r*Math.cos(th)*lerp(1,0.94,s)];});
        let lo=0,hi=N?0.3:0;for(let n=0;n<26&&N;n++){const m=(lo+hi)/2;if(ringLen(ring(m).map(p=>[p[0],y,p[2]]),true)<C)lo=m;else hi=m;}
        pos.push(j===0?waistRing.map(p=>p.slice()):ring(lo).map(p=>pushOut(field,p,norm([p[0],0,p[2]]))));
        h.push(waistRing.map((w,i)=>lerp(len(sub(waistRing[(i+1)%NU],w)),C/NU,smooth(0,0.18,t))));v.push(waistRing.map((_,i)=>step(Math.min(NV-1,j+1),i)));}
      if(straight){ // まっすぐな形は布の計算を使わず、体のいちばん外側に沿わせて下ろす
        const flare=(d.hem-1.1)/3.4*0.13*k,pleat=Math.min(N,18)?0.0022*k:0;let prev=waistRing.map(p=>Math.hypot(p[0],p[2]));
        for(let j=1;j<NV;j++){const t=j/(NV-1);
          let row=pos[j].map((p,i)=>{const th=i/NU*TAU,dir=[Math.sin(th),Math.cos(th)];let r=k/Math.hypot(dir[0]/(p[1]>0.56*k?0.176:0.3),dir[1]/0.3); // 外から探すが、腕と手は拾わない範囲にする
           while(r>0.02&&field.at(dir[0]*r,p[1],dir[1]*r)>0.013)r-=0.002;return[dir[0]*r,p[1],dir[1]*r];});
          row=bridge(row,1);
          const rad=row.map(p=>Math.hypot(p[0],p[2])),even=rad.map((r,i)=>Math.max(r,(rad[(i+NU-2)%NU]+rad[(i+NU-1)%NU]+r+rad[(i+1)%NU]+rad[(i+2)%NU])/5));
          const next=even.map((r,i)=>Math.max(r,waist-row[i][1]>0.17*k?prev[i]-0.11*(L/(NV-1)):0));prev=next; // 腰より下は、ゆるくすぼめる
          pos[j]=row.map((p,i)=>{const th=i/NU*TAU,r=next[i]+flare*smooth(0.25,1,t)+pleat*smooth(0.15,0.6,t)*(1+Math.sin(N*th+0.6));return[Math.sin(th)*r,p[1],Math.cos(th)*r];});}
        for(let it=0;it<3;it++){const src=pos.map(r=>r.map(p=>p.slice()));for(let j=1;j<NV-1;j++)pos[j]=src[j].map((p,i)=>{const q=vlerp(p,mul(add(src[j-1][i],src[j+1][i]),0.5),0.5);return Math.hypot(q[0],q[2])>Math.hypot(p[0],p[2])?[q[0],p[1],q[2]]:p;});}
        const part={name:'cloth_skirt',kind:'skirt',pos,closed:true,length:L,tiers:null,open:false,width:HEM*0.6};results.skirt=part;
        const under=(results.pants||[]).map(q=>({...q,pos:tuckUnder(q.pos,pos,0)})); // ズボンは内側へ収める
        return{parts:[part,...under],layers:[{pos,closed:true,thick:0.004}]};
      }
      // 前開きは、正面の列を除く
      const gap=open?Math.round(NU*0.09):0,pickCols=r=>open?r.slice(gap,NU-gap+1):r;
      const P=pos.map(pickCols),n=P[0].length;
      const out=sim({nu:n,nv:NV,closed:!open,pos:P,h:h.map(pickCols),v:v.map(pickCols),pinned:j=>j===0},{stretch:2e-8,shear:3e-5,bend:6e-3,mass:0.6*Math.max(0.75,d.length*HEM/(3*k))*n/NU,frames:220,sub:20,margin:0.006});
      if(open)out.forEach((row,j)=>{ // 前の開きが裾へ向かって広がるように、向きをそろえる
        // 角度は隣の列から続けて数える。正面を越えた端が反対側へ回り込むと、開きをふさぐ面ができる
        const t=j/(NV-1),G=lerp(gap/NU*TAU,0.62,smooth(0,0.75,t)),a=[];
        for(const p of row){let v=Math.atan2(p[0],p[2]);if(a.length)v+=TAU*Math.round((a[a.length-1]-v)/TAU);else if(v<-Math.PI/2)v+=TAU;a.push(v);}
        const a0=a[0],a1=a[a.length-1];
        if(j&&a1-a0>1)out[j]=row.map((p,i)=>{const b=G+(a[i]-a0)*(TAU-2*G)/(a1-a0),r=Math.hypot(p[0],p[2]);return[r*Math.sin(b),p[1],r*Math.cos(b)];});});
      const part={name:'cloth_skirt',kind:'skirt',pos:out,closed:!open,length:L,tiers:tiered?[1/3,2/3]:null,open,width:HEM*0.6};results.skirt=part;
      return{parts:[part],layers:[{pos:out,closed:!open,thick:0.004}]};
    },
    tabard(d){ // 前掛け：上半身は体の前（後ろ）に沿わせ、腰から下は垂らす
      const[NU,NV]=Q.tabard,parts=[],layers=[],sides=d.back?[1,-1]:[1];
      const yTop=Math.min(results.neckFront[1]-0.012*k,S[1]-0.02*k),L=(waist-0.05*k)*d.length,NA=Math.max(6,Math.round(NV*0.34)),w=d.width*k;
      sides.forEach(side=>{
        const top=side>0?yTop:Math.min(S[1]+0.015*k,neckY-0.05*k),pos=[];
        for(let j=0;j<NA;j++){const t=j/(NA-1),y=lerp(top,waist,t),wj=w*lerp(0.82,0.96,t);
          pos.push(Array.from({length:NU},(_,i)=>{const x=(i/(NU-1)-0.5)*wj;let z=side*0.4*k;while(z*side>0&&field.at(x,y,z)>0.0055)z-=side*0.0015;return[x,y,z];}));}
        for(let it=0;it<4;it++)for(const r of pos){const src=r.map(p=>p[2]);r.forEach((p,i)=>{if(i>0&&i<NU-1){const a=(src[i-1]+src[i+1])/2;if((a-src[i])*side>0)p[2]=a;}});}
        // 腰から下は、下にある布や体のいちばん外側に沿って真っすぐ垂らす（布の計算より安定する）
        const need=pos.slice();
        for(let j=NA;j<NV;j++){const t=(j-NA+1)/(NV-NA),wj=w*lerp(0.96,1.3,t),prev=pos[j-1];
          pos.push(Array.from({length:NU},(_,i)=>{const x=(i/(NU-1)-0.5)*wj,y=waist-L*t*0.96,min=prev[i][2]*side;let z=0.75*k;while(z>min&&field.at(x,y,side*z)>0.013)z-=0.0015;return[x,y,side*Math.max(z,min)];}));}
        for(let j=NA;j<NV;j++)need[j]=pos[j].map(p=>p.slice());
        for(let it=0;it<14;it++){const src=pos.map(r=>r.map(p=>p[2]*side));
          for(let j=NA;j<NV;j++)for(let i=0;i<NU;i++){const up=src[j-1][i],down=j+1<NV?src[j+1][i]:2*src[j][i]-src[j-1][i],l=src[j][Math.max(0,i-1)],r=src[j][Math.min(NU-1,i+1)];
            pos[j][i][2]=side*Math.max(need[j][i][2]*side,(up+down+l+r)/4);}}
        const out=pos.map((r,j)=>r.map((p,i)=>j<NA?p:[p[0],p[1],p[2]+side*0.004*smooth(0,0.5,(j-NA)/(NV-NA))*(1+Math.sin(i/(NU-1)*TAU*1.5))]));
        parts.push({name:'cloth_tabard_'+(side>0?'front':'back'),kind:'tabard',pos:out,closed:false,length:(top-waist)+L,upper:(top-waist)/((top-waist)+L),side});layers.push({pos:out,closed:false,thick:0.003});
      });
      if(results.skirt){let pos=results.skirt.pos;for(const l of layers)pos=tuckUnder(pos,l.pos,0.6);parts.push({...results.skirt,pos});} // 前掛けから突き出たスカートは内側へ戻す
      return{parts,layers};
    },
    sash(d){
      const NU=Q.nu,NV=7,width=d.width*k,band=[],parts=[],layers=[];
      for(let j=0;j<NV;j++){const t=j/(NV-1),y=lerp(waist+width*0.55,waist-width*0.45,t),row=[];
        for(let i=0;i<NU;i++){const th=i/NU*TAU,dir=[Math.sin(th),0,Math.cos(th)];let r=S[0];while(r>0.03&&field.at(r*dir[0],y,r*dir[2])>0.004)r-=0.001;row.push([r,y,th]);}band.push(row);}
      for(let it=0;it<12;it++)for(const row of band){const s=row.map(q=>q[0]);row.forEach((q,i)=>q[0]=Math.max(s[i],(s[(i+1)%NU]+s[(i+NU-1)%NU])/2));}
      for(let i=0;i<NU;i++){const m=Math.max(...band.map(r=>r[i][0]));band.forEach((r,j)=>r[i][0]=lerp(r[i][0],m,0.35)+0.002+(j===0||j===NV-1?0:0.0022*Math.sin(j*2.1)));}
      const bp=band.map(r=>r.map(([r_,y,th])=>[r_*Math.sin(th),y+0.004*k*Math.sin(th*2),r_*Math.cos(th)]));
      field.splat(gridTris(bp,true),0.003);parts.push({name:'cloth_sash',kind:'sash',pos:bp,closed:true,length:width});layers.push({pos:bp,closed:true,thick:0.003});
      const tails=[[0.59,1,0.062,0.010],[0.98,0.8,0.055,0.018],[-0.75,0.9,0.05,0.012]].slice(0,d.tails);
      tails.forEach(([angle,lf,wd,out],n)=>{const[NUt,NVt]=Q.tail,idx=((Math.round(angle/TAU*NU)%NU)+NU)%NU,base=bp[NV-2][idx],th=idx/NU*TAU,dir=[Math.sin(th),0,Math.cos(th)],side=[Math.cos(th),0,-Math.sin(th)],L=d.tail*k*lf,wid=wd*k;
        const pos=[],h=[],v=[];for(let j=0;j<NVt;j++){const t=j/(NVt-1);pos.push([]);h.push([]);v.push([]);
          for(let i=0;i<NUt;i++){const u=i/(NUt-1)-0.5,w=wid*lerp(0.7,1.25,t),p=add(add(base,mul(side,u*w)),add(mul(dir,out+0.18*t*L),[0,-L*t*0.95,0]));
            pos[j].push(j<2?add(add(base,mul(side,u*w)),add(mul(dir,0.008+out*0.3*j),[0,-L*t,0])):pushOut(field,p,dir));h[j].push(w/(NUt-1));v[j].push(L/(NVt-1));}}
        const res=sim({nu:NUt,nv:NVt,closed:false,pos,h,v,pinned:j=>j<2},{stretch:2e-8,shear:1e-5,bend:4e-3,mass:0.05,frames:160,sub:20,margin:0.005},[n/tails.length,(n+1)/tails.length]);
        field.splat(gridTris(res,false),0.003);parts.push({name:'cloth_sash_tail_'+(n+1),kind:'tail',pos:res,closed:false,length:L,waistIndex:idx});layers.push({pos:res,closed:false,thick:0.003});});
      return{parts,layers,splatted:true};
    },
    sleeve(d){
      const puff=d.type==='puff',bishop=d.type==='bishop',fitType=d.type==='fit'||puff,[NUs,NVq]=Q.sleeve,NV=puff?NVq:fitType?Math.max(14,Math.round(NVq*0.75)):NVq,parts=[],layers=[];
      const full=clamp((d.cuff-0.25)/0.95,0,1); // ふくらみの大きさ
      [['l',1],['r',-1]].forEach(([side,sg],n)=>{
        const{L1,Ls,path,frame}=armPath(J,side,k);
        const armR=s=>{const{c,t}=path(s),[e1,e2]=frame(t),rs=[];for(const a of[-1.2,-0.6,0,0.6,1.2,1.57,-1.57]){const dir=add(mul(e1,Math.cos(a)),mul(e2,Math.sin(a)));let r=0.005;while(r<0.09*k&&bodyOnly.at(...add(c,mul(dir,r)))<0)r+=0.001;rs.push(r);}rs.sort((a,b)=>a-b);return rs[rs.length>>1];};
        const end=Math.min(Ls*d.length,Ls)+0.012*k,s0=a=>(-0.012+0.062*Math.pow((1-Math.cos(a))/2,1.5))*k,spacing=(end+0.012*k)/(NV-1);
        const FIT=clamp(Math.round(0.065*k/spacing)+1,3,Math.floor(NV/2));
        const longDir=i=>{const a=i/NUs*TAU,w=Math.max(0,Math.cos(a-4.15));return fitType||bishop?0:w*w*w;};
        const drape=fitType||bishop?0:d.drape*k*smooth(0.45,0.9,d.length);
        const cuff=Math.max(d.cuff*k,0.2*k),mid=Math.max(0.34*k*(0.4+0.6*d.length),0.2*k);
        const pos=[],h=[],v=[],cache=new Map(),ar=s=>{const key=Math.round(s*200);if(!cache.has(key))cache.set(key,armR(s));return cache.get(key);};
        for(let j=0;j<NV;j++){const t=j/(NV-1);pos.push([]);h.push([]);v.push([]);
          for(let i=0;i<NUs;i++){const a=i/NUs*TAU,s=lerp(s0(a),end+drape*longDir(i)*smooth(0.55,1,t),t),sArm=Math.min(s,Ls+0.03*k),{c,t:tg}=path(sArm),[e1,e2]=frame(tg);
            const ra=ar(clamp(s,0,Ls-0.02*k)),fit=ra+0.0095,C0=TAU*fit;
            let C=C0;if(bishop){const wide=Math.max(C0*1.35,(0.24+0.26*full)*k);C=lerp(C0,wide,smooth(0.05,0.55,t)*(1-smooth(0.86,0.98,t)));}else if(!fitType)C=lerp(C0,Math.max(C0,mid),smooth(0.14,0.45,t))+Math.max(0,cuff-Math.max(C0,mid))*Math.pow(smooth(0.45,1,t),1.4);
            const R=Math.max(C/TAU,fitType?0:fit*0.9),dir=add(mul(e1,Math.cos(a)),mul(e2,Math.sin(a))),sh=bishop?0:smooth(0.15,0.5,t),off=add(mul(e1,(R-fit)*0.45*sh),[0,-(R-fit)*0.45*sh,-(R-fit)*0.15*sh]);
            const atCuff=bishop&&j>=NV-3;
            let rr=R;if(fitType||j<FIT+3||atCuff){let q=0.004;const ease=fitType?0.0068+0.002*smooth(0.9,1,t):0.0095;while(q<ra+0.032*k&&bodyOnly.at(...add(c,mul(dir,q)))<ease)q+=0.001;rr=fitType||atCuff?q:j<FIT?Math.max(q,fit*0.9):Math.max(R,lerp(q,R,(j-FIT+1)/4));}
            if(puff){const zone=Math.min(end,0.36*Ls),f=clamp((s-s0(a))/(zone-s0(a)),0,1),inner=Math.max(0,-dot(dir,e1));
              rr+=lerp(0.014,0.055,full)*k*Math.pow(Math.max(0,Math.sin(Math.PI*f)),0.55)*(1+0.13*Math.sin(a*13))*(1-0.65*inner);}
            let p=add(add(c,fitType?[0,0,0]:off),mul(dir,rr));if(s>sArm)p=add(p,[0,-(s-sArm),0]);
            if(!fitType&&!atCuff&&j>=FIT)p=escapeFrom(field,p,0.012);
            pos[j].push(p);h[j].push(Math.max(C,TAU*0.025)/NUs);}}
        for(let j=0;j<NV;j++)for(let i=0;i<NUs;i++){const a=i/NUs*TAU;v[j].push((end-s0(a)+drape*longDir(i))*(bishop?1.09:1)/(NV-1));}
        for(let j=0;j<NV;j++)if(j<FIT||bishop&&j>=NV-3)pos[j].forEach((p,i)=>h[j][i]=len(sub(pos[j][(i+1)%NUs],p)));
        let res=pos;
        if(!fitType)res=sim({nu:NUs,nv:NV,closed:true,pos,h,v,pinned:j=>j<FIT||bishop&&j>=NV-3},{stretch:2e-8,shear:2e-5,bend:1.2e-3,mass:bishop?0.1:0.16,frames:bishop?170:220,sub:24,margin:0.006},[n/2,(n+1)/2]);
        for(let it=0;it<(puff?1:fitType?2:3);it++){const src=res.map(r=>r.slice());for(let j=fitType?1:FIT-1;j<(bishop?NV-3:NV-1);j++)for(let i=0;i<NUs;i++){const sum=[src[j-1][i],src[j+1][i],src[j][(i+1)%NUs],src[j][(i+NUs-1)%NUs]].reduce(add,[0,0,0]),q=vlerp(src[j][i],mul(sum,0.25),0.55);
          if(fitType){const g=[0,0,0],dd=bodyOnly.at(q[0],q[1],q[2],g);res[j][i]=dd<0.006&&Math.abs(q[0])>S[0]*1.05?add(q,mul(norm(g),0.006-dd)):q;}else res[j][i]=j<FIT?q:escapeFrom(field,q,0.0055);}}
        parts.push({name:'cloth_sleeve_'+side,kind:'sleeve',side,pos:res,closed:true,length:end,L1,Ls,fitted:fitType,type:d.type});layers.push({pos:res,closed:true,thick:fitType?0.008:0.009});
        if(n===0){field.splat(gridTris(res,true),layers[0].thick);}
      });
      field.splat(gridTris(layers[1].pos,true),layers[1].thick);
      results.sleeves=parts;
      return{parts,layers,splatted:true};
    },
    cape(d){
      const[NUc,NV]=Q.cape,fx=S[0]/0.158;
      if(!results.sleeves)field.splat(ctx.body.tris.filter(t=>t.every(q=>Math.abs(q[0])>S[0]*1.05&&q[1]<S[1])),0.012); // 袖がないときは腕を少し太らせて、布が抜けないようにする
      const ctrl=[[0.128,0.050],[0.142,0.000],[0.118,-0.048],[0.062,-0.080],[0,-0.090],[-0.062,-0.080],[-0.118,-0.048],[-0.142,0.000],[-0.128,0.050]].map(([x,z])=>[x*fx,0,z*k]);
      const drop=(x,z)=>{let y=neckY+0.017*k;while(y>S[1]-0.2*k&&field.at(x,y,z)>0.011)y-=0.001;return[x,y,z];};
      let pins=Array.from({length:NUc},(_,i)=>{const p=spline(ctrl,i/(NUc-1));return drop(p[0],p[2]);});
      for(let it=0;it<4;it++)pins=pins.map((p,i)=>i===0||i===NUc-1?p:[p[0],Math.max(p[1],(pins[i-1][1]+pins[i+1][1])/2),p[2]]);
      const L=(pins[NUc>>1][1]-0.04*k)*d.length,w0=ringLen(pins,false),W1=Math.min(d.width*k,w0+TAU*L*0.42),shortness=clamp(d.length/0.7,0.45,1),pos=[],h=[],v=[],flare=clamp(d.width/1.75,0.5,1.3),drop_=new Array(NUc).fill(0);
      // 最初の置き場所は、袖やスカートよりも外側にする（内側から始めると突き抜ける）
      const outside=p=>{const r0=Math.hypot(p[0],p[2])||1e-6,dx=p[0]/r0,dz=p[2]/r0;let r=0.74*k;while(r>r0&&field.at(dx*r,p[1],dz*r)>0.017)r-=0.002;r=Math.max(r,r0);return escapeFrom(field,[dx*r,p[1],dz*r],0.014);};
      for(let j=0;j<NV;j++){const t=j/(NV-1),W=lerp(w0,Math.max(W1,w0*1.1),Math.pow(t,0.85));
        const ring=m=>pins.map((P,i)=>{const u=i/(NUc-1),b=lerp(95,265,u)*Math.PI/180,dir=[Math.sin(b),0,Math.cos(b)],r=m*(1+0.07*smooth(0.1,0.5,t)*Math.sin(u*TAU*7));return add(P,add(mul(dir,r),[0,-t*L*0.82,0]));});
        let lo=0,hi=1.4*k;for(let n=0;n<26;n++){const m=(lo+hi)/2;if(ringLen(ring(m),false)<W)lo=m;else hi=m;}
        // 裾の形に合わせて、列ごとの丈を変える
        const stepAt=(jj,i)=>{const u=i/(NUc-1),tt=jj/(NV-1),col=d.edge==='point'?0.7+0.3*(1-Math.abs(2*u-1)):1,c=d.edge==='jag'||d.edge==='wave'?EDGE_CUT[d.edge](u+(d.edge==='jag'?0:0),d.edge==='jag'?8:7):0;return L/(NV-1)*col*(tt>0.68?1-c/0.32:1);};
        if(j)for(let i=0;i<NUc;i++)drop_[i]+=stepAt(j,i);
        pos.push(j===0?pins.map(p=>p.slice()):ring(Math.max(lo,0.34*k*flare*shortness*Math.sqrt(t))).map((p,i)=>[p[0],pins[i][1]-drop_[i]*0.82,p[2]]).map(j<2?p=>escapeFrom(field,p,0.014):outside));
        h.push(pins.map((p,i)=>i+1<NUc?lerp(len(sub(pins[i+1],p)),W/(NUc-1),smooth(0,0.25,t)):0));v.push(pins.map((_,i)=>stepAt(Math.min(NV-1,j+1),i)));}
      const out=sim({nu:NUc,nv:NV,closed:false,pos,h,v,pinned:j=>j===0},{stretch:2e-8,shear:3e-5,bend:1e-2,mass:0.9*d.length*flare,frames:300,sub:20,margin:0.0075,vmax:0.9});
      results.cape=out;
      const parts=[{name:'cloth_cape',kind:'cape',pos:out,closed:false,length:L,width:W1}];
      field.splat(gridTris(out,false),0.005);
      parts.push({name:'cloth_cape_collar',kind:'trim',pos:tube(pins,0.0065*k),closed:true});
      if(d.clasp){const a=pins[0],b=pins[NUc-1];
        const chain=Array.from({length:33},(_,n)=>{const t=n/32,p=vlerp(a,b,t);p[1]-=0.045*k*Math.sin(Math.PI*t);let z=0.34*k;while(z>0&&field.at(p[0],p[1],z)>0.007)z-=0.001;return[p[0],p[1],Math.max(z,p[2])];});
        chain[0]=a;chain[32]=b;for(let it=0;it<3;it++)for(let n=1;n<32;n++)chain[n][2]=Math.max(chain[n][2],(chain[n-1][2]+chain[n+1][2])/2);
        parts.push({name:'cloth_cape_cord',kind:'trim',pos:tube(chain,0.0032*k),closed:true});
        [a,b].forEach((c,n)=>parts.push({name:'cloth_cape_brooch_'+(n+1),kind:'trim',closed:true,pos:brooch(c,norm([c[0]*1.2,0.45,0.8]),k)}));}
      for(const sl of results.sleeves||[])parts.push({...sl,pos:tuckUnder(sl.pos,out)}); // マントの外へ飛び出した袖は内側へ戻す
      if(results.skirt)parts.push({...results.skirt,pos:tuckUnder(tuckUnder(results.skirt.pos,out),out)}); // スカートも同じ
      return{parts,layers:[{pos:out,closed:false,thick:0.005}],splatted:true};
    },
    hood(d){
      if(d.pose==='up')return this.hoodUp(d);
      // 下ろしたフードは、マントの上に形を決めて置く
      const NUh=37,NV=17,cape=results.cape,CN=cape.length,CU=cape[0].length,L=ringLen(cape.map(r=>r[CU>>1]),false);
      const cp=(u,t)=>{const fi=clamp(u,0,1)*(CU-1),fj=clamp(t,0,1)*(CN-1),i=Math.min(CU-2,Math.floor(fi)),j=Math.min(CN-2,Math.floor(fj));return vlerp(vlerp(cape[j][i],cape[j][i+1],fi-i),vlerp(cape[j+1][i],cape[j+1][i+1],fi-i),fj-j);};
      const raw=(uc,tc)=>{const p=cp(uc,tc),tu=sub(cp(uc+0.03,tc),cp(uc-0.03,tc)),tv=sub(cp(uc,tc+0.04),cp(uc,Math.max(0,tc-0.04)));let n=norm(cross(tu,tv));if(dot(n,[p[0],0.25,p[2]])<0)n=mul(n,-1);return{p,n};};
      const deep=Math.min(0.9,d.depth*k/L);
      let pos=[];for(let j=0;j<NV;j++){const t=j/(NV-1);pos.push(Array.from({length:NUh},(_,i)=>{const u=i/(NUh-1),m=Math.sin(Math.PI*u),uc=lerp(0.17,0.83,u),depth=deep*(0.16+0.84*Math.pow(m,2.6)),{p,n}=raw(uc,t*depth);
        const lift=0.006+k*(d.depth/0.28)*Math.pow(m,0.7)*(0.050*Math.pow(Math.sin(Math.PI*Math.min(1,t*0.92)),0.8)+0.022*Math.sin(t*Math.PI*3)*t*(1-t))+0.008*t;
        return add(p,mul(norm(add(n,[0,0.35,0])),j===0?0.004:lift));}));}
      for(let it=0;it<2;it++)pos=pos.map((r,j)=>r.map((p,i)=>j===0||j===NV-1||i===0||i===NUh-1?p:mul([pos[j-1][i],pos[j+1][i],r[i-1],r[i+1],p,p,p,p].reduce(add,[0,0,0]),1/8)));
      const mir=pos.map(r=>r.map((p,i)=>{const q=r[NUh-1-i];return[(p[0]-q[0])/2,(p[1]+q[1])/2,(p[2]+q[2])/2];}));
      pos=mir.map((r,j)=>r.map(p=>j===0?p:escapeFrom(field,p,0.0065)));
      return{parts:[{name:'cloth_hood',kind:'hood',pos,closed:false,length:d.depth*k}],layers:[{pos,closed:false,thick:0.004}]};
    },
  };
}

// 服を順に作る。cache にある工程は計算せずに使い回す
export async function generate(ctx,design,cache,onStep,onProgress,cancelled){
  const{field,bodyOnly}=ctx,steps=plan(design),results={};field.copyFrom(bodyOnly);
  for(let n=0;n<steps.length;n++){
    await new Promise(r=>setTimeout(r,0));if(cancelled&&cancelled())return false;
    const s=steps[n];let r=cache.get(s.hash);
    if(r){for(const l of r.layers)field.splat(gridTris(l.pos,l.closed),l.thick);Object.assign(results,r.results);}
    else{onProgress(n,steps.length,s.id,0);const local=makeRunner(ctx,results,f=>onProgress(n,steps.length,s.id,f))[s.id](design[s.id],design);
      if(!local.splatted)for(const l of local.layers)field.splat(gridTris(l.pos,l.closed),l.thick);
      r={parts:local.parts,layers:local.layers,results:{...results}};cache.set(s.hash,r);if(cache.size>40)cache.delete(cache.keys().next().value);}
    onStep(s.id,r.parts);
  }
  return true;
}
