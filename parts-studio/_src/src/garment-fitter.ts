// garment-fitter: which part of the body does a garment belong to, and where does it go?
// Order of evidence: user choice > skin weights (rig) > names > position in the body's frame > default.
// Rigid garments are placed with a uniform scale + translation only; their shape is never changed.
import * as THREE from 'three';
import type { GarmentRegion, Part, TRS, Vec3 } from './types';
import type { BodyFeatures, GarmentFeatures } from './features';

export interface RegionGuess {
  region: GarmentRegion;
  source: 'name' | 'rig' | 'position' | 'default';
  confidence: 'high' | 'medium' | 'low';
  why: string;
}

const NAME_RULES: [RegExp, GarmentRegion][] = [
  [/(hat|cap\b|hood|helmet|crown|ribbon|tiara|glasses|earring|headband|帽|フード|冠|リボン|ヘルメット|眼鏡|メガネ|カチューシャ|ヘアバンド)/i, 'head'],
  [/(scarf|collar|necklace|choker|tie\b|muffler|マフラー|スカーフ|ネックレス|襟|チョーカー|ネクタイ)/i, 'neck'],
  [/(shoe|boot|sandal|sneaker|heel|靴|サンダル|ブーツ)/i, 'foot'],
  [/(glove|mitten|bracer|手袋|グローブ)/i, 'hand'],
  [/(sleeve|armband|arm\b|袖|アームバンド)/i, 'arm'],
  [/(sock|stocking|legging|pants|trousers|jeans|shorts|靴下|ズボン|パンツ|レギンス|ショーツ)/i, 'leg'],
  [/(belt|sash|obi|帯|ベルト|waist)/i, 'waist'],
  [/(skirt|スカート|panties|下着)/i, 'pelvis'],
  [/(dress|robe|coat|cape|cloak|jumpsuit|suit|kimono|gown|ワンピ|ローブ|マント|コート|ドレス|着物|全身)/i, 'whole'],
  [/(shirt|top\b|jacket|bodice|vest|tee\b|blouse|sweater|シャツ|上衣|胴|ジャケット|ベスト|トップス|ブラウス|セーター)/i, 'torso'],
];

export function guessRegionByName(names: string[]): { region: GarmentRegion; hit: string } | null {
  for (const n of names) {
    for (const [re, region] of NAME_RULES) if (re.test(n)) return { region, hit: n };
  }
  return null;
}

export function detectRegion(part: Part, gf: GarmentFeatures, bf: BodyFeatures | null, names: string[]): RegionGuess {
  // skinned: look at where the weights are
  if (gf.skinned) {
    const s = gf.groupShare;
    const g = (k: keyof typeof s) => s[k] ?? 0;
    const torso = g('chest') + g('waist') + g('pelvis') + g('neck');
    const arm = g('arm') + g('hand');
    const leg = g('leg') + g('foot');
    if (g('head') > 0.6) return { region: 'head', source: 'rig', confidence: 'high', why: `スキンの重みの ${Math.round(g('head') * 100)}% が頭の骨` };
    if (torso > 0.25 && (arm > 0.08 || leg > 0.15) && torso + arm + leg > 0.8) {
      return { region: 'whole', source: 'rig', confidence: 'high', why: `重みが胴 ${Math.round(torso * 100)}%・腕 ${Math.round(arm * 100)}%・脚 ${Math.round(leg * 100)}% に分布` };
    }
    if (leg > 0.55) return { region: g('foot') > leg * 0.7 ? 'foot' : 'leg', source: 'rig', confidence: 'high', why: `重みの ${Math.round(leg * 100)}% が脚の骨` };
    if (arm > 0.55) return { region: g('hand') > arm * 0.7 ? 'hand' : 'arm', source: 'rig', confidence: 'high', why: `重みの ${Math.round(arm * 100)}% が腕の骨` };
    if (torso > 0.55) {
      const region: GarmentRegion = g('pelvis') > torso * 0.6 ? 'pelvis' : g('waist') > torso * 0.5 ? 'waist' : 'torso';
      return { region, source: 'rig', confidence: 'high', why: `重みの ${Math.round(torso * 100)}% が胴の骨` };
    }
  }
  const byName = guessRegionByName(names);
  if (byName) return { region: byName.region, source: 'name', confidence: 'medium', why: `名前「${byName.hit}」から` };
  if (bf) {
    const H = bf.height;
    const c = gf.box.getCenter(new THREE.Vector3());
    const fy = (c.y - bf.box.min.y) / H;
    const sizeY = gf.size.y / H;
    if (sizeY > 0.5) return { region: 'whole', source: 'position', confidence: 'low', why: `高さが身長の ${Math.round(sizeY * 100)}%` };
    if (fy > 0.84) return { region: 'head', source: 'position', confidence: 'low', why: '位置が頭の高さ' };
    if (fy > 0.58) return { region: 'torso', source: 'position', confidence: 'low', why: '位置が胸の高さ' };
    if (fy > 0.44) return { region: 'pelvis', source: 'position', confidence: 'low', why: '位置が腰の高さ' };
    if (fy > 0.1) return { region: 'leg', source: 'position', confidence: 'low', why: '位置が脚の高さ' };
    return { region: 'foot', source: 'position', confidence: 'low', why: '位置が足の高さ' };
  }
  return { region: 'torso', source: 'default', confidence: 'low', why: '手がかりがないため胴体と仮定' };
}

