import { UNIT_LABEL, UNIT_SCALE, UNIT_STEP, type ParamDef } from '../model/params';

export interface ParamControl {
  set(value: number): void;
  setDefault?(value: number): void;
}

function round(v: number, step: number): number {
  const d = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  return Number(v.toFixed(d));
}

/** slider + numeric input (two-way bound) + unit + reset button */
export function paramRow(parent: HTMLElement, def: ParamDef, value: number, onChange: (v: number) => void): ParamControl {
  const scale = UNIT_SCALE[def.unit];
  const step = UNIT_STEP[def.unit];
  const row = document.createElement('div');
  row.className = 'row';
  const id = `p_${def.key}`;
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = def.label;
  if (def.note) {
    const s = document.createElement('small');
    s.textContent = `（${def.note}）`;
    label.appendChild(s);
  }
  const range = document.createElement('input');
  range.type = 'range';
  range.min = String(def.min * scale);
  range.max = String(def.max * scale);
  range.step = String(step);
  let center = def.rangeCenter;
  if (center != null) { range.min = '0'; range.max = '100'; range.step = '1'; }
  range.setAttribute('aria-label', def.label);
  const num = document.createElement('input');
  num.type = 'number';
  num.id = id;
  num.min = String(def.min * scale);
  num.max = String(def.max * scale);
  num.step = String(step);
  const unit = document.createElement('span');
  unit.className = 'unit';
  unit.textContent = UNIT_LABEL[def.unit];
  const reset = document.createElement('button');
  reset.className = 'reset';
  reset.type = 'button';
  let resetValue = def.def;
  const setDefault = (v: number) => {
    resetValue = v;
    if (def.rangeCenter != null) center = v;
    reset.title = `初期値（${round(v * scale, step)}${UNIT_LABEL[def.unit]}）に戻す`;
  };
  setDefault(def.def);
  reset.setAttribute('aria-label', `${def.label}を初期値に戻す`);
  reset.textContent = '↺';
  row.append(label, range, num, unit, reset);
  parent.appendChild(row);

  const show = (internal: number) => {
    const d = round(internal * scale, step);
    range.value = String(center == null ? d : internal === center ? 50 : internal < center
      ? 50 * (internal - def.min) / Math.max(1e-9, center - def.min)
      : 50 + 50 * (internal - center) / Math.max(1e-9, def.max - center));
    range.setAttribute('aria-valuetext', String(d));
    num.value = String(d);
  };
  const commit = (display: number) => {
    if (!Number.isFinite(display)) return show(value);
    const internal = Math.min(def.max, Math.max(def.min, display / scale));
    value = internal;
    show(internal);
    onChange(internal);
  };
  range.addEventListener('input', () => {
    const t = Number(range.value);
    commit(center == null ? t : (t <= 50 ? def.min + (center - def.min) * t / 50 : center + (def.max - center) * (t - 50) / 50) * scale);
  });
  num.addEventListener('change', () => commit(Number(num.value)));
  num.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit(Number(num.value));
  });
  reset.addEventListener('click', () => commit(resetValue * scale));
  show(value);
  return {
    setDefault,
    set(v: number) {
      value = v;
      show(v);
    },
  };
}

export function heading(parent: HTMLElement, text: string, level: 'h1' | 'h2' = 'h2'): void {
  const h = document.createElement(level);
  h.textContent = text;
  parent.appendChild(h);
}

/**
 * Hierarchical sliders: 大項目 (group) → 中項目 (section) → 小項目 (slider rows), as nested
 * <details>. Returns the controls by parameter key.
 */
export function paramTree(
  parent: HTMLElement,
  groups: { key: string; label: string; sections: { key: string; label: string; params: ParamDef[] }[] }[],
  values: Record<string, number>,
  onChange: (key: string, v: number) => void,
  openGroups: string[] = [],
): Record<string, ParamControl> {
  const controls: Record<string, ParamControl> = {};
  for (const g of groups) {
    const dg = document.createElement('details');
    dg.className = 'g1';
    dg.open = openGroups.includes(g.key);
    const sg = document.createElement('summary');
    sg.textContent = g.label;
    dg.appendChild(sg);
    for (const s of g.sections) {
      let host: HTMLElement = dg;
      if (g.sections.length > 1) {
        const ds = document.createElement('details');
        ds.className = 'g2';
        ds.open = false;
        const ss = document.createElement('summary');
        ss.textContent = s.label;
        ds.appendChild(ss);
        dg.appendChild(ds);
        host = ds;
      } else {
        const h = document.createElement('div');
        h.className = 'g2label';
        h.textContent = s.label;
        dg.appendChild(h);
      }
      for (const d of s.params) controls[d.key] = paramRow(host, { ...d, def: values[d.key] }, values[d.key], (v) => onChange(d.key, v));
    }
    parent.appendChild(dg);
  }
  return controls;
}
