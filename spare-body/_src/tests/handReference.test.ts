import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { buildBody } from '../src/model/body';
import { presetParams } from '../src/model/params';
import { handLayout } from '../src/model/handRig';

describe('reference hand proportions', () => {
  it('places the MCP pivots closer together and inside the palm, below the webs', () => {
    for (const preset of ['female', 'male'] as const) {
      const p = presetParams(preset), h = handLayout(new Vector3(), new Vector3(0, 1, 0), p);
      expect(h.local[5].x - h.local[17].x).toBeLessThan(p.handWidth * 0.72);
      for (const n of [5, 9, 13, 17]) expect(h.local[n].y).toBeLessThan(p.handLength * 0.48);
      expect(h.local[12].y).toBeCloseTo(p.handLength, 5);
    }
  });
  it('follows the four measured silhouette intervals at image row 250', () => {
    const p = presetParams('female'), body = buildBody(p, 'standard');
    const bone = (name: string) => new Vector3(...body.bones.find(b => b.name === name)!.head);
    const wrist = bone('hand_l'), along = wrist.clone().sub(bone('forearm_l')).normalize();
    const part = body.parts.find(p => p.name === 'hand_l')!;
    const samples: number[] = [];
    const point = (id: number) => {
      const v = new Vector3().fromArray(body.positions, id * 3).sub(wrist);
      return [775 - v.z / p.handWidth * 350, 775 - v.dot(along) / p.handLength * 766];
    };
    for (let i = part.start; i < part.start + part.count; i += 3) {
      const pts = [0, 1, 2].map(k => point(body.indices[i + k]));
      for (let k = 0; k < 3; k++) {
        const a = pts[k], b = pts[(k + 1) % 3];
        if ((a[1] - 250) * (b[1] - 250) < 0) samples.push(a[0] + (b[0] - a[0]) * (250 - a[1]) / (b[1] - a[1]));
      }
    }
    for (const [lo, hi, left, right] of [[620, 708, 624, 704], [708, 793, 710, 790], [793, 874, 795, 869], [874, 950, 878, 936]]) {
      const xs = samples.filter(x => x >= lo && x < hi);
      expect(Math.abs(Math.min(...xs) - left)).toBeLessThan(2);
      expect(Math.abs(Math.max(...xs) - right)).toBeLessThan(2);
    }
  });
});
