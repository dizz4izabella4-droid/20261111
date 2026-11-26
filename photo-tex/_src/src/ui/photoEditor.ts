// Photo view with landmark placement (SPEC 6.3): tap/click to place the selected landmark, drag to
// adjust, wheel / pinch to zoom, drag on empty area to pan, magnifier loupe while dragging on touch,
// template wireframe projected with the current camera fit (opacity adjustable).

export interface EditorPhoto {
  bitmap: CanvasImageSource;
  width: number;
  height: number;
}

export interface EditorCallbacks {
  /** user placed or moved a landmark (commit = pointer released) */
  onLandmark(id: string, pos: [number, number], commit: boolean): void;
  /** which landmark id is currently selected for placing */
  selected(): string | null;
  landmarks(): Record<string, [number, number]>;
  labels(): Record<string, string>;
  /** wireframe segments in image pixels (pairs of points), or null */
  wireframe(): Float32Array | null;
  residuals(): Record<string, number>;
}

export class PhotoEditor {
  private ctx: CanvasRenderingContext2D;
  private photo: EditorPhoto | null = null;
  private scale = 1;
  private ox = 0;
  private oy = 0;
  opacity = 0.5;
  private pointers = new Map<number, { x: number; y: number; type: string }>();
  private drag: { mode: 'pan' | 'landmark' | 'pinch'; id?: string; sx: number; sy: number; ox: number; oy: number; moved: boolean; dist?: number; scale?: number } | null = null;
  private loupe: { x: number; y: number } | null = null;
  private raf = 0;

