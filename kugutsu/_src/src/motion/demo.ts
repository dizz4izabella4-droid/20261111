// A procedural sample clip in the same format as the "モーション" tool (dizz-mocap-v1), so the body
// can be tried without a capture: a precisely repeating mechanical dash in place.
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
    const ph = 2 * Math.PI * 2 * t; // 240 steps/min, twelve complete cycles in six seconds
    const P: V[] = new Array(33).fill(null).map(() => [0, 0, 0] as V);
    const hip: V = [0, 0.95, 0];
    for (const s of [1, -1]) {
      const k = s > 0 ? 'l' : 'r';
      const phase = ph + (s > 0 ? 0 : Math.PI);
      // Constant-speed swings and exact left/right symmetry give a motor-driven rhythm.
      const drive = (2 / Math.PI) * Math.asin(Math.sin(phase));
      const swing = 0.25 + 1.35 * drive;
      const knee = 0.45 + 1.8 * Math.max(0, -Math.cos(phase));
      const hj = add(hip, [s * 0.09, 0, 0]);
      const kn = add(hj, limb(0.42, swing, 0, s));
      const an = add(kn, limb(0.4, swing - knee, 0, s));
      P[J[`${k}_hip`]] = hj;
      P[J[`${k}_knee`]] = kn;
      P[J[`${k}_ankle`]] = an;
      P[J[`${k}_heel`]] = add(an, [0, -0.05, -0.05]);
      P[J[`${k}_foot`]] = add(an, [0, -0.06, 0.16]);
      // Bent elbows pump opposite to the knees throughout the entire clip.
      const sh: V = [s * 0.19, 1.43, 0];
      const up = 0.12, fw = 0.25 - 1.2 * drive, bend = 1.7;
      const el = add(sh, limb(0.29, fw, up, s));
      const wr = add(el, limb(0.25, fw + bend, up, s));
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
    // Lean the whole pose forward by 14 degrees, keeping it centered in the viewer.
    const lean = 14 * Math.PI / 180;
    for (const p of P) {
      const y = p[1] - hip[1], z = p[2];
      p[1] = hip[1] + y * Math.cos(lean) - z * Math.sin(lean);
      p[2] = y * Math.sin(lean) + z * Math.cos(lean);
    }
    frames.push(P.flatMap((p) => p.map((x) => Math.round(x * 10000) / 10000)));
    root.push([0, 0.025 * (1 - Math.cos(2 * ph)), 0]);
  }
  return { format: 'dizz-mocap-v1', fps, joints: [...JOINT_NAMES], frames, root, creator: 'kugutsu mechanical dash demo' };
}

const mix = (a: V, b: V, t: number): V => a.map((x, i) => x + (b[i] - x) * t) as V;
const ease = (t: number) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };

/** Keep both arm segments at their actual lengths while reaching and pulling sideways. */
function elbowFor(shoulder: V, wrist: V, side: number, hint: V = [side, -0.65, -0.25]): V {
  const d = wrist.map((x, i) => x - shoulder[i]) as V;
  const distance = Math.hypot(...d);
  const axis = d.map((x) => x / distance) as V;
  const dot = hint.reduce((sum, x, i) => sum + x * axis[i], 0);
  const perpendicular = hint.map((x, i) => x - dot * axis[i]) as V;
  const length = Math.hypot(...perpendicular);
  const along = (0.29 ** 2 - 0.25 ** 2 + distance ** 2) / (2 * distance);
  const height = Math.sqrt(Math.max(0, 0.29 ** 2 - along ** 2));
  return shoulder.map((x, i) => x + axis[i] * along + perpendicular[i] * height / length) as V;
}

