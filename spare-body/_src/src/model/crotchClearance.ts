import type { BodyMesh } from './body';
import type { BodyParams } from './params';
import { smoothstep } from './interp';
import { tissueNormals } from './tissueDeform';

/** A neutral recessed reserve, without anatomical detail or an open mesh. */
export function shapeCrotchClearance(body:BodyMesh,p:BodyParams):BodyMesh {
  const depth=p.crotchClearanceDepth??.008;if(depth<=0)return body;
  const width=p.crotchClearanceWidth??.028,height=p.crotchClearanceHeight??.06;
  const ids=new Set<number>();
  for(const part of body.parts)if(part.name==='torso'||/^thigh_/.test(part.name))for(let i=part.start;i<part.start+part.count;i++)ids.add(body.indices[i]);
  const positions=body.positions.slice();
  for(const i of ids){
    const x=positions[i*3],y=positions[i*3+1],z=positions[i*3+2];
    const central=1-smoothstep(width*.3,width,Math.abs(x));
    const vertical=1-smoothstep(height*.35,height,Math.abs(y-body.crotchY-.01));
    const front=smoothstep(-.005,.035,z),weight=central*vertical*front;
    if(!weight)continue;
    positions[i*3+2]-=depth*weight;
    if(Math.abs(x)>1e-6&&y<body.crotchY){
      const space=width*.4*(1-smoothstep(body.crotchY-.045,body.crotchY,y));
      positions[i*3]+=Math.sign(x)*Math.max(0,space-Math.abs(x))*weight;
    }
  }
  return {...body,positions,normals:tissueNormals(positions,body.indices)};
}
