// auto-fitter: compute where each part should go. Pure computation — it returns transforms and
// notes; the assembly decides how to apply them (keeping manual edits, remembering the result).
//   body  = the reference
//   face  -> body (head root onto the neck top, head scaled to the body's proportions)
//   hair  -> face (same coordinate system if it clearly is one, otherwise cap-to-skull fit)
//   garment -> body (rig-follow when the skeletons are compatible, otherwise region fit)
import * as THREE from 'three';
import type { FitMessage, GarmentRegion, Part, TRS, Vec3 } from './types';
import type { BodyFeatures, FaceFeatures, GarmentFeatures, HairFeatures } from './features';
import { detectRegion, fitRigid, regionLabel } from './garment-fitter';
import { checkRigCompat } from './rig-retargeter';
import type { RigCompat } from './rig-retargeter';
import { isIdentityOrientation } from './coordinate-normalizer';
import { matrixFromTRS, trsFromMatrix } from './util';

export interface FitOutcome {
  id: string;
  /** parent-local transform (face/body/garments: assembly space; hair: face space when `parentId` is the face) */
  trs: TRS;
  parentId: string | null;
  status: 'ok' | 'adjust' | 'unknown' | 'unsupported';
  confidence: 'high' | 'medium' | 'low' | 'none';
  note: string;
  messages: FitMessage[];
  garment?: { region: GarmentRegion; regionSource: 'name' | 'rig' | 'position' | 'user' | 'default'; rigMode: 'follow' | 'independent' | 'none'; rigInfo: string; rigCompatible: boolean };
}

export interface FitContext {
  parts: Part[];
  body: Part | null;
  face: Part | null;
  bodyF: BodyFeatures | null;
  faceF: FaceFeatures | null;
  hairF: (p: Part) => HairFeatures;
  garmentF: (p: Part) => GarmentFeatures;
}

const ident = (): TRS => ({ p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] });

function toAssembly(body: Part, local: TRS): TRS {
  body.root.updateMatrix();
  const m = new THREE.Matrix4().multiplyMatrices(body.root.matrix, matrixFromTRS(local));
  return trsFromMatrix(m);
}

/** Scale and place the face on the body. Everything is measured in the body's own frame first. */
export function fitFace(face: Part, ctx: FitContext): FitOutcome {
  const messages: FitMessage[] = [];
  const body = ctx.body;
  const bf = ctx.bodyF;
  const ff = ctx.faceF;
  if (!body || !bf || !ff) {
    return {
      id: face.id,
      trs: ident(),
      parentId: null,
      status: 'unknown',
      confidence: 'none',
      note: '身体が未読込のため配置していません（読み込んだ位置のまま）',
      messages: [{ level: 'info', text: '身体を読み込むと、首の位置と頭の大きさを自動で合わせます。' }],
    };
  }
  const H = bf.height;
  // target head height: the body's own head (a placeholder box in spare-body) clamped to a natural proportion
  let target = bf.headH;
  const lo = H / 8.2;
  const hi = H / 6.5;
  if (!bf.headHasGeometry || target < lo || target > hi) {
    target = Math.min(hi, Math.max(lo, bf.headHasGeometry ? target : H / 7.5));
    if (!bf.headHasGeometry) messages.push({ level: 'info', text: `身体に頭のメッシュが無いため、身長の1/7.5（${(H / 7.5).toFixed(3)}m）を頭の高さの基準にしました。` });
  }
  const s = target / Math.max(1e-6, ff.headH);
  // placement
  const neckAxis = new THREE.Vector3(bf.neckTop[0], 0, bf.neckTop[2]);
  let rootPoint: THREE.Vector3; // point on the face that goes onto the body's neck
  let targetPoint: THREE.Vector3;
  if (ff.hasNeck && ff.neckBase) {
    // the face brings its own neck: join the two necks, hiding the seam inside the shorter overlap
    rootPoint = new THREE.Vector3(ff.neckBase[0], ff.box.min.y, ff.neckBase[2]);
    targetPoint = new THREE.Vector3(bf.neckBase[0], bf.neckBase[1] - 0.012 * H, bf.neckBase[2]);
    messages.push({ level: 'info', text: '顔データに首が含まれているため、顔の首の中心を身体の首の中心に、首の下端を身体の首の上端付近に重ねました。' });
    const bnW = bf.regions.neck.max.x - bf.regions.neck.min.x;
    if (bnW > 0 && ff.neckW > 0) {
      const ratio = (ff.neckW * s) / bnW;
      if (ratio < 0.7 || ratio > 1.4) {
        messages.push({ level: 'warn', text: `顔の首の太さ（${(ff.neckW * s * 100).toFixed(1)}cm）が身体の首（${(bnW * 100).toFixed(1)}cm）の ${(ratio * 100).toFixed(0)}% で、つなぎ目に段差が出ます。身体の首の太さ（対応する場合）か頭の大きさで調整してください。` });
      }
    }
  } else {
    // no neck on the face: the neck of the body goes up into the jaw
    rootPoint = new THREE.Vector3(ff.headRoot[0], ff.headRoot[1], ff.headRoot[2]);
    const overlap = 0.006 * (H / 1.5);
    targetPoint = new THREE.Vector3(neckAxis.x, bf.neckBase[1] - overlap, neckAxis.z);
    // if the body's neck is longer than its top (neckTop above neckBase), meet in the middle of the stub
    if (bf.neckTop[1] > bf.neckBase[1] && !bf.headHasGeometry) targetPoint.y = bf.neckTop[1] - overlap;
  }
  const t = new THREE.Vector3(targetPoint.x - rootPoint.x * s, targetPoint.y - rootPoint.y * s, targetPoint.z - rootPoint.z * s);
  const local: TRS = { p: [t.x, t.y, t.z], r: [0, 0, 0], s: [s, s, s] };
  const trs = toAssembly(body, local);
  let status: FitOutcome['status'] = 'ok';
  let confidence: FitOutcome['confidence'] = 'high';
  const ratio = s;
  if (ratio < 0.25 || ratio > 4) {
    status = 'adjust';
    confidence = 'low';
    messages.push({ level: 'warn', text: `頭の大きさの補正倍率が ${ratio.toFixed(2)} 倍と大きく、単位や向きの取り違えの可能性があります。` });
  }
  const aspect = ff.headW / Math.max(1e-6, ff.headH);
  const bodyAspect = bf.head.getSize(new THREE.Vector3()).x / Math.max(1e-6, bf.headH);
  if (bf.headHasGeometry && Math.abs(aspect - bodyAspect) / bodyAspect > 0.5) {
    messages.push({ level: 'info', text: `顔の縦横比（幅/高さ ${aspect.toFixed(2)}）が身体の頭の仮形状（${bodyAspect.toFixed(2)}）と違います。頭は等倍で合わせています。` });
  }
  return {
    id: face.id,
    trs,
    parentId: null,
    status,
    confidence,
    note: `頭の高さ ${target.toFixed(3)}m に合わせて ${s.toFixed(3)} 倍、首の上端に装着`,
    messages,
  };
}

