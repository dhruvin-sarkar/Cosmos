/**
 * Geomagnetic activity for the illustrative aurora: the planetary Kp index at the simulation time, from the NASA
 * CCMC DONKI geomagnetic-storm list in public/data/solar/space-weather.json (scripts/data/solar/fetch-space-weather.mjs).
 *
 * DONKI lists storms only (Kp ≥ 5), each with its maximum Kp and its time. Inside a storm the Kp is ramped up to the
 * observed maximum and decays afterwards; outside storms the typical quiet level (Kp ≈ 2, the long-term median) is
 * used and labelled as such. Pure functions; no allocations per call.
 */

export interface GeomagneticStorm {
  startTimeUTC: string;
  maxKp: number | null;
  maxKpTimeUTC: string | null;
  nKpSamples?: number | null;
}

export interface SpaceWeatherJson {
  window?: { from?: string; to?: string };
  geomagneticStorms?: GeomagneticStorm[];
}

/** Long-term median planetary Kp (quiet conditions), used when no storm is listed. */
export const QUIET_KP = 2;
const H = 3_600_000;

export interface StormSpan {
  startMs: number;
  peakMs: number;
  endMs: number;
  maxKp: number;
}

export interface KpReading {
  kp: number;
  /** 'observed' inside a DONKI storm; 'typical' when the quiet baseline is used. */
  basis: 'observed' | 'typical';
  /** Maximum observed Kp of the storm in effect, or null. */
  stormMaxKp: number | null;
}

/** DONKI storm list → time spans (start, peak, end); Kp samples are 3-hourly. */
export function parseStorms(json: SpaceWeatherJson | null): StormSpan[] {
  const out: StormSpan[] = [];
  for (const s of json?.geomagneticStorms ?? []) {
    const startMs = Date.parse(s.startTimeUTC);
    const maxKp = s.maxKp;
    if (!Number.isFinite(startMs) || maxKp == null || !Number.isFinite(maxKp)) continue;
    const peak = s.maxKpTimeUTC ? Date.parse(s.maxKpTimeUTC) : NaN;
    const peakMs = Number.isFinite(peak) ? peak : startMs + 3 * H;
    const span = Math.max(1, s.nKpSamples ?? 2) * 3 * H;
    // Recovery: Kp falls back to quiet levels within roughly a day of the last storm-level sample.
    const endMs = Math.max(startMs + span, peakMs + 3 * H) + 12 * H;
    out.push({ startMs, peakMs, endMs, maxKp });
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

/** Kp at `timeMs`: the strongest storm in effect (ramped to its observed maximum), else the quiet baseline. */
export function kpAt(storms: readonly StormSpan[], timeMs: number, out: KpReading = { kp: QUIET_KP, basis: 'typical', stormMaxKp: null }): KpReading {
  let best = QUIET_KP;
  let stormMax: number | null = null;
  for (const s of storms) {
    if (s.startMs - 6 * H > timeMs) break;
    if (timeMs > s.endMs) continue;
    let k: number;
    if (timeMs <= s.peakMs) {
      // Rise from quiet over the 6 h before the storm onset up to the peak.
      const t0 = s.startMs - 6 * H;
      const f = Math.min(1, Math.max(0, (timeMs - t0) / Math.max(s.peakMs - t0, 1)));
      k = QUIET_KP + (s.maxKp - QUIET_KP) * f;
    } else {
      const f = Math.min(1, Math.max(0, (timeMs - s.peakMs) / Math.max(s.endMs - s.peakMs, 1)));
      k = s.maxKp + (QUIET_KP - s.maxKp) * f;
    }
    if (k > best) {
      best = k;
      stormMax = s.maxKp;
    }
  }
  out.kp = best;
  out.basis = stormMax != null ? 'observed' : 'typical';
  out.stormMaxKp = stormMax;
  return out;
}

/**
 * Geomagnetic (centred-dipole) north pole, IGRF-14 for epoch 2025.0 (NOAA NCEI / IAGA): 80.8° N, 72.6° W.
 * The southern pole is antipodal. Auroral ovals are centred on it (dipole approximation of AACGM coordinates).
 */
export const GEOMAGNETIC_NORTH_POLE = { latDeg: 80.8, lonDeg: -72.6 } as const;

/** Unit dipole axis (toward the geomagnetic north pole) in the Earth body-fixed frame (+x Greenwich, +z north). */
export function dipoleAxis(out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const lat = (GEOMAGNETIC_NORTH_POLE.latDeg * Math.PI) / 180;
  const lon = (GEOMAGNETIC_NORTH_POLE.lonDeg * Math.PI) / 180;
  out.x = Math.cos(lat) * Math.cos(lon);
  out.y = Math.cos(lat) * Math.sin(lon);
  out.z = Math.sin(lat);
  return out;
}

/**
 * Equatorward boundary of the auroral oval at magnetic midnight, magnetic latitude in degrees (Starkov 1994 fit,
 * linearised: ≈ 66° at Kp 0, ≈ 49° at Kp 9 — the May 2024 / Oct 2024 storms reached ~45–50° geomagnetic).
 */
export function ovalEquatorwardMlatDeg(kp: number): number {
  return 66 - 1.9 * Math.min(9, Math.max(0, kp));
}
