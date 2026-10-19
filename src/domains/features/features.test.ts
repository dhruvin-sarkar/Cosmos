import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FEATURE_RECORDS, systemIILongitude } from './data';
import { bodyFrame, surfaceNormal } from './bodyFrames';
import { importanceThreshold } from './featuresLayer';
import { evaluate } from '../earth/ephemeris';

const byId = new Map(FEATURE_RECORDS.map((r) => [r.id, r]));

describe('feature records', () => {
  it('has a curated set of unique, well-formed records', () => {
    expect(FEATURE_RECORDS.length).toBeGreaterThanOrEqual(150);
    expect(FEATURE_RECORDS.length).toBeLessThanOrEqual(320);
    expect(byId.size).toBe(FEATURE_RECORDS.length);
    for (const r of FEATURE_RECORDS) {
      expect(r.id).toBe(`feat:${r.body}:${r.id.split(':')[2]}`);
      expect(r.id).toMatch(/^feat:[a-z]+:[a-z0-9-]+$/);
      expect(Math.abs(r.latDeg)).toBeLessThanOrEqual(90);
      if (r.lonDeg !== null) expect(r.lonDeg > -180 && r.lonDeg <= 180).toBe(true);
      expect(r.diameterKm === null || r.diameterKm > 0).toBe(true); // null = unknown, never 0
      expect(r.importance).toBeGreaterThanOrEqual(0);
      expect(r.importance).toBeLessThanOrEqual(100);
    }
  });

  it('every body with features has a body-fixed frame', () => {
    for (const body of new Set(FEATURE_RECORDS.map((r) => r.body))) expect(bodyFrame(body), body).not.toBeNull();
  });

  it('covers the required landmarks and landing sites', () => {
    for (const id of [
      'feat:moon:apollo-11', 'feat:moon:apollo-17', 'feat:moon:tycho', 'feat:moon:copernicus', 'feat:moon:luna-9', 'feat:moon:chang-e-4-yutu-2',
      'feat:mars:olympus-mons', 'feat:mars:jezero', 'feat:mars:gale', 'feat:mars:perseverance', 'feat:mars:curiosity', 'feat:mars:zhurong',
      'feat:pluto:sputnik-planitia', 'feat:titan:huygens', 'feat:venus:venera-13', 'feat:eros:near-shoemaker', 'feat:jupiter:great-red-spot',
    ]) expect(byId.has(id), id).toBe(true);
  });

  // Reference coordinates: Apollo 11 LM (Wagner et al. 2017 / LROC: 0.67408° N, 23.47297° E);
  // Olympus Mons and Tycho centres from the IAU/USGS Gazetteer (planetocentric, east-positive).
  it('matches published coordinates', () => {
    const a11 = byId.get('feat:moon:apollo-11')!;
    expect(a11.latDeg).toBeCloseTo(0.674, 2);
    expect(a11.lonDeg!).toBeCloseTo(23.473, 2);
    const om = byId.get('feat:mars:olympus-mons')!;
    expect(om.latDeg).toBeCloseTo(18.65, 1);
    expect(om.lonDeg!).toBeCloseTo(-133.8, 1); // 226.2° E
    const ty = byId.get('feat:moon:tycho')!;
    expect(ty.latDeg).toBeCloseTo(-43.3, 1);
    expect(ty.lonDeg!).toBeCloseTo(-11.2, 1);
  });
});

describe('placement', () => {
  it('surface normal: +Z north, +X prime meridian, +Y 90° E', () => {
    const v = new THREE.Vector3();
    expect(surfaceNormal(90, 0, v).z).toBeCloseTo(1, 12);
    surfaceNormal(0, 0, v);
    expect(v.x).toBeCloseTo(1, 12);
    surfaceNormal(0, 90, v);
    expect(v.y).toBeCloseTo(1, 12);
  });

  // The Moon's mean sub-Earth point is (0°, 0°) by definition of the mean-Earth/polar-axis frame; libration keeps the
  // apparent sub-Earth point within ≈ 8° in longitude and ≈ 7° in latitude.
  it('the Moon frame puts the sub-Earth point near 0° N, 0° E', () => {
    const q = new THREE.Quaternion();
    const d = new THREE.Vector3();
    for (const iso of ['2000-01-01T12:00:00Z', '2024-06-15T00:00:00Z', '2026-10-18T00:00:00Z']) {
      const t = Date.parse(iso);
      const s = evaluate(t);
      d.subVectors(s.earth, s.moon).normalize();
      bodyFrame('moon')!.orient(t, q);
      d.applyQuaternion(q.invert());
      const lat = (Math.asin(d.z) * 180) / Math.PI;
      const lon = (Math.atan2(d.y, d.x) * 180) / Math.PI;
      expect(Math.abs(lat), iso).toBeLessThan(8);
      expect(Math.abs(lon), iso).toBeLessThan(9);
    }
  });

  it('frames are proper rotations', () => {
    const q = new THREE.Quaternion();
    for (const key of ['mars', 'titan', 'pluto', 'vesta']) {
      bodyFrame(key)!.orient(Date.parse('2026-10-18T00:00:00Z'), q);
      expect(q.length()).toBeCloseTo(1, 9);
    }
  });
});

describe('Great Red Spot drift', () => {
  it('advances linearly and wraps into [0, 360)', () => {
    const d = { systemIILonDeg: 350, epoch: '2025-01-01T00:00:00Z', driftDegPerMonth: 2 };
    expect(systemIILongitude(d, Date.parse(d.epoch))).toBeCloseTo(350, 9);
    const l = systemIILongitude(d, Date.parse(d.epoch) + 86_400_000 * 30.4375 * 6);
    expect(l).toBeCloseTo(2, 6);
  });
});

describe('declutter', () => {
  it('shows nothing on tiny discs and more features as the disc grows', () => {
    expect(importanceThreshold(20)).toBe(Infinity);
    expect(importanceThreshold(60)).toBeGreaterThan(importanceThreshold(300));
    expect(importanceThreshold(5000)).toBe(0);
  });
});
