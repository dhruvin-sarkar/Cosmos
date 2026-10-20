/**
 * Milky Way particle arrays, shuffled so any prefix (drawRange LOD) is a fair sample of every population. Runs in
 * particles.worker.ts; buildShuffledParticlesAsync falls back to a macrotask on the main thread without workers.
 */
import { generateGalaxyParticles, rng } from './model';

export interface ShuffledParticles {
  count: number;
  pos: Float32Array;
  col: Float32Array;
  lum: Float32Array;
}

export function buildShuffledParticles(n: number): ShuffledParticles {
  const g = generateGalaxyParticles(n);
  const r = rng(77);
  const idx = new Uint32Array(g.count);
  for (let i = 0; i < g.count; i++) idx[i] = i;
  for (let i = g.count - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = idx[i]!; idx[i] = idx[j]!; idx[j] = t; }
  const pos = new Float32Array(g.count * 3), col = new Float32Array(g.count * 3), lum = new Float32Array(g.count);
  for (let k = 0; k < g.count; k++) {
    const i = idx[k]!;
    pos[3 * k] = g.positions[3 * i]!; pos[3 * k + 1] = g.positions[3 * i + 1]!; pos[3 * k + 2] = g.positions[3 * i + 2]!;
    col[3 * k] = g.colors[3 * i]!; col[3 * k + 1] = g.colors[3 * i + 1]!; col[3 * k + 2] = g.colors[3 * i + 2]!;
    lum[k] = g.lum[i]!;
  }
  return { count: g.count, pos, col, lum };
}

export function buildShuffledParticlesAsync(n: number): Promise<ShuffledParticles> {
  const fallback = (): Promise<ShuffledParticles> => new Promise(r => setTimeout(() => r(buildShuffledParticles(n)), 0));
  let w: Worker;
  try {
    w = new Worker(new URL('./particles.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return fallback();
  }
  return new Promise(resolve => {
    w.onmessage = (e: MessageEvent<ShuffledParticles>) => {
      w.terminate();
      resolve(e.data);
    };
    w.onerror = () => {
      w.terminate();
      void fallback().then(resolve);
    };
    w.postMessage({ n });
  });
}
