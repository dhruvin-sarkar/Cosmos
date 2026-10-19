/**
 * Orbital sandbox: earth + orbital domains through the real engine (no React UI).
 * ?view=iss|tiangong|hubble|shells|geo|track &t=ISO &dist=<m or Earth radii> &phase=<deg> &elev=<deg> &hud=0
 *   iss/tiangong/hubble — the model from `dist` metres at a `phase` Sun–craft–camera angle (sunlit time searched)
 *   shells — Earth from 4 Earth radii with satellites + debris; geo — from 15 Earth radii; track — ISS orbit + ground track
 * window.__orbital exposes the app; window.__orbitalView(name) re-frames.
 */
import * as Astronomy from 'astronomy-engine';
import * as THREE from 'three';
import { bootSandbox } from './harness';
import { domain as earthDomain } from '../src/domains/earth/domain';
import { domain as orbitalDomain } from '../src/domains/orbital/domain';
import { createPlaceholderStarfieldLayer } from '../src/domains/_placeholder';
import { createRegistry } from '../src/core/registry';
import { AU_M } from '../src/core/units';
import { F, type CatalogRow } from '../src/domains/orbital/catalogTypes';
import notable from '../src/domains/orbital/notable.generated.json';
import { satrecFromRow, sgp4Icrs } from '../src/domains/orbital/sgp4';
import type { CameraViewState } from '../src/core/types';

const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'iss';
const R_E = 6_371_008.4;
const NORAD: Record<string, string> = { iss: '25544', tiangong: '48274', hubble: '20580', track: '25544' };
const ID: Record<string, string> = { iss: 'sc:iss', tiangong: 'sat:48274', hubble: 'sat:20580', track: 'sc:iss' };

function sunGeo(tMs: number): THREE.Vector3 {
  const v = Astronomy.GeoVector(Astronomy.Body.Sun, Astronomy.MakeTime(new Date(tMs)), true);
  return new THREE.Vector3(v.x, v.y, v.z).multiplyScalar(AU_M);
}

/** First time after t0 when the craft is sunlit above a sunlit Earth (bright limb behind it). */
function sunlitTime(norad: string, t0: number): number {
  const row = (notable as { rows: CatalogRow[] }).rows.find((r) => r[F.norad] === norad)!;
  const rec = satrecFromRow(row)!;
  const s = new Float64Array(6);
  for (let t = t0; t < t0 + 6 * 3600e3; t += 30e3) {
    sgp4Icrs(rec, t, s);
    const r = new THREE.Vector3(s[0], s[1], s[2]);
    const sun = sunGeo(t).normalize();
    if (r.clone().normalize().dot(sun) > 0.55) return t;
  }
  return t0;
}

const t0 = params.get('t') ? Date.parse(params.get('t')!) : Date.UTC(2026, 9, 18, 12, 0, 0);
const timeMs = NORAD[view] && !params.get('t') ? sunlitTime(NORAD[view], t0) : t0;

let registryRef = createRegistry();
const lazyReg = new Proxy({} as typeof registryRef, { get: (_o, k) => (registryRef as never)[k] });
const store0 = { getState: () => ({ time: { simTimeMs: app?.engine.time.nowMs ?? timeMs } }) };
const earth = earthDomain.create({ store: store0 as never, registry: lazyReg as never, manifest: () => null });
const orb = orbitalDomain.create({ store: store0 as never, registry: lazyReg as never, manifest: () => null });
const shells = view === 'shells' || view === 'geo';
const app = bootSandbox({
  layers: [createPlaceholderStarfieldLayer(), ...earth.layers, ...orb.layers],
  entities: [...(earth.entities ?? []), ...(orb.entities ?? [])],
  providers: orb.providers,
  focusId: ID[view] ?? 'sol:earth',
  timeMs,
  overlays: { satellites: shells || params.get('sats') === '1', debris: shells || params.get('debris') === '1', orbits: true, labels: params.get('labels') !== '0' },
  hud: params.get('hud') !== '0',
});
registryRef = app.registry as typeof registryRef;
if (params.get('paused') === '1') app.store.setState({ time: { ...app.store.getState().time, paused: true } });

function lookView(anchorId: string, anchor: THREE.Vector3, eye: THREE.Vector3, target: THREE.Vector3, up: THREE.Vector3): CameraViewState {
  const m4 = new THREE.Matrix4().lookAt(eye, target, up);
  const q = new THREE.Quaternion().setFromRotationMatrix(m4);
  const off = eye.clone().sub(anchor);
  return { anchorId, offset: [off.x, off.y, off.z], quaternion: [q.x, q.y, q.z, q.w], mode: 'orbit', focusId: anchorId, scaleLog10: Math.log10(off.length()) };
}

function frame(name: string): CameraViewState {
  const t = app.engine.time.nowMs;
  const earthW = app.registry.get('sol:earth')!.position(t, new THREE.Vector3());
  const sunDir = sunGeo(t).normalize();
  if (ID[name] && name !== 'track') {
    const e = app.registry.get(ID[name])!;
    const p = e.position(t, new THREE.Vector3());
    const zen = p.clone().sub(earthW).normalize();
    const dist = Number(params.get('dist') ?? (name === 'iss' ? 150 : name === 'tiangong' ? 85 : 26));
    const phase = THREE.MathUtils.degToRad(Number(params.get('phase') ?? 60));
    const elev = THREE.MathUtils.degToRad(Number(params.get('elev') ?? 18));
    const axis = new THREE.Vector3().crossVectors(zen, sunDir).normalize();
    const dir = sunDir.clone().applyAxisAngle(axis, phase);
    dir.addScaledVector(zen, Math.tan(elev)).normalize();
    const eye = p.clone().addScaledVector(dir, dist);
    return lookView(ID[name], p, eye, p, zen);
  }
  const radii = Number(params.get('dist') ?? (name === 'geo' ? 15 : name === 'track' ? 3.2 : 4));
  const phase = THREE.MathUtils.degToRad(Number(params.get('phase') ?? 55));
  const pole = new THREE.Vector3(0, 0, 1);
  const dir = sunDir.clone().applyAxisAngle(pole, -phase);
  dir.addScaledVector(pole, Math.tan(THREE.MathUtils.degToRad(Number(params.get('elev') ?? 22)))).normalize();
  const eye = earthW.clone().addScaledVector(dir, radii * R_E);
  return lookView('sol:earth', earthW, eye, earthW, pole);
}

(window as unknown as Record<string, unknown>).__orbital = app;
(window as unknown as Record<string, unknown>).__orbitalView = async (n: string) => app.engine.rig.setView(frame(n), { instant: true });
void app.ready.then(async () => {
  await app.engine.rig.setView(frame(view), { instant: true });
  if (view === 'track') app.commands.select('sc:iss');
  if (params.get('inspect') === '1') app.commands.select(ID[view] ?? 'sol:earth');
});
