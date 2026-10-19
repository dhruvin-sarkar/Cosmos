/**
 * Debris lab 3D overlay sandbox: earth + orbital domains through the real engine (no React UI) plus the lab's overlay layer.
 * ?mode=shells|breakup &scenario=<ShellScenarioId> &year=<0..200> &event=iridium-cosmos-2009|fengyun-1c-2007 &t=<s after breakup>
 * &dist=<Earth radii, default 4> &tracked=1 (show today's tracked objects) &hud=0
 * window.__debris = { app, state, setT(s), setYear(y) }.
 */
import { bootSandbox } from './harness';
import { domain as earthDomain } from '../src/domains/earth/domain';
import { domain as orbitalDomain } from '../src/domains/orbital/domain';
import { createPlaceholderStarfieldLayer } from '../src/domains/_placeholder';
import { createRegistry } from '../src/core/registry';
import { createDebrisOverlayLayer, createOverlayState } from '../src/labs/debris/overlay';
import {
  REAL_INPUTS, SHELL_COUNT, buildBreakupCloud, shellGlowLevel, catalogInitialPopulation, runScenario, shellDensityPerKm3, shellsAtYear,
  type BreakupEventId,
} from '../src/labs/debris/model';
import type { ShellScenarioId } from '../src/science/debris';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') === 'breakup' ? 'breakup' : 'shells';
const R_E = 6_371_008.4;
const dist = Number(params.get('dist') ?? 4) * R_E;

const registry = createRegistry();
const ctx = { store: undefined as never, registry, manifest: () => null };
const earth = earthDomain.create(ctx);
const orb = orbitalDomain.create(ctx);
const state = createOverlayState();
state.mode = mode;

const run = runScenario({ ...REAL_INPUTS, scenario: (params.get('scenario') ?? 'business-as-usual') as ShellScenarioId, horizonYears: 200 });
const p0 = catalogInitialPopulation();
const today = shellDensityPerKm3(p0.active.map((v, i) => v + p0.derelict[i] + p0.debris[i]), new Float64Array(SHELL_COUNT));
const peak = Math.max(...today);
const counts = new Float64Array(SHELL_COUNT), dens = new Float64Array(SHELL_COUNT);
function setYear(y: number): void {
  shellsAtYear(run, y, 'total', counts);
  shellDensityPerKm3(counts, dens);
  for (let i = 0; i < SHELL_COUNT; i++) state.shellLevel[i] = shellGlowLevel(dens[i] / peak);
}
setYear(Number(params.get('year') ?? 0));
if (mode === 'breakup') state.cloud = buildBreakupCloud((params.get('event') ?? 'iridium-cosmos-2009') as BreakupEventId);
state.tS = Number(params.get('t') ?? 3600);

const tracked = params.get('tracked') === '1';
const app = bootSandbox({
  layers: [createPlaceholderStarfieldLayer(), ...earth.layers, ...orb.layers, createDebrisOverlayLayer(state)],
  entities: [...(earth.entities ?? []), ...(orb.entities ?? [])],
  providers: orb.providers,
  focusId: 'sol:earth',
  overlays: { satellites: tracked, debris: tracked, orbits: false, labels: false },
  hud: params.get('hud') !== '0',
});
void app.ready.then(() => app.commands.focus('sol:earth', { distanceM: dist, instant: true }));
(window as unknown as Record<string, unknown>).__debris = { app, state, setT: (s: number) => { state.tS = s; }, setYear };
