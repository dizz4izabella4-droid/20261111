import { BufferAttribute, BufferGeometry, Matrix4, SkinnedMesh, Vector3 } from 'three';
import type { BodyMesh } from './body';
import type { BodyParams } from './params';
import type { SoftnessField } from './softness';
import { Pchip, smoothstep } from './interp';

/** One continuous skin with two posterior domes, not intersecting spheres. */
export function shapeGlutes(body: BodyMesh, p: BodyParams): BodyMesh {
  const amount = (p.gluteRoundness ?? 0) / 100; if (!amount && !(p.gluteCleft ?? 0)) return body;
  const left = body.bones.find(b => b.name === 'thigh_l')!.head;
  const right = body.bones.find(b => b.name === 'thigh_r')!.head;
  const hipY = (left[1] + right[1]) / 2, hipZ = (left[2] + right[2]) / 2;
  const widthScale=(p.gluteWidthScale ?? 100)/100;
  const width = p.hipCirc * 0.19 * widthScale, height = p.hipCirc * 0.135 * (p.gluteHeightScale ?? 100)/100;
  const tailStrength=(p.coccyxSmooth ?? 100)/100;
  const centerY = body.crotchY + p.hipHeight - 0.018 + (p.glutePositionY ?? 0), domeX = p.hipJointSpacing * 0.36 * (p.gluteSeparation ?? 100)/100, sigma = width * 0.31;
  const eligible = new Set<number>();
  for (const part of body.parts) if (part.name === 'torso' || /^thigh_[lr]$/.test(part.name)) {
    for (let i = part.start; i < part.start + part.count; i++) eligible.add(body.indices[i]);
  }
  const positions = body.positions.slice();
  for (const i of eligible) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    const dy = (y - centerY) / height;
    if (Math.abs(dy) >= 1 || Math.abs(x) >= width) continue;
    const weight = (1 - smoothstep(0.65, 1, Math.abs(dy)))
      * (1 - smoothstep(width * 0.8, width, Math.abs(x))) * smoothstep(0.015, 0.075, hipZ - z);
    if (!weight) continue;
    const vertical = Math.exp(-2 * dy * dy);
    const lobes = Math.exp(-0.5 * ((x - domeX) / sigma) ** 2) + Math.exp(-0.5 * ((x + domeX) / sigma) ** 2);
    const cleft = (p.gluteCleft ?? 0.014) * Math.exp(-0.5 * (x / (p.gluteCleftWidth ?? .012)) ** 2);
    // Add a shallow pair of domes to the existing pelvis. An absolute
    // ellipsoid projection creates a pinched rim when the hip is flexed.
    positions[i * 3 + 2] = z + (cleft - p.hipCirc * .19 * 0.06 * (p.gluteProjectionScale ?? 100)/100 * lobes * amount) * vertical * weight;
    positions[i * 3] = x * (1 + (widthScale - 1) * weight * .35 * amount);
  }
  // The midline is an inset between the cheeks, never a posterior tail.
  // Follow the adjacent cheek envelope at each height rather than projecting
  // the whole pelvis onto a new shape, preserving the accepted two lobes.
  const samplesY:number[]=[], samplesZ:number[]=[];
  for(let row=0;row<=34;row++) {
    const y=hipY-.16+row*.01, values:number[]=[];
    for(const i of eligible) {
      const x=Math.abs(positions[i*3]),yy=positions[i*3+1],z=positions[i*3+2];
      if(x>=.035&&x<=width*.72&&Math.abs(yy-y)<.014&&z<hipZ-.035)values.push(z);
    }
    if(values.length>=3){values.sort((a,b)=>a-b);samplesY.push(y);samplesZ.push(values[Math.floor(values.length*.15)]);}
  }
  if(samplesY.length>=2) {
    const envelope=new Pchip(samplesY,samplesZ);
    for(const i of eligible) {
      const x=Math.abs(positions[i*3]),y=positions[i*3+1],z=positions[i*3+2];
      if(x>=.065||y<samplesY[0]||y>samplesY[samplesY.length-1]||z>=hipZ-.025)continue;
      const weight=(1-smoothstep(.012,.065,x))*smoothstep(.025,.065,hipZ-z);
      const inset=(p.gluteCleft??.014)*Math.exp(-.5*(x/((p.gluteCleftWidth??.012)*1.5))**2);
      const bound=envelope.eval(y)+inset,difference=z-bound;
      const rounded=.5*(z+bound+Math.sqrt(difference*difference+.004**2));
      positions[i*3+2]=z+(rounded-z)*weight*amount*tailStrength;
    }
  }
  // Round the remaining coccyx transition, leaving the lateral cheek volumes intact.
  const neighbors = new Map<number, Set<number>>();
  for (let i=0;i<body.indices.length;i+=3) {
    const ids=[body.indices[i],body.indices[i+1],body.indices[i+2]];
    for(let k=0;k<3;k++) if(eligible.has(ids[k])) {const set=neighbors.get(ids[k])??new Set<number>();set.add(ids[(k+1)%3]);set.add(ids[(k+2)%3]);neighbors.set(ids[k],set);}
  }
  const baseline=positions.slice();
  for(let pass=0;pass<7;pass++) {
    const previous=positions.slice();
    for(const [i,nb]of neighbors) {
      const x=baseline[i*3],y=baseline[i*3+1],z=baseline[i*3+2];
      const cap=Math.exp(-0.5*(x/.035)**2-0.5*((y-hipY-.025)/.05)**2)*smoothstep(.025,.08,hipZ-z);
      if(cap<.01||!nb.size)continue;
      for(const k of [1,2]) {let mean=0;for(const j of nb)mean+=previous[j*3+k];mean/=nb.size;
        positions[i*3+k]=Math.max(baseline[i*3+k]-.006,Math.min(baseline[i*3+k]+.006,previous[i*3+k]+(mean-previous[i*3+k])*.42*cap*tailStrength));}
    }
  }
  const geometry = new BufferGeometry(); geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(body.indices, 1)); geometry.computeVertexNormals();
  const normals = (geometry.getAttribute('normal').array as Float32Array).slice(); geometry.dispose();
  return { ...body, positions, normals, gluteShape: { hipY, hipZ, height, width } };
}

