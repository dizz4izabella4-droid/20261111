// manual-adjuster: the three states of a part's transform and how they relate.
//   initial : right after loading (normalized frame, nothing fitted)
//   auto    : the last automatic fit
//   current : what is on screen = auto + whatever the user did by hand (stored as `manual`)
// A re-fit moves `auto` and re-applies the stored manual difference, so hand work is never thrown away
// unless the user explicitly asks to discard it.
import * as THREE from 'three';
import type { Part, TRS } from './types';
import { applyTRS, IDENTITY_TRS, matrixFromTRS, trsEqual, trsFromMatrix, trsOf } from './util';

const q = (r: [number, number, number]): THREE.Quaternion => new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2], 'XYZ'));

export function current(part: Part): TRS {
  return trsOf(part.root);
}

function isNeutralManual(m: NonNullable<Part['manual']>): boolean {
  const e = 1e-7;
  return (
    Math.abs(m.dp[0]) < e && Math.abs(m.dp[1]) < e && Math.abs(m.dp[2]) < e &&
    Math.abs(m.dq[0]) < e && Math.abs(m.dq[1]) < e && Math.abs(m.dq[2]) < e && Math.abs(m.dq[3] - 1) < e &&
    Math.abs(m.ds[0] - 1) < e && Math.abs(m.ds[1] - 1) < e && Math.abs(m.ds[2] - 1) < e
  );
}

/** Record how the current transform differs from the auto fit. Call after any manual change. */
export function captureManual(part: Part): void {
  if (!part.auto) {
    part.manual = null;
    return;
  }
  const c = current(part);
  const a = part.auto;
  const dq = q(a.r).invert().multiply(q(c.r));
  const m: NonNullable<Part['manual']> = {
    dp: [c.p[0] - a.p[0], c.p[1] - a.p[1], c.p[2] - a.p[2]],
    dq: [dq.x, dq.y, dq.z, dq.w],
    ds: [c.s[0] / (a.s[0] || 1), c.s[1] / (a.s[1] || 1), c.s[2] / (a.s[2] || 1)],
  };
  part.manual = isNeutralManual(m) ? null : m;
}

export function isManuallyEdited(part: Part): boolean {
  return !!part.manual;
}

function compose(auto: TRS, m: NonNullable<Part['manual']>): TRS {
  const aq = q(auto.r);
  const cq = aq.multiply(new THREE.Quaternion(m.dq[0], m.dq[1], m.dq[2], m.dq[3]));
  const e = new THREE.Euler().setFromQuaternion(cq, 'XYZ');
  return {
    p: [auto.p[0] + m.dp[0], auto.p[1] + m.dp[1], auto.p[2] + m.dp[2]],
    r: [e.x, e.y, e.z],
    s: [auto.s[0] * m.ds[0], auto.s[1] * m.ds[1], auto.s[2] * m.ds[2]],
  };
}

/**
 * Store a new automatic result. With keepManual (the default) the user's hand adjustments ride on top
 * of it; with discard they are dropped. Returns whether manual edits were kept.
 */
export function setAuto(part: Part, auto: TRS, keepManual: boolean): boolean {
  part.auto = auto;
  if (keepManual && part.manual) {
    applyTRS(part.root, compose(auto, part.manual));
    return true;
  }
  part.manual = null;
  applyTRS(part.root, auto);
  return false;
}

export function resetToInitial(part: Part): void {
  applyTRS(part.root, part.initial);
  captureManual(part);
}

/** back to the automatic fit, dropping the hand adjustments of this part only */
export function resetToAuto(part: Part): boolean {
  if (!part.auto) return false;
  part.manual = null;
  applyTRS(part.root, part.auto);
  return true;
}

export function setCurrent(part: Part, patch: Partial<{ p: Partial<TRS['p']>; r: Partial<TRS['r']>; s: Partial<TRS['s']> }>): void {
  const c = current(part);
  const p: TRS['p'] = [patch.p?.[0] ?? c.p[0], patch.p?.[1] ?? c.p[1], patch.p?.[2] ?? c.p[2]];
  const r: TRS['r'] = [patch.r?.[0] ?? c.r[0], patch.r?.[1] ?? c.r[1], patch.r?.[2] ?? c.r[2]];
  const s: TRS['s'] = [patch.s?.[0] ?? c.s[0], patch.s?.[1] ?? c.s[1], patch.s?.[2] ?? c.s[2]];
  applyTRS(part.root, { p, r, s });
  captureManual(part);
}

/** set all three scale axes at once, keeping their ratio */
export function setUniformScale(part: Part, k: number): void {
  const c = current(part);
  const base = (c.s[0] + c.s[1] + c.s[2]) / 3 || 1;
  const f = k / base;
  setCurrent(part, { s: [c.s[0] * f, c.s[1] * f, c.s[2] * f] });
}

export const uniformOf = (t: TRS): number => (t.s[0] + t.s[1] + t.s[2]) / 3;

export function sameAsAuto(part: Part): boolean {
  return !!part.auto && trsEqual(current(part), part.auto, 1e-6);
}

/** world matrix helper for gizmo-free callers */
export function matrixOf(t: TRS): THREE.Matrix4 {
  return matrixFromTRS(t);
}
export { IDENTITY_TRS, trsFromMatrix };