/** Join hands at the chest, drive them into the gap, then brace and force the doors apart. */
export function pryClip(fps = 30, seconds = 6): MotionJson {
  const frames: number[][] = [], root: number[][] = [];
  for (let i = 0; i < Math.round(fps * seconds); i++) {
    const t = (i / fps) * (6 / seconds);
    const release = 1 - ease((t - 4.8) / 1.0);
    const gather = ease(t / 0.55) * release;
    const stab = ease((t - 0.85) / 0.16);
    const reach = stab * release;
    const spread = ease((t - 1.3) / 1.8) * (1 - ease((t - 4.5) / 0.9));
    const strain = 0.004 * Math.sin(t * Math.PI * 12) * spread;
    const P: V[] = Array.from({ length: 33 }, () => [0, 0, 0]);
    const hipY = 0.95 - 0.06 * reach;
    for (const s of [1, -1]) {
      const k = s > 0 ? 'l' : 'r';
      const hip: V = [s * (0.09 + 0.025 * reach), hipY, 0];
      const knee = add(hip, limb(0.42, 0.16 + 0.18 * reach, 0.06 * reach, s));
      const ankle = add(knee, limb(0.4, -0.17 - 0.20 * reach, 0.03 * reach, s));
      P[J[`${k}_hip`]] = hip;
      P[J[`${k}_knee`]] = knee;
      P[J[`${k}_ankle`]] = ankle;
      P[J[`${k}_heel`]] = add(ankle, [0, -0.05, -0.05]);
      P[J[`${k}_foot`]] = add(ankle, [0, -0.06, 0.16]);
      const shoulder: V = [s * 0.19, hipY + 0.48, 0.1 * reach];
      const joined: V = [s * 0.025, hipY + 0.38, 0.14];
      const inserted: V = [s * 0.025, hipY + 0.36, 0.58];
      const opened: V = [s * (0.48 + strain), hipY + 0.37, 0.38];
      const wrist = mix([s * 0.24, hipY + 0.03, 0.05], mix(joined, mix(inserted, opened, spread), stab), gather);
      const elbow = elbowFor(shoulder, wrist, s);
      P[J[`${k}_shoulder`]] = shoulder;
      P[J[`${k}_elbow`]] = elbow;
      P[J[`${k}_wrist`]] = wrist;
      const hand: V = [s * 0.055 * spread, 0.025 * gather, 0.075];
      P[J[`${k}_index`]] = add(wrist, add(hand, [s * 0.018, 0, 0]));
      P[J[`${k}_pinky`]] = add(wrist, add(hand, [-s * 0.018, 0, 0]));
      P[J[`${k}_thumb`]] = add(wrist, [s * 0.035, 0.02, 0.045]);
      P[J[`${k}_ear`]] = [s * 0.075, hipY + 0.67, 0.1 * reach - 0.01];
      P[J[`${k}_eye`]] = [s * 0.032, hipY + 0.71, 0.1 * reach + 0.08];
      P[J[`${k}_eye_in`]] = [s * 0.018, hipY + 0.71, 0.1 * reach + 0.085];
      P[J[`${k}_eye_out`]] = [s * 0.048, hipY + 0.71, 0.1 * reach + 0.075];
    }
    P[J.nose] = [0, hipY + 0.67, 0.1 * reach + 0.11];
    P[J.mouth_l] = [0.025, hipY + 0.63, 0.1 * reach + 0.09];
    P[J.mouth_r] = [-0.025, hipY + 0.63, 0.1 * reach + 0.09];
    frames.push(P.flatMap((p) => p.map((x) => Math.round(x * 10000) / 10000)));
    root.push([0, -0.06 * reach, 0.04 * reach]);
  }
  return { format: 'dizz-mocap-v1', fps, joints: [...JOINT_NAMES], frames, root, creator: 'kugutsu elevator pry demo' };
}

