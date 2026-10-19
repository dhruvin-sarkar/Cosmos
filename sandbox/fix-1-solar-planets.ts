/**
 * fix-1-solar-planets sandbox (copy of solar-clouds): rings, Uranus, Pluto, Sun through the real engine.
 * Query: ?focus=sol:jupiter&t=2026-10-18T12:00:00Z&quality=ultra&phase=60&dist=3&rate=100000
 *   phase/dist/elev: camera at that Sun–body–camera phase angle (deg), distance (body radii), elevation (deg).
 *   look=lon,lat: pick the time (within one rotation) when that body-fixed point is in the afternoon and look at it
 *   from `dist` radii at ~`phase` phase angle. rate>0: run time at that rate.
 */
import * as THREE from 'three';
import { bootSandbox } from './harness';
import { createSolarDomain } from '../src/domains/solar';
import { createPlaceholderEntities, createPlaceholderBodiesLayer } from '../src/domains/_placeholder';
import { createRegistry } from '../src/core/registry';
import { createSkyDomain } from '../src/domains/sky';
import { SOLAR_BODY_BY_ID } from '../src/domains/solar/constants';
import { bodyOrientation, bodyPosition, sunPosition } from '../src/domains/solar/ephemeris';

const params = new URLSearchParams(location.search);
const focus = params.get('focus') ?? 'sol:jupiter';
const t = params.get('t');
let timeMs = t ? Date.parse(t) : Date.parse('2026-10-18T12:00:00Z');
const D2R = Math.PI / 180;

// look=lon,lat → time when the point sits ~35° from the sub-solar point on the day side, afternoon.
let lookDir: THREE.Vector3 | null = null;
const look = params.get('look');
const def = SOLAR_BODY_BY_ID.get(focus);
if (look && def) {
  const [lon, lat] = look.split(',').map((x) => Number(x) * D2R);
  const local = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat));
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const sp = new THREE.Vector3();
  const d = new THREE.Vector3();
  const periodMs = Math.abs(360 / def.rotation.wDot) * 86_400_000;
  let best = Infinity;
  for (let i = 0; i < 720; i++) {
    const tt = timeMs + (periodMs * i) / 720;
    bodyPosition(def, tt, p);
    sunPosition(tt, sp);
    const s = sp.sub(p).normalize();
    d.copy(local).applyQuaternion(bodyOrientation(def.rotation, tt, q));
    const ang = Math.acos(THREE.MathUtils.clamp(d.dot(s), -1, 1));
    const cost = Math.abs(ang - 35 * D2R);
    if (cost < best) {
      best = cost;
      timeMs = tt;
      lookDir = d.clone();
    }
  }
}

let registryRef = createRegistry();
const solar = createSolarDomain({ registry: new Proxy({} as typeof registryRef, { get: (_o, k) => (registryRef as never)[k] }), nowMs: () => app.store.getState().time.simTimeMs });
const ph = createPlaceholderEntities().filter((e) => e.id !== 'sol:sun' && params.get('ph') === '1');
const app = bootSandbox({
  layers: [...(params.get('sky') !== '0' ? createSkyDomain().layers : []), ...solar.layers, createPlaceholderBodiesLayer(ph)],
  entities: [...solar.entities, ...ph],
  focusId: focus,
  timeMs,
  overlays: { orbits: params.get('orbits') !== '0', labels: params.get('labels') !== '0', 'enlarge-bodies': params.get('enlarge') === '1' },
});
registryRef = app.registry as typeof registryRef;
const quality = params.get('quality');
if (quality) app.store.setState({ quality: { ...app.store.getState().quality, preset: quality as never } });
if (params.get('scalemode') === 'true') app.store.setState({ visualScale: 'true' } as never);
const rate = Number(params.get('rate') ?? '0');
if (rate > 0) app.store.setState({ time: { ...app.store.getState().time, rate, paused: false } });
else if (params.get('paused') !== '0') app.store.setState({ time: { ...app.store.getState().time, paused: true } });

void app.ready.then(async () => {
  const scale = Number(params.get('scale'));
  if (params.has('scale') && Number.isFinite(scale)) app.commands.setScale(scale, { animate: false });
  if (params.has('phase') || lookDir) {
    const e = app.registry.get(focus)!;
    const sunE = app.registry.get('sol:sun')!;
    const tNow = app.store.getState().time.simTimeMs;
    const p = e.position(tNow, new THREE.Vector3());
    const s = sunE.position(tNow, new THREE.Vector3()).sub(p).normalize();
    if (!(s.lengthSq() > 0.5)) s.set(0.3, -0.8, 0.5).normalize();
    let dir: THREE.Vector3;
    if (lookDir) {
      // From above the point, tilted away from the Sun a little (phase ≈ 35° + tilt).
      const away = lookDir.clone().sub(s.clone().multiplyScalar(0.35)).normalize();
      dir = away;
    } else {
      const phase = (Number(params.get('phase')) * Math.PI) / 180;
      const elev = (Number(params.get('elev') ?? '20') * Math.PI) / 180;
      const up = new THREE.Vector3(0, 0, 1);
      const axis = new THREE.Vector3().crossVectors(s, up).normalize().applyAxisAngle(s, elev);
      dir = s.clone().applyAxisAngle(axis, phase);
    }
    if (def) {
      const pole0 = new THREE.Vector3(0, 0, 1).applyQuaternion(bodyOrientation(def.rotation, tNow, new THREE.Quaternion()));
      console.warn('[fix1] sun latitude in body frame (deg)', (Math.asin(s.dot(pole0)) / D2R).toFixed(2));
    }
    if (params.has('blat') && def) {
      // Camera latitude in the body's equatorial frame (deg): negative = below the ring plane when the pole points north.
      const pole = new THREE.Vector3(0, 0, 1).applyQuaternion(bodyOrientation(def.rotation, tNow, new THREE.Quaternion()));
      const bl = Number(params.get('blat')) * D2R;
      const h = dir.clone().sub(pole.clone().multiplyScalar(dir.dot(pole))).normalize();
      dir = h.multiplyScalar(Math.cos(bl)).add(pole.multiplyScalar(Math.sin(bl)));
    }
    const dist = Number(params.get('dist') ?? '3') * (e.radiusM ?? 1);
    const offset = dir.multiplyScalar(dist);
    const lookV = offset.clone().negate().normalize();
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), lookV, new THREE.Vector3(0, 0, 1));
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    await app.engine.services.cameraController.setView(
      { anchorId: focus, offset: [offset.x, offset.y, offset.z], quaternion: [q.x, q.y, q.z, q.w], mode: 'orbit', focusId: focus, scaleLog10: Math.log10(dist) },
      { instant: true },
    );
  }
  if (params.get('inspect') === '1') app.commands.select(focus);
});
(window as unknown as { __solar: unknown }).__solar = solar;
(window as unknown as { __app: unknown }).__app = app;
