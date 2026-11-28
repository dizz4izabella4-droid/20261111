// 服の計算は画面を止めないように裏で行う
import {createEngine} from './engine.js';

const handle=createEngine(m=>self.postMessage(m));
self.onmessage=e=>handle(e.data);
self.postMessage({type:'ready'}); // 画面側はこの知らせが来なければ、画面側の計算に切り替える