/** Hair onto the face. The hair's frame is the face's frame when both came from the same head. */
export function fitHair(hair: Part, ctx: FitContext): FitOutcome {
  const hf = ctx.hairF(hair);
  const messages: FitMessage[] = [];
  const face = ctx.face;
  const ff = ctx.faceF;
  if (face && ff) {
    const faceBox = ff.box;
    const capW = hf.cap.max.x - hf.cap.min.x;
    const sameFrame =
      Math.abs(hf.top - faceBox.max.y) < 0.14 * ff.height &&
      Math.abs(hf.capCx - ff.skullCx) < 0.25 * ff.headW &&
      Math.abs(hf.capCz - ff.skullCz) < 0.3 * ff.headD &&
      capW / ff.headW > 0.8 &&
      capW / ff.headW < 1.8;
    if (sameFrame) {
      return {
        id: hair.id,
        trs: ident(),
        parentId: face.id,
        status: 'ok',
        confidence: 'high',
        note: '髪と顔が同じ座標系（同じ頭部モデルから作られた髪）のため、顔にそのまま重ねました',
        messages: [{ level: 'info', text: '位置・大きさは顔との相対 0 / 等倍。顔を動かすと髪も一緒に動きます。' }],
      };
    }
    // cap-to-skull fit
    const targetW = ff.headW * 1.1;
    let s = targetW / Math.max(1e-6, capW);
    s = Math.min(Math.max(s, 0.05), 20);
    const crown = new THREE.Vector3(hf.capCx, hf.top, hf.capCz);
    const targetCrown = new THREE.Vector3(ff.skullCx, faceBox.max.y + 0.02 * ff.headH, ff.skullCz);
    const t = targetCrown.sub(crown.multiplyScalar(s));
    let status: FitOutcome['status'] = 'adjust';
    let conf: FitOutcome['confidence'] = 'medium';
    if (s < 0.4 || s > 2.5) {
      conf = 'low';
      messages.push({ level: 'warn', text: `髪の大きさの補正が ${s.toFixed(2)} 倍と大きく、髪の単位や向きの取り違えの可能性があります。` });
    } else status = 'ok';
    messages.push({ level: 'info', text: '髪の頭頂部と幅から推定して合わせました。前髪・後ろ髪の位置は目で確認してください。' });
    return {
      id: hair.id,
      trs: { p: [t.x, t.y, t.z], r: [0, 0, 0], s: [s, s, s] },
      parentId: face.id,
      status,
      confidence: conf,
      note: `髪の頭頂部を顔の頭頂に合わせ、${s.toFixed(3)} 倍で配置`,
      messages,
    };
  }
  if (ctx.body && ctx.bodyF) {
    // no face yet: put it on the body's head
    const bf = ctx.bodyF;
    const hb = bf.head;
    const hs = hb.getSize(new THREE.Vector3());
    const hc = hb.getCenter(new THREE.Vector3());
    const capW = hf.cap.max.x - hf.cap.min.x;
    const s = Math.min(Math.max((hs.x * 1.12) / Math.max(1e-6, capW), 0.05), 20);
    const t = new THREE.Vector3(hc.x - hf.capCx * s, hb.max.y + 0.015 * bf.headH - hf.top * s, hc.z - hf.capCz * s);
    return {
      id: hair.id,
      trs: toAssembly(ctx.body, { p: [t.x, t.y, t.z], r: [0, 0, 0], s: [s, s, s] }),
      parentId: null,
      status: 'adjust',
      confidence: 'low',
      note: `顔が未読込のため、身体の頭の仮形状に ${s.toFixed(3)} 倍で合わせました`,
      messages: [{ level: 'warn', text: '顔を読み込むと、顔に合わせて自動調整し直します。' }],
    };
  }
  return { id: hair.id, trs: ident(), parentId: null, status: 'unknown', confidence: 'none', note: '顔・身体が未読込のため配置していません', messages: [{ level: 'info', text: '顔または身体を読み込むと自動で合わせます。' }] };
}

