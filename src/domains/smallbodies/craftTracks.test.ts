import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { HermiteTrack, type CraftTrackJson } from './craftTracks';
import { AU_M } from '../../core/units';

const DAY_S = 86400;

describe('HermiteTrack (non-uniform cubic Hermite with true velocities)', () => {
  // x(t) = t³ − 2 t² km (t in days), sampled at uneven times with exact velocities: Hermite is exact for cubics.
  const ts = [0, 0.5, 2, 2.25, 5, 9];
  const x = (t: number): number => t ** 3 - 2 * t ** 2;
  const vx = (t: number): number => (3 * t ** 2 - 4 * t) / DAY_S; // km/s
  const tr = new HermiteTrack(
    't', 'sun', Float64Array.from(ts.map((t) => 2460000 + t)),
    Float64Array.from(ts.flatMap((t) => [x(t), 0, 0])), Float64Array.from(ts.flatMap((t) => [vx(t), 0, 0])),
  );
  it('reproduces a cubic exactly between uneven samples', () => {
    const out = new Vector3();
    for (const t of [0.2, 1.3, 2.1, 3.7, 8.4]) expect(out.copy(tr.positionM(2460000 + t, out)).x / 1000).toBeCloseTo(x(t), 6);
  });
  it('velocity matches the analytic derivative', () => {
    const v = new Vector3();
    expect(tr.velocityMs(2460000 + 3.7, v).x).toBeCloseTo(vx(3.7) * 1000, 6);
  });
  it('holds the end point outside coverage (never extrapolates)', () => {
    const a = tr.positionM(tr.endJD, new Vector3());
    const b = tr.positionM(tr.endJD + 400, new Vector3());
    expect(b.distanceTo(a)).toBe(0);
    expect(tr.covers(tr.endJD + 1)).toBe(false);
  });
});

describe('craft-tracks.json (JPL Horizons)', () => {
  const j = JSON.parse(readFileSync('public/data/smallbodies/craft-tracks.json', 'utf8')) as { craft: CraftTrackJson[] };
  const track = (id: string): HermiteTrack => HermiteTrack.fromJson(j.craft.find((c) => c.id === id)!);
  const JD_2026_10_18 = 2461331.5;

  it('has monotonic sample times and matching array lengths', () => {
    for (const c of j.craft) {
      expect(c.p.length).toBe(3 * c.t.length);
      expect(c.v.length).toBe(3 * c.t.length);
      for (let i = 1; i < c.t.length; i++) expect(c.t[i]).toBeGreaterThan(c.t[i - 1]);
    }
  });
  it('puts Voyager 1 at ≈ 170 au from the Sun in Oct 2026 (JPL Voyager mission status: ~3.6 au/yr outward)', () => {
    const d = track('voyager-1').positionM(JD_2026_10_18, new Vector3()).length() / AU_M;
    expect(d).toBeGreaterThan(166);
    expect(d).toBeLessThan(175);
  });
  it('keeps JWST 1.2–1.8 million km from Earth on its L2 halo orbit', () => {
    const tr = track('jwst');
    for (let k = 0; k < 12; k++) {
      const d = tr.positionM(JD_2026_10_18 - 30 * k, new Vector3()).length();
      expect(d).toBeGreaterThan(1.0e9);
      expect(d).toBeLessThan(1.9e9);
    }
  });
  it('resolves Parker’s perihelion at ≈ 9.86 solar radii (6.9 million km; NASA/APL)', () => {
    const tr = track('parker-solar-probe');
    let best = Infinity;
    const p = new Vector3();
    for (let t = 2461240; t < 2461340; t += 1 / 48) best = Math.min(best, tr.positionM(t, p).length());
    expect(best / 6.957e8).toBeGreaterThan(9.6);
    expect(best / 6.957e8).toBeLessThan(10.1);
  });
  it('brings DART to Didymos at the impact (2022-09-26 23:14 UTC; Dimorphos orbits 1.2 km from Didymos)', () => {
    const tr = track('dart');
    // Impact 23:14:24 UTC = JD 2459849.46834 UTC = 2459849.46914 TDB (+69.184 s); the track ends there, within ~1 s.
    expect(Math.abs(tr.endJD - 2459849.46914) * 86400).toBeLessThan(2);
    const d = tr.positionM(tr.endJD, new Vector3()).length();
    expect(d).toBeLessThan(5e3);
  });
});
