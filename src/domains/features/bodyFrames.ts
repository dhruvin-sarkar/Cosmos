/**
 * Body-fixed frames of every body that carries features, reusing EXACTLY the orientation the owning domain renders with
 * (so a label sits on the feature drawn in the texture):
 *   planets / dwarf planets  -> solar/ephemeris bodyOrientation (IAU WGCCRE 2015, NAIF pck00011)
 *   the Moon                 -> earth/ephemeris evaluate().moonRot
 *   other moons              -> moons/ephemeris moonRotation (IAU frame for mapped moons, synchronous otherwise)
 *   Vesta, Eros              -> smallbodies/famousShapes spinQuaternion (IAU WGCCRE 2015)
 * Frame convention (shared by all shaders): +Z north pole, +X prime meridian (longitude 0), +Y 90° E.
 */
import * as THREE from 'three';
import { SOLAR_BODY_BY_ID } from '../solar/constants';
import { bodyOrientation } from '../solar/ephemeris';
import { evaluate as evaluateEarthMoon, rotationToQuaternion } from '../earth/ephemeris';
import { MOON_RECORDS, type MoonRecord } from '../moons/data';
import { moonRotation } from '../moons/ephemeris';
import { SPIN_STATES, spinQuaternion } from '../smallbodies/famousShapes';

export interface BodyFrame {
  key: string;
  entityId: string;
  name: string;
  /** Mean radius, m (fallback when the entity is not registered). */
  radiusM: number;
  /** Body-fixed → ICRS rotation at `tMs`. Allocation-free. */
  orient(tMs: number, out: THREE.Quaternion): THREE.Quaternion;
}

const DISPLAY: Record<string, string> = {
  moon: 'the Moon', mercury: 'Mercury', venus: 'Venus', mars: 'Mars', jupiter: 'Jupiter', ceres: 'Ceres', pluto: 'Pluto',
  vesta: 'Vesta', eros: 'Eros',
};

const m4 = new THREE.Matrix4();
const rot = new Float64Array(9);

function fromRowMajor(r: Float64Array, out: THREE.Quaternion): THREE.Quaternion {
  m4.set(r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0, 0, 0, 0, 1);
  return out.setFromRotationMatrix(m4);
}

const SMALL_BODY_RADII_M: Record<string, number> = { vesta: 262_700, eros: 8_420 };

function buildFrame(key: string): BodyFrame | null {
  if (key === 'moon') {
    return {
      key, entityId: 'sol:moon', name: 'the Moon', radiusM: 1_737_400,
      orient: (t, out) => rotationToQuaternion(evaluateEarthMoon(t).moonRot, out),
    };
  }
  const solar = SOLAR_BODY_BY_ID.get(`sol:${key}`);
  if (solar && solar.kind !== 'star') {
    const r = solar.rotation;
    return { key, entityId: solar.id, name: DISPLAY[key] ?? solar.name, radiusM: solar.meanRadiusM, orient: (t, out) => bodyOrientation(r, t, out) };
  }
  const moon: MoonRecord | undefined = MOON_RECORDS.find((m) => m.id === key);
  if (moon) {
    const [a, b, c] = moon.radiiKm;
    return {
      key, entityId: `sol:${key}`, name: key[0].toUpperCase() + key.slice(1), radiusM: ((a + b + c) / 3) * 1000,
      orient: (t, out) => fromRowMajor(moonRotation(moon, t, rot), out),
    };
  }
  const spin = SPIN_STATES[key];
  if (spin) {
    return {
      key, entityId: `sb:${key}`, name: DISPLAY[key] ?? key, radiusM: SMALL_BODY_RADII_M[key] ?? 1000,
      orient: (t, out) => spinQuaternion(spin, t, out),
    };
  }
  return null;
}

const cache = new Map<string, BodyFrame | null>();

export function bodyFrame(key: string): BodyFrame | null {
  let f = cache.get(key);
  if (f === undefined) {
    f = buildFrame(key);
    cache.set(key, f);
  }
  return f;
}

/** Body-fixed unit vector of planetocentric (lat, east lon) in degrees. */
export function surfaceNormal(latDeg: number, lonDeg: number, out: THREE.Vector3): THREE.Vector3 {
  const la = (latDeg * Math.PI) / 180, lo = (lonDeg * Math.PI) / 180;
  const c = Math.cos(la);
  return out.set(c * Math.cos(lo), c * Math.sin(lo), Math.sin(la));
}

/** Drawn (map) longitude/latitude of Jupiter's Great Red Spot from the solar domain's rigid vortex. */
export function drawnGreatRedSpot(): { latDeg: number; lonDeg: number } | null {
  const v = SOLAR_BODY_BY_ID.get('sol:jupiter')?.winds?.vortex;
  return v ? { latDeg: v.latDeg, lonDeg: v.lonDeg } : null;
}
