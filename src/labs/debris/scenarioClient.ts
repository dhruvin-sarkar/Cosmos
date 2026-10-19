/**
 * Scenario runner client: a single module worker (scenario.worker.ts) with request ids; falls back to running on the
 * main thread when workers are unavailable. Results are cached by input key (runs are deterministic).
 */
import { runScenario, type ScenarioInputs, type ScenarioRun } from './model';

type Pending = { resolve(r: ScenarioRun): void; reject(e: Error): void };

let worker: Worker | null | undefined;
let nextId = 1;
const pending = new Map<number, Pending>();
const cache = new Map<string, Promise<ScenarioRun>>();
const CACHE_MAX = 40;

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('./scenario.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<{ id: number; run?: ScenarioRun; error?: string }>) => {
      const p = pending.get(ev.data.id);
      if (!p) return;
      pending.delete(ev.data.id);
      if (ev.data.run) p.resolve(ev.data.run);
      else p.reject(new Error(ev.data.error ?? 'Scenario worker failed'));
    };
    worker.onerror = () => {
      for (const p of pending.values()) p.reject(new Error('Scenario worker crashed'));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  } catch {
    worker = null;
  }
  return worker;
}

export function scenarioKey(inp: ScenarioInputs, withShells: boolean): string {
  return `${inp.scenario}|${inp.solar}|${inp.horizonYears}|${inp.scenario === 'adr' ? inp.adrPerYear : 0}|${withShells ? 1 : 0}`;
}

export function requestScenario(inp: ScenarioInputs, withShells: boolean): Promise<ScenarioRun> {
  const key = scenarioKey(inp, withShells);
  const hit = cache.get(key);
  if (hit) return hit;
  const w = getWorker();
  const p = w
    ? new Promise<ScenarioRun>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      w.postMessage({ id, inputs: { ...inp }, withShells });
    })
    : new Promise<ScenarioRun>((resolve, reject) => {
      setTimeout(() => {
        try { resolve(runScenario(inp, withShells)); } catch (e) { reject(e instanceof Error ? e : new Error(String(e))); }
      }, 0);
    });
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return p;
}
