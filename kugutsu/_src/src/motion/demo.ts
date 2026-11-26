// A procedural sample clip in the same format as the "モーション" tool (dizz-mocap-v1), so the body
// can be tried without a capture: walking in place for 2 cycles, then waving with the right hand.
import type { MotionJson } from './clip';
import { JOINT_NAMES, J } from './clip';

type V = [number, number, number];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** limb vector of length L: `fwd` = swing forward (rad), `out` = raise to the side (rad), side = +1 left / −1 right */
function limb(L: number, fwd: number, out: number, side: number): V {
  // start pointing down, raise sideways by `out`, then swing forward by `fwd`
  const x = side * Math.sin(out);
  const y = -Math.cos(out);
  return [L * x, L * (y * Math.cos(fwd)), L * (-y * Math.sin(fwd))];
}

export function demoClip(fps = 30, seconds = 6): MotionJson {
  const frames: number[][] = [];
  const root: number[][] = [];
  const n = Math.round(fps * seconds);
  for (let i = 0; i < n; i++) {
    const t = i / fps;
    const walk = t < 4 ? 1 : Math.max(0, 1 - (t - 4) * 2); // walk, then settle
    const wave = Math.max(0, Math.min(1, (t - 3.6) * 1.5)); // raise the right hand after 3.6 s
    const ph = 2 * Math.PI * t; // one stride cycle per second
    const P: V[] = new Array(33).fill(null).map(() => [0, 0, 0] as V);
    const hip: V = [0, 0.95 + 0.015 * walk * Math.abs(Math.sin(ph)), 0];
    for (const s of [1, -1]) {
      const k = s > 0 ? 'l' : 'r';
      const swing = walk * 0.45 * Math.sin(ph + (s > 0 ? 0 : Math.PI)); // thigh forward/back
      const knee = walk * Math.max(0, 0.9 * Math.sin(ph + (s > 0 ? 0 : Math.PI) - 1.2)); // knee bends while swinging
      const hj = add(hip, [s * 0.09, 0, 0]);
      const kn = add(hj, limb(0.42, swing, 0, s));
      const an = add(kn, limb(0.4, swing - knee, 0, s));
      P[J[`${k}_hip`]] = hj;
      P[J[`${k}_knee`]] = kn;
      P[J[`${k}_ankle`]] = an;
      P[J[`${k}_heel`]] = add(an, [0, -0.05, -0.05]);
      P[J[`${k}_foot`]] = add(an, [0, -0.06, 0.16]);
      // arms swing opposite to the legs; the right arm waves at the end
      const sh: V = [s * 0.19, 1.43, 0];
      let up = 0.08, fw = -walk * 0.35 * Math.sin(ph + (s > 0 ? 0 : Math.PI)), bend = 0.25;
      if (s < 0 && wave > 0) {
        up = up + wave * (2.5 - up);
        fw = fw * (1 - wave);
        bend = wave * (0.4 + 0.35 * Math.sin(2 * Math.PI * 1.5 * t));
      }
      const el = add(sh, limb(0.29, fw, up, s));
      const wr = add(el, limb(0.25, fw + (s < 0 && wave > 0 ? 0 : bend), up + (s < 0 && wave > 0 ? bend : 0), s));
      const dir: V = [(wr[0] - el[0]) / 0.25, (wr[1] - el[1]) / 0.25, (wr[2] - el[2]) / 0.25];
      P[J[`${k}_shoulder`]] = sh;
      P[J[`${k}_elbow`]] = el;
      P[J[`${k}_wrist`]] = wr;
      P[J[`${k}_index`]] = add(wr, [dir[0] * 0.08, dir[1] * 0.08, dir[2] * 0.08 + 0.02]);
      P[J[`${k}_pinky`]] = add(wr, [dir[0] * 0.07, dir[1] * 0.07, dir[2] * 0.07 - 0.02]);
      P[J[`${k}_thumb`]] = add(wr, [dir[0] * 0.04, dir[1] * 0.04, dir[2] * 0.04 + 0.04]);
      P[J[`${k}_ear`]] = [s * 0.075, 1.62, -0.01];
      P[J[`${k}_eye`]] = [s * 0.032, 1.66, 0.08];
      P[J[`${k}_eye_in`]] = [s * 0.018, 1.66, 0.085];
      P[J[`${k}_eye_out`]] = [s * 0.048, 1.66, 0.075];
    }
    P[J.nose] = [0, 1.62, 0.11];
    P[J.mouth_l] = [0.025, 1.58, 0.09];
    P[J.mouth_r] = [-0.025, 1.58, 0.09];
    frames.push(P.flatMap((p) => p.map((x) => Math.round(x * 10000) / 10000)));
    root.push([0, 0, 0]);
  }
  return { format: 'dizz-mocap-v1', fps, joints: [...JOINT_NAMES], frames, root, creator: 'body-motion demo' };
}
