// glb-exporter: the whole assembly as ONE glb scene, every part still its own node.
// No mesh merging, no re-meshing. Materials, textures, UVs, skeleton and skin weights are written
// as loaded. Each part root carries the common metadata (spec 3-C) in its extras.
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Assembly } from './assembly-manager';
import type { Part } from './types';
import { metaForExport } from './anchor-manager';
import { boneGroup } from './features';
import { bonesOf } from './util';

export interface ExportOptions {
  /** hang head, hair and rigid garments under the matching bone so they follow motion */
  attachToBones: boolean;
  /** extra info in the scene extras */
  note?: string;
}

export interface ExportResult {
  blob: Blob;
  bytes: number;
  nodes: string[];
  warnings: string[];
}

export const FORMAT = 'parts-studio-glb-v1';

function pickBone(body: Part, group: 'head' | 'chest' | 'waist' | 'pelvis', prefer: RegExp): THREE.Bone | null {
  const bones = bonesOf(body.model).filter((b) => boneGroup(b.name) === group);
  return bones.find((b) => prefer.test(b.name)) ?? bones[0] ?? null;
}

function uniformScale(m: THREE.Matrix4): boolean {
  const s = new THREE.Vector3().setFromMatrixScale(m);
  return Math.abs(s.x - s.y) < 1e-4 * s.x && Math.abs(s.y - s.z) < 1e-4 * s.x;
}

