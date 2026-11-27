import { defaultSoftness, normalizeSoftness, SOFTNESS_REGIONS, type SoftnessField, type SoftnessRegion, type SoftnessSettings } from '../model/softness';
import { paramRow, type ParamControl } from './panel';
import type { ParamDef } from '../model/params';

export function softnessPanel(parent: HTMLElement, initial: SoftnessSettings, events: {
  change(value: SoftnessSettings): void;
  impulse(): void;
  stop(): void;
}): { update(settings: SoftnessSettings, field: SoftnessField): void } {
  let settings = normalizeSoftness(initial);
  const controls = new Map<string, ParamControl>();
  parent.innerHTML = `
    <div class="soft-intro"><strong>形に、動きやすさを。</strong>
      <p>骨の近くは硬く、離れたところは柔らかく。腕と胴、深く曲げた太ももと下腹部が接触すると、柔らかい部位ほど多く変形します。</p></div>
    <div class="soft-presets" aria-label="柔らかさのプリセット"></div>
    <div class="soft-summary" role="status" aria-live="polite"></div>
    <div class="line soft-actions"><button class="btn primary" id="testSoftness">揺れを試す</button><button class="btn" id="stopSoftness">止める</button></div>
    <p class="note">横から一度刺激したときの揺れの見本です。移動上限と収まり方を見比べられます。</p>
    <p class="note">GLBには柔らかさのデータを含めます。傀儡で揺らすには、傀儡側の対応が必要です。</p>`;
  const summary = parent.querySelector('.soft-summary') as HTMLElement;
  const presetHost = parent.querySelector('.soft-presets')!;
  for (const [key, label] of [['standard', '標準'], ['firm', '硬め'], ['soft', '柔らかめ'], ['fixed', '全身固定']]) {
    const button = document.createElement('button');
    button.className = 'btn'; button.textContent = label;
    button.addEventListener('click', () => {
      const next = defaultSoftness();
      if (key === 'firm') { next.maxOffset = 0.006; next.damping = 0.8; }
      if (key === 'soft') { next.maxOffset = 0.025; next.damping = 0.35; }
      for (const r of Object.keys(next.regions) as SoftnessRegion[]) {
        next.regions[r] = key === 'fixed' ? 0 : Math.min(1, next.regions[r] * (key === 'firm' ? 0.6 : key === 'soft' ? 1.3 : 1));
      }
      events.change(next);
    });
    presetHost.appendChild(button);
  }
  parent.querySelector('#testSoftness')!.addEventListener('click', events.impulse);
  parent.querySelector('#stopSoftness')!.addEventListener('click', events.stop);
  const group = (title: string, open = false) => {
    const el = document.createElement('details'); el.className = 'g1'; el.open = false;
    const caption = document.createElement('summary'); caption.textContent = title;
    el.appendChild(caption); parent.appendChild(el); return el;
  };
  const regionHost = group('部位ごとの動きやすさ', true);
  const regionNote = document.createElement('p'); regionNote.className = 'note';
  regionNote.textContent = '中央が保存した基準値です。左で硬く、右で柔らかく調整します。数値は0〜100、左右共通です。';
  regionHost.appendChild(regionNote);
  const row = (host: HTMLElement, key: string, label: string, unit: ParamDef['unit'], def: number, min: number, max: number, change: (v: number) => void) => {
    controls.set(key, paramRow(host, { key: `soft_${key}`, label, unit, def, min, max, ...(key in SOFTNESS_REGIONS ? { rangeCenter: def } : {}) }, def, change));
  };
  const defaults = defaultSoftness();
  for (const [key, label] of Object.entries(SOFTNESS_REGIONS)) {
    row(regionHost, key, `${label}の動きやすさ`, 'index', defaults.regions[key as SoftnessRegion] * 100, 0, 100, (v) => {
      events.change({ ...settings, regions: { ...settings.regions, [key]: v / 100 } });
    });
  }
  const motionHost = group('揺れの上限・収まり方', true);
  row(motionHost, 'maxOffset', '最大の移動量', 'mm', defaults.maxOffset, 0, 0.04, (v) => events.change({ ...settings, maxOffset: v }));
  row(motionHost, 'damping', '揺れの収まりやすさ', 'index', defaults.damping * 100, 0, 100, (v) => events.change({ ...settings, damping: v / 100 }));
  const motionNote = document.createElement('p'); motionNote.className = 'note';
  motionNote.textContent = '最大の移動量は柔らかさ 1 の上限です。硬い部位ほど移動量が小さくなります。';
  motionHost.appendChild(motionNote);
  const advanced = group('骨からの距離・ならし');
  row(advanced, 'radius', 'フレームの太さ（基準半径）', 'mm', defaults.radius, 0, 0.1, (v) => events.change({ ...settings, radius: v }));
  row(advanced, 'hardThickness', '固定する厚み', 'mm', defaults.hardThickness, 0, 0.099, (v) => events.change({ ...settings, hardThickness: v }));
  row(advanced, 'softThickness', '最大に柔らかくなる厚み', 'mm', defaults.softThickness, 0.001, 0.2, (v) => events.change({ ...settings, softThickness: v }));
  row(advanced, 'smoothing', 'ならし回数', 'index', defaults.smoothing, 0, 10, (v) => events.change({ ...settings, smoothing: v }));
  const advancedNote = document.createElement('p'); advancedNote.className = 'note';
  advancedNote.textContent = '部位ごとの太さを持つ骨の芯を、基準半径で拡縮します。芯の外側は硬めの筋肉、その外側は柔らかい表層です。「最大に柔らかくなる厚み」は「固定する厚み」より 1 mm 以上大きく保ちます。';
  advanced.appendChild(advancedNote);
  return {
    update(next, field) {
      settings = normalizeSoftness(next);
      for (const [key, control] of controls) {
        const value = key in settings.regions ? settings.regions[key as SoftnessRegion] * 100 : settings[key as keyof Omit<SoftnessSettings, 'regions'>];
        control.set(key === 'damping' ? value * 100 : value);
      }
      summary.textContent = `平均の柔らかさ ${Math.round(field.mean * 100)} / 100　・　動く頂点 ${field.movingPercent.toFixed(0)}%`;
      (parent.querySelector('#testSoftness') as HTMLButtonElement).disabled = field.movingPercent === 0 || settings.maxOffset === 0;
    },
  };
}
