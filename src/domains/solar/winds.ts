/**
 * Zonal winds of the giant planets and Venus' cloud super-rotation, as texture motion for the planet shader.
 *
 * Profiles are zonal wind speed u (m/s, prograde = in the direction of the planet's rotation, relative to the IAU
 * rotation system: System III for the giants) against planetographic latitude, smoothed from:
 *  - Jupiter: Cassini ISS 2000 (Porco et al. 2003, Science 299, 1541) and HST OPAL 2015–16 (Tollefson et al. 2017,
 *    Icarus 296, 163): strongest jet 23.7° N ≈ 165 m/s, equatorial ≈ 100 m/s, SEB westward jet ≈ −60 m/s.
 *  - Saturn: Voyager/Cassini (Sánchez-Lavega et al. 2000, Icarus 147, 405; García-Melendo et al. 2011, Icarus 215, 62):
 *    broad equatorial super-rotation ≈ 440 m/s, alternating high-latitude jets, hexagon jet ≈ 100 m/s at 78° N.
 *  - Uranus: Sromovsky et al. 2015 (Icarus 258, 192) symmetric fit: retrograde equator ≈ −80 m/s, prograde ≈ 250 m/s at 60°.
 *  - Neptune: Sromovsky et al. 1993 (Icarus 105, 140) polynomial u = −398 + 0.188 φ² − 1.2e−5 φ⁴ (φ in degrees).
 *  - Venus: cloud tops (≈ 70 km) super-rotate retrograde in ≈ 4 Earth days, near solid-body below 50° (Sánchez-Lavega
 *    et al. 2008, GRL 35, L13204; Venus Express VMC/VIRTIS) — rendered as a rigid rotation of the cloud map.
 *
 * Texture motion: a wind that keeps advecting a static map shears it into streaks, so each body uses two copies of
 * the map advected over a bounded "wind clock" cycle and cross-faded (flow-map technique, Vlachos 2010). The clock
 * follows simulation time exactly up to a per-body time-lapse cap (beyond it the cycle would flicker); the shear
 * budget per cycle keeps the largest displacement modest. Cloud motion is a qualitative visual of real wind speeds
 * over an illustrative map, not a forecast of where features are.
 */
import * as THREE from 'three';

export type WindProfileId = 'jupiter' | 'saturn' | 'uranus' | 'neptune';

/** [planetographic latitude °, zonal speed m/s prograde]. */
const JUPITER: [number, number][] = [
  [-90, 0], [-70, 0], [-65, 15], [-61, -5], [-57, 25], [-53, -5], [-49, 30], [-45, -5], [-41, 35], [-37, -10],
  [-33, 40], [-29, -20], [-26, 50], [-23, -5], [-19.5, -60], [-15, 5], [-11, 60], [-7, 135], [-3, 95], [0, 90],
  [3, 100], [7, 120], [11, 30], [14, -10], [17, -30], [20.5, 5], [23.7, 165], [26.5, 10], [28.5, -25], [31, 25],
  [33.5, -10], [35.5, 35], [39, -15], [43, 25], [46.5, -10], [49, 25], [53, -10], [56.5, 30], [60, -5], [65, 15],
  [70, 0], [90, 0],
];

const SATURN: [number, number][] = [
  [-90, 0], [-86, 60], [-80, 0], [-74, 70], [-67, -10], [-61, 70], [-55, -5], [-47, 80], [-41, -20], [-36, 15],
  [-30, 110], [-25, 250], [-18, 360], [-10, 420], [0, 440], [10, 420], [18, 360], [25, 250], [30, 110], [36, 10],
  [41, -25], [47, 100], [53, 0], [57, -10], [61, 120], [66, 0], [70, -10], [74, 90], [78, 100], [83, 0], [87, 140],
  [90, 0],
];

const URANUS: [number, number][] = [
  [-90, 0], [-75, 160], [-60, 240], [-50, 210], [-40, 150], [-30, 80], [-20, 10], [-10, -60], [0, -80], [10, -60],
  [20, 10], [30, 80], [40, 150], [50, 220], [60, 250], [75, 160], [90, 0],
];

function neptuneSpeed(latDeg: number): number {
  const p2 = latDeg * latDeg;
  const u = -398 + 0.188 * p2 - 1.2e-5 * p2 * p2;
  // The fit is valid to ~ ±80°; taper to zero at the pole.
  return u * Math.min(1, (90 - Math.abs(latDeg)) / 12);
}

/** Zonal wind (m/s, prograde) at a planetographic latitude. Exported for tests. */
export function zonalWind(id: WindProfileId, latDeg: number): number {
  if (id === 'neptune') return neptuneSpeed(latDeg);
  const t = id === 'jupiter' ? JUPITER : id === 'saturn' ? SATURN : URANUS;
  const x = Math.max(-90, Math.min(90, latDeg));
  for (let i = 1; i < t.length; i++) {
    if (x <= t[i][0]) {
      const [x0, y0] = t[i - 1];
      const [x1, y1] = t[i];
      const f = (x - x0) / (x1 - x0);
      // Cosine interpolation: jets are rounded, not kinked.
      const s = (1 - Math.cos(Math.PI * f)) / 2;
      return y0 + (y1 - y0) * s;
    }
  }
  return 0;
}

