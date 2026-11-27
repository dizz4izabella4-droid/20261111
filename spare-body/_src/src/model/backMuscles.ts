import type { BodyMesh } from './body';
import type { BodyParams } from './params';
import { smoothstep } from './interp';
import { tissueNormals } from './tissueDeform';

/** Continuous paired erector ridges and a broad latissimus fan. These are
 * part of the torso skin and share its skeleton and muscle/tissue solver. */
export function shapeBackMuscles(body: BodyMesh, p: BodyParams): BodyMesh {
  const strength=(p.backMuscleStrength??60)/100;if(!strength)return body;
  const part=body.parts.find(v=>v.name==='torso');if(!part)return body;
  const ids=new Set(body.indices.subarray(part.start,part.start+part.count)),positions=body.positions.slice();
  const low=body.crotchY+p.hipHeight+.025,high=body.keyY.shoulderJoint-.01;
  const halfWidth=(p.backMuscleWidth??.07)/2,depth=p.backMuscleDepth??.006;
  const gaussian=(x:number)=>Math.exp(-.5*x*x);
  for(const i of ids){
    const x=positions[i*3],y=positions[i*3+1],z=positions[i*3+2],t=(y-low)/Math.max(.1,high-low);
    if(t<=0||t>=1||z>=-.015)continue;
    const rear=smoothstep(.015,.065,-z),vertical=Math.sin(Math.PI*t)**2;
    const ridges=gaussian((Math.abs(x)-halfWidth*(.85+.3*t))/.016);
    const fan=gaussian((Math.abs(x)-(.035+.065*t))/.042)*smoothstep(.15,.6,t);
    const groove=(p.backSpineGroove??.002)*gaussian(x/.009);
    positions[i*3+2]=z+strength*rear*vertical*(groove-depth*(.8*ridges+.35*fan));
  }
  return {...body,positions,normals:tissueNormals(positions,body.indices)};
}
