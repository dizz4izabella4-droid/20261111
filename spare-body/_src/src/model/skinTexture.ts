import sampleSkin from '../assets/sampleSkin';
export interface SkinTextureSettings { source: string | null; name: string; enabled: boolean; repeat: number; }
export const defaultSkinTexture = (): SkinTextureSettings => ({ source: sampleSkin, name: 'サンプル肌テクスチャ', enabled: false, repeat: 6 });
export function normalizeSkinTexture(input?: SkinTextureSettings | null): SkinTextureSettings {
  if (input == null) return defaultSkinTexture();
  if (input.source != null && (typeof input.source !== 'string' || input.source.length > 16 * 1024 * 1024 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(input.source))) throw new Error('肌テクスチャの保存画像が不正です。');
  return { source: input.source ?? null, name: typeof input.name === 'string' ? input.name.slice(0, 200) : '肌テクスチャ',
    enabled: input.enabled !== false && !!input.source, repeat: Number.isFinite(input.repeat) ? Math.min(20, Math.max(1, input.repeat)) : 6 };
}
