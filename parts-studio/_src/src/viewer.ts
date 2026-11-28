import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type ViewName = 'front' | 'threeQuarter' | 'left' | 'right' | 'back' | 'top';
export type GizmoMode = 'translate' | 'rotate' | 'scale' | 'off';

const DIRS: Record<ViewName, [number, number, number]> = {
  front: [0, 0, 1],
  threeQuarter: [0.7, 0.18, 0.7],
  left: [1, 0, 0],
  right: [-1, 0, 0],
  back: [0, 0, -1],
  top: [0, 1, 0.001],
};

export class Viewer {
  /** null when WebGL is not available: everything except drawing keeps working */
  readonly renderer: THREE.WebGLRenderer | null;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly gizmo: TransformControls;
  private gizmoHelper: THREE.Object3D;
  private selBox: THREE.Box3Helper;
  private needs = true;
  private grids: THREE.Object3D[] = [];
  /** called when the gizmo moves something (during drag) */
  onGizmoChange: (() => void) | null = null;
  onGizmoEnd: (() => void) | null = null;
  gpu = true;
  noWebGL = false;

  constructor(private canvas: HTMLCanvasElement) {
    let r: THREE.WebGLRenderer | null = null;
    try {
      r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
      r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      const gl = r.getContext();
      this.gpu = !/swiftshader|software|llvmpipe/i.test(String(gl.getParameter(gl.VERSION)) + String(gl.getParameter(gl.RENDERER)));
    } catch {
      r = null;
      this.gpu = false;
      this.noWebGL = true;
    }
    this.renderer = r;
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.01, 60);
    this.scene.add(this.camera);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8890a0, 1.0));
    if (this.renderer) {
      const pm = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environmentIntensity = 0.5;
    }
    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(-0.6, 0.8, 1.0);
    this.camera.add(key);
    this.camera.add(key.target);
    key.target.position.set(0, 0, -1);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(0.8, -0.2, 0.6);
    this.camera.add(fill);

    const floor = new THREE.GridHelper(4, 40, 0x7a8499, 0xb4bccb);
    this.grids = [floor];
    this.scene.add(floor);
    this.scene.background = new THREE.Color(0xe4e8ef);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0.9, 0);
    this.controls.minDistance = 0.1;
    this.controls.maxDistance = 20;
    this.controls.addEventListener('change', () => (this.needs = true));

    this.gizmo = new TransformControls(this.camera, canvas);
    this.gizmoHelper = this.gizmo.getHelper();
    this.gizmoHelper.visible = false;
    this.scene.add(this.gizmoHelper);
    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.controls.enabled = !(e as unknown as { value: boolean }).value;
      if (!(e as unknown as { value: boolean }).value) this.onGizmoEnd?.();
    });
    this.gizmo.addEventListener('objectChange', () => {
      this.onGizmoChange?.();
      this.needs = true;
    });
    this.gizmo.addEventListener('change', () => (this.needs = true));
    this.gizmo.setSize(0.8);

    this.selBox = new THREE.Box3Helper(new THREE.Box3(), 0x3a6fd8);
    this.selBox.visible = false;
    this.scene.add(this.selBox);

    this.setView('front');
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    const loop = () => {
      if (this.needs) {
        this.needs = false;
        this.renderer?.render(this.scene, this.camera);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  invalidate(): void {
    this.needs = true;
  }

  resize(): void {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer?.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.needs = true;
  }

  setView(v: ViewName, target?: THREE.Vector3, size = 1.6): void {
    const t = target ?? this.controls.target;
    const d = new THREE.Vector3(...DIRS[v]).normalize();
    const dist = (size / 2) / Math.tan((this.camera.fov * Math.PI) / 360) * 1.25;
    this.controls.target.copy(t);
    this.camera.position.copy(t).addScaledVector(d, dist);
    this.camera.up.set(0, 1, 0);
    this.controls.update();
    this.needs = true;
  }

  frame(box: THREE.Box3): void {
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const dist = (Math.max(s.y, s.x * 0.8) / 2 / Math.tan((this.camera.fov * Math.PI) / 360)) * 1.3 + s.z;
    this.controls.target.copy(c);
    this.camera.position.copy(c).addScaledVector(dir, Math.max(dist, 0.3));
    this.controls.update();
    this.needs = true;
  }

  /** focus the camera on a point at a distance (for close-up inspection of joints) */
  closeUp(target: THREE.Vector3, dist: number): void {
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.copy(target);
    this.camera.position.copy(target).addScaledVector(dir, dist);
    this.controls.update();
    this.needs = true;
  }

  attachGizmo(obj: THREE.Object3D | null, mode: GizmoMode): void {
    if (!obj || mode === 'off') {
      this.gizmo.detach();
      this.gizmoHelper.visible = false;
    } else {
      this.gizmo.attach(obj);
      this.gizmo.setMode(mode);
      this.gizmoHelper.visible = true;
    }
    this.needs = true;
  }

  setSelectionBox(box: THREE.Box3 | null): void {
    if (!box || box.isEmpty()) this.selBox.visible = false;
    else {
      this.selBox.box.copy(box);
      this.selBox.visible = true;
    }
    this.needs = true;
  }

  setBackground(c: 'light' | 'dark'): void {
    (this.scene.background as THREE.Color).set(c === 'light' ? 0xe4e8ef : 0x16181d);
    this.needs = true;
  }

  setGrid(on: boolean): void {
    for (const g of this.grids) g.visible = on;
    this.needs = true;
  }

  dispose(): void {
    this.renderer?.dispose();
  }
}
