/// <reference lib="webworker" />
/** Runs debris scenarios off the main thread (each 200-year run with per-shell snapshots costs ~0.3 s). */
import { runScenario, type ScenarioInputs, type ScenarioRun } from './model';

interface Req { id: number; inputs: ScenarioInputs; withShells: boolean }

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = (ev: MessageEvent<Req>) => {
  const { id, inputs, withShells } = ev.data;
  try {
    const run: ScenarioRun = runScenario(inputs, withShells);
    const transfer: ArrayBuffer[] = [run.timesYears, run.total, run.active, run.derelict, run.debris, run.collisionsPerYear, run.cumulativeCollisions, ...run.shellTotals, ...run.shellDebris]
      .map(a => a.buffer as ArrayBuffer);
    scope.postMessage({ id, run }, transfer);
  } catch (e) {
    scope.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
};
export {};
