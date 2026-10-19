/**
 * Small-bodies sandbox: solar domain + small-bodies domain (+ placeholder Earth/Moon) through the real engine.
 * Query: ?focus=sb:didymos&t=2026-10-18T12:00:00Z&paused=1&orbits=1&labels=1&enlarge=1&neo=1
 *   dist=<body radii>&phase=<deg>&elev=<deg>  place the camera relative to the focus (as in moons.ts)
 *   top=<AU>  view the Sun from above the ecliptic at that height (belt overview), e.g. ?focus=sol:sun&top=9
 */
import * as THREE from 'three';
import { bootSandbox } from './harness';
import { createSolarDomain } from '../src/domains/solar';
import { createPlaceholderEntities, createPlaceholderBodiesLayer } from '../src/domains/_placeholder';
import { domain as smallBodies } from '../src/domains/smallbodies/domain';
import { setNeoHighlight } from '../src/domains/smallbodies/asteroidLayer';
import { createRegistry } from '../src/core/registry';
import { AU_M } from '../src/core/units';

// Headless Chrome in the screenshot tool stalls on the first cached plain fetch of the 2.7 MB .bin; one uncached warm-up avoids it (sandbox only).
await fetch(`${import.meta.env.BASE_URL}data/solar/asteroids.bin`, { cache: 'no-store' }).then((r) => r.arrayBuffer()).catch(() => undefined);

const params = new URLSearchParams(location.search);
const t = params.get('t');
const timeMs = t ? Date.parse(t) : Date.parse('2026-10-18T12:00:00Z');
let registryRef = createRegistry();
const lazyReg = new Proxy({} as typeof registryRef, { get: (_o, k) => (registryRef as never)[k] });
const solar = createSolarDomain({ registry: lazyReg, nowMs: () => app.store.getState().time.simTimeMs });
const ph = createPlaceholderEntities().filter((e) => e.id !== 'sol:sun');
const sb = smallBodies.create({ registry: lazyReg, store: undefined as never, manifest: () => null });
// Spacecraft ephemerides must be loaded before a craft is the initial focus (otherwise the camera frames its pre-load position at the Sun).
await (sb.layers[2] as unknown as { ready: Promise<void> }).ready;
const app = bootSandbox({
  layers: [...solar.layers, ...sb.layers, createPlaceholderBodiesLayer(ph)],
  entities: [...solar.entities, ...(sb.entities ?? []), ...ph],
  focusId: params.get('focus') ?? 'sol:sun',
  timeMs,
  overlays: { asteroids: params.get('asteroids') !== '0', orbits: params.get('orbits') !== '0', labels: params.get('labels') !== '0', 'enlarge-bodies': params.get('enlarge') === '1' },
});
registryRef = app.registry as typeof registryRef;
if (params.get('paused') !== '0') app.store.setState({ time: { ...app.store.getState().time, paused: true } });
if (params.get('neo') === '1') setNeoHighlight(true);

void app.ready.then(async () => {
  const focus = params.get('focus') ?? 'sol:sun';
  const e = app.registry.get(focus)!;
  const tNow = app.store.getState().time.simTimeMs;
  let offset: THREE.Vector3 | null = null;
  if (params.has('top')) {
    offset = new THREE.Vector3(0, -0.15, 1).normalize().multiplyScalar(Number(params.get('top')) * AU_M);
  } else if (params.has('dist')) {
    const p = e.position(tNow, new THREE.Vector3());
    const s = app.registry.get('sol:sun')!.position(tNow, new THREE.Vector3()).sub(p).normalize();
    const phase = (Number(params.get('phase') ?? '60') * Math.PI) / 180;
    const elev = (Number(params.get('elev') ?? '20') * Math.PI) / 180;
    const axis = new THREE.Vector3().crossVectors(s, new THREE.Vector3(0, 0, 1)).normalize().applyAxisAngle(s, elev);
    offset = s.clone().applyAxisAngle(axis, phase).multiplyScalar(Number(params.get('dist')) * (e.radiusM ?? 1));
  }
  if (offset) {
    const look = offset.clone().negate().normalize();
    const up = Math.abs(look.z) > 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), look, up));
    await app.engine.services.cameraController.setView(
      { anchorId: focus, offset: [offset.x, offset.y, offset.z], quaternion: [q.x, q.y, q.z, q.w], mode: 'orbit', focusId: focus, scaleLog10: Math.log10(offset.length()) },
      { instant: true },
    );
  }
  if (params.get('inspect') === '1') app.commands.select(focus);
});
(window as unknown as { __sb: unknown }).__sb = sb;
