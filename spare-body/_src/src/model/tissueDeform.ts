import { Matrix4, Quaternion, SkinnedMesh, Vector3 } from 'three';
import type { BodyMesh } from './body';
import type { SoftnessField } from './softness';
import { frameRadius } from './frameProfile';

type Cache = { neighbors: { id: number; weight: number }[][]; differential: Float64Array; edges: [number, number, number][]; active: Uint8Array; segment: Int32Array; radius: Float32Array; ends: number[] };
const caches = new WeakMap<BodyMesh, Cache>();
function cacheFor(body: BodyMesh): Cache {
  const old = caches.get(body); if (old) return old;
  const n = body.positions.length / 3, sets = Array.from({ length: n }, () => new Set<number>()), active = new Uint8Array(n);
  const segment = new Int32Array(n).fill(-1), radius = new Float32Array(n), ends = body.bones.map(() => -1);
  const physical: Record<string, string> = { hips: 'spine', spine: 'chest', chest: 'neck' };
  for (const side of ['l','r']) Object.assign(physical, { [`upperarm_${side}`]: `forearm_${side}`, [`forearm_${side}`]: `hand_${side}`, [`thigh_${side}`]: `shin_${side}`, [`shin_${side}`]: `foot_${side}` });
  for (const [a,b] of Object.entries(physical)) ends[body.bones.findIndex(v=>v.name===a)] = body.bones.findIndex(v=>v.name===b);
  for (const part of body.parts) {
    const tissue = part.name === 'torso' || /^(upperarm|forearm|thigh|shin)_[lr]$/.test(part.name);
    for (let i=part.start;i<part.start+part.count;i+=3) {
      const ids=[body.indices[i],body.indices[i+1],body.indices[i+2]];
      for(let k=0;k<3;k++) { sets[ids[k]].add(ids[(k+1)%3]); sets[ids[(k+1)%3]].add(ids[k]); if(tissue) active[ids[k]]=1; }
    }
  }
  // Shared wrist/ankle boundary vertices also belong to limb faces. Explicitly
  // protect the accepted hands and rigid terminal parts after collecting faces.
  for (const part of body.parts) if (/^(hand|foot)_[lr]$/.test(part.name) || /^(head|neck)$/.test(part.name)) {
    for (let i=part.start;i<part.start+part.count;i++) active[body.indices[i]]=0;
  }
  const neighbors = sets.map((set,i)=>[...set].map(id=>{
    const d=Math.hypot(...[0,1,2].map(k=>body.positions[i*3+k]-body.positions[id*3+k]));
    return { id, weight: 1/Math.max(0.001,d) };
  }));
  const differential=new Float64Array(n*3), edges: [number,number,number][]=[];
  const p=new Vector3(), a=new Vector3(), b=new Vector3(), axis=new Vector3(), delta=new Vector3();
  for(let i=0;i<n;i++) {
    let sum=0; for(const j of neighbors[i]) sum+=j.weight;
    for(let k=0;k<3;k++) differential[i*3+k]=body.positions[i*3+k]-(sum?neighbors[i].reduce((v,j)=>v+body.positions[j.id*3+k]*j.weight,0)/sum:body.positions[i*3+k]);
    for(const j of neighbors[i]) if(j.id>i && active[i] && active[j.id]) edges.push([i,j.id,Math.hypot(...[0,1,2].map(k=>body.positions[i*3+k]-body.positions[j.id*3+k]))]);
    if(!active[i])continue;
    // Pick an actual anatomical bone segment among this vertex's influences.
    let largest=-1;
    for(let k=0;k<4;k++) {const index=body.skinIndex[i*4+k],w=body.skinWeight[i*4+k];if(ends[index]>=0&&w>largest){segment[i]=index;largest=w;}}
    if(segment[i]<0)continue;
    const index=segment[i];a.fromArray(body.bones[index].head);b.fromArray(body.bones[ends[index]].head);axis.copy(b).sub(a);
    p.fromArray(body.positions,i*3);const t=Math.max(0,Math.min(1,delta.copy(p).sub(a).dot(axis)/Math.max(1e-9,axis.lengthSq())));
    radius[i]=p.distanceTo(a.addScaledVector(axis,t));
  }
  const value={neighbors,differential,edges,active,segment,radius,ends};caches.set(body,value);return value;
}

/** Volume-preserving skinning, followed by a constrained muscle/soft-tissue
 * surface solve. Rigid frame transforms are never changed. Hands keep their
 * accepted skinning. The result is inverse-mapped for existing mesh APIs. */
