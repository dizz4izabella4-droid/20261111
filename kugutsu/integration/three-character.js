// Copy into a Three.js web game. Requires only three, not the kugutsu application.
import { AnimationMixer, LoopOnce, LoopRepeat } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export async function loadCharacter(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const clip = gltf.animations[0];
  if (!clip) throw new Error('このGLBにはアニメーションがありません。');
  const root = gltf.scene;
  const mixer = new AnimationMixer(root);
  const action = mixer.clipAction(clip);
  const settings = root.userData.kugutsu;
  action.setLoop(settings?.loop === false ? LoopOnce : LoopRepeat, settings?.loop === false ? 1 : Infinity);
  action.clampWhenFinished = true;
  action.play();
  return {
    root, mixer, action,
    update(deltaSeconds) { mixer.update(deltaSeconds); },
    dispose() { mixer.stopAllAction(); mixer.uncacheRoot(root); },
  };
}