/** Crouch over an imagined car roof and stab down alternately, with raised mantis-like elbows. */
export function thrustClip(fps = 30, seconds = 6): MotionJson {
  const frames: number[][] = [], root: number[][] = [];
  const extension = (phase: number) => phase < 0.14 ? ease(phase / 0.14) : 1 - ease((phase - 0.14) / 0.22);
  for (let i = 0; i < Math.round(fps * seconds); i++) {
    const t = i / fps;
    const left = extension(t % 1), right = extension((t + 0.5) % 1);
    const twist = left - right;
    const impact = Math.max(left, right);
    const crouch = ease(t / 0.25) * (1 - ease((t - seconds + 0.25) / 0.25));
    const hipY = 0.93 - 0.18 * crouch - 0.035 * impact;
    const P: V[] = Array.from({ length: 33 }, () => [0, 0, 0]);
    for (const s of [1, -1]) {
      const k = s > 0 ? 'l' : 'r';
      const power = s > 0 ? left : right;
      const hip: V = [s * 0.11, hipY, 0];
      const knee = add(hip, limb(0.42, 0.22 + 0.48 * crouch, 0.16, s));
      const ankle = add(knee, limb(0.4, -0.24 - 0.48 * crouch, 0.08, s));
      P[J[`${k}_hip`]] = hip;
      P[J[`${k}_knee`]] = knee;
      P[J[`${k}_ankle`]] = ankle;
      P[J[`${k}_heel`]] = add(ankle, [0, -0.05, -0.05]);
      P[J[`${k}_foot`]] = add(ankle, [0, -0.06, 0.16]);
      const lean = 0.19 * crouch;
      const shoulder: V = [s * 0.19, hipY + 0.42, 0.04 + lean + s * twist * 0.025];
      const wrist = mix([s * 0.25, hipY + 0.72, 0.16 + lean], [s * 0.15, hipY - 0.05, 0.24 + lean], power);
      P[J[`${k}_shoulder`]] = shoulder;
      P[J[`${k}_elbow`]] = elbowFor(shoulder, wrist, s, [s * 0.6, 1, -0.3]);
      P[J[`${k}_wrist`]] = wrist;
      // Hands hook downward even in the raised guard, then plunge below the waist.
      P[J[`${k}_index`]] = add(wrist, [s * 0.018, -0.12, 0.025]);
      P[J[`${k}_pinky`]] = add(wrist, [-s * 0.018, -0.12, 0.025]);
      P[J[`${k}_thumb`]] = add(wrist, [s * 0.035, -0.06, 0.015]);
      P[J[`${k}_ear`]] = [s * 0.075, hipY + 0.61, 0.31];
      P[J[`${k}_eye`]] = [s * 0.032, hipY + 0.64, 0.40];
      P[J[`${k}_eye_in`]] = [s * 0.018, hipY + 0.64, 0.405];
      P[J[`${k}_eye_out`]] = [s * 0.048, hipY + 0.64, 0.395];
    }
    P[J.nose] = [0, hipY + 0.60, 0.43];
    P[J.mouth_l] = [0.025, hipY + 0.56, 0.41];
    P[J.mouth_r] = [-0.025, hipY + 0.56, 0.41];
    frames.push(P.flatMap((p) => p.map((x) => Math.round(x * 10000) / 10000)));
    root.push([0, -0.18 * crouch - 0.035 * impact, 0]);
  }
  return { format: 'dizz-mocap-v1', fps, joints: [...JOINT_NAMES], frames, root, creator: 'kugutsu mantis downward thrust demo' };
}

export type DanceStyle = 'flamenco' | 'samba' | 'hiphop';