export function tissuePositions(body: BodyMesh, mesh: SkinnedMesh, field: SoftnessField | null): Float32Array {
  mesh.updateMatrixWorld(true);mesh.skeleton.update();
  const n=body.positions.length/3,cache=cacheFor(body),matrix=new Matrix4(),q=new Quaternion(),dual=new Quaternion(),tq=new Quaternion();
  const rotations: Quaternion[]=[],duals: Quaternion[]=[];
  for(let i=0;i<body.bones.length;i++) {
    matrix.fromArray(mesh.skeleton.boneMatrices!,i*16);q.setFromRotationMatrix(matrix).normalize();
    tq.set(matrix.elements[12],matrix.elements[13],matrix.elements[14],0);dual.copy(tq).multiply(q);
    rotations.push(q.clone());duals.push(new Quaternion(dual.x*.5,dual.y*.5,dual.z*.5,dual.w*.5));
  }
  let points=new Float64Array(n*3);const target=new Float64Array(n*3),curvature=new Float64Array(n*3),motion=new Float32Array(n);
  const p=new Vector3(),v=new Vector3(),r=new Quaternion(),d=new Quaternion(),translation=new Quaternion();
  let moving=false;
  for(let i=0;i<n;i++) {
    p.fromArray(body.positions,i*3);
    if(!cache.active[i]) {mesh.applyBoneTransform(i,p);p.toArray(points,i*3);p.toArray(target,i*3);continue;}
    const anchor=rotations[body.skinIndex[i*4]];r.set(0,0,0,0);d.set(0,0,0,0);
    for(let k=0;k<4;k++) {
      const index=body.skinIndex[i*4+k],w=body.skinWeight[i*4+k];if(!w)continue;
      const qr=rotations[index],qd=duals[index],sign=anchor.dot(qr)<0?-1:1;
      r.x+=qr.x*w*sign;r.y+=qr.y*w*sign;r.z+=qr.z*w*sign;r.w+=qr.w*w*sign;
      d.x+=qd.x*w*sign;d.y+=qd.y*w*sign;d.z+=qd.z*w*sign;d.w+=qd.w*w*sign;
    }
    const norm=Math.max(1e-9,r.length());r.set(r.x/norm,r.y/norm,r.z/norm,r.w/norm);d.set(d.x/norm,d.y/norm,d.z/norm,d.w/norm);
    const dot=r.dot(d);d.set(d.x-r.x*dot,d.y-r.y*dot,d.z-r.z*dot,d.w-r.w*dot);
    translation.copy(d).multiply(q.copy(r).conjugate());
    p.applyMatrix4(mesh.bindMatrix).applyQuaternion(r).add(v.set(translation.x*2,translation.y*2,translation.z*2)).applyMatrix4(mesh.bindMatrixInverse);
    p.toArray(points,i*3);p.toArray(target,i*3);v.fromArray(cache.differential,i*3).applyQuaternion(r).toArray(curvature,i*3);
    let variance=0;for(let k=0;k<4;k++)variance+=body.skinWeight[i*4+k]*(1-Math.abs(r.dot(rotations[body.skinIndex[i*4+k]])));
    motion[i]=Math.min(1,variance*12);if(motion[i]>1e-5)moving=true;
  }
  if(!moving)return body.positions;
  // Feather the solve around moving weight transitions, not along the bones.
  for(let pass=0;pass<2;pass++){const previous=motion.slice();for(let i=0;i<n;i++)if(cache.active[i])for(const j of cache.neighbors[i])motion[i]=Math.max(motion[i],previous[j.id]*.65);}
  const activation=body.bones.map((_,i)=>cache.ends[i]>=0?Math.sin(Math.min(Math.PI/2,mesh.skeleton.bones[cache.ends[i]].quaternion.angleTo(new Quaternion()))):0);
  const starts=body.bones.map((_,i)=>mesh.skeleton.bones[i].getWorldPosition(new Vector3()).applyMatrix4(mesh.matrixWorld.clone().invert()));
  const sums=new Float64Array(n*3),counts=new Float32Array(n),a=new Vector3(),axis=new Vector3(),relative=new Vector3();
  for(let iteration=0;iteration<7;iteration++) {
    sums.fill(0);counts.fill(0);
    // Muscle fibers resist extreme compression/stretch without making fat rigid.
    for(const [i,j,length]of cache.edges) {
      const active=Math.max(motion[i],motion[j]);if(active<1e-5||length<1e-6)continue;
      const dx=points[j*3]-points[i*3],dy=points[j*3+1]-points[i*3+1],dz=points[j*3+2]-points[i*3+2],distance=Math.hypot(dx,dy,dz);if(distance<1e-8)continue;
      const soft=((field?.softness[i]??.3)+(field?.softness[j]??.3))*.5;
      const minimum=length*(.68-.18*soft),maximum=length*(1.35+.65*soft),desired=Math.max(minimum,Math.min(maximum,distance));
      if(desired===distance)continue;
      const factor=(distance-desired)/distance*.3*active,wi=.08+Math.sqrt(field?.softness[i]??.3),wj=.08+Math.sqrt(field?.softness[j]??.3),sum=wi+wj;
      for(const [id,sign,w]of [[i,1,wi],[j,-1,wj]]){sums[id*3]+=dx*factor*sign*w/sum;sums[id*3+1]+=dy*factor*sign*w/sum;sums[id*3+2]+=dz*factor*sign*w/sum;counts[id]++;}
    }
    const next=points.slice();
    for(let i=0;i<n;i++) {
      if(!cache.active[i]||motion[i]<1e-5)continue;
      const soft=field?.softness[i]??.3,mobility=.12+.75*Math.sqrt(soft);let sum=0;v.set(0,0,0);
      for(const j of cache.neighbors[i]){v.x+=points[j.id*3]*j.weight;v.y+=points[j.id*3+1]*j.weight;v.z+=points[j.id*3+2]*j.weight;sum+=j.weight;}
      if(sum)v.divideScalar(sum).add(a.fromArray(curvature,i*3));else v.fromArray(points,i*3);
      p.fromArray(points,i*3).lerp(v,.32*motion[i]*mobility);
      if(counts[i])p.add(v.fromArray(sums,i*3).multiplyScalar(1/counts[i]));
      // Bone-adjacent tissue stays anchored. Softer tissue distributes the strain.
      p.lerp(a.fromArray(target,i*3),.1*(1-soft)*motion[i]);
      const bone=cache.segment[i];
      if(bone>=0&&cache.ends[bone]>=0) {
        a.copy(starts[bone]);axis.copy(starts[cache.ends[bone]]).sub(a);
        const t=Math.max(0,Math.min(1,relative.copy(p).sub(a).dot(axis)/Math.max(1e-9,axis.lengthSq())));a.addScaledVector(axis,t);relative.copy(p).sub(a);
        const frame=field?.frameRadii?.[bone] ?? frameRadius(body.bones[bone].name);
        const bell=Math.sin(Math.PI*t)**2, contracted=activation[bone]*bell;
        // A firm muscle belly surrounds the core. Flexion thickens its middle;
        // only the softer outer layer can compress substantially at contact.
        const support=frame+(cache.radius[i]-frame)*(.88+.2*contracted-.12*Math.sqrt(soft));
        const minimum=Math.min(cache.radius[i]*(1+.07*contracted),Math.max(frame*1.2,support));
        if(relative.length()<minimum&&relative.lengthSq()>1e-12)p.copy(a).add(relative.setLength(minimum));
      }
      p.toArray(next,i*3);
    }
    points=next;
  }
  const out=body.positions.slice(),skin=new Matrix4(),inverse=new Matrix4();
  for(let i=0;i<n;i++) {
    if(!cache.active[i])continue;skin.elements.fill(0);
    for(let k=0;k<4;k++){const w=body.skinWeight[i*4+k];if(!w)continue;matrix.fromArray(mesh.skeleton.boneMatrices!,body.skinIndex[i*4+k]*16);for(let j=0;j<16;j++)skin.elements[j]+=matrix.elements[j]*w;}
    inverse.copy(mesh.bindMatrixInverse).multiply(skin).multiply(mesh.bindMatrix);if(Math.abs(inverse.determinant())<1e-8)continue;
    p.fromArray(points,i*3).applyMatrix4(inverse.invert()).toArray(out,i*3);
  }
  return out;
}

