/**
 * "What's up": real sky events for the next months, computed from first principles with astronomy-engine
 * (VSOP87 / ELP lunar theory; eclipses by shadow-cone geometry) and satellite.js (SGP4 for ISS passes).
 *
 * Pure and synchronous: given a start time and an observer it returns plain event records with one-line explanations
 * and a camera hint (`view`) that the UI turns into a "Show me" shot. Nothing here touches the DOM or the engine.
 * Times are UTC epoch milliseconds; directions are unit vectors on ICRS/EQJ axes (the engine's world axes).
 * Unknown values are null, never 0.
 */
import * as Astronomy from 'astronomy-engine';
import { ecfToEci, ecfToLookAngles, eciToEcf, geodeticToEcf, gstime, json2satrec, propagate, type SatRec } from 'satellite.js';

export const MODEL_SKY_EVENTS = 'sky-events@1';
export const EVENTS_SOURCE = 'astronomy-engine 2.1 (D. Cross): VSOP87 planets and lunar theory, about 1 arcminute agreement with NOVAS';
export const ECLIPSE_SOURCE = 'NASA Eclipse Web Site, F. Espenak (eclipse.gsfc.nasa.gov) — paths and durations';
export const METEOR_SOURCE = 'IAU Meteor Data Center shower list; peak solar longitudes, ZHR and radiants from the IMO Meteor Shower Calendar';
export const ISS_SOURCE = 'CelesTrak GP elements (T.S. Kelso), propagated with SGP4 (satellite.js 7)';

const DAY_MS = 86_400_000;
const MIN_MS = 60_000;
const J2000_TT_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
const DEG = Math.PI / 180;
const R_EARTH_KM = 6378.137;

export type Vec3 = [number, number, number];

export type SkyEventKind =
  | 'solar-eclipse' | 'lunar-eclipse' | 'conjunction' | 'opposition' | 'elongation' | 'meteor-shower' | 'season' | 'iss-pass';

export interface SkyObserver {
  name: string;
  latDeg: number;
  lonDeg: number;
  heightM: number;
  /** IANA time zone for display (e.g. 'Asia/Dubai'); null means the browser's zone. */
  timeZone: string | null;
}

export const DUBAI: SkyObserver = { name: 'Dubai', latDeg: 25.2048, lonDeg: 55.2708, heightM: 5, timeZone: 'Asia/Dubai' };

/** Camera hint for "Show me". The UI owns the actual framing. */
export type SkyEventView =
  /** Look at Earth's day side from `dirEqj` (unit vector from Earth's centre): the Moon's shadow on Earth. */
  | { type: 'shadow-on-earth'; dirEqj: Vec3 }
  /** Look at the Moon from the Earth side: the Moon inside Earth's shadow. */
  | { type: 'moon-in-shadow'; dirEqj: Vec3 }
  /** Stand just above Earth and look along `dirEqj` (unit, geocentric); `upEqj` is the local vertical to use. */
  | { type: 'from-earth'; dirEqj: Vec3; upEqj: Vec3; targetIds: string[] }
  /** Earth seen side-on to the Sun so the terminator shows the tilt of the axis. */
  | { type: 'earth-season'; sunDirEqj: Vec3 }
  /** Ride along with the ISS looking back at the observer (`dirEqj`: observer → ISS, unit). */
  | { type: 'iss'; dirEqj: Vec3; upEqj: Vec3 };

export interface SkyEvent {
  id: string;
  kind: SkyEventKind;
  /** Moment to jump to (greatest eclipse, closest approach, shower peak, pass maximum…). */
  timeMs: number;
  title: string;
  /** One plain sentence: what happens and why it is worth looking. */
  summary: string;
  /** Observer-specific note (visibility from the visitor's location, Moon phase…), or null. */
  local: string | null;
  /** Headline events (total eclipses) are pinned in the panel. */
  headline: boolean;
  /** Entity ids involved, most important first. */
  bodies: string[];
  view: SkyEventView;
  /** Kind-specific numbers for the panel (all optional; null = unknown). */
  facts: SkyEventFact[];
  source: string;
}

export interface SkyEventFact {
  label: string;
  value: string;
}

// ── Small helpers ─────────────────────────────────────────────────────────────────────────

/** Terrestrial Dynamical Time of an AstroTime as epoch-like milliseconds (for comparison with eclipse catalogues). */
export function astroTimeToTdMs(t: Astronomy.AstroTime): number {
  return J2000_TT_MS + t.tt * DAY_MS;
}

function unit(v: { x: number; y: number; z: number }): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return [v.x / l, v.y / l, v.z / l];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Component of `v` perpendicular to unit `n`, normalised; falls back to any perpendicular. */
function perpendicular(v: Vec3, n: Vec3): Vec3 {
  const d = dot(v, n);
  let x = v[0] - d * n[0], y = v[1] - d * n[1], z = v[2] - d * n[2];
  let l = Math.hypot(x, y, z);
  if (l < 1e-6) {
    const a: Vec3 = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const e = dot(a, n);
    x = a[0] - e * n[0]; y = a[1] - e * n[1]; z = a[2] - e * n[2];
    l = Math.hypot(x, y, z);
  }
  return [x / l, y / l, z / l];
}

