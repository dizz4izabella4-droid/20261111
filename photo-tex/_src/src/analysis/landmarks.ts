// Landmark definitions per view (SPEC 6.3) and their 3D positions on the current template.
import type { BodyModel } from '../model/mesh';
import { ArcTable } from '../model/torso';
import type { ViewId } from './camera';

export interface LandmarkDef {
  id: string;
  label: string;
  /** list heading the landmark is shown under */
  group: 'torso' | 'breast';
}

// All landmarks are optional: place the ones visible in the photo (at least minLandmarks()).
// This allows partial photos, e.g. only the breasts. (User decision 2026-11-26; SPEC 6.3 required
// all but the nipples.)
const L = (id: string, label: string, group: LandmarkDef['group'] = 'torso'): LandmarkDef => ({ id, label, group });

/** finer landmarks around the breasts (added on the user's request 2026-11-26) */
function breastLandmarks(sides: ('R' | 'L')[]): LandmarkDef[] {
  const name = { R: '右', L: '左' };
  const out: LandmarkDef[] = [];
  for (const sd of sides) {
    out.push(
      L(`nipple${sd}`, `${name[sd]}乳頭`, 'breast'),
      L(`breastTop${sd}`, `${name[sd]}乳房の上端`, 'breast'),
      L(`breastBottom${sd}`, `${name[sd]}乳房の下端（下側の付け根）`, 'breast'),
      L(`breastOuter${sd}`, `${name[sd]}乳房の外側端`, 'breast'),
    );
  }
  if (sides.length === 2) out.push(L('cleavage', '胸の谷間（乳頭の高さの中央）', 'breast'), L('xiphoid', 'みぞおち（胸の下の中央）', 'breast'));
  return out;
}

export const FRONT_LANDMARKS: LandmarkDef[] = [
  L('neckFront', '首の付け根中央（胸骨上端）'),
  L('acromionR', '右肩峰'),
  L('acromionL', '左肩峰'),
  L('axillaFrontR', '右腋の前端'),
  L('axillaFrontL', '左腋の前端'),
  L('waistR', '右ウエスト側端'),
  L('waistL', '左ウエスト側端'),
  L('navel', 'へそ'),
  ...breastLandmarks(['R', 'L']),
];

export const BACK_LANDMARKS: LandmarkDef[] = [
  L('neckBack', '首の付け根中央（第7頸椎）'),
  L('acromionR', '右肩峰'),
  L('acromionL', '左肩峰'),
  L('axillaBackR', '右腋の後端'),
  L('axillaBackL', '左腋の後端'),
  L('waistR', '右ウエスト側端'),
  L('waistL', '左ウエスト側端'),
  L('bottomBack', '下端の中央'),
];

function sideLandmarks(side: 'L' | 'R'): LandmarkDef[] {
  return [
    L('neckFront', '首の付け根の前端'),
    L('neckBack', '首の付け根の後端'),
    L(`acromion${side}`, '肩峰'),
    L(`nipple${side}`, '乳頭（最前点）', 'breast'),
    L(`breastTop${side}`, '乳房の上端', 'breast'),
    L(`breastBottom${side}`, '乳房の下端（下側の付け根）', 'breast'),
    L('backChest', '背中の最後点（胸の高さ）'),
    L('waistFront', 'ウエスト前端'),
    L('waistBack', 'ウエスト後端'),
    L('bottomFront', '下端前端'),
    L('bottomBack', '下端後端'),
  ];
}

function unionDefs(a: LandmarkDef[], b: LandmarkDef[]): LandmarkDef[] {
  const out = [...a];
  for (const d of b) if (!out.some((o) => o.id === d.id)) out.push(d);
  return out;
}

export function landmarkDefs(view: ViewId): LandmarkDef[] {
  switch (view) {
    case 'front':
      return FRONT_LANDMARKS;
    case 'back':
      return BACK_LANDMARKS;
    case 'left':
      return sideLandmarks('L');
    case 'right':
      return sideLandmarks('R');
    case 'obliqueLeft':
      return unionDefs(FRONT_LANDMARKS, sideLandmarks('L'));
    case 'obliqueRight':
      return unionDefs(FRONT_LANDMARKS, sideLandmarks('R'));
  }
}

/** minimum number of placed landmarks for the view (oblique: user subset of >= 6) */
export function minLandmarks(view: ViewId): number {
  return view === 'obliqueLeft' || view === 'obliqueRight' ? 6 : 4;
}

