/**
 * Black-hole catalogue and render-model tests. Reference values:
 *  - Gaia BH1 9.62 M☉, 480 pc, P 185.59 d, e 0.451 (El-Badry et al. 2023, MNRAS 518, 1057)
 *  - Gaia BH3 32.7 M☉, 590.6 pc, P 4253 d (Gaia Collaboration, Panuzzo et al. 2024, A&A 686, L2)
 *  - Cygnus X-1 21.2 ± 2.2 M☉, 2.22 kpc, a = 0.244 AU, i = 27.5° (Miller-Jones et al. 2021, Science 371, 1046)
 *  - M87* 6.5 × 10⁹ M☉ at 16.8 Mpc, jet ~17° to the line of sight (EHT Collaboration 2019, Paper VI; Walker et al. 2018)
 *  - GW150914 36 + 29 → 62 M☉, 3 M☉ radiated (Abbott et al. 2016, PRL 116, 061102)
 *  - r_s = 2GM/c² = 2.953 km per solar mass.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { binaryPositions, buildModel, type BlackHoleCatalogue, type RawBlackHole } from './catalog';
import { BLACKHOLE_IDS } from './domain';

const cat = JSON.parse(readFileSync(resolve(__dirname, '../../../public/data/blackholes/blackholes.json'), 'utf8')) as BlackHoleCatalogue;
const raw = (id: string): RawBlackHole => {
  const r = cat.objects.find((o) => o.id === id);
  if (!r) throw new Error(`missing ${id}`);
  return r;
};
const AU = 1.495978707e11;
const DAY = 86400;
const GM_SUN = 1.32712440018e20;

describe('black-hole catalogue', () => {
  it('lists exactly the ids the domain provides', () => {
    expect(cat.objects.map((o) => o.id).sort()).toEqual([...BLACKHOLE_IDS].sort());
  });

  it('cites a known reference for every value', () => {
    const refs = new Set(Object.keys(cat.references as Record<string, unknown>));
    const missing: string[] = [];
    const walk = (v: unknown, path: string): void => {
      if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
      else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          if ((k === 'ref' || /Ref$/.test(k)) && typeof x === 'string' && !refs.has(x)) missing.push(`${path}.${k}=${x}`);
          walk(x, `${path}.${k}`);
        }
      }
    };
    walk(cat.objects, 'objects');
    expect(missing).toEqual([]);
  });

  it('matches the published masses and distances', () => {
    expect(raw('gaia-bh1').massMsun?.value).toBeCloseTo(9.62, 2);
    expect(raw('gaia-bh1').distancePc?.value).toBeCloseTo(480, 0);
    expect(raw('gaia-bh3').massMsun?.value).toBeCloseTo(32.7, 1);
    expect(raw('cygnus-x1').massMsun?.value).toBeCloseTo(21.2, 1);
    expect(raw('cygnus-x1').distancePc?.value).toBeCloseTo(2220, 0);
    expect(raw('m87').massMsun?.value).toBe(6.5e9);
    expect(raw('m87').distancePc?.value).toBeCloseTo(16.8e6, -5);
    expect(raw('m87').hostGalaxyId).toBe('gal:m87');
    expect(raw('m31').hostGalaxyId).toBe('gal:m31');
    const gw = raw('gw150914').extra as Record<string, number>;
    expect(gw.primaryMsun + gw.secondaryMsun - gw.finalMsun).toBeCloseTo(gw.radiatedMsun, 0);
  });

  it('never stores an unknown as zero', () => {
    for (const o of cat.objects) {
      if (o.massMsun) expect(o.massMsun.value === null || o.massMsun.value > 0).toBe(true);
      if (o.distancePc) expect(o.distancePc.value === null || o.distancePc.value > 0).toBe(true);
    }
  });

  it('has orbits consistent with Kepler’s third law where a is published', () => {
    for (const id of ['gaia-bh1', 'gaia-bh2', 'gaia-bh3', 'cygnus-x1']) {
      const o = raw(id);
      const mTot = (o.massMsun!.value as number) + (o.companion!.massMsun!.value as number);
      const P = (o.orbit!.periodDays!.value as number) * DAY;
      const a = Math.cbrt((GM_SUN * mTot * P * P) / (4 * Math.PI * Math.PI)) / AU;
      expect(a / (o.orbit!.semiMajorAxisAU!.value as number)).toBeCloseTo(1, 1);
    }
  });
});

describe('render model', () => {
  it('derives the Schwarzschild radius', () => {
    const m = buildModel(raw('cygnus-x1'));
    expect(m.rsM / 1e3).toBeCloseTo(21.2 * 2.95325, 1);
    expect(buildModel(raw('m87')).rsM / AU).toBeCloseTo(128, -1);
  });

  it('keeps the barycentre fixed and the separation on the ellipse', () => {
    const m = buildModel(raw('gaia-bh1'));
    expect(m.binary).not.toBeNull();
    const b = m.binary!;
    const bh = new THREE.Vector3();
    const st = new THREE.Vector3();
    const mBh = m.massMsun;
    const mSt = m.companion!.massMsun;
    for (const t of [0, 40, 93, 150].map((d) => Date.UTC(2024, 0, 1) + d * DAY * 1e3)) {
      binaryPositions(m, m.bary, t, bh, st);
      const sep = bh.distanceTo(st);
      expect(sep).toBeGreaterThanOrEqual(b.aM * (1 - b.e) * 0.999);
      expect(sep).toBeLessThanOrEqual(b.aM * (1 + b.e) * 1.001);
      const cm = bh.clone().multiplyScalar(mBh).addScaledVector(st, mSt).divideScalar(mBh + mSt);
      expect(cm.distanceTo(m.bary) / b.aM).toBeLessThan(1e-6);
    }
    expect(b.periodSec / DAY).toBeCloseTo(185.59, 1);
  });

  it('gives discs to accreting systems only, jets to microquasars and M87*', () => {
    expect(buildModel(raw('gaia-bh1')).disc).toBeNull();
    expect(buildModel(raw('gaia-bh3')).disc).toBeNull();
    expect(buildModel(raw('cygnus-x1')).disc).not.toBeNull();
    expect(buildModel(raw('grs1915')).jet).not.toBeNull();
    expect(buildModel(raw('m87')).jet).not.toBeNull();
    expect(buildModel(raw('a0620-00')).jet).toBeNull();
  });

  it('points M87*’s approaching jet ~17° from the line of sight, spin axis away from Earth', () => {
    const m = buildModel(raw('m87'));
    const toEarth = m.bary.clone().negate().normalize();
    const ang = (Math.acos(m.jet!.axis.dot(toEarth)) * 180) / Math.PI;
    expect(ang).toBeCloseTo(17, 0);
    expect(m.normal.dot(toEarth)).toBeLessThan(0);
  });
});