function geoDir(body: Astronomy.Body, tMs: number): Vec3 {
  return unit(Astronomy.GeoVector(body, new Date(tMs), true));
}

/** Golden-section minimiser of f on [a, b] to `tol` (same units as a, b). */
export function goldenMin(f: (x: number) => number, a: number, b: number, tol: number): number {
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a), d = a + g * (b - a);
  let fc = f(c), fd = f(d);
  while (b - a > tol) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(c); }
    else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(d); }
  }
  return (a + b) / 2;
}

function astroObserver(o: SkyObserver): Astronomy.Observer {
  return new Astronomy.Observer(o.latDeg, o.lonDeg, o.heightM);
}

/** Apparent altitude (deg, with refraction) of a body for the observer. */
export function altitudeDeg(body: Astronomy.Body, tMs: number, o: SkyObserver): number {
  const obs = astroObserver(o);
  const date = new Date(tMs);
  const eq = Astronomy.Equator(body, date, obs, true, true);
  return Astronomy.Horizon(date, obs, eq.ra, eq.dec, 'normal').altitude;
}

/** Plain-language Moon phase from the Sun–Moon ecliptic elongation (astronomy-engine MoonPhase, degrees). */
export function moonPhaseName(phaseDeg: number): string {
  const p = ((phaseDeg % 360) + 360) % 360;
  const names = ['new Moon', 'waxing crescent', 'first quarter', 'waxing gibbous', 'full Moon', 'waning gibbous', 'last quarter', 'waning crescent'];
  return names[Math.floor(((p + 22.5) % 360) / 45)] ?? 'new Moon';
}

export function moonIllumination(tMs: number): { fraction: number; phaseDeg: number; name: string } {
  const date = new Date(tMs);
  const phaseDeg = Astronomy.MoonPhase(date);
  const fraction = Astronomy.Illumination(Astronomy.Body.Moon, date).phase_fraction;
  return { fraction, phaseDeg, name: moonPhaseName(phaseDeg) };
}

/** 16-point compass name of an azimuth (deg, from north through east). */
export function compass(azDeg: number): string {
  const pts = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return pts[Math.round((((azDeg % 360) + 360) % 360) / 22.5) % 16] ?? 'N';
}

function fmtMag(m: number): string {
  return (m < 0 ? '−' : '') + Math.abs(m).toFixed(1);
}

function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60), s = Math.round(seconds - m * 60);
  return m > 0 ? `${m} min ${s} s` : `${s} s`;
}

function fmtLat(d: number): string {
  return `${Math.abs(d).toFixed(1)}° ${d >= 0 ? 'N' : 'S'}`;
}

function fmtLon(d: number): string {
  return `${Math.abs(d).toFixed(1)}° ${d >= 0 ? 'E' : 'W'}`;
}

function isoDay(tMs: number): string {
  return new Date(tMs).toISOString().slice(0, 10);
}

const BODY_ID: Partial<Record<Astronomy.Body, string>> = {
  [Astronomy.Body.Sun]: 'sol:sun', [Astronomy.Body.Moon]: 'sol:moon', [Astronomy.Body.Mercury]: 'sol:mercury',
  [Astronomy.Body.Venus]: 'sol:venus', [Astronomy.Body.Earth]: 'sol:earth', [Astronomy.Body.Mars]: 'sol:mars',
  [Astronomy.Body.Jupiter]: 'sol:jupiter', [Astronomy.Body.Saturn]: 'sol:saturn', [Astronomy.Body.Uranus]: 'sol:uranus',
  [Astronomy.Body.Neptune]: 'sol:neptune',
};

export function bodyEntityId(body: Astronomy.Body): string {
  return BODY_ID[body] ?? `sol:${String(body).toLowerCase()}`;
}

/** "From Earth" camera hint: look along `dir`, standing over the night side (or twilight side) of Earth. */
function fromEarthView(dir: Vec3, tMs: number, targetIds: string[]): SkyEventView {
  const sun = geoDir(Astronomy.Body.Sun, tMs);
  const up = perpendicular([-sun[0], -sun[1], -sun[2]], dir);
  return { type: 'from-earth', dirEqj: dir, upEqj: up, targetIds };
}

// ── Eclipses ──────────────────────────────────────────────────────────────────────────────

interface EclipseNote {
  path: string;
  durationS: number;
  saros: number;
  magnitude: number;
}

/** NASA (Espenak) path summaries for central solar eclipses in the exhibition window, keyed by UT date of greatest eclipse. */
const SOLAR_NOTES: Record<string, EclipseNote> = {
  '2026-08-12': { path: 'the Arctic, Greenland, Iceland and Spain', durationS: 138, saros: 126, magnitude: 1.039 },
  '2027-02-06': { path: 'Chile, Argentina and the Atlantic', durationS: 471, saros: 131, magnitude: 0.928 },
  '2027-08-02': { path: 'Spain, Morocco, Algeria, Libya, Egypt, Saudi Arabia, Yemen and Somalia', durationS: 383, saros: 136, magnitude: 1.079 },
  '2028-01-26': { path: 'Ecuador, Peru, Brazil, Suriname, Spain and Portugal', durationS: 627, saros: 141, magnitude: 0.921 },
  '2028-07-22': { path: 'Australia and New Zealand', durationS: 310, saros: 146, magnitude: 1.056 },
};

