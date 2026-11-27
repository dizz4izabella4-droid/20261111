// ズボン・靴・胴着・腕当て・帽子・かぶるフード
import {add,sub,mul,len,norm,lerp,vlerp,clamp,smooth,TAU,ringLen,gridTris} from './lib.js';
import {escapeFrom,tube,brooch,bridge,armPath} from './shape.js';

const range=n=>Array.from({length:n},(_,i)=>i);
const DEG=Math.PI/180;

export function extraRunners(ctx,results){
  const{field,bodyOnly,J,k,Q,waist,neckY,march,head,crotch}=ctx;
  // 脚の中心線（高さ y での位置）
  const legAt=(side,y)=>{const T=J['thigh_'+side],S=J['shin_'+side],F=J['foot_'+side];
    const [a,b]=y>S[1]?[S,T]:[F,S],t=clamp((y-a[1])/((b[1]-a[1])||1),0,1);return[lerp(a[0],b[0],t),y,lerp(a[2],b[2],t)];};

  return{
    pants(d,design){
      const[NU,NV]=Q.pants,type=d.type,under=design.skirt.on,V=d.volume;
      const yTop=waist+(under?-0.004:0.012)*k,ankle=J.foot_l[1]+0.012*k,yEnd=lerp(crotch-0.075*k,ankle,clamp((d.length-0.3)/0.7,0,1));
      const easeTop=under?Math.max(0.0045,design.top.ease-0.0028):design.top.ease+0.0028,SP=Math.round(NU*0.64); // SP は外側の列の終わり（背中の中心）
      const parts=[],layers=[];
      for(const[side,sg]of[['l',1],['r',-1]]){
        const ys=range(NV).map(j=>lerp(yTop,yEnd,j/(NV-1))),rows=ys.map(y=>{
          const ease=lerp(easeTop,0.0075,smooth(0,0.1*k,waist-y)),legMix=smooth(crotch+0.035*k,crotch-0.04*k,y);
          const u=clamp((crotch+0.08*k-y)/Math.max(0.05,crotch+0.08*k-yEnd),0,1),loose=type==='slim'?0:1;
          const yu=Math.max(y,crotch+0.025*k),extra=loose*(0.006+0.012*V)*k*smooth(waist,crotch+0.04*k,y);
          // 股より上：胴の外周の半分と、真ん中の面
          const outer=az=>{const dir=[sg*Math.sin(az),0,Math.cos(az)],r=march([0,yu,0],dir,ease,0.3*k)+extra*Math.pow(Math.abs(Math.sin(az)),0.5);return[sg*Math.max(0.0003,sg*dir[0]*r),y,dir[2]*r];};
          const front=outer(0),back=outer(Math.PI);
          const upper=i=>{if(i<=SP)return outer(i/SP*Math.PI);return[sg*0.0001,y,lerp(back[2],front[2],(i-SP)/(NU-SP))];};
          // 股より下：脚のまわり
          const c=legAt(side,y);
          const leg=i=>{const a=i<=SP?lerp(-40,220,i/SP)*DEG:lerp(220,320,(i-SP)/(NU-SP))*DEG,dir=[sg*Math.sin(a),0,Math.cos(a)];
            let r=march(c,dir,ease,0.16*k);
            if(type==='hakama'){const R=lerp(0.062,lerp(0.085,0.185,V),Math.pow(u,0.8))*k*(1+0.09*smooth(0.15,0.8,u)*Math.sin(a*9+sg));r=Math.max(r,R);}
            if(type==='balloon'){const b=Math.pow(Math.max(0,Math.sin(Math.PI*Math.pow(u,1.25))),0.6);r+=lerp(0.014,0.08,V)*k*b*(1+0.14*Math.sin(a*11+u*5))*(i>SP?0.12:1);}
            let p=add(c,mul(dir,r));if(type==='balloon')p=[p[0],p[1]-0.018*k*Math.sin(Math.PI*u)*smooth(0.4,0.8,u),p[2]];
            if(sg*p[0]<-0.0004)p[0]=-sg*0.0004;return p;};
          return range(NU).map(i=>legMix<=0?upper(i):legMix>=1?leg(i):vlerp(upper(i),leg(i),legMix));
        });
        const joined=ys.map(y=>y>crotch+0.005*k); // 股より上は、左右が真ん中で合わさる
        for(let it=0;it<(type==='slim'?3:2);it++){const src=rows.map(r=>r.map(p=>p.slice()));
          for(let j=1;j<NV-1;j++)for(let i=0;i<NU;i++){if(joined[j]&&(i<=1||i>=SP-1))continue;let q=[0,0,0];for(const s of[src[j-1][i],src[j+1][i],src[j][(i+1)%NU],src[j][(i+NU-1)%NU]])q=add(q,mul(s,0.25));q=vlerp(src[j][i],q,0.5);
            const g=[0,0,0],dd=bodyOnly.at(q[0],q[1],q[2],g);if(dd<0.0058&&sg*q[0]>0.006)q=add(q,mul(norm(g),0.0058-dd));{const min=joined[j]?0.0001:-0.0004;if(sg*q[0]<min)q[0]=sg*min;}rows[j][i]=q;}}
        for(let j=0;j<NV;j++)if(joined[j])for(const i of[0,SP]){rows[j][i]=[sg*0.0001,rows[j][i][1],rows[j][i][2]];}
        parts.push({name:'cloth_pants_'+side,kind:'pants',side,pos:rows,closed:true,length:yTop-yEnd,loose:type!=='slim'});layers.push({pos:rows,closed:true,thick:0.004});
      }
      results.pants=parts;
      return{parts,layers};
    },

    shoes(d){
      const NU=Q.foot,parts=[],layers=[],type=d.type;
      const top=type==='boots'?d.height*k:0.098*k;
      for(const[side,sg]of[['l',1],['r',-1]]){
        const foot=ctx.feet[side],cx=J['foot_'+side][0];
        // 足の長さ方向に切った断面（0 が真上）
        const section=(z,ease,ymax,cy=0.022*k)=>range(NU).map(i=>{const a=i/NU*TAU,dir=[sg*Math.sin(a),Math.cos(a),0],zz=clamp(z,foot.zmin+0.004,foot.zmax-0.004),r=march([cx,cy,zz],dir,ease,0.1*k);
          return[cx+dir[0]*r,clamp(cy+dir[1]*r,-0.006*k,ymax),z];});
        const loft=(ease,ymax)=>{const NZ=Math.round(NU*0.6),rows=range(NZ).map(j=>section(lerp(foot.zmin,foot.zmax,j/(NZ-1)),ease,ymax));
          const cap=(row,dz,s)=>{const c=mul(row.reduce(add,[0,0,0]),1/NU);return row.map(p=>[c[0]+(p[0]-c[0])*s,c[1]+(p[1]-c[1])*s,p[2]+dz]);};
          for(let it=0;it<2;it++)for(let j=1;j<NZ-1;j++){const src=rows[j].map(p=>p.slice());rows[j]=src.map((p,i)=>{const q=mul(add(add(src[(i+1)%NU],src[(i+NU-1)%NU]),mul(p,2)),0.25);return q;});}
          const a=rows[0],b=rows[NZ-1];
          return[cap(a,-ease*1.15,0),cap(a,-ease,0.72),cap(a,-ease*0.6,0.94),...rows,cap(b,ease*0.6,0.94),cap(b,ease,0.72),cap(b,ease*1.15,0)];};
        const ringAt=(y,ease,limit)=>{const c=legAt(side,y);return range(NU).map(i=>{const a=i/NU*TAU,dir=[sg*Math.sin(a),0,Math.cos(a)];let r=march(c,dir,ease,0.13*k);if(limit)r=Math.min(r,limit[i]);return add(c,mul(dir,r));});};
        const add_=(name,kind,pos,extra,thick=0.003)=>{parts.push({name,kind,side,pos,closed:true,length:1,...extra});layers.push({pos,closed:true,thick});};
        if(type==='sandal'){
          add_('cloth_shoe_sole_'+side,'strap',loft(0.0065*k,0.012*k),{solid:1});
          [0.58,0.8].forEach((f,n)=>{const z=lerp(foot.zmin,foot.zmax,f);add_('cloth_shoe_strap'+(n+1)+'_'+side,'strap',[-0.011,-0.0035,0.0035,0.011].map(o=>section(z+o*k,0.0048*k,0.08*k)),{solid:0});});
          add_('cloth_shoe_ankle_'+side,'strap',[0.108,0.101,0.094].map(y=>ringAt(y*k,0.005*k)),{solid:0});
          add_('cloth_shoe_back_'+side,'strap',tube([[cx,0.006,foot.zmin-0.004],[cx,0.045*k,foot.zmin-0.002],[cx,0.095*k,legAt(side,0.095*k)[2]-march(legAt(side,0.095*k),[0,0,-1],0.006,0.1)]],0.006*k),{solid:0});
        }else{
          const boots=type==='boots',ease=(boots?0.0105:0.0092)*k;
          add_('cloth_shoe_foot_'+side,'shoes',loft(ease*0.9,(boots?0.092:0.074)*k),{foot:true});
          const NV=Math.max(6,Math.round(top/(0.012*k))),bottom=0.05*k,base=ringAt(0.1*k,ease);
          const limit=base.map(p=>{const c=legAt(side,0.1*k);return Math.hypot(p[0]-c[0],p[2]-c[2])+0.005*k;});
          const rows=range(NV).map(j=>{const t=j/(NV-1),y=lerp(top,bottom,t),flare=boots?0.0045*k*(1-smooth(0,0.16,t)):0;return ringAt(y,ease+flare,y<0.1*k?limit:null);});
          for(let it=0;it<3;it++){const src=rows.map(r=>r.map(p=>p.slice()));for(let j=1;j<NV-1;j++)rows[j]=src[j].map((p,i)=>vlerp(p,mul(add(src[j-1][i],src[j+1][i]),0.5),0.5));}
          add_('cloth_shoe_top_'+side,'shoes',rows,{length:top-bottom});
        }
      }
      // ブーツの中へ、ズボンの裾を入れる
      if(type==='boots'&&results.pants){
        const tucked=results.pants.map(part=>({...part,pos:part.pos.map(row=>row.map(p=>{if(p[1]>top+0.07*k)return p;const c=legAt(part.side,p[1]),v=[p[0]-c[0],0,p[2]-c[2]],r=len(v);if(r<1e-6)return p;
          const limit=march(c,mul(v,1/r),0.0055,0.12*k);if(r<=limit)return p;const nr=lerp(r,limit,smooth(top+0.07*k,top-0.004*k,p[1]));return[c[0]+v[0]/r*nr,p[1],c[2]+v[2]/r*nr];}))}));
        results.pants=tucked;parts.push(...tucked);
      }
      return{parts,layers};
    },

    vest(d,design){
      const parts=[],layers=[],NU=Q.nu,ease=design.top.ease+0.0065*k;
      const reach=(o,dir,start)=>{let r=start;while(r<0.32*k&&field.at(o[0]+dir[0]*r,o[1]+dir[1]*r,o[2]+dir[2]*r)<0.0042)r+=0.001;return r;};
      if(d.type==='corset'){
        const H=lerp(0.085,0.165,d.size)*k,NV=Math.max(9,Math.round(H/(0.016*k))+2),yTop=waist+H*0.68,yBot=waist-H*0.32-0.012*k;
        let rows=range(NV).map(j=>{const t=j/(NV-1);return range(NU).map(i=>{const th=i/NU*TAU,dir=[Math.sin(th),0,Math.cos(th)],y=lerp(yTop,yBot,t)+(1-t)*0.012*k*(Math.pow(Math.sin(th),2)-0.5)-t*0.018*k*Math.pow(Math.max(0,Math.cos(th)),6);
          const o=[0,y,0],r=reach(o,dir,march(o,dir,ease,0.3*k)),p=[dir[0]*r,y,dir[2]*r],S=ctx.S,lim=lerp(S[0]*0.87,S[0]*1.1,smooth(waist+0.06*k,waist-0.02*k,y));
          if(y>waist&&Math.abs(p[0])>lim){const f=lim/Math.abs(p[0]);return[p[0]*f,y,p[2]*(0.35+0.65*f)];}return p;});});
        rows=rows.map(r=>bridge(r,0.85));
        for(let it=0;it<3;it++){const src=rows.map(r=>r.map(p=>p.slice()));for(let j=1;j<NV-1;j++)rows[j]=src[j].map((p,i)=>{const q=vlerp(p,mul(add(src[j-1][i],src[j+1][i]),0.5),0.45);return Math.hypot(q[0],q[2])>Math.hypot(p[0],p[2])?q:p;});}
        parts.push({name:'cloth_vest',kind:'vest',pos:rows,closed:true,length:H});layers.push({pos:rows,closed:true,thick:0.004});
        // 前の編み上げ紐
        const at=(x,t)=>{const fj=clamp(t,0,1)*(NV-1),j=Math.min(NV-2,Math.floor(fj)),row=vlerp(rows[j][0],rows[j+1][0],fj-j);let z=row[2]+0.03*k;while(z>0&&field.at(x,row[1],z)>0.0075)z-=0.001;return[x,row[1],Math.max(z,row[2])+0.0015];};
        const N=6;[1,-1].forEach((s,n)=>{const path=[];for(let m=0;m<N;m++){const a=at((m%2?-s:s)*0.017*k,lerp(0.14,0.86,m/(N-1))),b=m+1<N?at((m%2?s:-s)*0.017*k,lerp(0.14,0.86,(m+1)/(N-1))):null;
          path.push(a);if(b)for(const f of[0.33,0.67]){const q=vlerp(a,b,f);q[2]=Math.max(q[2],at(q[0],lerp(0.14,0.86,(m+f)/(N-1)))[2]);path.push(q);}}
          parts.push({name:'cloth_vest_lace_'+(n+1),kind:'trim',group:'vest',rig:'torso',pos:tube(path,0.0026*k,6),closed:true});});
      }else{
        const top=results.top,TV=top.length,TU=top[0].length,O0=lerp(waist,neckY,0.47),extra=Math.max(3,Math.round(TV*0.4)),down=lerp(0.025,0.2,d.size)*k,rows=[];
        const sample=(j,w)=>{const f=((w%1)+1)%1*TU,i=Math.floor(f)%TU;return vlerp(top[j][i],top[j][(i+1)%TU],f-Math.floor(f));};
        const open=t=>lerp(0.13,0.045,smooth(0,0.65,t))+0.05*smooth(0.8,1,t); // 前の開き（一周に対する割合）
        for(let j=0;j<TV+extra;j++){const t=j/(TV+extra-1),o=open(t);
          rows.push(range(NU).map(i=>{const w=lerp(o,1-o,i/(NU-1)),p=sample(Math.min(j,TV-1),w);
            if(j<TV){const n=norm(sub(p,[0,Math.min(p[1],O0),0]));let q=add(p,mul(n,0.0068*k));for(let s=0;s<20&&field.at(q[0],q[1],q[2])<0.0035;s++)q=add(q,mul(n,0.001));return q;}
            const th=w*TAU,dir=[Math.sin(th),0,Math.cos(th)],y=waist-down*(j-TV+1)/extra,o_=[0,y,0],base=Math.hypot(p[0],p[2])+0.006*k,r=reach(o_,dir,Math.max(march(o_,dir,ease,0.3*k),base));return[dir[0]*r,y,dir[2]*r];}));}
        for(let it=0;it<3;it++){const src=rows.map(r=>r.map(p=>p.slice()));for(let j=TV-2;j<rows.length-1;j++)rows[j]=src[j].map((p,i)=>{const q=vlerp(p,mul(add(src[j-1][i],src[j+1][i]),0.5),0.5);return Math.hypot(q[0],q[2])>Math.hypot(p[0],p[2])?q:p;});}
        parts.push({name:'cloth_vest',kind:'vest',open:true,pos:rows,closed:false,length:(neckY-waist)+down});layers.push({pos:rows,closed:false,thick:0.004});
        // 内側の身頃がはみ出さないようにする必要はない（外側へ置いている）
      }
      return{parts,layers};
    },

    bracer(d,design){
      const parts=[],layers=[],NU=Q.foot,tight=design.sleeve.type==='fit'||design.sleeve.type==='puff';
      for(const side of['l','r']){
        const{sg,L1,L2,Ls,path,frame}=armPath(J,side,k),from=Ls-L2*d.length*0.96,to=Ls-0.004*k,NV=Math.max(7,Math.round((to-from)/(0.016*k))+2),ease=(tight?0.0128:0.0072)*k;
        const rows=range(NV).map(j=>{const t=j/(NV-1),s=lerp(from,to,t),{c,t:tg}=path(s),[e1,e2]=frame(tg),flare=0.0055*k*(1-smooth(0,0.35,t));
          return range(NU).map(i=>{const a=i/NU*TAU,dir=add(mul(e1,Math.cos(a)),mul(e2,Math.sin(a)));let r=0.005;while(r<0.07*k&&bodyOnly.at(...add(c,mul(dir,r)))<ease+flare)r+=0.001;return add(c,mul(dir,r));});});
        for(let it=0;it<2;it++){const src=rows.map(r=>r.map(p=>p.slice()));for(let j=1;j<NV-1;j++)rows[j]=src[j].map((p,i)=>vlerp(p,mul(add(src[j-1][i],src[j+1][i]),0.5),0.45));}
        parts.push({name:'cloth_bracer_'+side,kind:'bracer',side,pos:rows,closed:true,length:to-from});layers.push({pos:rows,closed:true,thick:0.004});
      }
      return{parts,layers};
    },

    hat(d,design){
      const NU=Q.hat,{hx,hz,zc,top}=head,parts=[],layers=[],m=0.011*k;
      // 頭のまわりの輪。n が大きいほど四角に近い
      const ring=(y,s,n,{extra=0,dz=0,lift=()=>0}={})=>range(NU).map(i=>{const th=i/NU*TAU,sn=Math.sin(th),cs=Math.cos(th),a=(hx+m)*s+extra,b=(hz+m)*s+extra,r=1/Math.pow(Math.pow(Math.abs(sn)/a,n)+Math.pow(Math.abs(cs)/b,n),1/n);
        return[r*sn,y+lift(th),zc+dz+r*cs];});
      const center=[0,top-0.07*k,zc];
      const solid=(rows,band)=>parts.push({name:'cloth_hat',kind:'hat',pos:rows,closed:true,length:1,band,center});
      if(d.type==='witch'){
        const H=d.height*k,B=d.brim*k,bandY=top-0.042*k,rows=[],N=16;
        for(let j=0;j<N;j++){const t=j/(N-1);rows.push(ring(top+0.012*k+H*(1-t)-H*0.24*Math.pow(1-t,3),lerp(0.03,1,Math.pow(t,0.92)),lerp(2,8,Math.pow(t,1.6)),{dz:-H*0.55*Math.pow(1-t,2.2)}));}
        for(const f of[0.33,0.66,1])rows.push(ring(lerp(top+0.012*k,bandY,f),1,8));
        const bandRows=[N-1.6,N+2];
        for(let j=1;j<=7;j++){const s=j/7;rows.push(ring(bandY-0.2*B*s*s,1,lerp(8,2,smooth(0,0.55,s)),{extra:B*s,lift:th=>0.1*B*s*s*Math.sin(th*3+1)}));}
        solid(rows,bandRows.map(v=>v/(rows.length-1)));
      }else if(d.type==='brim'){
        const B=d.brim*k,H=lerp(0.016,0.075,(d.height-0.08)/0.24)*k,bandY=top-0.04*k,crown=top+0.01*k+H;
        const rows=[ring(crown+0.006*k,0.02,2),ring(crown+0.004*k,0.6,3),ring(crown,0.9,5),ring(crown-0.008*k,1,7),ring(top+0.012*k,1,8),ring(lerp(top,bandY,0.5),1,8),ring(bandY,1,8)];
        for(let j=1;j<=7;j++){const s=j/7;rows.push(ring(bandY-0.14*B*s*s,1,lerp(8,2,smooth(0,0.55,s)),{extra:B*s}));}
        solid(rows,[3.6/(rows.length-1),6/(rows.length-1)]);
      }else if(d.type==='beret'){
        const H=lerp(0.6,1.5,(d.height-0.08)/0.24),tilt=th=>0.016*k*Math.sin(th);
        const spec=[[0.04,0.02,2],[0.038,0.55,2.2],[0.032,0.98,2.4],[0.022,1.26,2.6],[0.007,1.34,3],[-0.006,1.2,4],[-0.017,1.04,7],[-0.024,1,8],[-0.036,1,8]];
        const rows=spec.map(([dy,s,n],j)=>ring(top+(dy>0?dy*H:dy)*k,s,n,{lift:j<6?th=>tilt(th)*(j<4?1:0.5):undefined}));
        solid(rows,[6.6/8,1]);
      }else if(d.type==='veil'){
        const[NUv,NVv]=Q.veil,L=d.length*k,PIN=5,yc=top-0.085*k,A=hx+0.013*k,B=top+0.012*k-yc;
        const arc=(u,z)=>{const b=lerp(-104,104,u)*DEG,s=Math.sin(b),c=Math.cos(b),r=1/Math.pow(Math.pow(Math.abs(s)/A,7)+Math.pow(Math.abs(c)/B,7),1/7);return[r*s,yc+r*c,z];};
        // 頭の上を通って後ろへ下ろす。形を決めて置く（布の計算より乱れにくい）
        const zFront=zc+hz*0.25,zBack=zc-hz-0.014*k;
        const out=range(NVv).map(j=>{const t=Math.max(0,(j-PIN+1)/(NVv-PIN));return range(NUv).map(i=>{const u=i/(NUv-1);
          if(j<PIN)return arc(u,lerp(zFront,zBack,j/(PIN-1)));
          const p=arc(u,zBack),yb=top-0.06*k-L*(0.86+0.14*Math.sin(Math.PI*u)),fold=Math.sin((u-0.5)*TAU*4)*0.5+0.5;
          const q=[p[0]*(1+0.75*smooth(0,0.8,t)),lerp(p[1],yb,Math.pow(t,0.9+0.25*Math.sin(Math.PI*u))),zBack-0.075*k*Math.sin(Math.PI*0.62*t)-0.024*k*fold*smooth(0,0.5,t)];
          return escapeFrom(field,q,0.012);});});
        for(let it=0;it<2;it++){const src=out.map(r=>r.map(p=>p.slice()));for(let j=PIN;j<NVv-1;j++)out[j]=src[j].map((p,i)=>vlerp(p,mul(add(src[j-1][i],src[j+1][i]),0.5),0.5));}
        parts.push({name:'cloth_hat_veil',kind:'veil',pos:out,closed:false,length:L+zFront-zBack,pinned:(PIN-1)/(NVv-1),center});layers.push({pos:out,closed:false,thick:0.003});
        parts.push({name:'cloth_hat_band',kind:'trim',group:'hat',rig:'head',pos:tube(range(33).map(i=>add(arc(0.2+0.6*i/32,zFront),[0,0,0.002])),0.0042*k),closed:true});
      }else{ // 額飾り
        const y=top-0.048*k,r=ring(y,0.94,9,{lift:th=>-0.008*k*Math.pow(Math.max(0,Math.cos(th)),8)});
        parts.push({name:'cloth_hat_circlet',kind:'trim',group:'hat',rig:'head',pos:tube([...r,r[0],r[1]],0.0036*k),closed:true});
        parts.push({name:'cloth_hat_gem',kind:'trim',group:'hat',rig:'head',pos:brooch([0,r[0][1],r[0][2]+0.001],[0,0.05,1],k*0.8),closed:true});
      }
      return{parts,layers};
    },

    hoodUp(d){ // 頭にかぶったフード
      const NU=Q.hood,NV=18,{hx,hz,zc,top}=head,yc=top-0.095*k,A=hx+0.032*k+0.05*k*(d.depth-0.28),Bt=top+0.036*k-yc,Bb=yc-(neckY+0.012*k);
      const zf=zc+hz+0.008*k+(d.depth-0.28)*0.2*k,zm=zc-hz*0.45,zb=zc-hz-0.045*k-(d.depth-0.28)*0.12*k;
      const rows=range(NV).map(j=>{const v=j/(NV-1),front=v<0.45,w=clamp((v-0.45)/0.55,0,1),s=front?1+0.03*Math.sin(Math.PI*v/0.45):Math.sqrt(Math.max(0,1-Math.pow(w,4))),z0=front?lerp(zf,zm,v/0.45):lerp(zm,zb,Math.sin(w*Math.PI/2));
        const end=lerp(158,180,smooth(0.3,0.7,v));return range(NU).map(i=>{const b=lerp(-end,end,i/(NU-1))*DEG,sn=Math.sin(b),cs=Math.cos(b),B=cs>0?Bt:Bb,r=1/Math.pow(Math.pow(Math.abs(sn)/A,4)+Math.pow(Math.abs(cs)/B,4),0.25);
          const low=smooth(100*DEG,158*DEG,Math.abs(b))*(1-smooth(0.45,0.8,v)),x=r*sn*lerp(1,0.55,low)*s,y=yc+r*cs*s;
          // ふちは上を前へ、下を少し後ろへ
          const z=lerp(z0,Math.min(z0,zc+hz*0.35),low)+(front?0.014*k*Math.max(0,cs)*(1-v/0.45):0);
          return[x,y-0.012*k*smooth(0.5,1,v),z];});});
      const pos=rows.map((r,j)=>r.map(p=>p[1]<neckY+0.09*k?escapeFrom(field,p,0.006):p));
      return{parts:[{name:'cloth_hood',kind:'hood',up:true,pos,closed:false,length:0.32*k,center:[0,yc,zc]}],layers:[{pos,closed:false,thick:0.004}]};
    },
  };
}
