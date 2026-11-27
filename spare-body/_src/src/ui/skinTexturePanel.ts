import { defaultSkinTexture, type SkinTextureSettings } from '../model/skinTexture';
export function skinTexturePanel(parent: HTMLElement, initial: SkinTextureSettings, change: (settings: SkinTextureSettings) => Promise<void>) {
  const host = document.createElement('details'); host.className = 'g1'; host.open = false;
  host.innerHTML = '<summary>肌テクスチャ</summary>'; parent.appendChild(host);
  const enabledLabel = document.createElement('label'), enabled = document.createElement('input'); enabled.type = 'checkbox'; enabled.id = 'skinTextureEnabled';
  enabledLabel.append(enabled, ' 肌テクスチャを表示'); host.appendChild(enabledLabel);
  const actions = document.createElement('div'); actions.className = 'line'; host.appendChild(actions);
  const fileLabel = document.createElement('label'); fileLabel.className = 'btn'; fileLabel.textContent = '肌の画像を選ぶ';
  const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp'; input.hidden = true; fileLabel.appendChild(input);
  const sample = document.createElement('button'); sample.className = 'btn'; sample.textContent = 'サンプルを貼る';
  const remove = document.createElement('button'); remove.className = 'btn'; remove.textContent = '画像を外す'; actions.append(fileLabel, sample, remove);
  const repeatLabel = document.createElement('label'); repeatLabel.htmlFor = 'skinTextureRepeat'; repeatLabel.textContent = '繰り返し（1mあたり）';
  const repeat = document.createElement('input'); repeat.id = 'skinTextureRepeat'; repeat.type = 'range'; repeat.min = '1'; repeat.max = '20'; repeat.step = '0.5';
  const value = document.createElement('output'); value.setAttribute('for', repeat.id); host.append(repeatLabel, repeat, value);
  const preview = document.createElement('img'); preview.alt = '肌テクスチャの見本'; preview.width = 64; preview.height = 64; preview.style.cssText = 'display:block;border-radius:6px;margin-top:8px'; host.appendChild(preview);
  const status = document.createElement('p'); status.className = 'note'; status.setAttribute('role', 'status'); host.appendChild(status);
  const note = document.createElement('p'); note.className = 'note'; note.textContent = '表示用のテクスチャです。画像は体の設定と一緒に保存できます。GLBには含まれません。'; host.appendChild(note);
  let settings = { ...initial }, version = 0;
  const sync = () => {
    enabled.checked = settings.enabled; enabled.disabled = !settings.source;
    repeat.value = String(settings.repeat); value.textContent = `${settings.repeat} 回`;
    preview.hidden = !settings.source; if (settings.source) preview.src = settings.source; else preview.removeAttribute('src');
    status.textContent = settings.source ? settings.name : '画像なし';
  };
  const apply = async () => { sync(); try { await change({ ...settings }); } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); } };
  enabled.addEventListener('change', () => { settings.enabled = enabled.checked; void apply(); });
  repeat.addEventListener('input', () => { settings.repeat = Number(repeat.value); void apply(); });
  sample.addEventListener('click', () => { version++; settings = defaultSkinTexture(); void apply(); });
  remove.addEventListener('click', () => { version++; settings = { ...settings, source: null, enabled: false, name: '' }; void apply(); });
  input.addEventListener('change', async () => {
    const file = input.files?.[0]; input.value = ''; if (!file) return;
    const token = ++version; let url = '';
    try {
      if (file.size > 30 * 1024 * 1024) throw new Error('30MB以下の画像を選んでください。');
      url = URL.createObjectURL(file);
      const image = new Image(); image.src = url; await image.decode(); if (token !== version) return;
      const scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      settings = { ...settings, source: canvas.toDataURL('image/jpeg', 0.93), name: file.name, enabled: true }; await apply();
    } catch (error) { if (token === version) status.textContent = error instanceof Error ? error.message : String(error); }
    finally { if (url) URL.revokeObjectURL(url); }
  });
  sync();
  return { set(next: SkinTextureSettings) { version++; settings = { ...next }; sync(); } };
}
