// part-detector: decide whether a loaded model is a face, hair, body or garment.
// Order of trust: explicit metadata > file / node names > structure (skeleton, size, mesh count).
// When nothing is convincing the confidence is 'low' and the UI asks the user.
import * as THREE from 'three';
import type { Part, PartMeta, PartType } from './types';
import { boxIn, bonesOf, meshesOf, skinnedMeshesOf } from './util';

export interface Detection {
  type: PartType;
  source: Part['typeSource'];
  confidence: Part['typeConfidence'];
  reason: string;
}

const KW: Record<PartType, RegExp> = {
  face: /(face|head|顔|頭|elena|skull|エレナ)/i,
  hair: /(hair|髪|strand|bangs?|ponytail|毛|ヘア)/i,
  body: /(spare[-_ ]?body|body|素体|mannequin|スペア|体型|^bodies)/i,
  garment: /(cloth|dress|garment|shirt|skirt|pants|trousers|coat|cape|cloak|hood|hat|cap\b|shoe|boot|glove|belt|sash|ribbon|jacket|robe|衣|服|帽|靴|仕立|装飾|アクセ|accessor|sleeve|scarf|mantle)/i,
};

const HUMANOID_BONE = /(hips|pelvis|spine|chest|neck|head|upperarm|thigh|shoulder)/i;

export function isClothName(n: string): boolean {
  return /^cloth_|^garment_|^dress_|衣装/i.test(n);
}

/** meshes (not bones) whose names mark them as clothes riding on a body file */
export function embeddedGarmentMeshes(object: THREE.Object3D): THREE.Mesh[] {
  return meshesOf(object).filter((m) => isClothName(m.name));
}

export function detectPartType(args: { fileName: string; names: string[]; meta: PartMeta; model: THREE.Object3D }): Detection {
  const { fileName, names, meta, model } = args;
  if (meta.partType) {
    return { type: meta.partType, source: 'metadata', confidence: 'high', reason: `メタデータの partType「${meta.partType}」` };
  }
  const bones = bonesOf(model);
  const skinned = skinnedMeshesOf(model);
  const humanoid = bones.filter((b) => HUMANOID_BONE.test(b.name)).length;
  if (skinned.length && bones.length >= 15 && humanoid >= 6) {
    const cloth = embeddedGarmentMeshes(model).length;
    return { type: 'body', source: 'structure', confidence: 'high', reason: `人体の骨格（${bones.length}本）をもつスキンメッシュ${cloth ? `（衣装 ${cloth} 点を含む）` : ''}` };
  }
  const stem = fileName.replace(/\.[^.]+$/, '');
  const score: Record<PartType, number> = { face: 0, hair: 0, body: 0, garment: 0 };
  const why: Partial<Record<PartType, string>> = {};
  for (const t of Object.keys(KW) as PartType[]) {
    if (KW[t].test(stem)) {
      score[t] += 3;
      why[t] = `ファイル名「${fileName}」`;
    }
    const hit = names.find((n) => KW[t].test(n));
    if (hit) {
      score[t] += 1;
      why[t] ??= `ノード名「${hit}」`;
    }
  }
  const ranked = (Object.keys(score) as PartType[]).sort((a, b) => score[b] - score[a]);
  if (score[ranked[0]] >= 1 && score[ranked[0]] > score[ranked[1]]) {
    // a file name hit is convincing (medium); a lone node-name hit is only a hint (low: the UI asks)
    return { type: ranked[0], source: 'filename', confidence: score[ranked[0]] >= 3 ? 'medium' : 'low', reason: why[ranked[0]] ?? '名前' };
  }
  // geometry-based guess
  const size = boxIn(model, null).getSize(new THREE.Vector3());
  const maxE = Math.max(size.x, size.y, size.z);
  const meshes = meshesOf(model);
  if (skinned.length && bones.length >= 8) {
    return { type: 'body', source: 'structure', confidence: 'low', reason: `スキンメッシュ（骨 ${bones.length} 本）` };
  }
  if (meshes.length >= 12 && maxE < 3) {
    return { type: 'hair', source: 'structure', confidence: 'low', reason: `細かいメッシュが多い（${meshes.length}個）ため髪型の可能性` };
  }
  return { type: 'garment', source: 'structure', confidence: 'low', reason: `大きさ ${maxE.toFixed(2)} の単体メッシュ。種別を判定できませんでした` };
}
