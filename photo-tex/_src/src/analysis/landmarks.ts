// Landmark definitions per view (SPEC 6.3) and their 3D positions on the current template.
import type { BodyModel } from '../model/mesh';
import { ArcTable } from '../model/torso';
import type { ViewId } from './camera';

export interface LandmarkDef {
  id: string;
  label: string;
  optional?: boolean;
}

const L = (id: string, label: string, optional = false): LandmarkDef => ({ id, label, optional });

export const FRONT_LANDMARKS: LandmarkDef[] = [
  L('neckFront', '首の付け根中央（胸骨上端）'),
  L('acromionR', '右肩峰'),
  L('acromionL', '左肩峰'),
  L('axillaFrontR', '右腋の前端'),
  L('axillaFrontL', '左腋の前端'),
  L('nippleR', '右乳頭', true),
  L('nippleL', '左乳頭', true),
  L('waistR', '右ウエスト側端'),
  L('waistL', '左ウエスト側端'),
  L('navel', 'へそ'),
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
    L(`nipple${side}`, '乳頭（最前点）', true),
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
