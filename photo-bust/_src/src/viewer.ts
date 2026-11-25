import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { BaseMesh } from './model/mesh';
import { BASE_COLOR } from './export/exportBase';

export type ViewName = 'front' | 'threeQuarterLeft' | 'left' | 'back';

/** fixed views (SPEC 13.2): same target and distance for every view and every project */
export const VIEW_TARGET = new THREE.Vector3(0, 0.27, 0);
export const VIEW_DISTANCE = 1.55;
const VIEW_DIRS: Record<ViewName, [number, number, number]> = {
  front: [0, 0, 1],
  threeQuarterLeft: [Math.SQRT1_2, 0, Math.SQRT1_2], // between the front (+Z) and the model's left (+X)
  left: [1, 0, 0],
  back: [0, 0, -1],
};

export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private baseMesh: THREE.Mesh;
  private wire: THREE.LineSegments;
  private needsRender = true;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.background = new THREE.Color(0xd9dde5);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.01, 20);
    // lights are attached to the camera, so every fixed view is lit the same way
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

    const geo = new THREE.BufferGeometry();
    this.baseMesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: BASE_COLOR }));
    this.baseMesh.name = 'base';
    this.scene.add(this.baseMesh);
    this.wire = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x0b1a40, transparent: true, opacity: 0.35 }));
    this.wire.visible = false;
    this.scene.add(this.wire);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.copy(VIEW_TARGET);
    this.controls.enableDamping = false;
    this.controls.minDistance = 0.03;
    this.controls.maxDistance = 4;
    this.controls.addEventListener('change', () => (this.needsRender = true));
    this.setView('front');

    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    const loop = () => {
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

  setView(name: ViewName): void {
    const d = VIEW_DIRS[name];
    this.camera.position.set(VIEW_TARGET.x + d[0] * VIEW_DISTANCE, VIEW_TARGET.y + d[1] * VIEW_DISTANCE, VIEW_TARGET.z + d[2] * VIEW_DISTANCE);
    this.controls.target.copy(VIEW_TARGET);
    this.camera.lookAt(VIEW_TARGET);
    this.controls.update();
    this.needsRender = true;
  }

  /** close-up camera looking at a point from the front (used for inspection screenshots) */
  lookAtPoint(p: [number, number, number], distance: number): void {
    const t = new THREE.Vector3(...p);
    this.camera.position.set(t.x + distance * 0.25, t.y + distance * 0.1, t.z + distance);
    this.controls.target.copy(t);
    this.camera.lookAt(t);
    this.controls.update();
    this.needsRender = true;
  }

  setBase(mesh: BaseMesh): void {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(mesh.uvs, 2));
    g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    g.computeBoundingSphere();
    this.baseMesh.geometry.dispose();
    this.baseMesh.geometry = g;
    this.wire.geometry.dispose();
    this.wire.geometry = new THREE.WireframeGeometry(g);
    this.needsRender = true;
  }

  setWireframe(on: boolean): void {
    this.wire.visible = on;
    this.needsRender = true;
  }

  /** render now and wait until the frame is presented */
  async renderNow(): Promise<void> {
    this.renderer.render(this.scene, this.camera);
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  }
}
