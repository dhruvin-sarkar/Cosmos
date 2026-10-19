/**
 * Earth domain sandbox: the real earth domain through the engine without the React UI.
 * Query params: ?view=disc|limb|night|moon|crescent|eclipse|far&t=ISO&hud=0
 *   disc     — full disc from 4 Earth radii at a 60° phase angle (terminator visible)
 *   limb     — 400 km altitude over the Pacific at the terminator, looking along the limb toward the Sun
 *   night    — night side over Europe / India
 *   moon     — gibbous Moon; crescent — thin crescent with Earthshine; eclipse — next total lunar eclipse
 *   far      — Earth and Moon from 1.5 million km
 * window.__earthView(name) re-frames at runtime.
 */
import * as Astronomy from 'astronomy-engine';
import * as THREE from 'three';
import { bootSandbox } from './harness';
import { domain } from '../src/domains/earth/domain';
import { createPlaceholderStarfieldLayer } from '../src/domains/_placeholder';
import { evaluate, earthNorthPole } from '../src/domains/earth/ephemeris';
import { R_EARTH_M, R_MOON_M } from '../src/domains/earth/entities';
import { ecefToIcrs, geodeticToEcef } from '../src/core/frames';
import type { CameraViewState } from '../src/core/types';

const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'disc';
const tParam = params.get('t');

function eclipseTime(): number {
  const e = Astronomy.SearchLunarEclipse(new Date(Date.UTC(2026, 0, 1)));
  let ecl = e;
  for (let i = 0; i < 6 && ecl.kind !== Astronomy.EclipseKind.Total; i++) ecl = Astronomy.NextLunarEclipse(ecl.peak);
  return ecl.peak.date.getTime();
}

function phaseTime(targetDeg: number): number {
  // Moon phase angle in ecliptic longitude: 0 new, 90 first quarter, 180 full.
  return Astronomy.SearchMoonPhase(targetDeg, new Date(Date.UTC(2026, 9, 18)), 40)!.date.getTime();
}

// DSCOVR EPIC reference (public/textures/earth/epic/epic.json, image 1): same date and viewing direction.
const EPIC = { dateUtc: '2026-10-16T11:10:38Z', dscovrJ2000Km: [-1495648.904167, -398640.437288, 18191.824544] };

const SOLAR_ECLIPSE = Astronomy.SearchGlobalSolarEclipse(new Date(Date.UTC(2026, 6, 1)));

const defaultTimes: Record<string, () => number> = {
  epic: () => Date.parse(EPIC.dateUtc),
  disc: () => Date.UTC(2026, 9, 18, 12, 0, 0),
  limb: () => Date.UTC(2026, 9, 18, 4, 0, 0),
  sunset: () => Date.UTC(2026, 9, 18, 4, 0, 0),
  night: () => Date.UTC(2026, 9, 18, 21, 30, 0),
  moon: () => phaseTime(135),
  crescent: () => phaseTime(40),
  eclipse: eclipseTime,
  // Total solar eclipse of 2026-08-12 (Greenland / Iceland / Spain): the Moon's shadow on the Earth.
  shadow: () => SOLAR_ECLIPSE.peak.date.getTime(),
  far: () => Date.UTC(2026, 9, 18, 12, 0, 0),
};
const timeMs = tParam ? Date.parse(tParam) : (defaultTimes[view] ?? defaultTimes.disc)();

const store0 = { getState: () => ({ time: { simTimeMs: timeMs } }) };
const mod = domain.create({ store: store0 as never, registry: { get: () => undefined } as never, manifest: () => null });
const app = bootSandbox({
  layers: [createPlaceholderStarfieldLayer(), ...mod.layers],
  entities: mod.entities,
  focusId: view === 'moon' || view === 'crescent' || view === 'eclipse' ? 'sol:moon' : 'sol:earth',
  timeMs,
  hud: params.get('hud') !== '0',
});

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const eye = new THREE.Vector3();
const target = new THREE.Vector3();
const up = new THREE.Vector3();

function viewFrom(anchorId: string, anchor: THREE.Vector3, camWorld: THREE.Vector3, look: THREE.Vector3, upDir: THREE.Vector3): CameraViewState {
  m4.lookAt(camWorld, look, upDir);
  q.setFromRotationMatrix(m4);
  const off = camWorld.clone().sub(anchor);
  return { anchorId, offset: [off.x, off.y, off.z], quaternion: [q.x, q.y, q.z, q.w], mode: 'orbit', focusId: anchorId, scaleLog10: Math.log10(off.length()) };
}

/** Camera at `dist` from the body centre, Sun–body–camera phase angle `phaseDeg`, roughly in the plane containing the pole. */
function phaseView(id: string, body: THREE.Vector3, sun: THREE.Vector3, pole: THREE.Vector3, dist: number, phaseDeg: number): CameraViewState {
  const s = sun.clone().sub(body).normalize();
  const side = new THREE.Vector3().crossVectors(pole, s).normalize();
  const ph = THREE.MathUtils.degToRad(phaseDeg);
  const dir = s.clone().multiplyScalar(Math.cos(ph)).addScaledVector(side, -Math.sin(ph)).normalize();
  eye.copy(body).addScaledVector(dir, dist);
  return viewFrom(id, body, eye, body, pole);
}

