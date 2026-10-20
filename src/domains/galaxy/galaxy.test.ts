import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ARMS, R0_PC, S2_GRAVITY2020, SGRA_DEC_DEG, SGRA_MASS_KG, SGRA_MASS_MSUN, SGRA_RA_DEG, SGRA_RS_M, Z_SUN_PC,
  armPointKpc, armRadiusKpc, buildGalacticFrame, decimalYear, galKpcToWorld, generateGalaxyParticles, helioGalPcToGalKpc,
  msOfDecimalYear, nextPericentreYr, orbitExtremes, schwarzschildPrecessionRad, sStarOffsetMas, worldToGalKpc, DEG,
} from './model';
import { AU_M, PC_M } from '../../core/units';

const json = (f: string): any => JSON.parse(readFileSync(resolve(__dirname, '../../../public/data/galactic', f), 'utf8'));

describe('galaxy model constants match the verified data files', () => {
  const mw = json('milkyway.json');
  const sg = json('sgra.json');
  const lm = json('landmarks.json');
  it('R0, z_sun, mass and Sgr A* position', () => {
    expect(R0_PC).toBe(mw.sun.galactocentricDistancePc.value);
    expect(Z_SUN_PC).toBe(mw.sun.heightAboveMidplanePc.value);
    expect(SGRA_MASS_MSUN).toBeCloseTo(sg.blackHole.mass.adopted.value, -2);
    const s = lm.objects.find((o: any) => o.id === 'sgr-a-star');
    expect(SGRA_RA_DEG).toBe(s.raDeg);
    expect(SGRA_DEC_DEG).toBe(s.decDeg);
  });
  it('arms are Reid 2019 Table 2 verbatim', () => {
    const f: string[] = mw.spiralArms.fields;
    const col = (row: any[], k: string): any => row[f.indexOf(k)];
    for (const row of mw.spiralArms.rows) {
      const a = ARMS.find((x) => x.reidLabel === col(row, 'reidLabel'))!;
      expect(a).toBeDefined();
      expect(a.rKinkKpc).toBe(col(row, 'rKinkKpc'));
      expect(a.betaKinkDeg).toBe(col(row, 'betaKinkDeg'));
      expect(a.pitchInDeg).toBe(col(row, 'pitchInsideKinkDeg'));
      expect(a.pitchOutDeg).toBe(col(row, 'pitchOutsideKinkDeg'));
      expect(a.widthKpc).toBe(col(row, 'widthKpc'));
      expect(a.betaMinDeg).toBe(col(row, 'betaMinDeg'));
      expect(a.betaMaxDeg).toBe(col(row, 'betaMaxDeg'));
    }
  });
  it('arm centre lines reproduce the published centre lines (R0 = 8.15 frame)', () => {
    const p = { x: 0, y: 0, z: 0 };
    for (const a of ARMS) {
      const cl = mw.spiralArms.centerLines[a.reidLabel];
      if (!cl) continue;
      const [x, y] = cl.xy[Math.floor(cl.xy.length / 2)];
      const beta = Math.atan2(y, -x);
      armPointKpc(a, beta, p);
      expect(Math.hypot(p.x - x, p.y - y)).toBeLessThan(0.02);
    }
  });
});

