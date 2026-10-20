/// <reference lib="webworker" />
/** Off-main-thread generation of the solar surface-pattern texture (sunGranulation.ts). */
import { drain, patternGen } from './sunGranulationGen';

self.onmessage = (e: MessageEvent<number>) => {
  const data = drain(patternGen(e.data));
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(data, [data.buffer]);
};
