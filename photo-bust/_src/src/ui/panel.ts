import { UNIT_LABEL, UNIT_SCALE, UNIT_STEP, type ParamDef } from '../model/params';

export interface ParamControl {
  set(value: number): void;
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
  range.setAttribute('aria-label', def.label);
  const num = document.createElement('input');
  num.type = 'number';
  num.id = id;
  num.min = range.min;
  num.max = range.max;
  num.step = String(step);
  const unit = document.createElement('span');
  unit.className = 'unit';
  unit.textContent = UNIT_LABEL[def.unit];
  const reset = document.createElement('button');
  reset.className = 'reset';
  reset.type = 'button';
  reset.title = `初期値（${round(def.def * scale, step)}${UNIT_LABEL[def.unit]}）に戻す`;
  reset.setAttribute('aria-label', `${def.label}を初期値に戻す`);
  reset.textContent = '↺';
  row.append(label, range, num, unit, reset);
  parent.appendChild(row);

  const show = (internal: number) => {
    const d = round(internal * scale, step);
    range.value = String(d);
    num.value = String(d);
  };
  const commit = (display: number) => {
    if (!Number.isFinite(display)) return show(value);
    const internal = Math.min(def.max, Math.max(def.min, display / scale));
    value = internal;
    show(internal);
    onChange(internal);
  };
  range.addEventListener('input', () => commit(Number(range.value)));
  num.addEventListener('change', () => commit(Number(num.value)));
  num.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit(Number(num.value));
  });
  reset.addEventListener('click', () => commit(def.def * scale));
  show(value);
  return {
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