/** Corner-angle normals remain smooth where dense skin meets coarse joint rows. */
export function tissueNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const out=new Float32Array(positions.length),p=[new Vector3(),new Vector3(),new Vector3()],normal=new Vector3(),a=new Vector3(),b=new Vector3();
  for(let t=0;t<indices.length;t+=3) {
    const ids=[indices[t],indices[t+1],indices[t+2]];
    for(let k=0;k<3;k++)p[k].fromArray(positions,ids[k]*3);
    normal.copy(p[1]).sub(p[0]).cross(a.copy(p[2]).sub(p[0]));if(normal.lengthSq()<1e-20)continue;normal.normalize();
    for(let k=0;k<3;k++) {
      a.copy(p[(k+1)%3]).sub(p[k]);b.copy(p[(k+2)%3]).sub(p[k]);
      const angle=Math.acos(Math.max(-1,Math.min(1,a.dot(b)/Math.max(1e-12,a.length()*b.length())))),i=ids[k]*3;
      out[i]+=normal.x*angle;out[i+1]+=normal.y*angle;out[i+2]+=normal.z*angle;
    }
  }
  for(let i=0;i<out.length;i+=3){const length=Math.hypot(out[i],out[i+1],out[i+2])||1;out[i]/=length;out[i+1]/=length;out[i+2]/=length;}
  return out;
}