export function solarEclipses(startMs: number, endMs: number, observer: SkyObserver | null): SkyEvent[] {
  const out: SkyEvent[] = [];
  let e = Astronomy.SearchGlobalSolarEclipse(new Date(startMs));
  for (let guard = 0; guard < 20 && e.peak.date.getTime() <= endMs; guard++) {
    const t = e.peak.date.getTime();
    const note = SOLAR_NOTES[isoDay(t)];
    const kind: string = e.kind;
    const title = `${kind === 'total' ? 'Total' : kind === 'annular' ? 'Annular' : kind === 'hybrid' ? 'Hybrid' : 'Partial'} solar eclipse`;
    let summary: string;
    if (kind === 'total') summary = `The Moon covers the Sun completely; along a narrow path day turns to twilight${note ? ` for up to ${fmtDuration(note.durationS)}` : ''}.`;
    else if (kind === 'annular') summary = 'The Moon is too far from Earth to cover the Sun, so a ring of sunlight stays around it.';
    else if (kind === 'hybrid') summary = 'Total along part of the path and annular along the rest, because Earth’s curve brings it closer to the Moon’s shadow tip.';
    else summary = 'The Moon covers part of the Sun; its dark inner shadow misses Earth.';
    const facts: SkyEventFact[] = [];
    if (e.latitude != null && e.longitude != null) facts.push({ label: 'Greatest eclipse', value: `${fmtLat(e.latitude)}, ${fmtLon(e.longitude)}` });
    if (note) {
      facts.push({ label: kind === 'annular' ? 'Path of annularity' : 'Path of totality', value: note.path });
      facts.push({ label: kind === 'annular' ? 'Longest annular phase' : 'Longest totality', value: fmtDuration(note.durationS) });
      facts.push({ label: 'Saros series', value: String(note.saros) });
    }
    let local: string | null = null;
    if (observer) {
      const loc = Astronomy.SearchLocalSolarEclipse(new Date(t - 2 * DAY_MS), astroObserver(observer));
      const lt = loc.peak.time.date.getTime();
      if (Math.abs(lt - t) < DAY_MS && loc.peak.altitude > 0) {
        const pct = Math.round(loc.obscuration * 100);
        local = loc.kind === 'total' || loc.kind === 'annular'
          ? `${loc.kind === 'total' ? 'Total' : 'Annular'} from ${observer.name}.`
          : `Partial from ${observer.name}: ${pct}% of the Sun covered, Sun ${Math.round(loc.peak.altitude)}° up.`;
        facts.push({ label: `From ${observer.name}`, value: `${pct}% of the Sun covered` });
      } else {
        local = `Not visible from ${observer.name}.`;
      }
    }
    let dir: Vec3;
    if (e.latitude != null && e.longitude != null) {
      dir = unit(Astronomy.ObserverVector(e.peak, new Astronomy.Observer(e.latitude, e.longitude, 0), false));
    } else {
      dir = geoDir(Astronomy.Body.Moon, t);
    }
    out.push({
      id: `solar-eclipse:${isoDay(t)}`, kind: 'solar-eclipse', timeMs: t, title, summary, local,
      headline: kind === 'total',
      bodies: ['sol:earth', 'sol:moon', 'sol:sun'],
      view: { type: 'shadow-on-earth', dirEqj: dir }, facts,
      source: note ? `${EVENTS_SOURCE}; ${ECLIPSE_SOURCE}` : EVENTS_SOURCE,
    });
    e = Astronomy.NextGlobalSolarEclipse(e.peak);
  }
  return out;
}

export function lunarEclipses(startMs: number, endMs: number, observer: SkyObserver | null): SkyEvent[] {
  const out: SkyEvent[] = [];
  let e = Astronomy.SearchLunarEclipse(new Date(startMs));
  for (let guard = 0; guard < 20 && e.peak.date.getTime() <= endMs; guard++) {
    const t = e.peak.date.getTime();
    const kind = e.kind;
    const title = `${kind === 'total' ? 'Total' : kind === 'partial' ? 'Partial' : 'Penumbral'} lunar eclipse`;
    const summary = kind === 'total'
      ? 'The Moon passes fully into Earth’s shadow and turns copper-red, lit only by sunlight bent through Earth’s atmosphere.'
      : kind === 'partial'
        ? 'Part of the Moon slides into Earth’s dark inner shadow, as if a bite were taken out of it.'
        : 'The Moon passes through Earth’s faint outer shadow: a subtle dimming that is easy to miss.';
    const facts: SkyEventFact[] = [];
    if (e.sd_total > 0) facts.push({ label: 'Totality', value: fmtDuration(e.sd_total * 120) });
    if (e.sd_partial > 0) facts.push({ label: 'Partial phases', value: fmtDuration(e.sd_partial * 120) });
    facts.push({ label: 'In the outer shadow', value: fmtDuration(e.sd_penum * 120) });
    let local: string | null = null;
    if (observer) {
      const alt = altitudeDeg(Astronomy.Body.Moon, t, observer);
      local = alt > 0 ? `Visible from ${observer.name}: Moon ${Math.round(alt)}° up at mid-eclipse.` : `Moon below the horizon in ${observer.name} at mid-eclipse.`;
    }
    const moon = Astronomy.GeoVector(Astronomy.Body.Moon, e.peak, false);
    out.push({
      id: `lunar-eclipse:${isoDay(t)}`, kind: 'lunar-eclipse', timeMs: t, title, summary, local,
      headline: kind === 'total',
      bodies: ['sol:moon', 'sol:earth'],
      view: { type: 'moon-in-shadow', dirEqj: unit({ x: -moon.x, y: -moon.y, z: -moon.z }) }, facts,
      source: EVENTS_SOURCE,
    });
    e = Astronomy.NextLunarEclipse(e.peak);
  }
  return out;
}

