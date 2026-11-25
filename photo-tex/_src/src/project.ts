// Project state (M1: parameters + preset). Full *.bust.zip format is milestone M5.
import { BODY_DEFS, BREAST_DEFS, clampToRange, defaultParams, PRESETS, type ModelParams, type PresetName } from './model/params';

export const FORMAT_VERSION = 1;

export interface ProjectJson {
  formatVersion: number;
  preset?: PresetName;
  params?: { body?: Record<string, number>; breast?: Record<string, number> };
}

export interface Project {
  preset: PresetName;
  params: ModelParams;
}

export function parseProject(json: ProjectJson, fallbackPreset: PresetName): Project {
  if (typeof json !== 'object' || json === null) throw new Error('プロジェクトの形式が正しくありません');
  if (typeof json.formatVersion !== 'number' || json.formatVersion > FORMAT_VERSION)
    throw new Error(`対応していない formatVersion です: ${json.formatVersion}`);
  const params = defaultParams();
  Object.assign(params.body, json.params?.body ?? {});
  Object.assign(params.breast, json.params?.breast ?? {});
  clampToRange(BODY_DEFS, params.body as unknown as Record<string, number>);
  clampToRange(BREAST_DEFS, params.breast as unknown as Record<string, number>);
  const preset = json.preset && json.preset in PRESETS ? json.preset : fallbackPreset;
  return { preset, params };
}

export function serializeProject(p: Project): ProjectJson {
  return { formatVersion: FORMAT_VERSION, preset: p.preset, params: { body: { ...p.params.body }, breast: { ...p.params.breast } } };
}