export async function exportAssemblyGlb(asm: Assembly, opts: ExportOptions): Promise<ExportResult> {
  const warnings: string[] = [];
  asm.root.updateMatrixWorld(true);
  const restores: (() => void)[] = [];
  try {
    // 1. metadata on every part node + scene
    const partsInfo: Record<string, unknown>[] = [];
    for (const p of asm.parts) {
      const saved = p.root.userData;
      const anchors = asm.anchors(p);
      p.root.userData = {
        ...metaForExport(p, anchors.anchors),
        partsStudio: {
          partId: p.id,
          name: p.name,
          typeSource: p.typeSource,
          visible: p.visible,
          parent: p.parentId,
          orientation: { unit: p.orient.unit, up: p.orient.up, forward: p.orient.forward, yaw: p.orient.yaw },
          autoFit: p.auto,
          manualAdjusted: !!p.manual,
          garment: p.garment ? { region: p.garment.region, rigMode: p.garment.rigMode } : undefined,
          body: p.bodyOpts ? { hideHead: p.bodyOpts.hideHead, neckLength: p.bodyOpts.neckLength, neckThickness: p.bodyOpts.neckThickness } : undefined,
        },
      };
      restores.push(() => (p.root.userData = saved));
      partsInfo.push({ id: p.id, node: p.root.name, type: p.type, file: p.fileName, visible: p.visible });
    }
    const rootSaved = asm.root.userData;
    asm.root.userData = {
      format: FORMAT,
      schemaVersion: 1,
      units: 'meters',
      up: '+Y',
      front: '+Z',
      left: '+X',
      parts: partsInfo,
      connections: asm.connections.map((c) => ({ kind: c.kind, a: c.a, b: c.b, status: c.status })),
      note: opts.note ?? '',
      generator: 'parts-studio',
    };
    restores.push(() => (asm.root.userData = rootSaved));

    // 2. optional: hang parts under bones (world transform is preserved)
    if (opts.attachToBones) {
      const body = asm.body;
      if (body && bonesOf(body.model).length) {
        const headBone = pickBone(body, 'head', /^head$/i);
        const chestBone = pickBone(body, 'chest', /^chest$/i);
        const spineBone = pickBone(body, 'waist', /^spine$/i);
        const hipsBone = pickBone(body, 'pelvis', /^hips?$/i);
        const move = (p: Part, bone: THREE.Bone | null, label: string) => {
          if (!bone) return;
          const parent = p.root.parent;
          if (!parent) return;
          bone.updateWorldMatrix(true, false);
          if (!uniformScale(bone.matrixWorld)) {
            warnings.push(`「${p.name}」は骨「${bone.name}」が不均等に拡縮されているため、骨にぶら下げずに出力しました。`);
            return;
          }
          const world = p.root.matrixWorld.clone();
          const local = new THREE.Matrix4().copy(bone.matrixWorld).invert().multiply(world);
          const pos = new THREE.Vector3();
          const q = new THREE.Quaternion();
          const s = new THREE.Vector3();
          local.decompose(pos, q, s);
          const old = { p: p.root.position.clone(), q: p.root.quaternion.clone(), s: p.root.scale.clone() };
          const idx = parent.children.indexOf(p.root);
          bone.add(p.root);
          p.root.position.copy(pos);
          p.root.quaternion.copy(q);
          p.root.scale.copy(s);
          p.root.updateMatrix();
          restores.push(() => {
            bone.remove(p.root);
            parent.children.splice(idx, 0, p.root);
            p.root.parent = parent;
            p.root.position.copy(old.p);
            p.root.quaternion.copy(old.q);
            p.root.scale.copy(old.s);
            p.root.updateMatrix();
          });
          (p.root.userData.partsStudio as Record<string, unknown>).attachedToBone = bone.name;
          void label;
        };
        const face = asm.face;
        if (face) move(face, headBone, 'face');
        if (!face) {
          for (const h of asm.of('hair')) move(h, headBone, 'hair');
        }
        for (const g of asm.of('garment')) {
          if (g.garment?.rigMode === 'follow') continue;
          const r = g.garment?.region;
          if (r === 'head') move(g, headBone, 'garment');
          else if (r === 'torso' || r === 'chest' || r === 'neck' || r === 'whole') move(g, chestBone, 'garment');
          else if (r === 'waist') move(g, spineBone, 'garment');
          else if (r === 'pelvis') move(g, hipsBone, 'garment');
        }
        asm.root.updateMatrixWorld(true);
      }
    }

    // 3. export
    const exporter = new GLTFExporter();
    const out = (await exporter.parseAsync(asm.root, { binary: true, onlyVisible: true, trs: true })) as ArrayBuffer;
    const blob = new Blob([out], { type: 'model/gltf-binary' });
    const nodes: string[] = [];
    asm.root.traverse((o) => {
      if (o !== asm.root && !(o as THREE.Bone).isBone && !(o as THREE.Mesh).isMesh) nodes.push(o.name);
    });
    return { blob, bytes: out.byteLength, nodes, warnings };
  } finally {
    for (const r of restores.reverse()) r();
    asm.root.updateMatrixWorld(true);
  }
}

// ---- verification: load the exported GLB again and compare with what is on screen -------------------------

export interface VerifyLine {
  part: string;
  ok: boolean;
  details: string[];
}

