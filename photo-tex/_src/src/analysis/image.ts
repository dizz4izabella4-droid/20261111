// Image helpers for the analysis worker (pure TypedArray code, no DOM).

export interface RGBAImage {
  width: number;
  height: number;
  /** sRGB, 8 bit, RGBA */
  data: Uint8ClampedArray;
}

/** single-channel float image */
export interface FImage {
  w: number;
  h: number;
  d: Float32Array;
}

const LUT = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LUT[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
export function srgb8ToLinear(v: number): number {
  return LUT[v];
}
export function linearToSrgb8(c: number): number {
  const x = Math.min(1, Math.max(0, c));
  const s = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

/**
 * Crop [x0,x1)×[y0,y1) (source pixels, may be fractional) and resample to outW×outH,
 * converting to linear RGB. Area averaging (box filter) when shrinking.
 */
export function cropResizeLinear(img: RGBAImage, x0: number, y0: number, x1: number, y1: number, outW: number, outH: number) {
  const R = new Float32Array(outW * outH);
  const G = new Float32Array(outW * outH);
  const B = new Float32Array(outW * outH);
  const sx = (x1 - x0) / outW;
  const sy = (y1 - y0) / outH;
  const fx = Math.max(1, Math.ceil(sx));
  const fy = Math.max(1, Math.ceil(sy));
  const W = img.width;
  const H = img.height;
  const d = img.data;
  for (let j = 0; j < outH; j++)
    for (let i = 0; i < outW; i++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let q = 0; q < fy; q++)
        for (let p = 0; p < fx; p++) {
          const X = Math.floor(x0 + (i + (p + 0.5) / fx) * sx);
          const Y = Math.floor(y0 + (j + (q + 0.5) / fy) * sy);
          if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
          const o = (Y * W + X) * 4;
          r += LUT[d[o]];
          g += LUT[d[o + 1]];
          b += LUT[d[o + 2]];
          n++;
        }
      const k = j * outW + i;
      if (n) {
        R[k] = r / n;
        G[k] = g / n;
        B[k] = b / n;
      }
    }
  return { R, G, B, w: outW, h: outH };
}

export function bilinear(img: FImage, x: number, y: number): number {
  // pixel centers at integer + 0.5
  const fx = x - 0.5;
  const fy = y - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const w = img.w;
  const h = img.h;
  const cx0 = Math.min(w - 1, Math.max(0, x0));
  const cx1 = Math.min(w - 1, Math.max(0, x0 + 1));
  const cy0 = Math.min(h - 1, Math.max(0, y0));
  const cy1 = Math.min(h - 1, Math.max(0, y0 + 1));
  const d = img.d;
  const a = d[cy0 * w + cx0] * (1 - tx) + d[cy0 * w + cx1] * tx;
  const b = d[cy1 * w + cx0] * (1 - tx) + d[cy1 * w + cx1] * tx;
  return a * (1 - ty) + b * ty;
}

/** 2×2 box pyramid; level 0 = input */
export function pyramid(img: FImage, levels: number): FImage[] {
  const out = [img];
  for (let l = 1; l < levels; l++) {
    const p = out[l - 1];
    const w = Math.max(1, p.w >> 1);
    const h = Math.max(1, p.h >> 1);
    const d = new Float32Array(w * h);
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const x = Math.min(p.w - 1, 2 * i);
        const y = Math.min(p.h - 1, 2 * j);
        const x1 = Math.min(p.w - 1, x + 1);
        const y1 = Math.min(p.h - 1, y + 1);
        d[j * w + i] = 0.25 * (p.d[y * p.w + x] + p.d[y * p.w + x1] + p.d[y1 * p.w + x] + p.d[y1 * p.w + x1]);
      }
    out.push({ w, h, d });
  }
  return out;
}

/** sample a pyramid at level-0 pixel coordinates */
export function samplePyramid(pyr: FImage[], level: number, x: number, y: number): number {
  const l = Math.min(pyr.length - 1, Math.max(0, level));
  const f = 1 / (1 << l);
  return bilinear(pyr[l], x * f, y * f);
}

export function median(values: Float32Array | number[]): number {
  const a = Float64Array.from(values as ArrayLike<number>).sort();
  if (!a.length) return 0;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : 0.5 * (a[m - 1] + a[m]);
}