/** One short phrase: flamenco arm arch and stamp, samba side step, or hip-hop pop and hit. */
export function danceClip(style: DanceStyle, fps = 30, seconds = 4): MotionJson {
  const frames: number[][] = [], root: number[][] = [];
  const pulse = (u: number, start: number, end: number) => Math.sin(Math.PI * Math.max(0, Math.min(1, (u - start) / (end - start))));
  for (let i = 0; i < Math.round(fps * seconds); i++) {
    const u = i / fps / seconds;
    const active = ease(u / 0.12) * (1 - ease((u - 0.82) / 0.18));
    const sway = Math.sin(2 * Math.PI * u) * active;
    const hit = pulse(u, 0.18, 0.40) - pulse(u, 0.48, 0.70);
    const yaw = style === 'flamenco' ? 0.25 * active : style === 'samba' ? 0.22 * Math.sin(4 * Math.PI * u) * active : 0.28 * hit;
    const hipY = 0.95 - (style === 'hiphop' ? 0.07 * active : style === 'samba' ? 0.025 * (1 - Math.cos(8 * Math.PI * u)) * active : 0);
    const P: V[] = Array.from({ length: 33 }, () => [0, 0, 0]);
    for (const s of [1, -1]) {
      const k = s > 0 ? 'l' : 'r';
      const lift = style === 'flamenco' ? (s < 0 ? pulse(u, 0.30, 0.55) : 0) : style === 'samba' ? Math.max(0, s * sway) * 0.45 : 0.15 * active;
      const hip: V = [s * 0.09, hipY, 0];
      const knee = add(hip, limb(0.42, 0.08 + 0.70 * lift, 0.035 * active, s));
      const ankle = add(knee, limb(0.4, -0.08 - 0.55 * lift, 0.02 * active, s));
      P[J[`${k}_hip`]] = hip;
      P[J[`${k}_knee`]] = knee;
      P[J[`${k}_ankle`]] = ankle;
      P[J[`${k}_heel`]] = add(ankle, [0, -0.05, -0.05]);
      P[J[`${k}_foot`]] = add(ankle, [0, -0.06, 0.16]);
      let out = 0.12, forward = 0, bend = 0.18;
      if (style === 'flamenco') {
        out += active * (s > 0 ? 2.55 : 1.10);
        forward = 0.2 * active;
        bend += 0.55 * active;
      } else if (style === 'samba') {
        out += active * (0.95 + s * 0.40 * sway);
        forward = -s * 0.5 * sway;
        bend += 0.75 * active;
      } else {
        const sideHit = Math.max(0, s * hit);
        out += 0.50 * active + 0.9 * sideHit;
        forward = 0.70 * active - 0.5 * sideHit;
        bend += 1.55 * active * (1 - sideHit);
      }
      const shoulder: V = [s * 0.19, hipY + 0.48, style === 'hiphop' ? 0.06 * active : 0];
      const elbow = add(shoulder, limb(0.29, forward, out, s));
      const wrist = add(elbow, limb(0.25, forward + bend, out, s));
      const direction = wrist.map((x, j) => (x - elbow[j]) / 0.25) as V;
      const hand = direction.map((x) => x * 0.08) as V;
      P[J[`${k}_shoulder`]] = shoulder;
      P[J[`${k}_elbow`]] = elbow;
      P[J[`${k}_wrist`]] = wrist;
      P[J[`${k}_index`]] = add(wrist, add(hand, [0, 0, 0.018]));
      P[J[`${k}_pinky`]] = add(wrist, add(hand, [0, 0, -0.018]));
      P[J[`${k}_thumb`]] = add(wrist, add(hand, [s * 0.025, 0, 0]));
      P[J[`${k}_ear`]] = [s * 0.075, hipY + 0.67, -0.01];
      P[J[`${k}_eye`]] = [s * 0.032, hipY + 0.71, 0.08];
      P[J[`${k}_eye_in`]] = [s * 0.018, hipY + 0.71, 0.085];
      P[J[`${k}_eye_out`]] = [s * 0.048, hipY + 0.71, 0.075];
    }
    P[J.nose] = [0, hipY + 0.67, 0.11];
    P[J.mouth_l] = [0.025, hipY + 0.63, 0.09];
    P[J.mouth_r] = [-0.025, hipY + 0.63, 0.09];
    // Turn the shoulders and arms together while the feet keep their support positions.
    for (let j = 0; j < 23; j++) {
      const p = P[j], x = p[0], z = p[2];
      p[0] = x * Math.cos(yaw) + z * Math.sin(yaw);
      p[2] = -x * Math.sin(yaw) + z * Math.cos(yaw);
    }
    frames.push(P.flatMap((p) => p.map((x) => Math.round(x * 10000) / 10000)));
    root.push([style === 'samba' ? 0.12 * sway : style === 'hiphop' ? 0.055 * hit : 0, hipY - 0.95, 0]);
  }
  return { format: 'dizz-mocap-v1', fps, joints: [...JOINT_NAMES], frames, root, creator: `kugutsu ${style} dance demo` };
}

export const sampleClips = {
  dash: demoClip, pry: pryClip, thrust: thrustClip,
  flamenco: () => danceClip('flamenco'), samba: () => danceClip('samba'), hiphop: () => danceClip('hiphop'),
};
export type SampleFamily = 'male' | 'female';
export function randomSample(family: SampleFamily, random = Math.random): MotionJson {
  const pool = family === 'female'
    ? [sampleClips.flamenco, sampleClips.samba, sampleClips.hiphop]
    : [sampleClips.dash, sampleClips.pry, sampleClips.thrust];
  return pool[Math.floor(random() * pool.length)]();
}
