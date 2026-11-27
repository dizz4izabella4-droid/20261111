import type { MotionClip } from './clip';
import type { HandTracks } from './hand';

export function getTimeline(body: MotionClip | null, hands: HandTracks = {}) {
  const tracks = Object.values(hands);
  if (body) {
    const fps = Math.max(body.fps, ...tracks.map((t) => t.clip.fps));
    const frameCount = Math.ceil(body.duration * fps - 1e-8);
    return { fps, duration: body.duration, frameCount, lastTime: (frameCount - 1) / fps, keyCount: frameCount + 1 };
  }
  if (!tracks.length) return null;
  const fps = Math.max(...tracks.map((t) => t.clip.fps));
  const duration = Math.max(1 / fps, ...tracks.map((t) => t.clip.duration + t.offset));
  const frameCount = Math.ceil(duration * fps - 1e-8) + 1;
  return { fps, duration, frameCount, lastTime: duration, keyCount: frameCount };
}
