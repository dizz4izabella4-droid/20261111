/** Physical core sizes in meters. The display control is a reference scale;
 * a forearm, femur and spine do not share one hard-cylinder diameter. */
export function frameRadius(name: string, reference = 0.035): number {
  const base = /^thigh_/.test(name) ? 0.032 : /^shin_/.test(name) ? 0.022
    : /^upperarm_/.test(name) ? 0.022 : /^forearm_/.test(name) ? 0.014
    : name === 'hips' ? 0.048 : name === 'spine' ? 0.033 : name === 'chest' ? 0.036
    : name === 'neck' ? 0.016 : 0.009;
  return base * Math.max(0, reference) / 0.035;
}