// ── Planets ───────────────────────────────────────────────────────────────────────────────

const OUTER: Astronomy.Body[] = [Astronomy.Body.Mars, Astronomy.Body.Jupiter, Astronomy.Body.Saturn, Astronomy.Body.Uranus, Astronomy.Body.Neptune];

export function oppositions(startMs: number, endMs: number): SkyEvent[] {
  const out: SkyEvent[] = [];
  for (const body of OUTER) {
    let from = startMs;
    for (let guard = 0; guard < 4; guard++) {
      const t = Astronomy.SearchRelativeLongitude(body, 0, new Date(from)).date.getTime();
      if (t > endMs) break;
      const ill = Astronomy.Illumination(body, new Date(t));
      const name = String(body);
      const naked = ill.mag < 6;
      out.push({
        id: `opposition:${name.toLowerCase()}:${isoDay(t)}`, kind: 'opposition', timeMs: t,
        title: `${name} at opposition`,
        summary: `Earth passes between ${name} and the Sun, so ${name} rises at sunset, is up all night and is at its brightest${naked ? '' : ' (binoculars needed)'}.`,
        local: null, headline: false, bodies: [bodyEntityId(body)],
        view: fromEarthView(unit(ill.gc), t, [bodyEntityId(body)]),
        facts: [
          { label: 'Brightness', value: `magnitude ${fmtMag(ill.mag)}` },
          { label: 'Distance from Earth', value: `${(ill.geo_dist * 149.597870700).toFixed(ill.geo_dist < 2 ? 1 : 0)} million km` },
        ],
        source: EVENTS_SOURCE,
      });
      from = t + 30 * DAY_MS;
    }
  }
  return out;
}

export function elongations(startMs: number, endMs: number): SkyEvent[] {
  const out: SkyEvent[] = [];
  for (const body of [Astronomy.Body.Mercury, Astronomy.Body.Venus]) {
    let from = startMs;
    for (let guard = 0; guard < 16; guard++) {
      const ev = Astronomy.SearchMaxElongation(body, new Date(from));
      const t = ev.time.date.getTime();
      if (t > endMs) break;
      const name = String(body);
      const evening = ev.visibility === 'evening';
      const ill = Astronomy.Illumination(body, ev.time);
      out.push({
        id: `elongation:${name.toLowerCase()}:${isoDay(t)}`, kind: 'elongation', timeMs: t,
        title: `${name} at greatest ${evening ? 'evening' : 'morning'} elongation`,
        summary: `${name} swings ${ev.elongation.toFixed(1)}° from the Sun, its widest gap: the best chance to see it low in the ${evening ? 'west after sunset' : 'east before sunrise'}.`,
        local: null, headline: false, bodies: [bodyEntityId(body), 'sol:sun'],
        view: fromEarthView(unit(ill.gc), t, [bodyEntityId(body), 'sol:sun']),
        facts: [
          { label: 'Angle from the Sun', value: `${ev.elongation.toFixed(1)}°` },
          { label: 'Brightness', value: `magnitude ${fmtMag(ill.mag)}` },
          { label: 'Lit fraction', value: `${Math.round(ill.phase_fraction * 100)}%` },
        ],
        source: EVENTS_SOURCE,
      });
      from = t + 10 * DAY_MS;
    }
  }
  return out;
}

const CONJ_BODIES: Astronomy.Body[] = [Astronomy.Body.Mercury, Astronomy.Body.Venus, Astronomy.Body.Mars, Astronomy.Body.Jupiter, Astronomy.Body.Saturn];
/** Report planet pairs that pass closer than this (deg) and at least `MIN_SUN_DEG` from the Sun. */
export const CONJUNCTION_MAX_DEG = 2.5;
const MIN_SUN_DEG = 12;

function angleDeg(a: Vec3, b: Vec3): number {
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) / DEG;
}

