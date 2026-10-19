/**
 * Cinematic post sandbox: real Sun (solar sun layer) + real Earth/Moon (earth domain) + placeholder stars.
 * ?view=earth|sun|eclipse|close|far|stars &post=off (bloom/glare/metering off for A/B) &hud=0
 * window.__cine(view) re-frames at runtime.
 */
import * as THREE from 'three';
import { bootSandbox } from './harness';
import { domain as earthDomain } from '../src/domains/earth/domain';
import { createPlaceholderStarfieldLayer } from '../src/domains/_placeholder';
import { createSolarEntities } from '../src/domains/solar/entities';
import { createSunLayer } from '../src/domains/solar/sunLayer';
import { evaluate, earthNorthPole } from '../src/domains/earth/ephemeris';
import { R_EARTH_M } from '../src/domains/earth/entities';
import type { CameraViewState } from '../src/core/types';

const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'earth';
const timeMs = params.get('t') ? Date.parse(params.get('t') as string) : Date.UTC(2026, 9, 18, 12);

const store0 = { getState: () => ({ time: { simTimeMs: timeMs } }) };
const reg0 = { get: () => undefined } as never;
const mod = earthDomain.create({ store: store0 as never, registry: reg0, manifest: () => null });
const solar = createSolarEntities({ registry: reg0, nowMs: () => timeMs });
const sun = solar.find(e => e.id === 'sol:sun');
if (!sun) throw new Error('no sun entity');

const app = bootSandbox({
  layers: [createPlaceholderStarfieldLayer(), createSunLayer(sun), ...mod.layers],
  entities: [sun, ...(mod.entities ?? [])],
  focusId: 'sol:earth',
  timeMs,
  hud: params.get('hud') !== '0',
});

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const eye = new THREE.Vector3();

function viewFrom(anchorId: string, anchor: THREE.Vector3, camWorld: THREE.Vector3, look: THREE.Vector3, upDir: THREE.Vector3): CameraViewState {
  m4.lookAt(camWorld, look, upDir);
  q.setFromRotationMatrix(m4);
  const off = camWorld.clone().sub(anchor);
  return { anchorId, offset: [off.x, off.y, off.z], quaternion: [q.x, q.y, q.z, q.w], mode: 'orbit', focusId: anchorId, scaleLog10: Math.log10(off.length()) };
}

function frame(name: string): CameraViewState {
  const t = app.engine.time.nowMs;
  const s = evaluate(t);
  const pole = earthNorthPole(t, new THREE.Vector3());
  const toSun = s.sun.clone().sub(s.earth).normalize();
  const side = new THREE.Vector3().crossVectors(pole, toSun).normalize();
  switch (name) {
    case 'sun': {
      // From 6 Earth radii on the day side, looking at the Sun with the Earth out of frame.
      eye.copy(s.earth).addScaledVector(side, R_EARTH_M * 6).addScaledVector(toSun, R_EARTH_M * 2);
      return viewFrom('sol:earth', s.earth, eye, s.sun, pole);
    }
    case 'eclipse': {
      // Night side; the Sun's centre sits on the Earth's limb (about half the disc occluded). ?beta= scales it.
      const dist = R_EARTH_M * 3.2;
      const beta = Math.asin(R_EARTH_M / dist) * Number(params.get('beta') ?? '1');
      const dir = toSun.clone().multiplyScalar(-Math.cos(beta)).addScaledVector(side, Math.sin(beta)).normalize();
      eye.copy(s.earth).addScaledVector(dir, dist);
      const look = s.sun.clone().sub(eye).normalize().lerp(s.earth.clone().sub(eye).normalize(), 0.5);
      return viewFrom('sol:earth', s.earth, eye, eye.clone().addScaledVector(look, 1e9), pole);
    }
    case 'close': {
      eye.copy(s.sun).addScaledVector(side, 6.957e8 * 8);
      return viewFrom('sol:sun', s.sun, eye, s.sun.clone().addScaledVector(side, 6.957e8 * 3), pole);
    }
    case 'far': {
      // From 30 AU (Neptune distance) looking back at the Sun.
      eye.copy(s.sun).addScaledVector(side, 30 * 1.496e11);
      return viewFrom('sol:sun', s.sun, eye, s.sun, pole);
    }
    case 'stars': {
      eye.copy(s.earth).addScaledVector(toSun, -R_EARTH_M * 40);
      return viewFrom('sol:earth', s.earth, eye, eye.clone().addScaledVector(pole, 1), toSun);
    }
    default: {
      const ph = THREE.MathUtils.degToRad(60);
      const dir = toSun.clone().multiplyScalar(Math.cos(ph)).addScaledVector(side, -Math.sin(ph)).normalize();
      eye.copy(s.earth).addScaledVector(dir, R_EARTH_M * 4);
      return viewFrom('sol:earth', s.earth, eye, s.earth, pole);
    }
  }
}

(window as unknown as { __cine: (n: string) => Promise<void> }).__cine = async (n: string) => {
  await app.engine.rig.setView(frame(n), { instant: true });
};

void app.ready.then(async () => {
  app.engine.time.pause();
  app.engine.time.jumpTo(timeMs);
  if (params.get('post') === 'off') {
    app.engine.post.cinematic.configure({ bloom: false, glare: false, metering: false });
  }
  await app.engine.rig.setView(frame(view), { instant: true });
});
