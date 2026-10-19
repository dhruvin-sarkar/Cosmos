/**
 * Stars sandbox: stars domain + solar domain through the real engine.
 * Query:
 *   ?ra=85&dec=0&fov=…      look direction (deg, ICRS) from 1 AU behind the Sun (sky-from-Earth check)
 *   &from=pc,ra,dec          camera at that heliocentric position instead (e.g. from=30,0,0)
 *   &star=star:hip:71683&dist=8   close-up: camera at dist × radius from the star, looking at it (phase via &az)
 *   &const=1&bounds=1&labels=1&quality=ultra&scale=…
 */
import * as THREE from 'three';
import { bootSandbox } from './harness';
import { createStarsDomain } from '../src/domains/stars';
import { createSolarDomain } from '../src/domains/solar';
import { createRegistry } from '../src/core/registry';
import { AU_M, PC_M } from '../src/core/units';

const params = new URLSearchParams(location.search);
const num = (k: string, d: number): number => (params.has(k) ? Number(params.get(k)) : d);
const timeMs = params.get('t') ? Date.parse(params.get('t')!) : Date.parse('2026-10-18T22:00:00Z');
let registryRef = createRegistry();
const solar = createSolarDomain({
  registry: new Proxy({} as typeof registryRef, { get: (_o, k) => (registryRef as never)[k] }),
  nowMs: () => app.store.getState().time.simTimeMs,
});
const stars = createStarsDomain();
const app = bootSandbox({
  layers: [...stars.layers, ...solar.layers],
  entities: [...solar.entities],
  focusId: 'sol:sun',
  timeMs,
  overlays: {
    constellations: params.get('const') === '1',
    'constellation-boundaries': params.get('bounds') === '1',
    labels: params.get('labels') !== '0',
    orbits: false,
  },
});
registryRef = app.registry as typeof registryRef;
const quality = params.get('quality');
if (quality) app.store.setState({ quality: { ...app.store.getState().quality, preset: quality as never } });
app.store.setState({ time: { ...app.store.getState().time, paused: true } });

const DEG = Math.PI / 180;
const dirOf = (ra: number, dec: number): THREE.Vector3 =>
  new THREE.Vector3(Math.cos(dec * DEG) * Math.cos(ra * DEG), Math.cos(dec * DEG) * Math.sin(ra * DEG), Math.sin(dec * DEG));
const quatLooking = (look: THREE.Vector3): THREE.Quaternion => {
  const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), look, new THREE.Vector3(0, 0, 1));
  return new THREE.Quaternion().setFromRotationMatrix(m);
};

async function waitFor<T>(fn: () => T | undefined | null, ms = 15000): Promise<T> {
  const t0 = performance.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (performance.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 50));
  }
}

void app.ready.then(async () => {
  await waitFor(() => stars.runtime.details);
  const starId = params.get('star');
  if (starId) {
    const e = await waitFor(() => app.registry.get(starId));
    const t = app.store.getState().time.simTimeMs;
    const p = e.position(t, new THREE.Vector3());
    const toSun = p.clone().negate().normalize();
    const az = num('az', 60) * DEG;
    const up = new THREE.Vector3(0, 0, 1);
    const axis = new THREE.Vector3().crossVectors(toSun, up).normalize();
    const dir = toSun.clone().applyAxisAngle(axis, az);
    const dist = num('dist', 8) * (e.radiusM ?? 7e8);
    const offset = dir.multiplyScalar(dist);
    const q = quatLooking(offset.clone().negate().normalize());
    await app.engine.services.cameraController.setView(
      { anchorId: starId, offset: [offset.x, offset.y, offset.z], quaternion: [q.x, q.y, q.z, q.w], mode: 'orbit', focusId: starId, scaleLog10: Math.log10(dist) },
      { instant: true },
    );
    if (params.get('inspect') === '1') app.commands.select(starId);
    return;
  }
  const look = dirOf(num('ra', 84), num('dec', 2));
  let offset: THREE.Vector3;
  if (params.has('from')) {
    const [pc, ra, dec] = params.get('from')!.split(',').map(Number);
    offset = dirOf(ra, dec).multiplyScalar(pc * PC_M);
  } else offset = look.clone().multiplyScalar(AU_M);
  const q = quatLooking(look);
  await app.engine.services.cameraController.setView(
    { anchorId: 'sol:sun', offset: [offset.x, offset.y, offset.z], quaternion: [q.x, q.y, q.z, q.w], mode: 'free', focusId: null, scaleLog10: num('scale', 11) },
    { instant: true },
  );
});
(window as unknown as { __stars: unknown }).__stars = stars;
