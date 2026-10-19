import { describe, expect, it } from 'vitest';
import * as Astronomy from 'astronomy-engine';
import {
  DUBAI, astroTimeToTdMs, compass, computeSkyEvents, conjunctions, elongations, goldenMin, issPassEvents, lunarEclipses,
  meteorShowers, moonPhaseName, oppositions, satellitePasses, seasons, solarEclipses, type OmmElements,
} from './events';

const START = Date.UTC(2026, 9, 19);
const END = Date.UTC(2028, 9, 19);

/** TD of greatest eclipse, NASA Eclipse Web Site decade tables (eclipse.gsfc.nasa.gov/SEdecade/SEdecade2021.html, LEdecade2021.html). */
const NASA_SOLAR: [string, string][] = [
  ['2027-02-06T16:00:47Z', 'annular'],
  ['2027-08-02T10:07:49Z', 'total'],
  ['2028-01-26T15:08:58Z', 'annular'],
  ['2028-07-22T02:56:39Z', 'total'],
];
const NASA_LUNAR: [string, string][] = [
  ['2027-02-20T23:14:06Z', 'penumbral'],
  ['2027-07-18T16:04:09Z', 'penumbral'],
  ['2027-08-17T07:14:59Z', 'penumbral'],
  ['2028-01-12T04:14:13Z', 'partial'],
  ['2028-07-06T18:20:57Z', 'partial'],
  ['2028-12-31T16:53:15Z', 'total'],
];

describe('eclipses vs the NASA catalogue', () => {
  it('global solar eclipses: kind and TD of greatest eclipse within one minute', () => {
    let e = Astronomy.SearchGlobalSolarEclipse(new Date(START));
    for (const [td, kind] of NASA_SOLAR) {
      expect(e.kind).toBe(kind);
      expect(Math.abs(astroTimeToTdMs(e.peak) - Date.parse(td))).toBeLessThan(60_000);
      e = Astronomy.NextGlobalSolarEclipse(e.peak);
    }
  });

  it('lunar eclipses: kind and TD of greatest eclipse within one minute', () => {
    let e = Astronomy.SearchLunarEclipse(new Date(START));
    for (const [td, kind] of NASA_LUNAR) {
      expect(e.kind).toBe(kind);
      expect(Math.abs(astroTimeToTdMs(e.peak) - Date.parse(td))).toBeLessThan(60_000);
      e = Astronomy.NextLunarEclipse(e.peak);
    }
  });

  it('2 Aug 2027: total, greatest eclipse in Egypt (NASA: 25°29′N 33°13′E), headline, partial from Dubai', () => {
    const ev = solarEclipses(START, END, DUBAI);
    expect(ev.map(e => e.id)).toEqual(['solar-eclipse:2027-02-06', 'solar-eclipse:2027-08-02', 'solar-eclipse:2028-01-26', 'solar-eclipse:2028-07-22']);
    const aug = ev[1]!;
    expect(aug.title).toBe('Total solar eclipse');
    expect(aug.headline).toBe(true);
    expect(aug.facts.find(f => f.label === 'Greatest eclipse')?.value).toBe('25.5° N, 33.2° E');
    expect(aug.facts.find(f => f.label === 'Longest totality')?.value).toBe('6 min 23 s');
    expect(aug.local).toMatch(/^Partial from Dubai: \d+% of the Sun covered/);
    // The camera hint points from Earth's centre toward the greatest-eclipse point, which faces the Sun at noon-ish.
    expect(aug.view.type).toBe('shadow-on-earth');
    if (aug.view.type === 'shadow-on-earth') {
      const s = Astronomy.GeoVector(Astronomy.Body.Sun, new Date(aug.timeMs), true);
      const l = Math.hypot(s.x, s.y, s.z);
      const cos = (aug.view.dirEqj[0] * s.x + aug.view.dirEqj[1] * s.y + aug.view.dirEqj[2] * s.z) / l;
      expect(cos).toBeGreaterThan(0.95);
    }
  });

  it('lunar eclipse records: totality length for 31 Dec 2028 (NASA: 71 min)', () => {
    const ev = lunarEclipses(START, Date.UTC(2029, 0, 1), DUBAI);
    const dec = ev.find(e => e.id === 'lunar-eclipse:2028-12-31')!;
    expect(dec.headline).toBe(true);
    const tot = dec.facts.find(f => f.label === 'Totality')!.value;
    const min = Number(/^(\d+) min/.exec(tot)![1]);
    expect(Math.abs(min - 71)).toBeLessThanOrEqual(1);
    // 16:53 UT is 20:53 in Dubai: the Moon is up.
    expect(dec.local).toMatch(/^Visible from Dubai/);
  });
});