/**
 * Angular drift rate (° per day of simulation time, in the body-fixed frame, east-positive in map longitude) at a
 * planetocentric latitude, for an ellipsoid with equatorial radius a and polar radius c. `rotationSign` is the sign
 * of the IAU W-dot (prograde winds move features toward increasing W).
 */
export function driftDegPerDay(id: WindProfileId, latcRad: number, aM: number, cM: number, rotationSign: number): number {
  // Planetocentric → planetographic latitude: tan φg = (a/c)² tan φc.
  const k = (aM / cM) ** 2;
  const latg = Math.atan(k * Math.tan(latcRad));
  const u = zonalWind(id, (latg * 180) / Math.PI);
  // Distance from the spin axis at that latitude on the ellipse.
  const cosC = Math.cos(latcRad);
  const sinC = Math.sin(latcRad);
  const r = (aM * cM) / Math.sqrt((cM * cosC) ** 2 + (aM * sinC) ** 2);
  const rho = Math.max(r * cosC, aM * 1e-3);
  return rotationSign * (u / rho) * (180 / Math.PI) * 86_400;
}

export const WIND_TEX_SIZE = 512;

/** Drift-rate lookup over planetocentric latitude (texel i ↔ latitude −90° + 180° (i + 0.5)/N), half-float °/day. */
export function createWindTexture(id: WindProfileId, aM: number, cM: number, rotationSign: number): { tex: THREE.DataTexture; maxDegPerDay: number } {
  const data = new Uint16Array(WIND_TEX_SIZE);
  let maxRate = 0;
  for (let i = 0; i < WIND_TEX_SIZE; i++) {
    const lat = (-90 + (180 * (i + 0.5)) / WIND_TEX_SIZE) * (Math.PI / 180);
    const rate = driftDegPerDay(id, lat, aM, cM, rotationSign);
    // Polar texels: drift of a few km/s-scale angular rates is meaningless on a 1-texel ring; taper.
    const taper = Math.min(1, (90 - Math.abs((lat * 180) / Math.PI)) / 4);
    const v = rate * taper;
    maxRate = Math.max(maxRate, Math.abs(v));
    data[i] = THREE.DataUtils.toHalfFloat(v);
  }
  const tex = new THREE.DataTexture(data, WIND_TEX_SIZE, 1, THREE.RedFormat, THREE.HalfFloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return { tex, maxDegPerDay: maxRate };
}

/** Fraction of each cycle spent cross-fading into the next copy. */
const FADE = 0.22;

/**
 * Two-phase wind clock. `advance` integrates simulation time (capped per real second); `out` receives
 * (τA days, τB days, wA, wB): the advection times of the two map copies and their blend weights (wA + wB = 1).
 */
export class WindClock {
  private clockDays = 0;
  /** Cycle length (days of simulation time). */
  readonly periodDays: number;
  /** Largest simulation-days per real second the clouds follow (time-lapse cap). */
  readonly capDaysPerSec: number;

  /**
   * @param maxDegPerDay largest |drift rate| of the profile
   * @param shearBudgetDeg largest displacement of one copy over its visible lifetime
   * @param minCycleSec shortest real-time cycle (sets the time-lapse cap)
   */
  constructor(maxDegPerDay: number, shearBudgetDeg: number, minCycleSec = 3) {
    this.periodDays = shearBudgetDeg / ((0.5 + FADE) * Math.max(maxDegPerDay, 1e-6));
    this.capDaysPerSec = this.periodDays / minCycleSec;
  }

  advance(dtSimSec: number, dtRealSec: number): void {
    const cap = this.capDaysPerSec * Math.max(dtRealSec, 0);
    const d = Math.max(-cap, Math.min(cap, dtSimSec / 86_400));
    if (!Number.isFinite(d)) return;
    const P = this.periodDays;
    this.clockDays = (((this.clockDays + d) % P) + P) % P;
  }

  /** Advance by simulation days without the time-lapse cap (sandbox / tour scripting). */
  advanceDays(days: number): void {
    const P = this.periodDays;
    this.clockDays = (((this.clockDays + days) % P) + P) % P;
  }

  /** Effective time-lapse factor the clouds follow (≤ the simulation rate). */
  get capRate(): number {
    return this.capDaysPerSec * 86_400;
  }

  phases(out: THREE.Vector4): THREE.Vector4 {
    const P = this.periodDays;
    const fa = this.clockDays / P;
    const fb = (fa + 0.5) % 1;
    const w = (f: number): number => (f < 0.5 ? smooth01(f / FADE) : 1 - smooth01((f - 0.5) / FADE));
    const wa = w(fa);
    const wb = w(fb);
    const sum = Math.max(wa + wb, 1e-6);
    // Each copy's advection time is measured from the middle of its life so its average displacement is zero.
    return out.set((fa - 0.25 - FADE / 2) * P, (fb - 0.25 - FADE / 2) * P, wa / sum, wb / sum);
  }
}

function smooth01(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/** Venus: cloud-top rotation period (days, retrograde like the solid body). */
export const VENUS_CLOUD_PERIOD_DAYS = 4.0;
