/** Milky Way particle generation off the main thread (was a 100-340 ms main-thread task on the first galaxy view). */
import { buildShuffledParticles } from './particlesGen';

self.onmessage = (e: MessageEvent<{ n: number }>) => {
  const p = buildShuffledParticles(e.data.n);
  (self as unknown as Worker).postMessage(p, [p.pos.buffer, p.col.buffer, p.lum.buffer]);
};
