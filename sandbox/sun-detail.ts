/**
 * Sun-detail sandbox: the solar domain through the real engine, camera placed relative to the Sun.
 * Query: ?dist=3.2&from=earth|side|pole&band=visible|h-alpha|ultraviolet|x-ray&t=2026-10-19T12:00:00Z&yaw=0&pitch=0
 *   dist in solar radii from the Sun's centre; yaw/pitch (deg) turn the camera off the Sun's centre (close-ups of the limb).
 */
import * as THREE from 'three';
import * as Astronomy from 'astronomy-engine';
import { bootSandbox } from './harness';
import { createSolarDomain } from '../src/domains/solar';
import { createRegistry } from '../src/core/registry';

const params = new URLSearchParams(location.search);
const t = params.get('t');
const timeMs = t ? Date.parse(t) : Date.parse('2026-10-19T12:00:00Z');
let registryRef = createRegistry();
const solar = createSolarDomain({ registry: new Proxy({} as typeof registryRef, { get: (_o, k) => (registryRef as never)[k] }), nowMs: () => app.store.getState().time.simTimeMs });
const app = bootSandbox({
  layers: solar.layers,
  entities: solar.entities,
  focusId: 'sol:sun',
  timeMs,
  overlays: { orbits: params.get('orbits') === '1', labels: params.get('labels') === '1' },
});
registryRef = app.registry as typeof registryRef;
if (params.get('paused') !== '0') app.store.setState({ time: { ...app.store.getState().time, paused: true } });
const band = params.get('band');
if (band) app.store.setState({ spectral: { band: band as never } });

void app.ready.then(async () => {
  const sun = app.registry.get('sol:sun')!;
  const R = sun.radiusM ?? 6.957e8;
  const tNow = app.store.getState().time.simTimeMs;
  const e = Astronomy.HelioVector(Astronomy.Body.Earth, new Date(tNow));
  let dir = new THREE.Vector3(e.x, e.y, e.z).normalize();
  const from = params.get('from') ?? 'earth';
  const up = new THREE.Vector3(0, 0, 1);
  if (from === 'side') dir = dir.clone().applyAxisAngle(up, Math.PI / 2);
  if (from === 'pole') dir = new THREE.Vector3(0.1, 0.2, 1).normalize();
  const dist = Number(params.get('dist') ?? '3.2') * R;
  const offset = dir.clone().multiplyScalar(dist);
  const look = offset.clone().negate().normalize();
  const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), look, up);
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  const yaw = (Number(params.get('yaw') ?? '0') * Math.PI) / 180;
  const pitch = (Number(params.get('pitch') ?? '0') * Math.PI) / 180;
  q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ')));
  await app.engine.services.cameraController.setView(
    { anchorId: 'sol:sun', offset: [offset.x, offset.y, offset.z], quaternion: [q.x, q.y, q.z, q.w], mode: 'orbit', focusId: 'sol:sun', scaleLog10: Math.log10(dist) },
    { instant: true },
  );
});
(window as unknown as { __solar: unknown }).__solar = solar;