export function conjunctions(startMs: number, endMs: number, maxSepDeg = CONJUNCTION_MAX_DEG): SkyEvent[] {
  const out: SkyEvent[] = [];
  const n = Math.ceil((endMs - startMs) / DAY_MS) + 1;
  const dirs = CONJ_BODIES.map(() => new Array<Vec3>(n));
  for (let i = 0; i < n; i++) {
    const t = startMs + i * DAY_MS;
    CONJ_BODIES.forEach((b, k) => { dirs[k]![i] = geoDir(b, t); });
  }
  for (let a = 0; a < CONJ_BODIES.length; a++) {
    for (let b = a + 1; b < CONJ_BODIES.length; b++) {
      const A = CONJ_BODIES[a]!, B = CONJ_BODIES[b]!;
      const sep = (i: number): number => angleDeg(dirs[a]![i]!, dirs[b]![i]!);
      for (let i = 1; i < n - 1; i++) {
        const s = sep(i);
        if (!(s < sep(i - 1) && s <= sep(i + 1)) || s > maxSepDeg + 1) continue;
        const f = (t: number): number => angleDeg(geoDir(A, t), geoDir(B, t));
        const ti = startMs + i * DAY_MS;
        const t = goldenMin(f, ti - DAY_MS, ti + DAY_MS, MIN_MS);
        const minSep = f(t);
        if (minSep > maxSepDeg || t < startMs || t > endMs) continue;
        const dA = geoDir(A, t), dB = geoDir(B, t);
        const mid = unit({ x: dA[0] + dB[0], y: dA[1] + dB[1], z: dA[2] + dB[2] });
        const sunSep = angleDeg(mid, geoDir(Astronomy.Body.Sun, t));
        if (sunSep < MIN_SUN_DEG) continue;
        const mA = Astronomy.Illumination(A, new Date(t)).mag, mB = Astronomy.Illumination(B, new Date(t)).mag;
        const [first, second] = mA <= mB ? [A, B] : [B, A];
        const sepText = minSep < 1 ? `${(minSep * 60).toFixed(0)}′ (${(minSep / 0.52).toFixed(1)} full-Moon widths)` : `${minSep.toFixed(1)}°`;
        out.push({
          id: `conjunction:${String(first).toLowerCase()}-${String(second).toLowerCase()}:${isoDay(t)}`, kind: 'conjunction', timeMs: t,
          title: `${first} and ${second} close together`,
          summary: `${first} and ${second} line up in our sky, ${minSep < 1 ? 'less than a degree' : `${minSep.toFixed(1)}°`} apart, though they are really hundreds of millions of kilometres from each other.`,
          local: null, headline: false, bodies: [bodyEntityId(first), bodyEntityId(second)],
          view: fromEarthView(mid, t, [bodyEntityId(first), bodyEntityId(second)]),
          facts: [
            { label: 'Separation', value: sepText },
            { label: 'Angle from the Sun', value: `${sunSep.toFixed(0)}°` },
            { label: 'Brightness', value: `${String(A)} ${fmtMag(mA)}, ${String(B)} ${fmtMag(mB)}` },
          ],
          source: EVENTS_SOURCE,
        });
      }
    }
  }
  return out;
}

// ── Seasons ───────────────────────────────────────────────────────────────────────────────

export function seasons(startMs: number, endMs: number): SkyEvent[] {
  const out: SkyEvent[] = [];
  const y0 = new Date(startMs).getUTCFullYear(), y1 = new Date(endMs).getUTCFullYear();
  for (let y = y0; y <= y1; y++) {
    const s = Astronomy.Seasons(y);
    const items: [Astronomy.AstroTime, string, string][] = [
      [s.mar_equinox, 'March equinox', 'The Sun crosses the celestial equator heading north: day and night are nearly equal everywhere, and spring begins in the northern hemisphere.'],
      [s.jun_solstice, 'June solstice', 'Earth’s north pole leans furthest toward the Sun: the longest day in the northern hemisphere and the shortest in the southern.'],
      [s.sep_equinox, 'September equinox', 'The Sun crosses the celestial equator heading south: day and night are nearly equal, and autumn begins in the northern hemisphere.'],
      [s.dec_solstice, 'December solstice', 'Earth’s south pole leans furthest toward the Sun: the shortest day in the northern hemisphere and the longest in the southern.'],
    ];
    for (const [at, title, summary] of items) {
      const t = at.date.getTime();
      if (t < startMs || t > endMs) continue;
      out.push({
        id: `season:${isoDay(t)}`, kind: 'season', timeMs: t, title, summary, local: null, headline: false,
        bodies: ['sol:earth', 'sol:sun'],
        view: { type: 'earth-season', sunDirEqj: geoDir(Astronomy.Body.Sun, t) },
        facts: [{ label: 'Axial tilt', value: '23.44°' }],
        source: EVENTS_SOURCE,
      });
    }
  }
  return out;
}

// ── Meteor showers ────────────────────────────────────────────────────────────────────────

export interface MeteorShower {
  code: string;
  name: string;
  /** Solar longitude of the peak, J2000.0 equinox, degrees. */
  peakSolarLonDeg: number;
  /** Radiant at the peak (J2000), degrees. */
  raDeg: number;
  decDeg: number;
  /** Zenithal hourly rate at the peak (ideal dark sky, radiant overhead). */
  zhr: number;
  speedKmS: number;
  parent: string;
}