/** surface point at height y where |x| = xAbs, on the front (front=true) or back half, side sign */
function surfaceAtX(model: BodyModel, y: number, xAbs: number, sign: 1 | -1, front: boolean): [number, number, number] {
  const t = model.torso;
  const sec = t.section(y);
  // left half θ in (0, π): back half (0, π/2), front half (π/2, π); |x| peaks at π/2
  let lo = front ? Math.PI / 2 : 0;
  let hi = front ? Math.PI : Math.PI / 2;
  const xa = Math.min(xAbs, sec.a * 0.999);
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    const x = Math.abs(t.pointU(mid, y, sec)[0]);
    if (front ? x > xa : x < xa) lo = mid;
    else hi = mid;
  }
  let th = 0.5 * (lo + hi);
  if (sign < 0) th = 2 * Math.PI - th;
  return model.evalAt(th, y, new ArcTable(sec)).pos;
}

/** surface point at breast footprint coordinates (s lateral, t vertical, meters) */
function footprintPoint(model: BodyModel, f: BodyModel['frames'][number], sFoot: number, t: number): [number, number, number] {
  const y = f.yc + t;
  const tab = new ArcTable(model.torso.section(y));
  const th = tab.thetaAt(f.sigma * (f.sB + sFoot));
  return model.evalAt(th, y, tab).pos;
}

function midline(model: BodyModel, y: number, front: boolean): [number, number, number] {
  const th = front ? Math.PI : 0;
  return model.evalAt(th, y).pos;
}

/** 3D template position of a landmark (meters) */
export function landmark3D(model: BodyModel, id: string): [number, number, number] {
  const t = model.torso;
  const k = t.keys;
  const center = (y: number) => {
    const s = t.section(y);
    return s.cz + (s.bf - s.bb) / 2;
  };
  switch (id) {
    case 'neckFront':
      return midline(model, k.neckBase, true);
    case 'neckBack':
      return midline(model, k.neckBase, false);
    case 'acromionL':
      return [t.xs, k.shoulderTop, center(k.shoulderTop)];
    case 'acromionR':
      return [-t.xs, k.shoulderTop, center(k.shoulderTop)];
    case 'axillaFrontL':
      return surfaceAtX(model, k.armpit, t.xs - 0.015, 1, true);
    case 'axillaFrontR':
      return surfaceAtX(model, k.armpit, t.xs - 0.015, -1, true);
    case 'axillaBackL':
      return surfaceAtX(model, k.armpit, t.xs - 0.015, 1, false);
    case 'axillaBackR':
      return surfaceAtX(model, k.armpit, t.xs - 0.015, -1, false);
    case 'nippleL':
    case 'nippleR': {
      const f = model.frames.find((fr) => fr.sigma === (id === 'nippleL' ? 1 : -1))!;
      return model.evalAt(f.thetaN, f.yN).pos;
    }
    case 'waistL':
    case 'waistR': {
      const s = t.section(k.waist);
      return [id === 'waistL' ? s.a : -s.a, k.waist, s.cz];
    }
    case 'navel':
      return midline(model, k.navel, true);
    case 'cleavage': {
      const f = model.frames[0];
      return midline(model, f.yN, true);
    }
    case 'xiphoid':
      return midline(model, k.underbust, true);
    case 'breastTopL':
    case 'breastTopR':
    case 'breastBottomL':
    case 'breastBottomR':
    case 'breastOuterL':
    case 'breastOuterR': {
      const f = model.frames.find((fr) => fr.sigma === (id.endsWith('L') ? 1 : -1))!;
      if (id.startsWith('breastTop')) return footprintPoint(model, f, f.cS, 0.92 * f.H2);
      if (id.startsWith('breastBottom')) {
        // lower edge of the breast: the base ellipse, but not below the inframammary fold
        const y = Math.max(f.yc - 0.92 * f.H2, f.yFold + 0.008);
        return footprintPoint(model, f, f.cS, y - f.yc);
      }
      return footprintPoint(model, f, 0.92 * f.W2, f.cT);
    }
    case 'backChest':
      return midline(model, k.bust, false);
    case 'waistFront':
      return midline(model, k.waist, true);
    case 'waistBack':
      return midline(model, k.waist, false);
    case 'bottomFront':
      return midline(model, 0.002, true);
    case 'bottomBack':
      return midline(model, 0.002, false);
  }
  throw new Error(`unknown landmark ${id}`);
}
