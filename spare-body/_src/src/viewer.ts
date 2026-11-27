import * as THREE from 'three';
import { tissuePositions, tissueNormals } from './model/tissueDeform';
import { softContactPositions } from './model/softContact';
import type { SkinTextureSettings } from './model/skinTexture';
import { facePhotoGeometry, type FacePhoto } from './model/facePhoto';
import type { BodyParams } from './model/params';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { BodyMesh } from './model/body';
import { previewOffset, softnessColor, type SoftnessField } from './model/softness';
import { applyPreviewPose, defaultPreviewPose, type PreviewPose } from './model/pose';
import { applyHandFrame, type HandClip } from './model/handMotion';

export type ViewName = 'front' | 'threeQuarterLeft' | 'left' | 'back';

/** fixed views for screenshots: same target and distance for every view and project */
export const VIEW_TARGET = new THREE.Vector3(0, 0.95, 0);
export const VIEW_DISTANCE = 4.1;
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
  private skinTexture: THREE.Texture | null = null;
  private skinUrl = '';
  private skinVersion = 0;
  private skinUniforms = { skinMap: { value: null as THREE.Texture | null }, skinScale: { value: 6 }, skinEnabled: { value: 0 } };
  private heatMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  private showSoftness = false;
  private softness: SoftnessField | null = null;
  private restPositions: Float32Array | null = null;
  private bodyBounds = new THREE.Box3();
  private impulseStart: number | null = null;
  private body: BodyMesh | null = null;
  private pose = defaultPreviewPose();
  private faceMesh: THREE.Mesh | null = null;
  private faceTexture: THREE.Texture | null = null;
  private faceUrl = '';
  private faceFocus = false;
  private handFocus: 'l' | 'r' | null = null;
  private grid: THREE.GridHelper | null = null;
  private handClip: HandClip | null = null;
  private handClipStart = 0;
  bones: THREE.Bone[] = [];
  private needsRender = true;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const posedShader = (shader: { vertexShader: string }) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 posePosition;\nattribute vec3 poseNormal;\nattribute vec3 skinRestPosition;\nattribute vec3 skinRestNormal;')
        .replace('#include <skinning_vertex>', '#include <skinning_vertex>\ntransformed = posePosition;')
        .replace('#include <skinnormal_vertex>', '#include <skinnormal_vertex>\nobjectNormal = poseNormal;');
    };
    this.heatMaterial.onBeforeCompile = shader => posedShader(shader);
    this.heatMaterial.customProgramCacheKey = () => 'spare-tissue-heat-v2';
    this.material.onBeforeCompile = shader => {
      posedShader(shader);
      Object.assign(shader.uniforms, this.skinUniforms);
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSkinPosition;\nvarying vec3 vSkinNormal;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSkinPosition = skinRestPosition;\nvSkinNormal = skinRestNormal;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D skinMap;\nuniform float skinScale;\nuniform float skinEnabled;\nvarying vec3 vSkinPosition;\nvarying vec3 vSkinNormal;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          if (skinEnabled > 0.5) {
            vec3 blend = pow(abs(normalize(vSkinNormal)), vec3(4.0));
            blend /= max(dot(blend, vec3(1.0)), 0.0001);
            vec3 tx = texture2D(skinMap, vSkinPosition.yz * skinScale).rgb;
            vec3 ty = texture2D(skinMap, vSkinPosition.xz * skinScale).rgb;
            vec3 tz = texture2D(skinMap, vSkinPosition.xy * skinScale).rgb;
            diffuseColor.rgb *= tx * blend.x + ty * blend.y + tz * blend.z;
          }
        `);
    };
    this.material.customProgramCacheKey = () => 'spare-body-tissue-skin-v2';
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
    this.grid = grid;
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
      if (this.handClip && this.body) {
        const seconds = (performance.now() - this.handClipStart) / 1000;
        applyPreviewPose(this.body, this.bones, this.pose);
        applyHandFrame(this.body, this.bones, this.handClip, seconds);
        this.updatePosedAttributes();
        this.needsRender = true;
        if (!this.handClip.loop && seconds >= (this.handClip.frames.length - 1) / this.handClip.fps) this.handClip = null;
      }
      if (this.impulseStart !== null) this.updateImpulse((performance.now() - this.impulseStart) / 1000);
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
    this.handFocus = null;
    this.faceFocus = false;
    if (this.faceMesh) this.faceMesh.visible = !this.showSoftness;
    this.material.color.setHex(this.skinUniforms.skinEnabled.value ? 0xffffff : BODY_COLOR);
    this.mesh?.geometry.setDrawRange(0, Infinity);
    if (this.grid) this.grid.visible = true;
    if (this.mesh) this.refreshSkeleton(this.mesh);
    this.camera.up.set(0, 1, 0);
    const d = VIEW_DIRS[name];
    this.camera.position.set(VIEW_TARGET.x + d[0] * VIEW_DISTANCE, VIEW_TARGET.y + d[1] * VIEW_DISTANCE, VIEW_TARGET.z + d[2] * VIEW_DISTANCE);
    this.controls.target.copy(VIEW_TARGET);
    this.camera.lookAt(VIEW_TARGET);
    this.controls.update();
    this.fitBody();
    this.needsRender = true;
  }

  /** Fit the entire rest pose in narrow preview windows; manual zoom remains available. */
  private fitBody(): void {
    if (this.bodyBounds.isEmpty()) return;
    this.camera.updateMatrixWorld(true);
    const tangent = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    let zoom = 1;
    const point = new THREE.Vector3();
    const { min, max } = this.bodyBounds;
    for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
      point.set(x, y, z).applyMatrix4(this.camera.matrixWorldInverse);
      const halfHeight = Math.max(0.01, -point.z) * tangent;
      zoom = Math.min(zoom, 0.94 * halfHeight * this.camera.aspect / (Math.abs(point.x) + 0.025), 0.94 * halfHeight / (Math.abs(point.y) + 0.025));
    }
    this.camera.zoom = zoom;
    this.camera.updateProjectionMatrix();
  }

  /** replace the body: skinned mesh bound to a fresh skeleton in the rest pose */
  setBody(b: BodyMesh): void {
    const firstBody = this.body === null;
    this.stopImpulse();
    this.clearFaceMesh();
    this.body = b;
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      if (this.skelHelper) {
        this.scene.remove(this.skelHelper);
        this.skelHelper.dispose();
      }
    }
    const g = new THREE.BufferGeometry();
    this.restPositions = b.positions;
    this.softness = null;
    g.setAttribute('position', new THREE.BufferAttribute(b.positions.slice(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(b.normals, 3));
    g.setAttribute('posePosition', new THREE.BufferAttribute(b.positions.slice(), 3));
    g.setAttribute('poseNormal', new THREE.BufferAttribute(b.normals.slice(), 3));
    g.setAttribute('skinRestPosition', new THREE.BufferAttribute(b.positions, 3));
    g.setAttribute('skinRestNormal', new THREE.BufferAttribute(b.normals, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(b.skinIndex, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(b.skinWeight, 4));
    g.setIndex(new THREE.BufferAttribute(b.indices, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    this.bodyBounds.copy(g.boundingBox!);
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
    applyPreviewPose(b, bones, this.pose);
    this.fitPose();
    // Rebuilding a slider-edited mesh must not reframe the user's view.
    if (firstBody) this.fitBody();
    if (this.handFocus) {
      const part = b.parts.find(p => p.name === `hand_${this.handFocus}`);
      if (part) mesh.geometry.setDrawRange(part.start, part.count);
      this.refreshSkeleton(bones.find(bone => bone.name === `hand_${this.handFocus}`)!);
    }
    this.material.wireframe = this.wire;
    this.needsRender = true;
  }

  private clearFaceMesh(): void {
    if (!this.faceMesh) return;
    this.faceMesh.removeFromParent(); this.faceMesh.geometry.dispose();
    (this.faceMesh.material as THREE.Material).dispose(); this.faceMesh = null;
  }

  setFacePhoto(photo: FacePhoto | null, params: BodyParams): void {
    this.clearFaceMesh();
    if (!photo || !this.body) {
      this.faceTexture?.dispose(); this.faceTexture = null; this.faceUrl = ''; this.needsRender = true; return;
    }
    if (this.faceUrl !== photo.texture) {
      this.faceTexture?.dispose(); this.faceUrl = photo.texture;
      this.faceTexture = new THREE.TextureLoader().load(photo.texture, () => { this.needsRender = true; });
      this.faceTexture.colorSpace = THREE.SRGBColorSpace;
      // Geometry uses glTF UV orientation so saved and displayed images agree.
      this.faceTexture.flipY = false;
    }
    const data = facePhotoGeometry(this.body, params), geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
    const head = this.body.bones.find((b) => b.name === 'head')!;
    geometry.translate(-head.head[0], -head.head[1], -head.head[2]);
    this.faceMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: this.faceTexture, toneMapped: false }));
    this.faceMesh.name = 'face_photo'; this.faceMesh.visible = !this.showSoftness && !this.handFocus;
    this.bones.find((b) => b.name === 'head')!.add(this.faceMesh); this.needsRender = true;
  }

  focusFace(): void {
    const head = this.bones.find((b) => b.name === 'head'); if (!head || !this.body) return;
    this.setView('front'); this.faceFocus = true;
    const base = this.body.bones.find((b) => b.name === 'head')!.head;
    const height = this.body.height - base[1];
    const center = head.localToWorld(new THREE.Vector3(0, height * 0.53, 0));
    const distance = Math.max(0.5, height * 2.8 / Math.min(1, this.camera.aspect));
    this.controls.target.copy(center); this.camera.position.copy(center).add(new THREE.Vector3(0, 0, distance));
    this.camera.zoom = 1; this.camera.lookAt(center); this.camera.updateProjectionMatrix(); this.controls.update(); this.needsRender = true;
  }

  setSkeletonVisible(on: boolean): void {
    this.showSkeleton = on;
    if (this.skelHelper) this.skelHelper.visible = on;
    this.needsRender = true;
  }

  setPose(pose: PreviewPose): void {
    this.handClip = null;
    this.pose = { ...pose };
    if (this.body) applyPreviewPose(this.body, this.bones, this.pose);
    this.fitPose();
    this.needsRender = true;
  }

  playHandMotion(clip: HandClip): void {
    if (!this.body) return;
    this.handClip = clip; this.handClipStart = performance.now();
    applyPreviewPose(this.body, this.bones, this.pose);
    applyHandFrame(this.body, this.bones, clip, 0);
    this.mesh?.updateMatrixWorld(true); this.mesh?.skeleton.update();
    this.focusHand(clip.handedness === 'Left' ? 'l' : 'r');
  }

  stopHandMotion(): void { this.setPose(this.pose); }

  private refreshSkeleton(root: THREE.Object3D): void {
    if (this.skelHelper) { this.scene.remove(this.skelHelper); this.skelHelper.dispose(); }
    this.skelHelper = new THREE.SkeletonHelper(root); this.skelHelper.visible = this.showSkeleton; this.scene.add(this.skelHelper);
  }

  private fitPose(): void {
    if (!this.mesh || !this.restPositions || !this.body) return;
    const tissue = tissuePositions(this.body, this.mesh, this.softness);
    this.restPositions = softContactPositions(this.body, this.mesh, tissue, this.softness);
    const position = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    (position.array as Float32Array).set(this.restPositions); position.needsUpdate = true;
    // Compute lighting from the actual deformed surface, not from an inverse-
    // skinned normal which can produce false creases under deep joint bends.
    const posed = new Float32Array(this.restPositions.length), pointForNormal = new THREE.Vector3();
    for (let i = 0; i < posed.length / 3; i++) {
      pointForNormal.fromArray(this.restPositions, i * 3);
      this.mesh.applyBoneTransform(i, pointForNormal); pointForNormal.toArray(posed, i * 3);
    }
    this.mesh.geometry.setAttribute('posePosition', new THREE.BufferAttribute(posed, 3));
    this.mesh.geometry.setAttribute('poseNormal', new THREE.BufferAttribute(tissueNormals(posed, this.body.indices), 3));
    this.mesh.updateMatrixWorld(true);
    this.mesh.skeleton.update();
    this.bodyBounds.makeEmpty();
    const point = new THREE.Vector3();
    for (let i = 0; i < this.restPositions.length / 3; i++) {
      point.fromArray(this.restPositions, i * 3);
      this.mesh.applyBoneTransform(i, point);
      this.bodyBounds.expandByPoint(point);
    }
    // Bounds update independently of camera framing. Only explicit view/focus
    // buttons and the first model load are allowed to reposition or zoom.

  }

  focusHand(side: 'l' | 'r'): void {
    if (!this.mesh || !this.body) return;
    this.handFocus = side;
    this.faceFocus = false;
    if (this.faceMesh) this.faceMesh.visible = false;
    this.material.color.setHex(this.skinUniforms.skinEnabled.value ? 0xffffff : 0xc5aca1);
    const part = this.body.parts.find((p) => p.name === `hand_${side}`)!;
    this.mesh.geometry.setDrawRange(part.start, part.count);
    if (this.grid) this.grid.visible = false;
    this.refreshSkeleton(this.bones.find((b) => b.name === `hand_${side}`)!);
    const bounds = new THREE.Box3(), point = new THREE.Vector3();
    for (const i of new Set(this.body.indices.subarray(part.start, part.start + part.count))) {
      point.fromArray(this.body.positions, i * 3); this.mesh.applyBoneTransform(i, point); bounds.expandByPoint(point);
    }
    const at = (name: string) => this.bones.find((b) => b.name === `${name}_${side}`)!.getWorldPosition(new THREE.Vector3());
    const along = at('middle_mcp').sub(at('hand')).normalize();
    const normal = at('index_mcp').sub(at('pinky_mcp')).cross(along).normalize().multiplyScalar(side === 'l' ? 1 : -1);
    const center = bounds.getCenter(new THREE.Vector3()), distance = Math.max(0.25, bounds.getSize(point).length() * 2.8);
    this.camera.up.copy(along); this.camera.position.copy(center).addScaledVector(normal, distance);
    this.controls.target.copy(center); this.camera.lookAt(center); this.controls.update();
    this.bodyBounds.copy(bounds); this.fitBody(); this.needsRender = true;
  }

  async setSkinTexture(settings: SkinTextureSettings): Promise<void> {
    const version = ++this.skinVersion;
    this.skinUniforms.skinScale.value = settings.repeat;
    if (settings.source && settings.source !== this.skinUrl) {
      const texture = await new THREE.TextureLoader().loadAsync(settings.source);
      if (version !== this.skinVersion) { texture.dispose(); return; }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      this.skinTexture?.dispose(); this.skinTexture = texture; this.skinUrl = settings.source;
    }
    if (!settings.source) { this.skinTexture?.dispose(); this.skinTexture = null; this.skinUrl = ''; }
    this.skinUniforms.skinMap.value = this.skinTexture;
    this.skinUniforms.skinEnabled.value = settings.enabled && this.skinTexture ? 1 : 0;
    this.material.color.setHex(this.skinUniforms.skinEnabled.value ? 0xffffff : this.handFocus ? 0xc5aca1 : BODY_COLOR);
    this.needsRender = true;
  }

  setWireframe(on: boolean): void {
    this.wire = on;
    this.material.wireframe = on;
    this.heatMaterial.wireframe = on;
    this.needsRender = true;
  }

  setSoftness(field: SoftnessField): void {
    this.stopImpulse();
    this.softness = field;
    const colors = new Float32Array(field.softness.length * 3);
    const color = new THREE.Color();
    for (let i = 0; i < field.softness.length; i++) {
      const [r, g, b] = softnessColor(field.softness[i]);
      color.setRGB(r, g, b, THREE.SRGBColorSpace).toArray(colors, i * 3);
    }
    this.mesh?.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.setSoftnessVisible(this.showSoftness);
    this.fitPose();
  }

  setSoftnessVisible(on: boolean): void {
    this.showSoftness = on;
    if (this.faceMesh) this.faceMesh.visible = !on && !this.handFocus;
    if (this.mesh) this.mesh.material = on ? this.heatMaterial : this.material;
    this.needsRender = true;
  }

  testImpulse(): void {
    this.impulseStart = performance.now();
  }

  stopImpulse(): void {
    this.impulseStart = null;
    if (this.mesh && this.restPositions) {
      const position = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      (position.array as Float32Array).set(this.restPositions);
      position.needsUpdate = true;
      this.updatePosedAttributes();
      this.needsRender = true;
    }
  }

  private updateImpulse(time: number): void {
    if (!this.mesh || !this.restPositions || !this.softness || time >= 8) return this.stopImpulse();
    const position = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const values = position.array as Float32Array;
    const f = this.softness;
    for (let i = 0; i < f.softness.length; i++) {
      values[i * 3] = this.restPositions[i * 3] + previewOffset(time, f.softness[i], f.maxOffset[i], f.damping[i]);
    }
    position.needsUpdate = true;
    this.updatePosedAttributes();
    this.needsRender = true;
  }

  private updatePosedAttributes(): void {
    if (!this.mesh) return;
    const geometry = this.mesh.geometry, position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const posed = geometry.getAttribute('posePosition') as THREE.BufferAttribute, point = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i); this.mesh.applyBoneTransform(i, point); posed.setXYZ(i, point.x, point.y, point.z);
    }
    posed.needsUpdate = true;
    if (this.body) geometry.setAttribute('poseNormal', new THREE.BufferAttribute(tissueNormals(posed.array as Float32Array, this.body.indices), 3));
  }

  requestRender(): void {
    this.needsRender = true;
  }

  async renderNow(): Promise<void> {
    this.renderer.render(this.scene, this.camera);
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  }
}