/** Garment onto the body: rig-follow when compatible, otherwise place by region. */
export function fitGarment(g: Part, ctx: FitContext, forced?: GarmentRegion, forceIndependent = false): FitOutcome {
  const messages: FitMessage[] = [];
  const body = ctx.body;
  const bf = ctx.bodyF;
  const gf = ctx.garmentF(g);
  const names: string[] = [];
  g.model.traverse((o) => {
    if (o.name && !(o as THREE.Bone).isBone) names.push(o.name);
  });
  names.unshift(g.fileName);
  let rig: RigCompat | null = null;
  if (body) rig = checkRigCompat(g.model, body.model);
  const guess = forced
    ? { region: forced, source: 'user' as const, confidence: 'high' as const, why: 'ユーザー指定' }
    : detectRegion(g, gf, bf, names);
  if (!body || !bf) {
    return {
      id: g.id,
      trs: ident(),
      parentId: null,
      status: 'unknown',
      confidence: 'none',
      note: '身体が未読込のため配置していません（読み込んだ位置のまま）',
      messages: [{ level: 'info', text: '身体を読み込むと、装着部位を判定して自動でフィットします。' }],
      garment: { region: guess.region, regionSource: guess.source, rigMode: 'none', rigInfo: rig?.reason ?? '', rigCompatible: false },
    };
  }
  const rigOk = !!rig && rig.compatible && isIdentityOrientation(g.orient) && !forceIndependent;
  if (rig && rig.compatible && !isIdentityOrientation(g.orient)) {
    messages.push({ level: 'warn', text: 'リグは互換ですが、座標の変換（単位・向き）が掛かっているため、骨への追従は使わず通常配置にしました。' });
  }
  if (rigOk && rig) {
    const off = rig.maxBoneOffset / Math.max(1e-6, bf.height);
    const regionTxt = `装着部位：${regionLabel(guess.region)}（${guess.why}）`;
    const st: FitOutcome['status'] = off > 0.03 ? 'adjust' : 'ok';
    if (off > 0.03) messages.push({ level: 'warn', text: `衣服と身体の骨の位置が最大 ${(rig.maxBoneOffset * 100).toFixed(1)}cm ずれています（身長比 ${(off * 100).toFixed(1)}%）。骨の対応付けで補正されますが、形が崩れる場合は「骨に追従」を外して通常配置にしてください。` });
    messages.push({ level: 'info', text: rig.reason });
    return {
      id: g.id,
      trs: ident(),
      parentId: null,
      status: st,
      confidence: 'high',
      note: `骨に追従（既存のスケルトン・ウェイトを維持）。${regionTxt}`,
      messages,
      garment: { region: guess.region, regionSource: guess.source, rigMode: 'follow', rigInfo: rig.reason, rigCompatible: true },
    };
  }
  if (rig && rig.skinned && !rig.compatible) messages.push({ level: 'info', text: rig.reason });
  const fit = fitRigid(guess.region, gf, bf);
  const trs = toAssembly(body, fit.trs);
  let status: FitOutcome['status'] = 'ok';
  if (guess.confidence === 'low') {
    status = 'adjust';
    messages.push({ level: 'warn', text: `装着部位を確信できません（${guess.why}）。「装着部位」を確認してください。` });
  }
  return {
    id: g.id,
    trs,
    parentId: null,
    status,
    confidence: guess.confidence === 'low' ? 'low' : fit.confidence,
    note: `${fit.note}。装着部位：${regionLabel(guess.region)}（${guess.why}）`,
    messages,
    garment: { region: guess.region, regionSource: guess.source, rigMode: rig && rig.skinned ? 'independent' : 'none', rigInfo: rig?.reason ?? '', rigCompatible: !!rig?.compatible },
  };
}

export const IDENT = ident;
export type { Vec3 };
