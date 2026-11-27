import type { BodyMesh } from './body';
import type { BodyParams } from './params';
import { smoothstep } from './interp';
import { tissueNormals } from './tissueDeform';

/** Shallow continuous skin relief for collarbones and shoulder blades. */
export function shapeBoneLandmarks(body:BodyMesh,p:BodyParams):BodyMesh {
  const part=body.parts.find(v=>v.name==='torso');if(!part)return body;
  const positions=body.positions.slice(),ids=new Set(body.indices.subarray(part.start,part.start+part.count));
  const gaussian=(x:number)=>Math.exp(-.5*x*x);
  for(const i of ids){
    const x=positions[i*3],y=positions[i*3+1],z=positions[i*3+2],ax=Math.abs(x);
    if(z>0){
      const start=p.neckBaseWidth*.2,end=p.shoulderWidth*.47,t=(ax-start)/Math.max(.03,end-start);
      if(t>0&&t<1){
        const line=body.keyY.neckBase-.025-.028*t+.006*Math.sin(Math.PI*t)+(p.clavicleOffsetY??0);
        const width=Math.max(.002,(p.clavicleWidth??.012)/2),ends=smoothstep(0,.15,t)*(1-smoothstep(.85,1,t));
        const depth=p.clavicleDepth??.0025;
        positions[i*3+2]+=depth*ends*smoothstep(.008,.045,z)*(gaussian((y-line)/width)-.2*gaussian((y-line+.012)/(width*1.3)));
      }
    }else{
      const centerY=body.keyY.shoulderJoint-.065+(p.scapulaOffsetY??0),centerX=(p.scapulaSpacing??.14)/2;
      const dx=ax-centerX,dy=y-centerY;
      const u=dx-.22*dy,v=dy+.15*dx;
      const patch=gaussian(u/Math.max(.015,(p.scapulaWidth??.08)/2))*gaussian(v/Math.max(.025,(p.scapulaHeight??.12)/2));
      positions[i*3+2]-=(p.backScapula??.0045)*patch*smoothstep(.015,.065,-z);
    }
  }
  return {...body,positions,normals:tissueNormals(positions,body.indices)};
}