function frame(name: string): CameraViewState {
  const t = app.engine.time.nowMs;
  const s = evaluate(t);
  const pole = earthNorthPole(t, new THREE.Vector3());
  switch (name) {
    case 'limb': {
      // 400 km above a terminator point over the Pacific, looking toward the sunward horizon.
      const sunDir = s.sun.clone().sub(s.earth).normalize();
      const p = new THREE.Vector3();
      let best = { lon: -150, lat: 0, err: 9 };
      for (let lat = -40; lat <= 40; lat += 2)
        for (let lon = -180; lon <= -120; lon += 2) {
          const n = ecefToIcrs(t, geodeticToEcef(lat, lon, 0, new THREE.Vector3()), new THREE.Vector3()).normalize();
          const err = Math.abs(n.dot(sunDir) - 0.03);
          if (err < best.err) best = { lon, lat, err };
        }
      ecefToIcrs(t, geodeticToEcef(best.lat, best.lon, 400_000, p), p);
      eye.copy(s.earth).add(p);
      const nrm = p.clone().normalize();
      // Look along the terminator (Sun on the left), tilted down to the horizon.
      const toSun = sunDir.clone().addScaledVector(nrm, -sunDir.dot(nrm)).normalize();
      const fwd = new THREE.Vector3().crossVectors(nrm, toSun).normalize().addScaledVector(toSun, -0.25).normalize();
      target.copy(eye).addScaledVector(fwd, 2e6).addScaledVector(nrm, -0.36e6);
      return viewFrom('sol:earth', s.earth, eye, target, nrm);
    }
    case 'sunset': {
      // ISS-style orbital sunset: 400 km over the Pacific, ground below already dark, looking at the Sun ~4° above the
      // apparent horizon (horizon dip at 400 km ≈ 19.8°).
      const sunDir = s.sun.clone().sub(s.earth).normalize();
      const p = new THREE.Vector3();
      let best = { lon: -150, lat: 0, err: 9 };
      const target0 = Math.sin(THREE.MathUtils.degToRad(-16));
      for (let lat = -40; lat <= 40; lat += 1)
        for (let lon = -180; lon <= -120; lon += 1) {
          const n = ecefToIcrs(t, geodeticToEcef(lat, lon, 0, new THREE.Vector3()), new THREE.Vector3()).normalize();
          const err = Math.abs(n.dot(sunDir) - target0);
          if (err < best.err) best = { lon, lat, err };
        }
      ecefToIcrs(t, geodeticToEcef(best.lat, best.lon, 400_000, p), p);
      eye.copy(s.earth).add(p);
      const nrm = p.clone().normalize();
      // Aim slightly below the Sun so the limb sits in the lower third, Sun near the top of the glow.
      const fwd = sunDir.clone().addScaledVector(nrm, -0.12).normalize();
      target.copy(eye).addScaledVector(fwd, 2e6);
      return viewFrom('sol:earth', s.earth, eye, target, nrm);
    }
    case 'night': {
      const p = ecefToIcrs(t, geodeticToEcef(38, 40, 9_000_000, new THREE.Vector3()), new THREE.Vector3());
      eye.copy(s.earth).add(p);
      return viewFrom('sol:earth', s.earth, eye, s.earth, pole);
    }
    case 'moon':
    case 'crescent':
    case 'eclipse': {
      // From the Earth's side (as seen from Earth), 4.2 lunar radii out.
      const toEarth = s.earth.clone().sub(s.moon).normalize();
      eye.copy(s.moon).addScaledVector(toEarth, R_MOON_M * 4.2);
      return viewFrom('sol:moon', s.moon, eye, s.moon, pole);
    }
    case 'epic': {
      // Toward DSCOVR (J2000 ≈ ICRS), closer than L1 so the disc fills the frame (perspective differs slightly).
      const d = new THREE.Vector3(...(EPIC.dscovrJ2000Km as [number, number, number])).normalize();
      eye.copy(s.earth).addScaledVector(d, R_EARTH_M * 5);
      return viewFrom('sol:earth', s.earth, eye, s.earth, pole);
    }
    case 'shadow': {
      // Above the point of greatest eclipse, so the umbra/penumbra sits mid-disc.
      const lat = SOLAR_ECLIPSE.latitude ?? 60;
      const lon = SOLAR_ECLIPSE.longitude ?? -25;
      const d = ecefToIcrs(t, geodeticToEcef(lat, lon, 0, new THREE.Vector3()), new THREE.Vector3()).normalize();
      eye.copy(s.earth).addScaledVector(d, R_EARTH_M * 3.2);
      return viewFrom('sol:earth', s.earth, eye, s.earth, pole);
    }
    case 'far': {
      const sun = s.sun.clone().sub(s.earth).normalize();
      const side = new THREE.Vector3().crossVectors(pole, sun).normalize();
      eye.copy(s.earth).addScaledVector(sun, -0.6e9).addScaledVector(side, 1.2e9).addScaledVector(pole, 0.3e9);
      return viewFrom('sol:earth', s.earth, eye, s.earth, pole);
    }
    default:
      return phaseView('sol:earth', s.earth, s.sun, pole, R_EARTH_M * 4, 60);
  }
}

(window as unknown as { __earthView: (n: string) => Promise<void> }).__earthView = async (n: string) => {
  await app.engine.rig.setView(frame(n), { instant: true });
};

void app.ready.then(async () => {
  // Sandbox only: the placeholder starfield draws without a depth test (transparent pass, after opaque bodies), so it
  // would show through the Earth's night side. The real starfield (PointStarMaterial) depth-tests.
  app.engine.services.scene.traverse(o => {
    const m = (o as THREE.Points).material as THREE.Material | undefined;
    if (o.name === 'placeholder-starfield' && m) m.depthTest = true;
    if (o.name === 'sol:earth:atmosphere' && params.get('atm') === '0') o.layers.disable(0);
  });
  app.engine.time.pause();
  app.engine.time.jumpTo(timeMs);
  await app.engine.rig.setView(frame(view), { instant: true });
  up.set(0, 0, 1);
});
