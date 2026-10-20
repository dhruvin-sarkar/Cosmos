import { describe, expect, it } from 'vitest';
import { PRESETS, SGRA, blackHole, clockAt, dilationCurve, freeFall, masToAu, orbitPlaneAt, orbitPlanePath, s2Numbers } from './model';

describe('black hole lab model', () => {
  it('Sgr A*: r_s and the shadow on the sky', () => {
    const bh = blackHole(SGRA.massMsun, SGRA.distancePc);
    // r_s = 2GM/c² = 2.953 km per solar mass → 1.27e10 m for 4.30e6 M☉ (GRAVITY 2024 mass).
    expect(bh.rsM).toBeCloseTo(2953.25 * SGRA.massMsun, -7);
    // Shadow = 2√27 θ_g with θ_g = GM/(Dc²) ≈ 5.1 µas → ≈ 53 µas, consistent with the EHT 2022 ring of 51.8 ± 2.3 µas
    // (EHT Collaboration 2022, ApJL 930, L12).
    expect(bh.shadowUas!).toBeGreaterThan(50);
    expect(bh.shadowUas!).toBeLessThan(56);
    expect(Math.abs(bh.shadowUas! - SGRA.ehtRingUas)).toBeLessThan(3 * SGRA.ehtRingErrUas);
    expect(bh.shadowDiameterM / bh.rsM).toBeCloseTo(3 * Math.sqrt(3), 6);
    expect(bh.iscoM / bh.rsM).toBe(3);
  });

  it('M87*: shadow ≈ 2√27 × 3.8 µas (EHT 2019: θ_g = 3.8 ± 0.4 µas, ring 42 ± 3 µas)', () => {
    const m87 = PRESETS.find(p => p.id === 'm87')!;
    const bh = blackHole(m87.massMsun, m87.distancePc);
    expect(bh.shadowUas! / (2 * Math.sqrt(27))).toBeCloseTo(3.8, 0);
    expect(bh.shadowUas!).toBeGreaterThan(36);
    expect(bh.shadowUas!).toBeLessThan(45);
  });

  it('density inside r_s falls as 1/M²', () => {
    const a = blackHole(10, null), b = blackHole(1e3, null);
    expect(a.meanDensityKgM3 / b.meanDensityKgM3).toBeCloseTo(1e4, -1);
    expect(a.shadowUas).toBeNull();
  });

  it('clock rates (Schwarzschild): hovering √(1 − 1/x), circular orbit √(1 − 3/2x)', () => {
    const c = clockAt(3, 1);
    expect(c.staticRate).toBeCloseTo(Math.sqrt(2 / 3), 10);
    expect(c.orbitRate).toBeCloseTo(Math.sqrt(0.5), 10);
    expect(c.redshift).toBeCloseTo(1 / Math.sqrt(2 / 3) - 1, 10);
    expect(Number.isNaN(clockAt(1.2, 1).orbitRate)).toBe(true);
    const curve = dilationCurve(50, 1000);
    expect(curve.x[0]).toBeCloseTo(1.0005, 6);
    expect(curve.x[49]).toBeCloseTo(1000, 6);
    expect(curve.hover.every((v, i) => i === 0 || v >= curve.hover[i - 1]!)).toBe(true);
  });

  it('radial free fall: proper time to the horizon is finite, far-away time diverges', () => {
    const r0 = 10;
    const s = freeFall(r0, 2000);
    const last = s[s.length - 1]!;
    expect(last.r).toBeCloseTo(1.0001, 4);
    // Cycloid: τ(r) = (r0^{3/2}/2)(η + sin η), r = r0 cos²(η/2) (units r_s = c = 1).
    const eta = 2 * Math.acos(Math.sqrt(1.0001 / r0));
    expect(last.tau).toBeCloseTo((r0 ** 1.5 / 2) * (eta + Math.sin(eta)), 8);
    // Total proper time to r = 0 is (π/2) r0^{3/2}; the horizon is reached a little before.
    expect(last.tau).toBeLessThan((Math.PI / 2) * r0 ** 1.5);
    expect(last.t).toBeGreaterThan(last.tau);
    for (let i = 1; i < s.length; i++) {
      expect(s[i]!.r).toBeLessThanOrEqual(s[i - 1]!.r);
      expect(s[i]!.t).toBeGreaterThanOrEqual(s[i - 1]!.t);
    }
    // Far-away time keeps growing near the horizon (logarithmic divergence): the last 1 % of τ takes far longer in t.
    const i99 = s.findIndex(p => p.tau > 0.99 * last.tau);
    expect(last.t - s[i99]!.t).toBeGreaterThan(5 * (last.tau - s[i99]!.tau));
  });

  it('S2 (GRAVITY 2018/2020): pericentre ≈ 120 AU at ≈ 7,650 km/s, 12′ precession, next pericentre 2034', () => {
    const s2 = s2Numbers();
    expect(s2.periAu).toBeGreaterThan(115);
    expect(s2.periAu).toBeLessThan(125);
    expect(s2.vPeriKmS).toBeGreaterThan(7500);
    expect(s2.vPeriKmS).toBeLessThan(7800);
    expect(s2.vPeriFracC).toBeCloseTo(0.0256, 3);
    expect(s2.precessionArcminPerOrbit).toBeCloseTo(12.1, 0);
    expect(s2.nextPeriYr).toBeGreaterThan(2034);
    expect(s2.nextPeriYr).toBeLessThan(2035);
    expect(s2.lastPeriYr).toBeCloseTo(2018.4, 0);
    // Gravitational + transverse Doppler redshift at pericentre ≈ 200 km/s (GRAVITY 2018: f = 1 fits, ~200 km/s).
    expect(s2.periRedshiftKmS).toBeGreaterThan(170);
    expect(s2.periRedshiftKmS).toBeLessThan(230);
    expect(s2.periOverRs).toBeGreaterThan(1300);
    expect(s2.periOverRs).toBeLessThan(1500);
  });

  it('orbit geometry helpers', () => {
    const e = 0.88;
    const peri = orbitPlaneAt(e, 0);
    expect(peri.r).toBeCloseTo(1 - e, 10);
    expect(peri.v).toBeCloseTo(Math.sqrt((1 + e) / (1 - e)), 8);
    const apo = orbitPlaneAt(e, 0.5);
    expect(apo.r).toBeCloseTo(1 + e, 8);
    const path = orbitPlanePath(e, 8);
    expect(path[0]![0]).toBeCloseTo(1 - e, 10);
    expect(masToAu(1)).toBeCloseTo(8.2759, 2);
  });
});
