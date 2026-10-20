/**
 * Shared black-hole rendering module: physics helpers, the ray-traced lens/disc/jet renderer and its GLSL.
 * Used by src/domains/blackholes; written so Sgr A* (src/domains/galaxy) can switch to it.
 */
export * from './physics';
export { BlackHoleLens, type BlackHoleLensParams, type LensDisc, type LensJet, type LensStar } from './lens';
export { createJetRibbons, type JetParams, type JetRibbons } from './jets';
export { BLACKHOLE_FRAG, BLACKHOLE_VERT } from './glsl';
export { traceRay, type TraceResult } from './trace';
