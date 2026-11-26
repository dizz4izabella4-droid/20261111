// Parameters of the full body, organized as 大項目 (group) → 中項目 (section) → 小項目 (slider).
// Internal values: lengths in meters, angles in degrees, indices 0..100.
// Torso heights are measured from the crotch (股), the bottom of the torso.

export type Unit = 'cm' | 'mm' | 'deg' | 'index';

export interface ParamDef {
  key: string;
  label: string;
  unit: Unit;
  def: number;
  min: number;
  max: number;
  note?: string;
}

export interface Section {
  key: string;
  label: string;
  params: ParamDef[];
}

export interface Group {
  key: 'pose' | 'head' | 'torso' | 'breast' | 'arm' | 'leg';
  label: string;
  sections: Section[];
}

export const UNIT_SCALE: Record<Unit, number> = { cm: 100, mm: 1000, deg: 1, index: 1 };
export const UNIT_LABEL: Record<Unit, string> = { cm: 'cm', mm: 'mm', deg: '°', index: '' };
export const UNIT_STEP: Record<Unit, number> = { cm: 0.1, mm: 1, deg: 1, index: 1 };

const P = (key: string, label: string, unit: Unit, def: number, min: number, max: number, note?: string): ParamDef => ({ key, label, unit, def, min, max, note });