/** Fair only the posed posterior tissue, preserving the central cleft. The two
 * halves remain on their own side; any closing pressure flattens soft tissue
 * and redistributes it forward instead of allowing the cheeks to cross. */
export function gluteContactPositions(body: BodyMesh, mesh: SkinnedMesh, input: Float32Array, field: SoftnessField | null): Float32Array {
  const shape = body.gluteShape; if (!shape) return input;
  const count = input.length / 3, masks = new Float32Array(count), neighbors = Array.from({ length: count }, () => new Set<number>());
  for (const part of body.parts) if (part.name === 'torso' || /^thigh_[lr]$/.test(part.name)) {
    for (let i = part.start; i < part.start + part.count; i += 3) {
      const ids = [body.indices[i], body.indices[i + 1], body.indices[i + 2]];
      for (const id of ids) {
        const x = body.positions[id * 3], y = body.positions[id * 3 + 1], z = body.positions[id * 3 + 2];
        masks[id] = (1 - smoothstep(shape.height * 0.65, shape.height * 1.5, Math.abs(y - (shape.hipY - 0.018))))
          * (1 - smoothstep(shape.width * 0.85, shape.width * 1.1, Math.abs(x))) * smoothstep(0.01, 0.065, shape.hipZ - z);
      }
      for (let k = 0; k < 3; k++) { neighbors[ids[k]].add(ids[(k + 1) % 3]); neighbors[ids[(k + 1) % 3]].add(ids[k]); }
    }
  }
  mesh.updateMatrixWorld(true); mesh.skeleton.update();
  let points = Array.from({ length: count }, (_, i) => masks[i] ? mesh.applyBoneTransform(i, new Vector3().fromArray(input, i * 3)) : null);
  for (let pass = 0; pass < 5; pass++) for (const lambda of [0.42, -0.39]) {
    const previous = points;
    points = previous.map((point, i) => {
      if (!point || !masks[i]) return point;
      const sign = Math.sign(body.positions[i * 3]), mean = new Vector3(); let total = 0;
      for (const j of neighbors[i]) {
        const q = previous[j]; if (!q) continue;
        if (sign && Math.sign(body.positions[j * 3]) !== sign) continue;
        mean.add(q); total++;
      }
      if (!total) return point;
      const softness = field?.softness[i] ?? 0.3;
      const candidate = point.clone().lerp(mean.divideScalar(total), lambda * masks[i] * (0.45 + 0.55 * softness));
      if (!sign) candidate.x = 0;
      else {
        const gap = 0.0004 + 0.0006 * (1 - softness);
        const pressure = Math.max(0, gap - candidate.x * sign);
        candidate.x += sign * pressure;
        candidate.z += pressure * softness;
      }
      // Keep the crease narrow while fairing each dome independently.
      if (Math.abs(body.positions[i * 3]) < 0.012) candidate.z = point.z + (candidate.z - point.z) * 0.2;
      return candidate;
    });
  }
  const out = input.slice(), matrix = new Matrix4(), skin = new Matrix4(), inverse = new Matrix4();
  const index = mesh.geometry.getAttribute('skinIndex'), weight = mesh.geometry.getAttribute('skinWeight');
  points.forEach((point, i) => {
    if (!point) return;
    skin.elements.fill(0);
    for (let k = 0; k < 4; k++) {
      const w = weight.getComponent(i, k); if (!w) continue;
      matrix.fromArray(mesh.skeleton.boneMatrices!, index.getComponent(i, k) * 16);
      for (let j = 0; j < 16; j++) skin.elements[j] += matrix.elements[j] * w;
    }
    inverse.copy(mesh.bindMatrixInverse).multiply(skin).multiply(mesh.bindMatrix);
    if (Math.abs(inverse.determinant()) >= 1e-8) point.applyMatrix4(inverse.invert()).toArray(out, i * 3);
  });
  return out;
}