  constructor(private canvas: HTMLCanvasElement, private cb: EditorCallbacks) {
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.up(e));
    canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
  }

  setPhoto(p: EditorPhoto | null): void {
    this.photo = p;
    this.fit();
  }

  /** fit the whole photo in view */
  fit(): void {
    const r = this.canvas.getBoundingClientRect();
    if (!this.photo || !r.width) return this.redraw();
    this.scale = Math.min(r.width / this.photo.width, r.height / this.photo.height) * 0.95;
    this.ox = (r.width - this.photo.width * this.scale) / 2;
    this.oy = (r.height - this.photo.height * this.scale) / 2;
    this.redraw();
  }

  private resize(): void {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    if (this.photo && this.scale === 1) this.fit();
    this.redraw();
  }

  private toImage(cx: number, cy: number): [number, number] {
    return [(cx - this.ox) / this.scale, (cy - this.oy) / this.scale];
  }
  private toCanvas(ix: number, iy: number): [number, number] {
    return [ix * this.scale + this.ox, iy * this.scale + this.oy];
  }
  private local(e: PointerEvent | WheelEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private hit(cx: number, cy: number, radius: number): string | null {
    let best: string | null = null;
    let bd = radius;
    for (const [id, p] of Object.entries(this.cb.landmarks())) {
      const [x, y] = this.toCanvas(p[0], p[1]);
      const d = Math.hypot(x - cx, y - cy);
      if (d < bd) {
        bd = d;
        best = id;
      }
    }
    return best;
  }

  private down(e: PointerEvent): void {
    if (!this.photo) return;
    this.canvas.setPointerCapture(e.pointerId);
    const [cx, cy] = this.local(e);
    this.pointers.set(e.pointerId, { x: cx, y: cy, type: e.pointerType });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.drag = { mode: 'pinch', sx: (a.x + b.x) / 2, sy: (a.y + b.y) / 2, ox: this.ox, oy: this.oy, moved: true, dist: Math.hypot(a.x - b.x, a.y - b.y), scale: this.scale };
      this.loupe = null;
      return;
    }
    const touch = e.pointerType === 'touch';
    const id = this.hit(cx, cy, touch ? 28 : 14);
    if (id) this.drag = { mode: 'landmark', id, sx: cx, sy: cy, ox: 0, oy: 0, moved: false };
    else this.drag = { mode: 'pan', sx: cx, sy: cy, ox: this.ox, oy: this.oy, moved: false };
  }

  private move(e: PointerEvent): void {
    if (!this.drag) return;
    const [cx, cy] = this.local(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: cx, y: cy, type: e.pointerType });
    const d = this.drag;
    if (d.mode === 'pinch' && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const s = d.scale! * (Math.hypot(a.x - b.x, a.y - b.y) / d.dist!);
      // keep the image point under the initial pinch center under the current center
      const ix = (d.sx - d.ox) / d.scale!, iy = (d.sy - d.oy) / d.scale!;
      this.scale = s;
      this.ox = mx - ix * s;
      this.oy = my - iy * s;
      this.redraw();
      return;
    }
    if (Math.hypot(cx - d.sx, cy - d.sy) > 4) d.moved = true;
    if (d.mode === 'pan' && d.moved) {
      this.ox = d.ox + (cx - d.sx);
      this.oy = d.oy + (cy - d.sy);
      this.redraw();
    } else if (d.mode === 'landmark' && d.moved) {
      // on touch the finger hides the point: offset the landmark above the finger and show a loupe
      const touch = e.pointerType === 'touch';
      const py = touch ? cy - 40 : cy;
      this.loupe = touch ? { x: cx, y: py } : null;
      this.cb.onLandmark(d.id!, this.toImage(cx, py), false);
      this.redraw();
    }
  }

  private up(e: PointerEvent): void {
    const d = this.drag;
    this.pointers.delete(e.pointerId);
    if (!d) return;
    if (d.mode === 'pinch') {
      if (this.pointers.size === 0) this.drag = null;
      return;
    }
    const [cx, cy] = this.local(e);
    if (d.mode === 'landmark' && d.moved) {
      const touch = e.pointerType === 'touch';
      this.cb.onLandmark(d.id!, this.toImage(cx, touch ? cy - 40 : cy), true);
    } else if (!d.moved) {
      // tap: place the selected landmark here
      const sel = this.cb.selected();
      if (sel) this.cb.onLandmark(sel, this.toImage(cx, cy), true);
    }
    this.drag = null;
    this.loupe = null;
    this.redraw();
  }

  private wheel(e: WheelEvent): void {
    if (!this.photo) return;
    e.preventDefault();
    const [cx, cy] = this.local(e);
    const f = Math.exp(-e.deltaY * 0.0015);
    const [ix, iy] = this.toImage(cx, cy);
    this.scale *= f;
    this.ox = cx - ix * this.scale;
    this.oy = cy - iy * this.scale;
    this.redraw();
  }

  redraw(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  }

  /** synchronous draw (used by screenshots) */
  draw(): void {
    const c = this.ctx;
    const dpr = this.canvas.width / Math.max(1, this.canvas.getBoundingClientRect().width);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#2a2e36';
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.photo) {
      c.fillStyle = '#c8ccd6';
      c.font = `${14 * dpr}px sans-serif`;
      c.fillText('写真を選んでください', 20 * dpr, 30 * dpr);
      return;
    }
    c.setTransform(dpr * this.scale, 0, 0, dpr * this.scale, dpr * this.ox, dpr * this.oy);
    c.imageSmoothingEnabled = true;
    c.drawImage(this.photo.bitmap, 0, 0);
    // wireframe
    const wf = this.cb.wireframe();
    if (wf && this.opacity > 0) {
      c.strokeStyle = `rgba(80,200,255,${this.opacity})`;
      c.lineWidth = 1 / this.scale;
      c.beginPath();
      for (let i = 0; i < wf.length; i += 4) {
        c.moveTo(wf[i], wf[i + 1]);
        c.lineTo(wf[i + 2], wf[i + 3]);
      }
      c.stroke();
    }
    // landmarks
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const lms = this.cb.landmarks();
    const labels = this.cb.labels();
    const res = this.cb.residuals();
    const sel = this.cb.selected();
    const longSide = Math.max(this.photo.width, this.photo.height);
    c.font = '12px "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif';
    for (const [id, p] of Object.entries(lms)) {
      const [x, y] = this.toCanvas(p[0], p[1]);
      const bad = (res[id] ?? 0) > 0.03 * longSide;
      c.fillStyle = id === sel ? '#ffd54a' : bad ? '#ff5a5a' : '#5ef08a';
      c.strokeStyle = '#000';
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(x, y, 5, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.fillStyle = '#fff';
      c.strokeStyle = 'rgba(0,0,0,0.8)';
      c.lineWidth = 3;
      const t = labels[id] ?? id;
      c.strokeText(t, x + 8, y - 6);
      c.fillText(t, x + 8, y - 6);
    }
    // loupe (touch drag)
    if (this.loupe) {
      const R = 55;
      const zoom = 3;
      const lx = this.loupe.x, ly = this.loupe.y - 90;
      c.save();
      c.beginPath();
      c.arc(lx, ly, R, 0, Math.PI * 2);
      c.clip();
      const [ix, iy] = this.toImage(this.loupe.x, this.loupe.y);
      c.setTransform(dpr * this.scale * zoom, 0, 0, dpr * this.scale * zoom, dpr * (lx - ix * this.scale * zoom), dpr * (ly - iy * this.scale * zoom));
      c.drawImage(this.photo.bitmap, 0, 0);
      c.restore();
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.strokeStyle = '#fff';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(lx, ly, R, 0, Math.PI * 2);
      c.moveTo(lx - 8, ly);
      c.lineTo(lx + 8, ly);
      c.moveTo(lx, ly - 8);
      c.lineTo(lx, ly + 8);
      c.stroke();
    }
  }
}