export const GROUPS: Group[] = [
  {
    key: 'pose',
    label: '全体',
    sections: [{ key: 'rest', label: '立ち姿', params: [P('armAngle', '腕の開き（立ち姿）', 'deg', 18, 0, 80, '0で真下')] }],
  },
  {
    key: 'head',
    label: '頭・首',
    sections: [
      {
        key: 'head',
        label: '頭（仮の箱）',
        params: [P('headWidth', '頭の幅', 'cm', 0.135, 0.11, 0.21), P('headDepth', '頭の奥行き', 'cm', 0.17, 0.14, 0.25), P('headHeight', '頭の高さ', 'cm', 0.195, 0.17, 0.28)],
      },
      {
        key: 'neck',
        label: '首',
        params: [P('neckLength', '首の長さ', 'cm', 0.07, 0.03, 0.15), P('neckBaseWidth', '首の付け根の幅', 'cm', 0.09, 0.07, 0.15)],
      },
    ],
  },
  {
    key: 'torso',
    label: '胴',
    sections: [
      { key: 'length', label: '長さ', params: [P('torsoHeight', '胴の高さ（股〜首の付け根）', 'cm', 0.598, 0.48, 0.74)] },
      { key: 'chest', label: '肩・胸郭', params: [P('shoulderWidth', '肩幅（肩関節中心間）', 'cm', 0.316, 0.26, 0.46), P('chestDepth', '胸郭の厚み', 'cm', 0.202, 0.15, 0.3)] },
      {
        key: 'underbust',
        label: 'アンダーバスト',
        params: [P('underbustCirc', 'アンダーバスト周径', 'cm', 0.663, 0.56, 1.05), P('underbustHeight', 'アンダーバストの高さ', 'cm', 0.38, 0.3, 0.52, '股から')],
      },
      {
        key: 'waist',
        label: 'ウエスト・へそ',
        params: [
          P('waistCirc', 'ウエスト周径', 'cm', 0.57, 0.48, 1.1),
          P('waistHeight', 'ウエストの高さ', 'cm', 0.327, 0.22, 0.44, '股から'),
          P('navelHeight', 'へその高さ', 'cm', 0.231, 0.14, 0.34, '股から'),
        ],
      },
      {
        key: 'hip',
        label: '腰・お尻',
        params: [
          P('hipCirc', 'ヒップ周径', 'cm', 0.88, 0.72, 1.3),
          P('hipHeight', 'ヒップの高さ（いちばん太い所）', 'cm', 0.09, 0.03, 0.18, '股から'),
          P('hipJointSpacing', '股関節の間隔', 'cm', 0.16, 0.12, 0.26),
        ],
      },
    ],
  },
  {
    key: 'breast',
    label: '胸',
    sections: [
      {
        key: 'shape',
        label: '形',
        params: [
          P('size', '大きさ（ボリューム）', 'index', 26, 0, 100),
          P('projection', '前方への張り出し', 'mm', 0.033, 0, 0.12),
          P('baseWidth', '付け根の幅', 'mm', 0.172, 0.07, 0.22),
          P('baseHeight', '付け根の高さ', 'mm', 0.16, 0.06, 0.21),
          P('upperFullness', '上側の丸み', 'index', 19, 0, 100),
          P('lowerFullness', '下側の丸み', 'index', 81, 0, 100),
        ],
      },
      {
        key: 'place',
        label: '位置・向き',
        params: [
          P('centerHeight', '高さ位置（中心）', 'cm', 0.487, 0.38, 0.62, '股から'),
          P('spacing', '左右の間隔（中心間）', 'mm', 0.121, 0.1, 0.26),
          P('outwardAngle', '外向きの角度', 'deg', 17, 0, 30),
          P('ptosis', '下垂', 'index', 60, 0, 100),
        ],
      },
      {
        key: 'nipple',
        label: '乳頭・乳輪',
        params: [
          P('nippleOffsetX', '乳頭の位置（左右）', 'mm', 0, -0.02, 0.02, '＋で外側'),
          P('nippleOffsetY', '乳頭の位置（上下）', 'mm', 0, -0.025, 0.025, '＋で上'),
          P('nippleDiameter', '乳頭の直径', 'mm', 0.01, 0.004, 0.02),
          P('nippleProjection', '乳頭の高さ', 'mm', 0, 0, 0.015),
          P('areolaDiameter', '乳輪の直径', 'mm', 0.035, 0.015, 0.07),
          P('areolaProjection', '乳輪のふくらみ', 'mm', 0, 0, 0.008),
        ],
      },
    ],
  },
  {
    key: 'arm',
    label: '腕',
    sections: [
      { key: 'upper', label: '上腕', params: [P('upperArmLength', '上腕の長さ（肩〜肘）', 'cm', 0.255, 0.2, 0.38), P('upperArmCirc', '上腕周径', 'cm', 0.235, 0.17, 0.4), P('elbowCirc', '肘周径', 'cm', 0.2, 0.15, 0.33)] },
      { key: 'fore', label: '前腕', params: [P('forearmLength', '前腕の長さ（肘〜手首）', 'cm', 0.21, 0.17, 0.32), P('forearmCirc', '前腕周径', 'cm', 0.2, 0.15, 0.33), P('wristCirc', '手首周径', 'cm', 0.142, 0.11, 0.21)] },
      { key: 'hand', label: '手（仮の箱）', params: [P('handLength', '手の長さ', 'cm', 0.16, 0.13, 0.22), P('handWidth', '手の幅', 'cm', 0.07, 0.055, 0.1), P('handThickness', '手の厚み', 'cm', 0.027, 0.02, 0.05)] },
    ],
  },
  {
    key: 'leg',
    label: '脚',
    sections: [
      { key: 'thigh', label: '太もも', params: [P('thighLength', '太ももの長さ（股関節〜ひざ）', 'cm', 0.355, 0.3, 0.52), P('thighCirc', '太もも周径（付け根）', 'cm', 0.5, 0.38, 0.75), P('kneeCirc', 'ひざ周径', 'cm', 0.32, 0.27, 0.46)] },
      { key: 'shin', label: 'すね', params: [P('shinLength', 'すねの長さ（ひざ〜足首）', 'cm', 0.32, 0.27, 0.46), P('calfCirc', 'ふくらはぎ周径', 'cm', 0.31, 0.25, 0.48), P('ankleCirc', '足首周径', 'cm', 0.195, 0.16, 0.29)] },
      { key: 'foot', label: '足（仮の箱）', params: [P('footLength', '足の長さ', 'cm', 0.22, 0.19, 0.3), P('footWidth', '足の幅', 'cm', 0.085, 0.07, 0.12), P('ankleHeight', '足首の高さ', 'cm', 0.065, 0.05, 0.11)] },
    ],
  },
];