export interface RigidFit {
  trs: TRS;
  confidence: 'high' | 'medium' | 'low';
  note: string;
  aligned: boolean;
  scale: number;
}

const ident = (): TRS => ({ p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] });

/** target box in body-local space for a region, widened a little for composite regions */
function regionBox(bf: BodyFeatures, region: GarmentRegion, gf: GarmentFeatures): THREE.Box3 {
  const r = bf.regions[region].clone();
  if (region === 'pelvis') {
    // a skirt / short covers the hips and the upper legs
    const legs = bf.regions.leg;
    if (!legs.isEmpty()) r.min.y = Math.min(r.min.y, legs.min.y + (legs.max.y - legs.min.y) * 0.45);
    r.min.x = Math.min(r.min.x, bf.regions.torso.min.x);
    r.max.x = Math.max(r.max.x, bf.regions.torso.max.x);
  }
  if (region === 'leg' && gf.size.y > 0) {
    // trousers start at the waist
    r.max.y = Math.max(r.max.y, bf.regions.pelvis.isEmpty() ? r.max.y : bf.regions.pelvis.max.y);
  }
  return r;
}

export function fitRigid(region: GarmentRegion, gf: GarmentFeatures, bf: BodyFeatures): RigidFit {
  const G = gf.box;
  const gs = gf.size;
  const R = regionBox(bf, region, gf);
  const rs = R.getSize(new THREE.Vector3());
  const rc = R.getCenter(new THREE.Vector3());
  const gc = G.getCenter(new THREE.Vector3());

  // already in the body's frame? (garments made by 仕立て屋 for this very body are)
  const bodyBox = bf.box;
  const inside = bodyBox.clone().expandByScalar(bf.height * 0.35).containsBox(G);
  const wRatio = gs.x / Math.max(1e-6, rs.x);
  const hRatio = gs.y / Math.max(1e-6, rs.y);
  const near = Math.abs(gc.y - rc.y) < Math.max(rs.y, gs.y) * 0.45 && Math.abs(gc.x - rc.x) < Math.max(rs.x, gs.x) * 0.5;
  if (inside && near && wRatio > 0.6 && wRatio < 1.9 && hRatio > 0.45 && hRatio < 2.2 && region !== 'head') {
    return { trs: ident(), confidence: 'medium', note: `身体と同じ座標系に作られた衣服とみなし、そのまま重ねました（${regionLabel(region)}）`, aligned: true, scale: 1 };
  }

  let s: number;
  switch (region) {
    case 'leg':
    case 'arm':
      s = rs.y / Math.max(1e-6, gs.y);
      break;
    case 'foot':
    case 'hand':
      s = Math.max(rs.z, rs.y) / Math.max(1e-6, Math.max(gs.z, gs.y));
      break;
    case 'head':
      s = (rs.x * 1.12) / Math.max(1e-6, gs.x);
      break;
    case 'whole':
      s = rs.y / Math.max(1e-6, gs.y);
      break;
    case 'neck':
      s = (rs.x * 1.35) / Math.max(1e-6, gs.x);
      break;
    default: {
      // torso family: width, tempered by height
      const sx = (rs.x * 1.06) / Math.max(1e-6, gs.x);
      const sy = rs.y / Math.max(1e-6, gs.y);
      s = Math.sqrt(sx * sy);
    }
  }
  s = Math.min(Math.max(s, 1e-3), 1e3);
  const pos = new THREE.Vector3(rc.x - gc.x * s, 0, rc.z - gc.z * s);
  // vertical alignment
  switch (region) {
    case 'whole':
    case 'torso':
    case 'chest':
    case 'neck':
      pos.y = R.max.y - G.max.y * s; // hangs from the shoulders / neck
      break;
    case 'foot':
      pos.y = R.min.y - G.min.y * s; // stands on the floor
      break;
    case 'head':
      pos.y = R.min.y + (R.max.y - R.min.y) * 0.5 - G.min.y * s; // brim around the brow
      break;
    default:
      pos.y = rc.y - gc.y * s;
  }
  const conf: RigidFit['confidence'] = region === 'whole' || region === 'foot' ? 'medium' : 'medium';
  return {
    trs: { p: [pos.x, pos.y, pos.z] as Vec3, r: [0, 0, 0], s: [s, s, s] },
    confidence: conf,
    note: `${regionLabel(region)}に合わせて等倍率 ${s.toFixed(3)} で配置（形状は変更していません）`,
    aligned: false,
    scale: s,
  };
}

const LABEL: Record<GarmentRegion, string> = {
  whole: '全身',
  torso: '胴体',
  chest: '胸部',
  waist: '腰',
  pelvis: '骨盤',
  arm: '腕',
  leg: '脚',
  foot: '足',
  hand: '手',
  neck: '首',
  head: '頭部',
};
export const regionLabel = (r: GarmentRegion): string => LABEL[r];
