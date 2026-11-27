import type { BodyMesh } from './body';
import type { BodyParams } from './params';
import { smoothstep } from './interp';
import { tissueNormals } from './tissueDeform';

/** Split alternating triangles into three within each curved region: each
 * two-face patch becomes four. Original edges/positions remain unchanged,
 * preserving the accepted shape and avoiding T-junctions at region borders. */
export function doubleCurves(body: BodyMesh, p: BodyParams): BodyMesh {
  const positions=[...body.positions],normals=[...body.normals],joints=[...body.skinIndex],weights=[...body.skinWeight];
  const indices:number[]=[],parts:BodyMesh['parts']=[];
  const hipY=body.bones.find(b=>b.name==='thigh_l')!.head[1];
  const counters=[0,0,0];
  for(const part of body.parts){
    const start=indices.length;
    for(let t=part.start;t<part.start+part.count;t+=3){
      const ids=[body.indices[t],body.indices[t+1],body.indices[t+2]],y=ids.reduce((s,i)=>s+body.positions[i*3+1],0)/3,z=ids.reduce((s,i)=>s+body.positions[i*3+2],0)/3;
      const breast=part.name==='torso'&&z>.035&&Math.abs(y-body.crotchY-p.centerHeight)<p.baseHeight*.8;
      const glute=(part.name==='torso'||/^thigh_/.test(part.name))&&z<-.025&&Math.abs(y-hipY)<.15;
      const region=breast?1:glute?2:0;
      if(!region||counters[region]++%2){indices.push(...ids);continue;}
      const center=positions.length/3;
      for(let k=0;k<3;k++){positions.push(ids.reduce((s,i)=>s+body.positions[i*3+k],0)/3);normals.push(ids.reduce((s,i)=>s+body.normals[i*3+k],0)/3);}
      const length=Math.hypot(...normals.slice(center*3,center*3+3))||1;for(let k=0;k<3;k++)normals[center*3+k]/=length;
      // Place the added point on the curved patch estimated by its vertex
      // tangent planes, rather than leaving the old flat triangle untouched.
      const bend=[0,0,0];
      for(const i of ids){let dot=0;for(let k=0;k<3;k++)dot+=(body.positions[i*3+k]-positions[center*3+k])*body.normals[i*3+k];for(let k=0;k<3;k++)bend[k]+=body.normals[i*3+k]*dot/6;}
      const bendLength=Math.hypot(...bend);
      const e01=Math.hypot(...[0,1,2].map(k=>body.positions[ids[1]*3+k]-body.positions[ids[0]*3+k])),e12=Math.hypot(...[0,1,2].map(k=>body.positions[ids[2]*3+k]-body.positions[ids[1]*3+k])),e20=Math.hypot(...[0,1,2].map(k=>body.positions[ids[0]*3+k]-body.positions[ids[2]*3+k])),
        s2=(e01+e12+e20)/2,area=Math.sqrt(Math.max(0,s2*(s2-e01)*(s2-e12)*(s2-e20))),thin=2*area/Math.max(1e-9,e01,e12,e20); // shortest altitude
      const scale=Math.min(1,.002/Math.max(1e-9,bendLength),.25*thin/Math.max(1e-9,bendLength));
      for(let k=0;k<3;k++)positions[center*3+k]+=bend[k]*scale;
      const merged=new Map<number,number>();
      for(const i of ids)for(let k=0;k<4;k++){const bone=body.skinIndex[i*4+k];merged.set(bone,(merged.get(bone)??0)+body.skinWeight[i*4+k]/3);}
      const entries=[...merged].sort((a,b)=>b[1]-a[1]).slice(0,4),total=entries.reduce((s,e)=>s+e[1],0);
      for(let k=0;k<4;k++){joints.push(entries[k]?.[0]??0);weights.push((entries[k]?.[1]??0)/total);}
      indices.push(ids[0],ids[1],center,ids[1],ids[2],center,ids[2],ids[0],center);
    }
    parts.push({...part,start,count:indices.length-start});
  }
  const P=Float32Array.from(positions),I=Uint32Array.from(indices),baseline=P.slice();
  const mask=new Float32Array(P.length/3),adj=Array.from({length:mask.length},()=>new Set<number>());
  for(const part of parts)for(let t=part.start;t<part.start+part.count;t+=3){
    const ids=[I[t],I[t+1],I[t+2]];
    for(const i of ids){const x=P[i*3],y=P[i*3+1],z=P[i*3+2];
      if(part.name==='torso') {
        const breast=(1-smoothstep(p.baseHeight*.5,p.baseHeight*.95,Math.abs(y-body.crotchY-p.centerHeight)))*smoothstep(.025,.07,z);
        mask[i]=Math.max(mask[i],breast*(.35+.65*smoothstep(.008,.025,Math.abs(x))));
      }
      if(part.name==='torso'||/^thigh_/.test(part.name)) {
        const glute=(1-smoothstep(.085,.16,Math.abs(y-hipY)))*smoothstep(.025,.075,-z);
        mask[i]=Math.max(mask[i],glute*(.15+.85*smoothstep(.008,.024,Math.abs(x))));
      }
    }
    for(let k=0;k<3;k++){adj[ids[k]].add(ids[(k+1)%3]);adj[ids[(k+1)%3]].add(ids[k]);}
  }
  // Paired fairing removes angular ridges without progressively shrinking the
  // lobes. Fade at the boundaries and protect the breast/cleft midlines.
  // Move vertices along their own normal only. Sliding them along the surface (a plain
  // Laplacian step) folds the thin, densely packed triangles around the breast over each other.
  const N0=Float32Array.from(normals),shortest=new Float32Array(mask.length).fill(1);
  for(let i=0;i<mask.length;i++)for(const j of adj[i])shortest[i]=Math.min(shortest[i],Math.hypot(P[i*3]-P[j*3],P[i*3+1]-P[j*3+1],P[i*3+2]-P[j*3+2]));
  for(let pass=0;pass<7;pass++)for(const lambda of [.42,-.43]){
    const previous=P.slice();
    for(let i=0;i<mask.length;i++)if(mask[i]&&adj[i].size){
      const mean=[0,0,0];
      for(const j of adj[i])for(let k=0;k<3;k++)mean[k]+=previous[j*3+k]/adj[i].size;
      let along=0;for(let k=0;k<3;k++)along+=(mean[k]-previous[i*3+k])*N0[i*3+k];
      const cap=Math.min(.001,.2*shortest[i]),step=Math.max(-cap,Math.min(cap,along*lambda*mask[i]));
      for(let k=0;k<3;k++)P[i*3+k]=Math.max(baseline[i*3+k]-.005,Math.min(baseline[i*3+k]+.005,previous[i*3+k]+step*N0[i*3+k]));
    }
  }
  return {...body,positions:P,normals:tissueNormals(P,I),skinIndex:Uint16Array.from(joints),skinWeight:Float32Array.from(weights),indices:I,parts};
}
