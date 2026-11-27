// Project generated geometry into the source image's plane; no browser required.
import { createServer } from 'vite';
import { writeFileSync } from 'node:fs';
import { Vector3 } from 'three';
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { buildBody } = await server.ssrLoadModule('/src/model/body.ts');
  const { presetParams } = await server.ssrLoadModule('/src/model/params.ts');
  const p = presetParams('female'), body = buildBody(p, 'standard');
  if (!body.seams) throw new Error(body.warnings.join('\n'));
  const wrist = new Vector3(...body.bones.find(b=>b.name==='hand_l').head);
  const elbow = new Vector3(...body.bones.find(b=>b.name==='forearm_l').head);
  const along = wrist.clone().sub(elbow).normalize();
  const project = point => { const v = point.clone().sub(wrist); return [775-v.z/p.handWidth*350,775-v.dot(along)/p.handLength*766]; };
  const part = body.parts.find(p=>p.name==='hand_l');
  const indices = [...body.indices.subarray(part.start,part.start+part.count)];
  const ids = [...new Set(indices)], mapping = new Map(ids.map((id,i)=>[id,i]));
  writeFileSync(process.argv[2] || '/tmp/spare-hand-projection.json', JSON.stringify({
    points: ids.map(id=>project(new Vector3().fromArray(body.positions,id*3))),
    indices: indices.map(id=>mapping.get(id)),
    bones: body.bones.filter(b=>b.name.endsWith('_l') && /^(hand|thumb|index|middle|ring|pinky)/.test(b.name)).map(b=>({name:b.name,point:project(new Vector3(...b.head))})),
  }));
} finally { await server.close(); }
