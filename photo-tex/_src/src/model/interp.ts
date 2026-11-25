/** Monotone piecewise-cubic Hermite interpolation (Fritsch–Carlson / PCHIP). C1, no overshoot. */
export class Pchip {
  private xs: number[];
  private ys: number[];
  private ms: number[];

  constructor(xs: number[], ys: number[]) {
    const n = xs.length;
    if (n < 2) throw new Error('Pchip needs >= 2 points');
    for (let i = 1; i < n; i++) if (!(xs[i] > xs[i - 1])) throw new Error('Pchip xs must increase');
    this.xs = xs.slice();
    this.ys = ys.slice();
    const h: number[] = [];
    const d: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      h.push(xs[i + 1] - xs[i]);
      d.push((ys[i + 1] - ys[i]) / h[i]);
    }
    const m = new Array<number>(n).fill(0);
    m[0] = d[0];
    m[n - 1] = d[n - 2];
    for (let k = 1; k < n - 1; k++) {
      if (d[k - 1] * d[k] <= 0) m[k] = 0;
      else {
        const w1 = 2 * h[k] + h[k - 1];
        const w2 = h[k] + 2 * h[k - 1];
        m[k] = (w1 + w2) / (w1 / d[k - 1] + w2 / d[k]);
      }
    }
    // keep end slopes from overshooting
    if (n > 2) {
      if (Math.sign(m[0]) !== Math.sign(d[0])) m[0] = 0;
      if (Math.sign(m[n - 1]) !== Math.sign(d[n - 2])) m[n - 1] = 0;
    }
    this.ms = m;
  }

  eval(x: number): number {
    const xs = this.xs;
    const n = xs.length;
    if (x <= xs[0]) return this.ys[0]; // clamp outside the range
    if (x >= xs[n - 1]) return this.ys[n - 1];
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid;
      else hi = mid;
    }
    const h = xs[hi] - xs[lo];
    const t = (x - xs[lo]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    return h00 * this.ys[lo] + h10 * h * this.ms[lo] + h01 * this.ys[hi] + h11 * h * this.ms[hi];
  }
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