export async function verifyExport(asm: Assembly, blob: Blob): Promise<{ ok: boolean; lines: VerifyLine[]; summary: string }> {
  const buf = await blob.arrayBuffer();
  const gltf = await new GLTFLoader().parseAsync(buf, '');
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  asm.root.updateMatrixWorld(true);
  const lines: VerifyLine[] = [];
  // the nodes of the other parts are not counted for a part (a face may hang under the body's head bone)
  const rootNames = new Set(asm.parts.map((q) => q.root.name));
  const countMeshes = (o: THREE.Object3D) => {
    let meshes = 0;
    let verts = 0;
    let skinned = 0;
    let joints = 0;
    const mats = new Set<THREE.Material>();
    const texs = new Set<THREE.Texture>();
    const visit = (x: THREE.Object3D, top: boolean) => {
      if (!top && rootNames.has(x.name)) return;
      for (const c of x.children) visit(c, false);
      const m = x as THREE.Mesh;
      if (!m.isMesh) return;
      meshes++;
      verts += m.geometry.attributes.position.count;
      const sk = m as THREE.SkinnedMesh;
      if (sk.isSkinnedMesh) {
        skinned++;
        joints += sk.skeleton.bones.length;
      }
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        mats.add(mat);
        for (const v of Object.values(mat)) if (v && (v as THREE.Texture).isTexture) texs.add(v as THREE.Texture);
      }
    };
    visit(o, true);
    return { meshes, verts, skinned, joints, mats: mats.size, texs: texs.size };
  };
  for (const p of asm.parts) {
    if (!p.visible) continue;
    const details: string[] = [];
    let ok = true;
    const node = scene.getObjectByName(p.root.name);
    if (!node) {
      lines.push({ part: p.name, ok: false, details: [`ノード「${p.root.name}」が見つかりません`] });
      continue;
    }
    // world transform
    const live = p.root.matrixWorld.elements;
    const back = node.matrixWorld.elements;
    let maxd = 0;
    for (let i = 0; i < 16; i++) maxd = Math.max(maxd, Math.abs(live[i] - back[i]));
    const posOk = maxd < 1e-3;
    ok &&= posOk;
    details.push(`${posOk ? '✓' : '✗'} 位置・回転・スケール（ワールド行列の最大差 ${maxd.toExponential(1)}）`);
    // geometry
    const a = countMeshes(p.root);
    const b = countMeshes(node);
    // a live follow-garment has its own (detached) skeleton nodes missing, joints differ by design
    const same = a.meshes === b.meshes && a.verts === b.verts && a.skinned === b.skinned && a.mats === b.mats && a.texs === b.texs;
    ok &&= same;
    details.push(`${same ? '✓' : '✗'} メッシュ ${a.meshes}→${b.meshes}、頂点 ${a.verts}→${b.verts}、スキン ${a.skinned}→${b.skinned}、マテリアル ${a.mats}→${b.mats}、テクスチャ ${a.texs}→${b.texs}`);
    if (a.skinned) {
      const jok = a.joints === b.joints;
      ok &&= jok;
      details.push(`${jok ? '✓' : '✗'} 骨の参照数 ${a.joints}→${b.joints}`);
    }
    // attribute spot check: uv / skin weights of the first mesh with them
    const own = (root: THREE.Object3D): THREE.Mesh[] => {
      const out: THREE.Mesh[] = [];
      const visit = (x: THREE.Object3D, top: boolean) => {
        if (!top && rootNames.has(x.name)) return;
        if ((x as THREE.Mesh).isMesh) out.push(x as THREE.Mesh);
        for (const c of x.children) visit(c, false);
      };
      visit(root, true);
      return out;
    };
    const liveMeshes = own(p.root);
    const backMeshes = own(node);
    for (const attr of ['uv', 'skinWeight', 'skinIndex'] as const) {
      let checked = 0;
      let diff = 0;
      for (let i = 0; i < Math.min(liveMeshes.length, backMeshes.length); i++) {
        const A = liveMeshes[i].geometry.attributes[attr];
        const B = backMeshes[i].geometry.attributes[attr];
        if (!A) continue;
        if (!B) {
          diff = Infinity;
          break;
        }
        const n = Math.min(A.count, B.count, 2000);
        for (let k = 0; k < n; k++)
          for (let c = 0; c < A.itemSize; c++) {
            checked++;
            diff = Math.max(diff, Math.abs(A.getComponent(k, c) - B.getComponent(k, c)));
          }
      }
      if (checked) {
        const aok = diff < 1e-3;
        ok &&= aok;
        details.push(`${aok ? '✓' : '✗'} ${attr === 'uv' ? 'UV' : attr === 'skinWeight' ? 'スキンの重み' : 'スキンの骨番号'} ${checked} 値を照合（最大差 ${diff.toExponential(1)}）`);
      }
    }
    lines.push({ part: p.name, ok, details });
  }
  const bad = lines.filter((l) => !l.ok).length;
  return { ok: bad === 0, lines, summary: bad ? `${bad} 部品に差異があります` : `${lines.length} 部品すべて一致` };
}