/** Major annual showers (IAU MDC codes; IMO Meteor Shower Calendar values). */
export const METEOR_SHOWERS: MeteorShower[] = [
  { code: 'QUA', name: 'Quadrantids', peakSolarLonDeg: 283.15, raDeg: 230, decDeg: 49, zhr: 80, speedKmS: 41, parent: 'asteroid 2003 EH1' },
  { code: 'LYR', name: 'Lyrids', peakSolarLonDeg: 32.32, raDeg: 271, decDeg: 34, zhr: 18, speedKmS: 49, parent: 'comet C/1861 G1 (Thatcher)' },
  { code: 'ETA', name: 'Eta Aquariids', peakSolarLonDeg: 45.5, raDeg: 338, decDeg: -1, zhr: 50, speedKmS: 66, parent: 'comet 1P/Halley' },
  { code: 'SDA', name: 'Southern Delta Aquariids', peakSolarLonDeg: 127, raDeg: 340, decDeg: -16, zhr: 25, speedKmS: 41, parent: 'comet 96P/Machholz (probable)' },
  { code: 'PER', name: 'Perseids', peakSolarLonDeg: 140.0, raDeg: 48, decDeg: 58, zhr: 100, speedKmS: 59, parent: 'comet 109P/Swift–Tuttle' },
  { code: 'DRA', name: 'Draconids', peakSolarLonDeg: 195.4, raDeg: 262, decDeg: 54, zhr: 10, speedKmS: 20, parent: 'comet 21P/Giacobini–Zinner' },
  { code: 'ORI', name: 'Orionids', peakSolarLonDeg: 208, raDeg: 95, decDeg: 16, zhr: 20, speedKmS: 66, parent: 'comet 1P/Halley' },
  { code: 'LEO', name: 'Leonids', peakSolarLonDeg: 235.27, raDeg: 152, decDeg: 22, zhr: 15, speedKmS: 70, parent: 'comet 55P/Tempel–Tuttle' },
  { code: 'GEM', name: 'Geminids', peakSolarLonDeg: 262.2, raDeg: 112, decDeg: 33, zhr: 150, speedKmS: 35, parent: 'asteroid (3200) Phaethon' },
  { code: 'URS', name: 'Ursids', peakSolarLonDeg: 270.7, raDeg: 217, decDeg: 76, zhr: 10, speedKmS: 33, parent: 'comet 8P/Tuttle' },
];

/** General precession in ecliptic longitude, degrees per Julian century (IAU 2006, leading term). */
const PRECESSION_DEG_PER_CENTURY = 1.3969713;

function radecToVec(raDeg: number, decDeg: number): Vec3 {
  const ra = raDeg * DEG, dec = decDeg * DEG;
  return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
}

export function meteorShowers(startMs: number, endMs: number, observer: SkyObserver | null): SkyEvent[] {
  const out: SkyEvent[] = [];
  for (const sh of METEOR_SHOWERS) {
    let from = startMs;
    for (let guard = 0; guard < 4; guard++) {
      const T = (from - J2000_TT_MS) / (36525 * DAY_MS);
      const lonOfDate = (sh.peakSolarLonDeg + PRECESSION_DEG_PER_CENTURY * T) % 360;
      const at = Astronomy.SearchSunLongitude(lonOfDate, new Date(from), 370);
      if (!at) break;
      const t = at.date.getTime();
      if (t > endMs) break;
      const moon = moonIllumination(t);
      const pct = Math.round(moon.fraction * 100);
      const sky = moon.fraction < 0.35 ? 'dark skies, a good year' : moon.fraction < 0.75 ? 'some moonlight' : 'bright moonlight will hide the fainter meteors';
      const north = sh.decDeg >= 0;
      const lat = observer?.latDeg ?? null;
      const radiantMaxAlt = lat == null ? null : 90 - Math.abs(lat - sh.decDeg);
      out.push({
        id: `meteor-shower:${sh.code.toLowerCase()}:${isoDay(t)}`, kind: 'meteor-shower', timeMs: t,
        title: `${sh.name} meteor shower peak`,
        summary: `Earth ploughs through dust shed by ${sh.parent}; grains hit the air at ${sh.speedKmS} km/s and burn up as shooting stars, up to about ${sh.zhr} an hour under ideal skies.`,
        local: `Moon ${pct}% lit (${moon.name}): ${sky}.${radiantMaxAlt != null && radiantMaxAlt < 15 && observer ? ` The radiant stays low from ${observer.name}.` : ''}`,
        headline: false, bodies: ['sol:earth'],
        view: fromEarthView(radecToVec(sh.raDeg, sh.decDeg), t, []),
        facts: [
          { label: 'Peak rate', value: `about ${sh.zhr} per hour (ZHR)` },
          { label: 'Radiant', value: `RA ${(sh.raDeg / 15).toFixed(1)} h, Dec ${sh.decDeg >= 0 ? '+' : '−'}${Math.abs(sh.decDeg)}°${north ? '' : ' (best from the south)'}` },
          { label: 'Parent body', value: sh.parent },
          { label: 'Moon', value: `${pct}% lit` },
        ],
        source: METEOR_SOURCE,
      });
      from = t + 300 * DAY_MS;
    }
  }
  return out;
}

