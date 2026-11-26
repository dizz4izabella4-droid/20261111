import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { BodyMesh } from './model/body';
import type { Pose } from './motion/retarget';

export type ViewName = 'front' | 'threeQuarterLeft' | 'left' | 'back';

/** fixed views for screenshots: same target and distance for every view and project */
export const VIEW_TARGET = new THREE.Vector3(0, 0.85, 0);
export const VIEW_DISTANCE = 3.6;
const VIEW_DIRS: Record<ViewName, [number, number, number]> = {
  front: [0, 0, 1],
  threeQuarterLeft: [Math.SQRT1_2, 0, Math.SQRT1_2],
  left: [1, 0, 0],
  back: [0, 0, -1],
};
export const BODY_COLOR = 0x3a6fd8;

export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private mesh: THREE.SkinnedMesh | null = null;
  private skelHelper: THREE.SkeletonHelper | null = null;
  private showSkeleton = false;
  private wire = false;
  private material = new THREE.MeshLambertMaterial({ color: BODY_COLOR });
  bones: THREE.Bone[] = [];
  private needsRender = true;
  /** called every animation frame before rendering (motion playback) */
  onFrame: ((dt: number) => boolean) | null = null;
  private last = performance.now();

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.background = new THREE.Color(0xd9dde5);
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
    const grid = new THREE.GridHelper(2, 20, 0x9aa3b5, 0xc3c9d4);
    this.scene.add(grid);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.copy(VIEW_TARGET);
    this.controls.minDistance = 0.2;
    this.controls.maxDistance = 10;
    this.controls.addEventListener('change', () => (this.needsRender = true));
    this.setView('front');
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    const loop = () => {
      const now = performance.now();
      const dt = (now - this.last) / 1000;
      this.last = now;
      if (this.onFrame && this.onFrame(dt)) this.needsRender = true;
      if (this.needsRender) {
        this.needsRender = false;
        this.skelHelper?.updateMatrixWorld(true);
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

  /** replace the body: skinned mesh bound to a fresh skeleton in the rest pose */
  setBody(b: BodyMesh): void {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      if (this.skelHelper) this.scene.remove(this.skelHelper);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(b.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(b.normals, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(b.skinIndex, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(b.skinWeight, 4));
    g.setIndex(new THREE.BufferAttribute(b.indices, 1));
    g.computeBoundingSphere();
    const bones = b.bones.map((bi) => {
      const bone = new THREE.Bone();
      bone.name = bi.name;
      return bone;
    });
    b.bones.forEach((bi, i) => {
      const ph = bi.parent >= 0 ? b.bones[bi.parent].head : [0, 0, 0];
      bones[i].position.set(bi.head[0] - ph[0], bi.head[1] - ph[1], bi.head[2] - ph[2]);
      if (bi.parent >= 0) bones[bi.parent].add(bones[i]);
    });
    this.restHips.copy(bones[0].position);
    const mesh = new THREE.SkinnedMesh(g, this.material);
    mesh.name = 'body';
    mesh.add(bones[0]);
    mesh.bind(new THREE.Skeleton(bones));
    mesh.frustumCulled = false;
    this.mesh = mesh;
    this.bones = bones;
    this.scene.add(mesh);
    this.skelHelper = new THREE.SkeletonHelper(mesh);
    this.skelHelper.visible = this.showSkeleton;
    this.scene.add(this.skelHelper);
    this.material.wireframe = this.wire;
    this.needsRender = true;
  }

  private restHips = new THREE.Vector3();

  /** apply a pose (local bone rotations + hips position); bones are in BONE_NAMES order */
  applyPose(p: Pose): void {
    if (!this.bones.length) return;
    this.bones.forEach((b, i) => b.quaternion.copy(p.local[i]));
    this.bones[0].position.copy(p.hips);
    this.needsRender = true;
  }

  /** back to the rest pose (standing) */
  resetPose(): void {
    if (!this.bones.length) return;
    for (const b of this.bones) b.quaternion.identity();
    this.bones[0].position.copy(this.restHips);
    this.needsRender = true;
  }

  setSkeletonVisible(on: boolean): void {
    this.showSkeleton = on;
    if (this.skelHelper) this.skelHelper.visible = on;
    this.needsRender = true;
  }

  setWireframe(on: boolean): void {
    this.wire = on;
    this.material.wireframe = on;
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
