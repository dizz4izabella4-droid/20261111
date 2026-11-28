import './style.css';
import { Assembly } from './assembly-manager';
import { Viewer } from './viewer';
import { StudioUI } from './ui';
import * as exporter from './glb-exporter';
import * as projects from './project-manager';

const viewer = new Viewer(document.getElementById('c') as HTMLCanvasElement);
const asm = new Assembly();
viewer.scene.add(asm.root);
const ui = new StudioUI(asm, viewer);
if (viewer.noWebGL) {
  ui.toast('3D表示（WebGL）を開始できませんでした。読み込み・自動調整・数値調整・保存・GLB出力は、プレビューなしで使えます。', 'warn');
  const c = document.getElementById('viewport')!;
  const n = document.createElement('div');
  n.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#555;font-size:14px;pointer-events:none;text-align:center;padding:20px';
  n.textContent = '3Dプレビューを表示できません（WebGL が使えない環境です）';
  c.append(n);
}

// keep the camera usable when the first part arrives
asm.on('parts', () => viewer.invalidate());

// for tests and debugging in the browser console
(window as unknown as Record<string, unknown>).__studio = { asm, viewer, ui, exporter, projects };

window.addEventListener('error', (e) => ui.toast(`予期しないエラー：${e.message}`, 'error'));
window.addEventListener('unhandledrejection', (e) => ui.toast(`予期しないエラー：${(e.reason as Error)?.message ?? e.reason}`, 'error'));
