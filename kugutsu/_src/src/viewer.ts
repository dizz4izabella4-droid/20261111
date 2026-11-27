import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type ViewName = 'front' | 'threeQuarterLeft' | 'left' | 'back';
export type BackgroundName = 'white' | 'black';

/** fixed views for screenshots: same target and distance for every view */
export const VIEW_TARGET = new THREE.Vector3(0, 0.95, 0);
export const VIEW_DISTANCE = 4.1;
const VIEW_DIRS: Record<ViewName, [number, number, number]> = {
  front: [0, 0, 1],
  threeQuarterLeft: [Math.SQRT1_2, 0, Math.SQRT1_2],
  left: [1, 0, 0],
  back: [0, 0, -1],
};

export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private body: THREE.Object3D | null = null;
  private skelHelper: THREE.SkeletonHelper | null = null;
  private showSkeleton = false;
  private reflection: THREE.WebGLRenderTarget | null = null;
  private grids: THREE.GridHelper[] = [];
  private needsRender = true;
  /** called every animation frame before rendering (motion playback); return true if something changed */
  onFrame: ((dt: number) => boolean) | null = null;
  private last = performance.now();

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
    this.scene.add(this.camera);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8890a0, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.0);
    key.position.set(-0.6, 0.8, 1.0);
    this.camera.add(key);
    this.camera.add(key.target);
    key.target.position.set(0, 0, -1);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(0.8, -0.2, 0.6);
    this.camera.add(fill);
    const floor = new THREE.GridHelper(4, 40, 0xffffff, 0x888888);
    const back = new THREE.GridHelper(4, 40, 0xffffff, 0x888888);
    back.rotation.x = Math.PI / 2;
    back.position.set(0, 2, -2);
    const side = new THREE.GridHelper(4, 40, 0xffffff, 0x888888);
    side.rotation.z = Math.PI / 2;
    side.position.set(-2, 2, 0);
    this.grids = [floor, back, side];
    this.scene.add(...this.grids);
    this.setBackground('white');
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.copy(VIEW_TARGET);
    this.controls.minDistance = 0.2;
    this.controls.maxDistance = 12;
    this.controls.addEventListener('change', () => (this.needsRender = true));
    this.setView('front');
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    const loop = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      if (this.onFrame && this.onFrame(dt)) this.needsRender = true;
      if (this.needsRender) {
        this.needsRender = false;
        this.renderer.render(this.scene, this.camera);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  resize(): void {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }

  setBackground(background: BackgroundName): void {
    this.scene.background = new THREE.Color(background === 'black' ? 0x000000 : 0xffffff);
    for (const grid of this.grids) {
      for (const material of Array.isArray(grid.material) ? grid.material : [grid.material]) {
        material.color.setHex(background === 'black' ? 0x515963 : 0xa1a8b2);
      }
    }
    this.needsRender = true;
  }

  setView(name: ViewName): void {
    const d = VIEW_DIRS[name];
    this.camera.position.set(VIEW_TARGET.x + d[0] * VIEW_DISTANCE, VIEW_TARGET.y + d[1] * VIEW_DISTANCE, VIEW_TARGET.z + d[2] * VIEW_DISTANCE);
    this.controls.target.copy(VIEW_TARGET);
    this.camera.lookAt(VIEW_TARGET);
    this.controls.update();
    this.needsRender = true;
  }

  /** show a loaded body (glTF scene with a skinned mesh) */
  setBody(scene: THREE.Object3D): void {
    if (this.body) this.scene.remove(this.body);
    if (this.skelHelper) this.scene.remove(this.skelHelper);
    this.body = scene;
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.frustumCulled = false;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (!(material instanceof THREE.MeshStandardMaterial) || material.metalness <= 0 || material.envMap) continue;
        if (!this.reflection) {
          // Build and prefilter a local studio room once; reuse it for all metallic bodies.
          const room = new RoomEnvironment();
          const pmrem = new THREE.PMREMGenerator(this.renderer);
          try {
            this.reflection = pmrem.fromScene(room, 0.04);
          } finally {
            room.dispose();
            pmrem.dispose();
          }
        }
        material.envMap = this.reflection.texture;
        material.envMapIntensity = 0.85;
        material.needsUpdate = true;
      }
    });
    this.scene.add(scene);
    this.skelHelper = new THREE.SkeletonHelper(scene);
    this.skelHelper.visible = this.showSkeleton;
    this.scene.add(this.skelHelper);
    this.needsRender = true;
  }

  setSkeletonVisible(on: boolean): void {
    this.showSkeleton = on;
    if (this.skelHelper) this.skelHelper.visible = on;
    this.needsRender = true;
  }

  requestRender(): void {
    this.needsRender = true;
  }

  async renderNow(): Promise<void> {
    this.renderer.render(this.scene, this.camera);
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  }
}
