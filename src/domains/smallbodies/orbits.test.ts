import { describe, expect, it } from 'vitest';
import * as Astronomy from 'astronomy-engine';
import { Vector3 } from 'three';
import { AU_M } from '../../core/units';
import named from './named.generated.json';
import { heliocentricDistanceAU, heliocentricIcrsM, jdTdbFromMs, perihelionAU, periodDays, type HelioElements } from './orbits';

type Rec = { id: string; elements: HelioElements & { qAU: number; tpJD: number } };
const body = (id: string): Rec => (named.bodies as unknown as Rec[]).find((b) => b.id === id)!;

describe('two-body small-body propagation', () => {
  it('reaches the catalogued perihelion distance at tp (elliptic: Halley, hyperbolic: 3I/ATLAS)', () => {
    for (const id of ['halley', '67p', '3i-atlas', 'borisov', 'oumuamua']) {
      const el = body(id).elements;
      const r = heliocentricDistanceAU(el, el.tpJD);
      expect(r).toBeCloseTo(el.qAU, 4);
      expect(perihelionAU(el.aAU, el.e)).toBeCloseTo(el.qAU, 4);
    }
  });
  it('Halley period ~75-76 yr, Apophis ~323.6 d', () => {
    expect(periodDays(body('halley').elements.aAU, body('halley').elements.e)! / 365.25).toBeGreaterThan(74);
    expect(periodDays(body('halley').elements.aAU, body('halley').elements.e)! / 365.25).toBeLessThan(77);
    expect(periodDays(body('apophis').elements.aAU, body('apophis').elements.e)!).toBeCloseTo(323.6, 0);
  });
  it('Apophis passes Earth on 2029-04-13 within ~0.003 au of the real 0.000254 au (two-body, no Earth perturbation)', () => {
    const t = Date.UTC(2029, 3, 13, 21, 46);
    const sun = Astronomy.BaryState(Astronomy.Body.Sun, Astronomy.MakeTime(new Date(t)));
    const earth = Astronomy.BaryState(Astronomy.Body.Earth, Astronomy.MakeTime(new Date(t)));
    const h = heliocentricIcrsM(body('apophis').elements, jdTdbFromMs(t), new Vector3());
    const dx = h.x / AU_M - (earth.x - sun.x), dy = h.y / AU_M - (earth.y - sun.y), dz = h.z / AU_M - (earth.z - sun.z);
    expect(Math.hypot(dx, dy, dz)).toBeLessThan(0.003);
  });
});