// ── ISS passes ────────────────────────────────────────────────────────────────────────────

/** Mean elements in CelesTrak OMM terms (the orbital domain's catalog row fields). */
export interface OmmElements {
  name: string;
  norad: number;
  epochUtc: string;
  meanMotionRevPerDay: number;
  eccentricity: number;
  inclinationDeg: number;
  raanDeg: number;
  argPerigeeDeg: number;
  meanAnomalyDeg: number;
  bstar: number;
  meanMotionDot: number;
  meanMotionDdot: number;
}

export interface SatellitePass {
  startMs: number;
  maxMs: number;
  endMs: number;
  startAzDeg: number;
  maxAzDeg: number;
  endAzDeg: number;
  maxElevationDeg: number;
  /** Estimated visual magnitude at maximum (null when the satellite is in Earth's shadow there). */
  magnitude: number | null;
  /** Sunlit satellite in a dark sky (Sun below −6°) at maximum. */
  visible: boolean;
}

export function satrecFromOmm(e: OmmElements): SatRec | null {
  try {
    return json2satrec({
      OBJECT_NAME: e.name, OBJECT_ID: '', EPOCH: e.epochUtc.replace(/Z$/, ''),
      MEAN_MOTION: e.meanMotionRevPerDay, ECCENTRICITY: e.eccentricity, INCLINATION: e.inclinationDeg,
      RA_OF_ASC_NODE: e.raanDeg, ARG_OF_PERICENTER: e.argPerigeeDeg, MEAN_ANOMALY: e.meanAnomalyDeg,
      EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: 'U', NORAD_CAT_ID: e.norad, ELEMENT_SET_NO: 999, REV_AT_EPOCH: 0,
      BSTAR: e.bstar, MEAN_MOTION_DOT: e.meanMotionDot, MEAN_MOTION_DDOT: e.meanMotionDdot,
    });
  } catch {
    return null;
  }
}

/** Element sets older than this (days, either side of the epoch) are not trusted for pass times. */
export const ISS_MAX_ELEMENT_AGE_DAYS = 14;
/** Standard magnitude of the ISS: at 1000 km range, half lit (phase angle 90°). */
export const ISS_STD_MAG = -1.8;

interface Look { az: number; el: number; rangeKm: number; satEci: Vec3; obsEci: Vec3 }

function look(rec: SatRec, tMs: number, o: SkyObserver): Look | null {
  const date = new Date(tMs);
  const pv = propagate(rec, date);
  const p = pv?.position;
  if (!p || typeof p === 'boolean' || !Number.isFinite(p.x)) return null;
  const gmst = gstime(date);
  const gd = { latitude: o.latDeg * DEG, longitude: o.lonDeg * DEG, height: o.heightM / 1000 };
  const la = ecfToLookAngles(gd, eciToEcf(p, gmst));
  const oe = ecfToEci(geodeticToEcf(gd), gmst);
  return { az: la.azimuth / DEG, el: la.elevation / DEG, rangeKm: la.rangeSat, satEci: [p.x, p.y, p.z], obsEci: [oe.x, oe.y, oe.z] };
}

/** Sunlit test (cylindrical Earth shadow) and phase-angle magnitude estimate; null in shadow. */
function passMagnitude(l: Look, sun: Vec3): number | null {
  const r = l.satEci;
  const d = dot(r, sun);
  const perp = Math.hypot(r[0] - d * sun[0], r[1] - d * sun[1], r[2] - d * sun[2]);
  if (d < 0 && perp < R_EARTH_KM) return null;
  const toObs = unit({ x: l.obsEci[0] - r[0], y: l.obsEci[1] - r[1], z: l.obsEci[2] - r[2] });
  const phi = Math.acos(Math.max(-1, Math.min(1, dot(toObs, sun))));
  const f = (Math.sin(phi) + (Math.PI - phi) * Math.cos(phi)) / Math.PI;
  const f90 = 1 / Math.PI;
  return ISS_STD_MAG + 5 * Math.log10(l.rangeKm / 1000) - 2.5 * Math.log10(Math.max(f, 1e-4) / f90);
}

/**
 * Passes of a satellite above `minElevationDeg` for the observer between startMs and endMs (30 s scan, maximum refined
 * to ~1 s). Returns { passes, stale } — stale when the window is more than ISS_MAX_ELEMENT_AGE_DAYS from the epoch.
 */