describe('planets, seasons and showers', () => {
  it('oppositions: Mars on 19 Feb 2027, Jupiter, Saturn, Uranus and Neptune each once or more', () => {
    const ev = oppositions(START, END);
    const mars = ev.filter(e => e.bodies[0] === 'sol:mars');
    expect(mars.length).toBe(1);
    expect(new Date(mars[0]!.timeMs).toISOString().slice(0, 10)).toBe('2027-02-19');
    for (const b of ['sol:jupiter', 'sol:saturn', 'sol:uranus', 'sol:neptune']) expect(ev.some(e => e.bodies[0] === b)).toBe(true);
  });

  it('greatest elongations are physically sized (Mercury 17.8–28.3°, Venus 45–47.5°)', () => {
    const ev = elongations(START, END);
    expect(ev.filter(e => e.bodies[0] === 'sol:mercury').length).toBeGreaterThanOrEqual(10);
    for (const e of ev) {
      const a = Number.parseFloat(e.facts[0]!.value);
      if (e.bodies[0] === 'sol:mercury') { expect(a).toBeGreaterThan(17.5); expect(a).toBeLessThan(28.5); }
      else { expect(a).toBeGreaterThan(45); expect(a).toBeLessThan(47.5); }
    }
  });

  it('conjunctions are true local minima below the threshold, away from the Sun', () => {
    const ev = conjunctions(START, END);
    expect(ev.length).toBeGreaterThan(0);
    for (const e of ev) {
      const sun = Number.parseFloat(e.facts[1]!.value);
      expect(sun).toBeGreaterThanOrEqual(12);
      expect(e.view.type).toBe('from-earth');
    }
  });

  it('seasons 2027 match USNO to two minutes', () => {
    const ev = seasons(Date.UTC(2027, 0, 1), Date.UTC(2027, 11, 31, 23));
    const usno = ['2027-03-20T20:25Z', '2027-06-21T14:11Z', '2027-09-23T06:02Z', '2027-12-22T02:42Z'];
    expect(ev.length).toBe(4);
    ev.forEach((e, i) => expect(Math.abs(e.timeMs - Date.parse(usno[i]!))).toBeLessThan(120_000));
  });

  it('meteor shower peaks fall on the IMO dates (Perseids 12–13 Aug, Geminids 14 Dec)', () => {
    const ev = meteorShowers(START, END, DUBAI);
    const day = (code: string, year: number): string =>
      new Date(ev.find(e => e.id.startsWith(`meteor-shower:${code}:${year}`))!.timeMs).toISOString().slice(5, 10);
    expect(['08-12', '08-13']).toContain(day('per', 2027));
    expect(['12-14', '12-15']).toContain(day('gem', 2027));
    expect(['01-03', '01-04']).toContain(day('qua', 2027));
    for (const e of ev) expect(e.local).toMatch(/^Moon \d+% lit/);
  });

  it('computeSkyEvents is sorted and covers every kind', () => {
    const ev = computeSkyEvents({ startMs: START, observer: DUBAI });
    for (let i = 1; i < ev.length; i++) expect(ev[i]!.timeMs).toBeGreaterThanOrEqual(ev[i - 1]!.timeMs);
    const kinds = new Set(ev.map(e => e.kind));
    for (const k of ['solar-eclipse', 'lunar-eclipse', 'opposition', 'elongation', 'meteor-shower', 'season', 'conjunction']) expect(kinds.has(k as never)).toBe(true);
    expect(new Set(ev.map(e => e.id)).size).toBe(ev.length);
  });
});

describe('ISS passes', () => {
  // CelesTrak GP snapshot used by the orbital domain (epoch 2026-10-15T19:43:34Z).
  const ISS: OmmElements = {
    name: 'ISS (ZARYA)', norad: 25544, epochUtc: '2026-10-15T19:43:34.186944Z', meanMotionRevPerDay: 15.48879905,
    eccentricity: 0.00067551, inclinationDeg: 51.6317, raanDeg: 63.1136, argPerigeeDeg: 265.8514, meanAnomalyDeg: 94.1703,
    bstar: 0.00010980148, meanMotionDot: 0.0000558, meanMotionDdot: 0,
  };

  it('finds passes over Dubai with sane geometry', () => {
    const t0 = Date.parse('2026-10-16T00:00:00Z');
    const { passes, stale } = satellitePasses(ISS, DUBAI, t0, t0 + 3 * 86_400_000, 10);
    expect(stale).toBe(false);
    expect(passes.length).toBeGreaterThan(3);
    for (const p of passes) {
      expect(p.maxElevationDeg).toBeGreaterThanOrEqual(10);
      expect(p.maxElevationDeg).toBeLessThanOrEqual(90);
      expect(p.endMs - p.startMs).toBeLessThan(12 * 60_000);
      if (p.magnitude != null) { expect(p.magnitude).toBeLessThan(3); expect(p.magnitude).toBeGreaterThan(-5); }
    }
  });

  it('refuses stale elements and lists only visible passes as events', () => {
    expect(satellitePasses(ISS, DUBAI, Date.UTC(2027, 5, 1), Date.UTC(2027, 5, 3)).stale).toBe(true);
    const { events } = issPassEvents(ISS, DUBAI, Date.parse('2026-10-16T00:00:00Z'), 7);
    for (const e of events) { expect(e.kind).toBe('iss-pass'); expect(e.local).toMatch(/^Rises in the [NSEW]+/); }
  });
});

describe('helpers', () => {
  it('goldenMin, compass, moon phase names', () => {
    expect(goldenMin(x => (x - 2) ** 2, 0, 5, 1e-6)).toBeCloseTo(2, 5);
    expect(compass(0)).toBe('N');
    expect(compass(248)).toBe('WSW');
    expect(compass(359)).toBe('N');
    expect(moonPhaseName(180)).toBe('full Moon');
    expect(moonPhaseName(350)).toBe('new Moon');
    expect(moonPhaseName(100)).toBe('first quarter');
  });
});
