// SPEC 13.1 synthetic-data harness: variants A–E (P is milestone M4).
// The pipeline gets only the image, the (possibly perturbed) landmarks, the template parameters and settings.
import { describe, expect, it, afterAll } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { CASES, generate } from './synthetic';
import { runSinglePhoto, defaultSettings, fitCameraFromLandmarks } from '../src/analysis/pipeline';
import { texelTheta, texelY } from '../src/analysis/grid';
import { BodyModel } from '../src/model/mesh';
import { writePng, fieldToGray } from './png';

const summary: Record<string, unknown> = {};
afterAll(() => {
  mkdirSync('test-output', { recursive: true });
  writeFileSync('test-output/M2-synthetic-summary.json', JSON.stringify(summary, null, 2));
});

/** patch grid (i: θ, j: y upward) → image orientation as seen from the front: x = mirrored θ, y = top-down */
function toImage(a: Uint8Array, nx: number, ny: number): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) out[(ny - 1 - j) * nx + (nx - 1 - i)] = a[j * nx + i];
  return out;
}

function b64(a: Float32Array | Uint8Array): string {
  return Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');
}

const THRESHOLDS: Record<string, { corr?: number; rmseRel?: number; rmsMaxMm?: number }> = {
  A: { corr: 0.85, rmseRel: 0.35 },
  B: { corr: 0.85, rmseRel: 0.35 },
  C: { corr: 0.8 },
  D: { corr: 0.85, rmseRel: 0.35 },
  E: { rmsMaxMm: 1.0 },
  F: {}, // partial photo: no SPEC threshold (informational), only "no inverted relief"
};

describe('13.1 synthetic single-photo analysis (Standard settings)', () => {
  for (const c of CASES)
    it(`case ${c.name}`, () => {
      const syn = generate(c);
      const settings = defaultSettings('standard');
      const t0 = performance.now();
      const res = runSinglePhoto({ image: syn.image, view: 'front', landmarks: syn.landmarks, params: syn.params, settings });
      const ms = performance.now() - t0;
      const g = res.grid;
      const n = g.nx * g.ny;
      const dT = new Float32Array(n);
      for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) dT[j * g.nx + i] = syn.dTrue(texelTheta(g, i), texelY(g, j));
      // metrics over texels with confidence >= 0.5 inside the visible region
      let cnt = 0, se = 0, st = 0, sr = 0, stt = 0, srr = 0, str = 0, rr = 0;
      for (let k = 0; k < n; k++) {
        if (!res.region[k] || res.conf[k] < 0.5) continue;
        const t = dT[k], r = res.dSmooth[k];
        cnt++;
        se += (r - t) ** 2;
        st += t; sr += r; stt += t * t; srr += r * r; str += t * r; rr += r * r;
      }
      const rmse = Math.sqrt(se / cnt);
      const rmsTrue = Math.sqrt(stt / cnt);
      const rmsRec = Math.sqrt(rr / cnt);
      const cov = str / cnt - (st / cnt) * (sr / cnt);
      const vt = stt / cnt - (st / cnt) ** 2, vr = srr / cnt - (sr / cnt) ** 2;
      const corr = vt > 0 && vr > 0 ? cov / Math.sqrt(vt * vr) : NaN;
      // camera fit quality (informative)
      const fit = fitCameraFromLandmarks(new BodyModel(syn.params), 'front', syn.landmarks, 1024);
      const metrics = {
        case: c.name,
        texelsEvaluated: cnt,
        regionTexels: res.stats.regionTexels,
        rmse_mm: rmse * 1000,
        rmsTrue_mm: rmsTrue * 1000,
        rmsRecovered_mm: rmsRec * 1000,
        rmseOverRmsTrue: rmsTrue > 0 ? rmse / rmsTrue : null,
        pearson: corr,
        time_ms: ms,
        timings_ms: res.timings,
        stats: res.stats,
        cameraFit: { rms_px: fit.rms, max_px: fit.maxResidual, yawDeg: (fit.camera.yaw * 180) / Math.PI, trueYawDeg: (syn.camera.yaw * 180) / Math.PI },
        bumps: syn.bumps,
      };
      summary[c.name] = metrics;
      // ---- outputs ----
      const dir = `test-output/${c.name}`;
      mkdirSync(dir, { recursive: true });
      writePng(`${dir}/input.png`, syn.image.width, syn.image.height, syn.image.data, 4);
      const range = 0.01;
      writePng(`${dir}/recovered.png`, g.nx, g.ny, toImage(fieldToGray(res.dSmooth, res.region, range), g.nx, g.ny), 1);
      writePng(`${dir}/true.png`, g.nx, g.ny, toImage(fieldToGray(dT, res.region, range), g.nx, g.ny), 1);
      const diff = new Float32Array(n);
      for (let k = 0; k < n; k++) diff[k] = res.dSmooth[k] - dT[k];
      writePng(`${dir}/difference.png`, g.nx, g.ny, toImage(fieldToGray(diff, res.region, range), g.nx, g.ny), 1);
      const conf8 = new Uint8Array(n);
      for (let k = 0; k < n; k++) conf8[k] = Math.round(255 * res.conf[k]);
      writePng(`${dir}/confidence.png`, g.nx, g.ny, toImage(conf8, g.nx, g.ny), 1);
      writeFileSync(`${dir}/metrics.json`, JSON.stringify(metrics, null, 2));
      // project file for `npm run shots` (patch display)
      writeFileSync(
        `${dir}/project.json`,
        JSON.stringify({
          formatVersion: 1,
          preset: 'standard',
          params: syn.params,
          photos: [{ view: 'front', src: `test-output/${c.name}/input.png`, name: `synthetic_${c.name}.png`, landmarks: syn.landmarks }],
          patches: [{ id: `synthetic_${c.name}`, view: 'front', grid: g, gain: 1, region: b64(res.region), d: b64(res.dSmooth), conf: b64(res.conf) }],
        }),
      );
      // ---- acceptance ----
      const th = THRESHOLDS[c.name];
      if (th.corr !== undefined) expect(corr, 'pearson').toBeGreaterThanOrEqual(th.corr);
      if (th.rmseRel !== undefined) expect(rmse / rmsTrue, 'rmse / rms(d_true)').toBeLessThanOrEqual(th.rmseRel);
      if (th.rmsMaxMm !== undefined) expect(rmsRec * 1000, 'rms recovered (mm)').toBeLessThanOrEqual(th.rmsMaxMm);
      if (Number.isFinite(corr)) expect(corr, 'no inverted relief').toBeGreaterThanOrEqual(0);
    });
});
