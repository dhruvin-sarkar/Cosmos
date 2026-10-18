import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import {
  ARRIVAL_PHASE_ANGLE_DEG, TRAVEL_MAX_SEC, TRAVEL_MIN_SEC, chooseArrivalDirection, planZoomPan, sampleZoomPan,
  segmentHitsSphere, travelDecades, travelDurationSec, type ZoomPanSample,
} from './travel';
import { AU_M, DEG, KPC_M } from '../units';

const sample = (): ZoomPanSample => ({ widthM: 0, pan: 0, remaining: 0 });

describe('van Wijk zoom/pan path', () => {
  it('starts and ends exactly at the requested widths and focus points', () => {
    const path = planZoomPan(1e7, 3e6, AU_M);
    const s = sample();
    sampleZoomPan(path, 0, s);
    expect(s.widthM).toBeCloseTo(1e7, -1);
    expect(s.pan).toBe(0);
    expect(s.remaining).toBe(1);
    sampleZoomPan(path, path.length, s);
    expect(s.widthM / 3e6).toBeCloseTo(1, 9);
    expect(s.pan).toBe(1);
    expect(s.remaining).toBe(0);
  });

  it('zooms out to ≈ log10(separation) + 0.3 for a long pan', () => {
    const path = planZoomPan(1e7, 1e7, AU_M);
    expect(Math.log10(path.peakWidthM)).toBeGreaterThan(Math.log10(AU_M) + 0.15);
    expect(Math.log10(path.peakWidthM)).toBeLessThan(Math.log10(AU_M) + 0.45);
  });

  it('is monotonic in pan and keeps pan + remaining = 1', () => {
    const path = planZoomPan(30, 1e7, 8.2 * KPC_M);
    const s = sample();
    let prevPan = -1;
    for (let i = 0; i <= 400; i++) {
      sampleZoomPan(path, (path.length * i) / 400, s);
      expect(s.pan).toBeGreaterThanOrEqual(prevPan - 1e-15);
      expect(Math.abs(s.pan + s.remaining - 1)).toBeLessThan(1e-9);
      expect(Number.isFinite(s.widthM) && s.widthM > 0).toBe(true);
      prevPan = s.pan;
    }
  });

  it('resolves the remaining distance to metres at the end of a 10²¹ m pan', () => {
    const sep = 8.2 * KPC_M;
    const path = planZoomPan(1e21, 1e7, sep);
    const s = sample();
    // Near the end the remaining distance must shrink smoothly (no quantization at the 1e-16 level of `pan`).
    let prevDist = Infinity;
    for (let i = 0; i <= 200; i++) {
      const t = 0.98 + (0.02 * i) / 200;
      sampleZoomPan(path, path.length * t, s);
      const dist = sep * s.remaining;
      expect(dist).toBeLessThanOrEqual(prevDist);
      prevDist = dist;
    }
    sampleZoomPan(path, path.length * 0.999, s);
    const dist = sep * s.remaining;
    // Still to go, but well within a few view widths, and representable (not rounded to 0 or to 2e5 m steps).
    expect(dist).toBeGreaterThan(0);
    expect(dist).toBeLessThan(10 * s.widthM);
  });

  it('degenerates to a pure zoom for co-located points', () => {
    const path = planZoomPan(1e3, 1e9, 0);
    expect(path.pureZoom).toBe(true);
    const s = sample();
    sampleZoomPan(path, path.length / 2, s);
    expect(Math.log10(s.widthM)).toBeCloseTo(6, 9);
  });
});

describe('travel duration', () => {
  it('is 2 s + 0.35 s per decade, clamped to 1.5–9 s', () => {
    const short = planZoomPan(1e7, 1e7, 1e5);
    expect(travelDurationSec(short)).toBeGreaterThanOrEqual(TRAVEL_MIN_SEC);
    const mid = planZoomPan(1e7, 1e7, AU_M);
    expect(travelDurationSec(mid)).toBeCloseTo(2 + 0.35 * travelDecades(mid), 9);
    const huge = planZoomPan(10, 10, 1e25);
    expect(travelDurationSec(huge)).toBe(TRAVEL_MAX_SEC);
  });

  it('honours reduced motion and explicit overrides', () => {
    const p = planZoomPan(1e7, 1e7, AU_M);
    expect(travelDurationSec(p, { reducedMotion: true })).toBeLessThan(0.5);
    expect(travelDurationSec(p, { overrideSec: 4 })).toBe(4);
  });
});

describe('arrival direction', () => {
  it('frames lit bodies at the configured Sun–body–camera phase angle (50–70°)', () => {
    expect(ARRIVAL_PHASE_ANGLE_DEG).toBeGreaterThanOrEqual(50);
    expect(ARRIVAL_PHASE_ANGLE_DEG).toBeLessThanOrEqual(70);
    const target = new Vector3(AU_M, 0, 0);
    const light = new Vector3(0, 0, 0);
    const out = new Vector3();
    chooseArrivalDirection({ target, light, preferredDir: new Vector3(0, 1, 0), up: new Vector3(0, 0, 1) }, out);
    const toSun = light.clone().sub(target).normalize();
    expect(out.length()).toBeCloseTo(1, 12);
    expect(Math.acos(out.dot(toSun)) / DEG).toBeCloseTo(ARRIVAL_PHASE_ANGLE_DEG, 6);
    // Closest azimuth to the current side (+Y) is chosen.
    expect(out.y).toBeGreaterThan(0.5);
  });

  it('keeps the current side for unlit targets and respects lift', () => {
    const out = new Vector3();
    chooseArrivalDirection({
      target: new Vector3(), light: null, preferredDir: new Vector3(0, 0, -1), up: new Vector3(0, 0, 1),
      lift: { dir: new Vector3(1, 0, 0), minDot: 0.3 },
    }, out);
    expect(out.x).toBeCloseTo(0.3, 9);
    expect(out.length()).toBeCloseTo(1, 12);
  });

  it('detects approach lines through obstacles', () => {
    const o = new Vector3();
    expect(segmentHitsSphere(o, new Vector3(1, 0, 0), 10, new Vector3(5, 0.5, 0), 1)).toBe(true);
    expect(segmentHitsSphere(o, new Vector3(1, 0, 0), 10, new Vector3(5, 2, 0), 1)).toBe(false);
    expect(segmentHitsSphere(o, new Vector3(1, 0, 0), 3, new Vector3(5, 0, 0), 1)).toBe(false);
  });
});
