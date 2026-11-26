// Minimal PNG encoder for test outputs (8-bit gray or RGBA), Node only.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export function encodePng(w: number, h: number, pixels: Uint8Array | Uint8ClampedArray, channels: 1 | 4): Uint8Array {
  const raw = new Uint8Array((w * channels + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * channels + 1)] = 0;
    raw.set(pixels.subarray(y * w * channels, (y + 1) * w * channels), y * (w * channels + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = channels === 1 ? 0 : 6;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function writePng(path: string, w: number, h: number, pixels: Uint8Array | Uint8ClampedArray, channels: 1 | 4) {
  writeFileSync(path, encodePng(w, h, pixels, channels));
}

/** signed field → gray PNG (mid gray = 0, ±range → black/white); NaN → dark blue-ish (written as 0) */
export function fieldToGray(values: ArrayLike<number>, mask: ArrayLike<number> | null, range: number): Uint8Array {
  const out = new Uint8Array(values.length);
  for (let i = 0; i < values.length; i++) {
    if (mask && !mask[i]) {
      out[i] = 0;
      continue;
    }
    out[i] = Math.max(1, Math.min(255, Math.round(128 + (127 * values[i]) / range)));
  }
  return out;
}

/** flip rows (patch grids store y upward; images are top-down) */
export function flipRows(a: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let y = 0; y < h; y++) out.set(a.subarray(y * w, (y + 1) * w), (h - 1 - y) * w);
  return out;
}
