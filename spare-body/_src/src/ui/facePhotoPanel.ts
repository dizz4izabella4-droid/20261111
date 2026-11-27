import { cropRect, defaultFaceCrop, type FacePhoto } from '../model/facePhoto';
import { paramRow, type ParamControl } from './panel';

export function facePhotoPanel(parent: HTMLElement, change: (photo: FacePhoto | null) => void, focus: () => void) {
  const host = document.createElement('details'); host.className = 'g1'; host.id = 'facePhotoTools';
  host.innerHTML = '<summary>おまけ：顔に写真・画像を貼る</summary><p class="note">撮影済みの写真や画像を選び、顔に使う部分を切り取ります。画像はこの端末内で処理します。</p>';
  parent.appendChild(host);
  const actions = document.createElement('div'); actions.className = 'line'; host.appendChild(actions);
  const label = document.createElement('label'); label.className = 'btn'; label.textContent = '顔の画像を選ぶ';
  const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.hidden = true; label.appendChild(input);
  const focusButton = document.createElement('button'); focusButton.className = 'btn'; focusButton.textContent = '顔を拡大'; focusButton.addEventListener('click', focus);
  const remove = document.createElement('button'); remove.className = 'btn'; remove.textContent = '顔画像を外す';
  actions.append(label, focusButton, remove);
  const editor = document.createElement('div'); editor.hidden = true; host.appendChild(editor);
  const canvas = document.createElement('canvas'); canvas.width = 384; canvas.height = 512; canvas.className = 'face-crop'; canvas.setAttribute('aria-label', '顔画像の切り取りプレビュー'); editor.appendChild(canvas);
  const note = document.createElement('p'); note.className = 'note'; note.textContent = '枠内が貼り付ける範囲です。画像をドラッグ、または位置・拡大率を調整して「切り取って顔に貼る」を押します。'; editor.appendChild(note);
  const status = document.createElement('p'); status.className = 'note'; status.setAttribute('role', 'status'); host.appendChild(status);
  let source = '', image: HTMLImageElement | null = null, crop = defaultFaceCrop(), version = 0;
  const controls: Record<string, ParamControl> = {};
  const draw = () => {
    const ctx = canvas.getContext('2d')!; ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!image) return;
    const r = cropRect(image.naturalWidth, image.naturalHeight, crop);
    ctx.drawImage(image, r.x, r.y, r.width, r.height, 0, 0, canvas.width, canvas.height);
  };
  for (const [key, text, min, max, def] of [['x','切り取り位置（左右）',0,100,50], ['y','切り取り位置（上下）',0,100,50], ['zoom','画像の拡大率',100,400,100]] as const) {
    controls[key] = paramRow(editor, { key: `face_${key}`, label: text, unit: 'index', min, max, def }, def, (v) => { crop[key] = v; draw(); });
  }
  const sync = () => { for (const key of ['x', 'y', 'zoom'] as const) controls[key].set(crop[key]); draw(); };
  let drag: { x: number; y: number; crop: typeof crop } | null = null;
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, crop: { ...crop } }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || !image) return;
    const r = cropRect(image.naturalWidth, image.naturalHeight, crop), bounds = canvas.getBoundingClientRect();
    crop.x = Math.max(0, Math.min(100, drag.crop.x - (e.clientX - drag.x) / bounds.width * r.width / image.naturalWidth * 100));
    crop.y = Math.max(0, Math.min(100, drag.crop.y - (e.clientY - drag.y) / bounds.height * r.height / image.naturalHeight * 100)); sync();
  });
  canvas.addEventListener('pointerup', () => { drag = null; }); canvas.addEventListener('pointercancel', () => { drag = null; });
  const apply = document.createElement('button'); apply.className = 'btn primary'; apply.textContent = '切り取って顔に貼る'; editor.appendChild(apply);
  apply.addEventListener('click', () => {
    if (!image) return; draw();
    change({ source, texture: canvas.toDataURL('image/png'), crop: { ...crop } }); focus();
    status.textContent = '顔に貼りました。体の設定とGLBにも画像を含めて保存できます。';
  });
  const decode = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('この画像を開けません。JPEG・PNGなどに変換してお試しください。')); img.src = url; });
  input.addEventListener('change', async () => {
    const file = input.files?.[0]; input.value = ''; if (!file) return;
    const token = ++version; let url = '';
    try {
      if (file.size > 30 * 1024 * 1024) throw new Error('30MB以下の画像を選んでください。');
      url = URL.createObjectURL(file); const original = await decode(url); if (token !== version) return;
      const scale = Math.min(1, 2048 / Math.max(original.naturalWidth, original.naturalHeight));
      const small = document.createElement('canvas'); small.width = Math.max(1, Math.round(original.naturalWidth * scale)); small.height = Math.max(1, Math.round(original.naturalHeight * scale));
      const ctx = small.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, small.width, small.height); ctx.drawImage(original, 0, 0, small.width, small.height);
      const nextSource = small.toDataURL('image/jpeg', 0.9), nextImage = await decode(nextSource); if (token !== version) return;
      source = nextSource; image = nextImage; crop = defaultFaceCrop(); editor.hidden = false; sync(); status.textContent = '切り取る範囲を調整してください。';
    } catch (error) { if (token === version) status.textContent = error instanceof Error ? error.message : String(error); }
    finally { if (url) URL.revokeObjectURL(url); }
  });
  remove.addEventListener('click', () => { version++; source = ''; image = null; editor.hidden = true; change(null); status.textContent = '顔画像を外しました。'; });
  return { set: async (photo: FacePhoto | null) => {
    const token = ++version; editor.hidden = true; source = ''; image = null; status.textContent = '';
    if (!photo) return;
    try { const loaded = await decode(photo.source); if (token !== version) return; source = photo.source; image = loaded; crop = { ...photo.crop }; editor.hidden = false; sync(); }
    catch { if (token === version) status.textContent = '保存した元画像を開けませんでした。別の画像を選んでください。'; }
  } };
}
