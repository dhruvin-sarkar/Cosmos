/**
 * Solar-planets sandbox: the solar domain (+ placeholder Earth/Moon for context) through the real engine.
 * Query: ?focus=sol:saturn&t=2026-10-18T12:00:00Z&scale=9&quality=ultra&inspect=1&phase=60&dist=3
 *   phase/dist place the camera at that Sun–body–camera phase angle (deg) and distance (body radii).
 */
import * as THREE from 'three';
import { bootSandbox } from './harness';
import { createSolarDomain } from '../src/domains/solar';
import { createPlaceholderEntities, createPlaceholderBodiesLayer } from '../src/domains/_placeholder';
import { createRegistry } from '../src/core/registry';

const params = new URLSearchParams(location.search);
const t = params.get('t');
const timeMs = t ? Date.parse(t) : Date.parse('2026-10-18T12:00:00Z');
// The sandbox registry is created by the harness; give the domain a lazy view of it.
let registryRef = createRegistry();
const solar = createSolarDomain({ registry: new Proxy({} as typeof registryRef, { get: (_o, k) => (registryRef as never)[k] }), nowMs: () => app.store.getState().time.simTimeMs });
const ph = createPlaceholderEntities().filter((e) => e.id !== 'sol:sun');
const app = bootSandbox({
  layers: [...solar.layers, createPlaceholderBodiesLayer(ph)],
  entities: [...solar.entities, ...ph],
  focusId: params.get('focus') ?? 'sol:jupiter',
  timeMs,
  overlays: { orbits: params.get('orbits') !== '0', labels: params.get('labels') !== '0', 'enlarge-bodies': params.get('enlarge') === '1' },
});
registryRef = app.registry as typeof registryRef;
const quality = params.get('quality');
if (quality) app.store.setState({ quality: { ...app.store.getState().quality, preset: quality as never } });
if (params.get('paused') !== '0') app.store.setState({ time: { ...app.store.getState().time, paused: true } });

void app.ready.then(async () => {
  const scale = Number(params.get('scale'));
  if (params.has('scale') && Number.isFinite(scale)) app.commands.setScale(scale, { animate: false });
  const focus = params.get('focus') ?? 'sol:jupiter';
  if (params.has('phase')) {
    const e = app.registry.get(focus)!;
    const sunE = app.registry.get('sol:sun')!;
    const tNow = app.store.getState().time.simTimeMs;
    const p = e.position(tNow, new THREE.Vector3());
    const s = sunE.position(tNow, new THREE.Vector3()).sub(p).normalize();
    const phase = (Number(params.get('phase')) * Math.PI) / 180;
    const elev = (Number(params.get('elev') ?? '20') * Math.PI) / 180;
    // Rotate the Sun direction by the phase angle about an axis perpendicular to it (tilted by elev).
    const up = new THREE.Vector3(0, 0, 1);
    const axis = new THREE.Vector3().crossVectors(s, up).normalize().applyAxisAngle(s, elev);
    const dir = s.clone().applyAxisAngle(axis, phase);
    const dist = Number(params.get('dist') ?? '3') * (e.radiusM ?? 1);
    const offset = dir.multiplyScalar(dist);
    const look = offset.clone().negate().normalize();
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), look, new THREE.Vector3(0, 0, 1));
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    await app.engine.services.cameraController.setView(
      { anchorId: focus, offset: [offset.x, offset.y, offset.z], quaternion: [q.x, q.y, q.z, q.w], mode: 'orbit', focusId: focus, scaleLog10: Math.log10(dist) },
      { instant: true },
    );
  }
  if (params.get('inspect') === '1') app.commands.select(focus);
});
(window as unknown as { __solar: unknown }).__solar = solar;
