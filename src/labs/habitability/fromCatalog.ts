/**
 * Habitability lab inputs from the NASA Exoplanet Archive catalogue (pure): a planet row → HabInputs, filling unknowns
 * with documented estimates (mass ↔ radius from Chen & Kipping 2017, luminosity from R and Teff, distance from Kepler's
 * third law). Returns which values were estimated so the panel can label them.
 */
import { AU_M, G_SI as G, L_SUN_W, M_SUN_KG, R_SUN_M, SIGMA_SB } from '../../core/units';
import type { ExoCatalog } from '../../domains/exoplanets/catalog';
import { M_JUP_EARTH, massFromRadiusEarth, radiusFromMassEarth } from '../../domains/exoplanets/physics';
import type { HabInputs } from './model';

export interface CatalogInputs {
  inputs: HabInputs;
  planetName: string;
  hostName: string;
  /** Inputs that are estimates rather than archive values. */
  estimated: Array<'radius' | 'mass' | 'distance' | 'luminosity' | 'teff' | 'starMass'>;
  /** Archive equilibrium temperature, K (null = not in the archive). */
  archiveTeqK: number | null;
}

const fin = (x: number): boolean => Number.isFinite(x) && x > 0;

/** Default climate knobs for an exoplanet preset: Earth-like albedo and greenhouse (clearly labelled as assumptions). */
export const EXO_DEFAULT_CLIMATE = { albedo: 0.3, greenhouseK: 33, redistribution: 'full' as const };

export function inputsFromCatalog(c: ExoCatalog, planet: number): CatalogInputs | null {
  const P = c.planets;
  const H = c.hosts;
  if (!(planet >= 0 && planet < P.count)) return null;
  const host = P.host[planet];
  const estimated: CatalogInputs['estimated'] = [];
  let teff = host >= 0 ? H.teffK[host] : NaN;
  if (!fin(teff)) {
    teff = 5772;
    estimated.push('teff');
  }
  let lum = host >= 0 && Number.isFinite(H.logLum[host]) ? 10 ** H.logLum[host] : NaN;
  if (!fin(lum)) {
    const rs = host >= 0 && fin(H.radiusSun[host]) ? H.radiusSun[host] * R_SUN_M : R_SUN_M;
    lum = (4 * Math.PI * rs * rs * SIGMA_SB * teff ** 4) / L_SUN_W;
    estimated.push('luminosity');
  }
  const mStar = host >= 0 && fin(H.massSun[host]) ? H.massSun[host] : null;
  if (mStar == null) estimated.push('starMass');
  let r = P.radiusE[planet];
  let m = P.massE[planet];
  if (!fin(r) && fin(m)) {
    r = radiusFromMassEarth(m);
    estimated.push('radius');
  } else if (fin(r) && !fin(m)) {
    // The mass–radius relation is degenerate for giants (R ≳ 14 R⊕): assume one Jupiter mass there.
    m = massFromRadiusEarth(r);
    if (!fin(m)) m = M_JUP_EARTH;
    estimated.push('mass');
  } else if (!fin(r) && !fin(m)) {
    r = 1;
    m = 1;
    estimated.push('radius', 'mass');
  }
  if (P.massProv[planet] === 4 && !estimated.includes('mass')) estimated.push('mass');
  // Radius computed by the archive from the mass (e.g. Proxima b, an RV planet): an estimate, not a measurement.
  if (P.calc[planet] & 1 && !estimated.includes('radius')) estimated.push('radius');
  let a = P.aAu[planet];
  if (!fin(a)) {
    const per = P.periodDays[planet];
    if (fin(per) && mStar != null) {
      const t = per * 86400;
      a = Math.cbrt((G * mStar * M_SUN_KG * t * t) / (4 * Math.PI * Math.PI)) / AU_M;
    } else if (fin(P.insolE[planet])) {
      a = Math.sqrt(lum / P.insolE[planet]);
    } else a = 1;
    estimated.push('distance');
  }
  const teq = P.eqtK[planet];
  return {
    inputs: { starTeffK: teff, starLum: lum, starMass: mStar, distanceAu: a, radiusE: r, massE: m, ...EXO_DEFAULT_CLIMATE },
    planetName: P.name[planet],
    hostName: host >= 0 ? H.name[host] : '',
    estimated,
    archiveTeqK: fin(teq) ? teq : null,
  };
}