export const ALL_DEFS: ParamDef[] = GROUPS.flatMap((g) => g.sections.flatMap((s) => s.params));

/** flat parameter record (all keys of GROUPS) */
export type BodyParams = Record<string, number>;

export function defaultParams(): BodyParams {
  const o: BodyParams = {};
  for (const d of ALL_DEFS) o[d.key] = d.def;
  return o;
}

export function clampParams(p: BodyParams): BodyParams {
  const o: BodyParams = {};
  for (const d of ALL_DEFS) {
    const v = p[d.key];
    o[d.key] = Number.isFinite(v) ? Math.min(d.max, Math.max(d.min, v)) : d.def;
  }
  return o;
}

export type PresetName = 'light' | 'standard' | 'high';
export const PRESETS: Record<PresetName, { label: string; segments: number; rings: number; limbSegments: number }> = {
  light: { label: '軽量（Light）', segments: 48, rings: 48, limbSegments: 12 },
  standard: { label: '標準（Standard）', segments: 96, rings: 96, limbSegments: 20 },
  high: { label: '高精細（High）', segments: 160, rings: 150, limbSegments: 32 },
};

// ---------------- body-type presets ----------------
export type BodyPresetName = 'female' | 'male';

/**
 * 女性 = the torso and breasts the user tuned in photo-tex (2026-11-26), with the heights moved
 * from photo-tex's bottom cut to the crotch (+14 cm), and rough limb / head proportions of an adult
 * woman; the limbs, neck and head were fitted to the size of the tuned torso (2026-11-26, user
 * feedback: the tuned parts looked too small for the limbs). 男性 = a clearly rugged build.
 */
export const BODY_PRESETS: Record<BodyPresetName, { label: string; params: BodyParams }> = {
  female: { label: '女性', params: defaultParams() },
  male: {
    label: '男性',
    params: {
      ...defaultParams(),
      // 頭・首：太い首、大きめの頭
      headWidth: 0.175, headDepth: 0.21, headHeight: 0.245, neckLength: 0.085, neckBaseWidth: 0.145,
      // 胴：広い肩、厚い胸郭、太い胴回り（くびれ少なめ）
      torsoHeight: 0.67, shoulderWidth: 0.45, chestDepth: 0.27, underbustCirc: 1.02, underbustHeight: 0.45,
      waistCirc: 0.9, waistHeight: 0.3, navelHeight: 0.21, hipCirc: 1.0, hipHeight: 0.08, hipJointSpacing: 0.21,
      // 胸：平らで広い胸筋
      size: 45, projection: 0.014, baseWidth: 0.21, baseHeight: 0.13, upperFullness: 70, lowerFullness: 30,
      centerHeight: 0.53, spacing: 0.22, outwardAngle: 12, ptosis: 0,
      nippleDiameter: 0.007, nippleProjection: 0.0015, areolaDiameter: 0.026, areolaProjection: 0,
      // 腕：太く長い
      upperArmLength: 0.33, upperArmCirc: 0.37, elbowCirc: 0.29, forearmLength: 0.275, forearmCirc: 0.31, wristCirc: 0.195,
      handLength: 0.205, handWidth: 0.098, handThickness: 0.042,
      // 脚：太く長い
      thighLength: 0.45, thighCirc: 0.66, kneeCirc: 0.42, shinLength: 0.41, calfCirc: 0.43, ankleCirc: 0.26,
      footLength: 0.285, footWidth: 0.112, ankleHeight: 0.09,
    },
  },
};

export function presetParams(name: BodyPresetName): BodyParams {
  return { ...BODY_PRESETS[name].params };
}
