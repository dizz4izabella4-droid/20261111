import { it, expect } from 'vitest';
import { defaultParams } from '../src/model/params';
import { BodyModel } from '../src/model/mesh';
import { texelGeometry } from '../src/analysis/grid';
import { energy } from '../src/analysis/solve';
import { mulberry32 } from './synthetic';

it('energy gradient matches finite differences', () => {
  const model = new BodyModel(defaultParams());
  const geo = texelGeometry(model, { nx: 14, ny: 12, th0: 2.4, th1: 3.9, y0: 0.2, y1: 0.4 });
  const n = 14 * 12;
  const rnd = mulberry32(7);
  const L = new Float64Array(n).map(() => 0.3 + 0.3 * rnd());
  const w = new Float64Array(n).map(() => (rnd() < 0.9 ? 0.5 + rnd() : 0));
  const light = { model: 'directional' as const, coef: [-0.2, 0.27, 0.35, 0.06], amp: Math.hypot(0.2, 0.27, 0.35) };
  const terms = { lambdaS: 2e-7, lambdaP: 3e-4, d0: 0.01 };
  const d = new Float64Array(n).map(() => (rnd() - 0.5) * 0.004);
  const g = new Float64Array(n);
  energy(geo, { L, w, light }, terms, d, g);
  let maxRel = 0;
  for (let k = 0; k < n; k += 7) {
    const h = 1e-7;
    const dp = Float64Array.from(d); dp[k] += h;
    const dm = Float64Array.from(d); dm[k] -= h;
    const tmp = new Float64Array(n);
    const num = (energy(geo, { L, w, light }, terms, dp, tmp) - energy(geo, { L, w, light }, terms, dm, tmp)) / (2 * h);
    maxRel = Math.max(maxRel, Math.abs(num - g[k]) / Math.max(1e-12, Math.abs(num) + Math.abs(g[k])));
  }
  process.stdout.write(`grad max rel err ${maxRel}\n`);
  expect(maxRel).toBeLessThan(1e-4);
});