export function satellitePasses(
  elements: OmmElements, observer: SkyObserver, startMs: number, endMs: number, minElevationDeg = 10,
): { passes: SatellitePass[]; stale: boolean } {
  const epochMs = Date.parse(elements.epochUtc.endsWith('Z') ? elements.epochUtc : `${elements.epochUtc}Z`);
  const maxAge = ISS_MAX_ELEMENT_AGE_DAYS * DAY_MS;
  const from = Math.max(startMs, epochMs - maxAge), to = Math.min(endMs, epochMs + maxAge);
  const stale = !(to > from);
  const rec = satrecFromOmm(elements);
  if (stale || !rec) return { passes: [], stale };
  const STEP = 30_000;
  const passes: SatellitePass[] = [];
  let inPass = false, sMs = 0, sAz = 0;
  let prev: Look | null = null;
  for (let t = from; t <= to; t += STEP) {
    const l = look(rec, t, observer);
    if (!l) { prev = null; continue; }
    const up = l.el >= minElevationDeg;
    if (up && !inPass) { inPass = true; sMs = t; sAz = l.az; }
    if (!up && inPass) {
      inPass = false;
      const tMax = goldenMin(x => -(look(rec, x, observer)?.el ?? -90), sMs, t, 1000);
      const lm = look(rec, tMax, observer);
      if (lm && prev) {
        const sun = geoDir(Astronomy.Body.Sun, tMax);
        const mag = passMagnitude(lm, sun);
        const sunAlt = altitudeDeg(Astronomy.Body.Sun, tMax, observer);
        passes.push({
          startMs: sMs, maxMs: tMax, endMs: t - STEP, startAzDeg: sAz, maxAzDeg: lm.az, endAzDeg: prev.az,
          maxElevationDeg: lm.el, magnitude: mag, visible: mag != null && sunAlt < -6,
        });
      }
    }
    prev = l;
  }
  return { passes, stale: false };
}

/** ISS pass events (visible passes only) with "ride along" camera hints. */
export function issPassEvents(
  elements: OmmElements, observer: SkyObserver, startMs: number, days = 7,
): { events: SkyEvent[]; stale: boolean; /** Passes above 10° that are not visible (in Earth's shadow or in daylight). */ hidden: number } {
  const { passes, stale } = satellitePasses(elements, observer, startMs, startMs + days * DAY_MS, 10);
  const rec = satrecFromOmm(elements);
  const events: SkyEvent[] = [];
  for (const p of passes) {
    if (!p.visible || !rec) continue;
    const l = look(rec, p.maxMs, observer);
    if (!l) continue;
    // TEME ≈ equator of date; the < 0.4° precession offset does not matter for a camera direction.
    const dir = unit({ x: l.satEci[0] - l.obsEci[0], y: l.satEci[1] - l.obsEci[1], z: l.satEci[2] - l.obsEci[2] });
    const upv = unit({ x: l.satEci[0], y: l.satEci[1], z: l.satEci[2] });
    const bright = p.magnitude != null && p.magnitude <= -2;
    const mins = Math.max(1, Math.round((p.endMs - p.startMs) / MIN_MS));
    events.push({
      id: `iss-pass:${p.maxMs}`, kind: 'iss-pass', timeMs: p.maxMs,
      title: `${bright ? 'Bright ' : ''}ISS pass over ${observer.name}`,
      summary: `The space station crosses the sky in about ${mins} minutes, a steady sunlit point with six people aboard, 400 km up.`,
      local: `Rises in the ${compass(p.startAzDeg)}, highest ${Math.round(p.maxElevationDeg)}° in the ${compass(p.maxAzDeg)}, sets in the ${compass(p.endAzDeg)}.`,
      headline: false, bodies: ['sc:iss', 'sol:earth'],
      view: { type: 'iss', dirEqj: dir, upEqj: upv },
      facts: [
        { label: 'Highest point', value: `${Math.round(p.maxElevationDeg)}° above the ${compass(p.maxAzDeg)} horizon` },
        { label: 'Brightness', value: p.magnitude != null ? `magnitude ${fmtMag(p.magnitude)} (estimate)` : 'Unknown' },
        { label: 'Duration above 10°', value: `${mins} min` },
      ],
      source: ISS_SOURCE,
    });
  }
  return { events, stale, hidden: passes.length - events.length };
}

// ── Everything ────────────────────────────────────────────────────────────────────────────

export interface SkyEventsOptions {
  startMs: number;
  /** Window length in months (default 24). */
  months?: number;
  observer?: SkyObserver | null;
  kinds?: SkyEventKind[];
}

/** All astronomical events (not ISS passes, which need orbital elements) in the window, sorted by time. */
export function computeSkyEvents(opts: SkyEventsOptions): SkyEvent[] {
  const start = opts.startMs;
  const endDate = new Date(start);
  endDate.setUTCMonth(endDate.getUTCMonth() + (opts.months ?? 24));
  const end = endDate.getTime();
  const obs = opts.observer === undefined ? DUBAI : opts.observer;
  const want = (k: SkyEventKind): boolean => !opts.kinds || opts.kinds.includes(k);
  const all: SkyEvent[] = [];
  if (want('solar-eclipse')) all.push(...solarEclipses(start, end, obs));
  if (want('lunar-eclipse')) all.push(...lunarEclipses(start, end, obs));
  if (want('opposition')) all.push(...oppositions(start, end));
  if (want('elongation')) all.push(...elongations(start, end));
  if (want('conjunction')) all.push(...conjunctions(start, end));
  if (want('meteor-shower')) all.push(...meteorShowers(start, end, obs));
  if (want('season')) all.push(...seasons(start, end));
  return all.sort((a, b) => a.timeMs - b.timeMs);
}