describe('Galactocentric frame', () => {
  const f = buildGalacticFrame();
  it('puts the Sun at X ≈ −R0, Z ≈ +z_sun', () => {
    expect(f.sunKpc.x).toBeCloseTo(-R0_PC / 1000, 2);
    expect(Math.abs(f.sunKpc.y)).toBeLessThan(0.001);
    expect(f.sunKpc.z * 1000).toBeCloseTo(Z_SUN_PC, 1);
  });
  it('round-trips kpc ↔ world', () => {
    const w = galKpcToWorld(f, 3, -4, 0.2, { x: 0, y: 0, z: 0 });
    const g = worldToGalKpc(f, w, { x: 0, y: 0, z: 0 });
    expect(g.x).toBeCloseTo(3, 9); expect(g.y).toBeCloseTo(-4, 9); expect(g.z).toBeCloseTo(0.2, 9);
  });
  it('+Y points to l = 90° (Cygnus side): a landmark at l ≈ 80° has Y > 0', () => {
    const g = helioGalPcToGalKpc(f, [0, 1000, 0], { x: 0, y: 0, z: 0 });
    expect(g.y).toBeGreaterThan(0.99);
  });
  it('Sgr A* landmark xyz maps to the origin (within its 8 pc offset from l = 0)', () => {
    const g = helioGalPcToGalKpc(f, [8275.9, -8.1, -6.7], { x: 0, y: 0, z: 0 });
    expect(Math.hypot(g.x, g.y, g.z)).toBeLessThan(0.002);
  });
});

describe('arms', () => {
  it('Perseus lies outside the Sun, Sgr-Car inside, near β = 0', () => {
    const per = ARMS.find((a) => a.key === 'perseus')!, sgr = ARMS.find((a) => a.key === 'sgr-car')!;
    expect(armRadiusKpc(per, 0)).toBeGreaterThan(9);
    expect(armRadiusKpc(sgr, 0)).toBeLessThan(7.5);
    expect(armRadiusKpc(per, 200 * DEG)).toBeGreaterThan(4);
  });
});

describe('particles', () => {
  it('generates the requested count deterministically', () => {
    const a = generateGalaxyParticles(20000, 7), b = generateGalaxyParticles(20000, 7);
    expect(a.count).toBeGreaterThan(19000);
    expect(a.positions[123]).toBe(b.positions[123]);
    let maxR = 0;
    for (let i = 0; i < a.count; i++) maxR = Math.max(maxR, Math.hypot(a.positions[3 * i], a.positions[3 * i + 1]));
    expect(maxR).toBeLessThan(61);
  });
});

describe('Sgr A* and S2', () => {
  it('Schwarzschild radius ≈ 1.27e10 m (sgra.json derived 12,697,794 km)', () => {
    expect(SGRA_RS_M / 1e3).toBeCloseTo(12_697_794, -4);
  });
  it('S2 pericentre ≈ 120 AU, speed ≈ 7,700 km/s (GRAVITY 2018/2020)', () => {
    const x = orbitExtremes(S2_GRAVITY2020.aMas, S2_GRAVITY2020.e, 8246.7, 4.261e6 * (SGRA_MASS_KG / SGRA_MASS_MSUN));
    expect(x.periAu).toBeGreaterThan(115);
    expect(x.periAu).toBeLessThan(125);
    expect(x.vPeriKmS).toBeGreaterThan(7500);
    expect(x.vPeriKmS).toBeLessThan(7800);
    // GRAVITY 2020: Schwarzschild precession 12.1 arcmin per orbit.
    const dw = schwarzschildPrecessionRad(x.aM, S2_GRAVITY2020.e, 4.261e6 * (SGRA_MASS_KG / SGRA_MASS_MSUN)) / DEG * 60;
    expect(dw).toBeGreaterThan(11.5);
    expect(dw).toBeLessThan(12.6);
    expect(x.aM / AU_M).toBeGreaterThan(1000);
    expect(PC_M).toBeGreaterThan(0);
  });
  it('S2 at pericentre is 14.4 mas from Sgr A* on the sky-plane (r_p = a(1−e))', () => {
    const p = sStarOffsetMas(S2_GRAVITY2020, S2_GRAVITY2020.tPeriYr, { x: 0, y: 0, z: 0 });
    expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(S2_GRAVITY2020.aMas * (1 - S2_GRAVITY2020.e), 6);
  });
  it('next S2 pericentre after 2026 is in 2034', () => {
    const y = nextPericentreYr(S2_GRAVITY2020, 2026.8)!;
    expect(Math.floor(y)).toBe(2034);
    expect(decimalYear(msOfDecimalYear(y))).toBeCloseTo(y, 9);
  });
});
