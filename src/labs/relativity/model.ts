/**
 * Black hole lab model (LabId 'relativity'): pure functions over the tested relativity helpers (src/science/relativity.ts)
 * and the Sgr A* / S2 values used by the galaxy domain (src/domains/galaxy/model.ts). No DOM, no three.js.
 */
import { AU_M, C_M_PER_S, G_SI, PC_M } from '../../core/units';
import {
  circularOrbitTimeDilation, gravitationalRedshift, iscoRadiusM, photonSphereRadiusM, schwarzschildRadiusM, shadowRadiusM,
  staticObserverTimeDilation,
} from '../../science/relativity';
import {
  EHT_RING_ERR_UAS, EHT_RING_UAS, MSUN_KG, R0_PC, S2_GRAVITY2020, SGRA_MASS_ERR_MSUN, SGRA_MASS_MSUN, metresPerMas,
  nextPericentreYr, orbitExtremes, schwarzschildPrecessionRad,
} from '../../domains/galaxy/model';

export { MSUN_KG };

export const SRC = {
  gravity2024: 'GRAVITY Collaboration 2024, A&A 692, A242 (mass, R₀)',
  gravity2020: 'GRAVITY Collaboration 2020, A&A 636, L5 (S2 orbit, precession)',
  gravity2018: 'GRAVITY Collaboration 2018, A&A 615, L15 (S2 redshift)',
  gillessen2017: 'Gillessen et al. 2017, ApJ 837, 30 (S-star orbits)',
  eht2022: 'Event Horizon Telescope Collaboration 2022, ApJL 930, L12 (Sgr A* ring)',
  eht2019: 'Event Horizon Telescope Collaboration 2019, ApJL 875, L1 (M87*)',
} as const;

export interface Preset { id: string; label: string; massMsun: number; distancePc: number | null; source: string }

export const PRESETS: readonly Preset[] = [
  { id: 'sgra', label: 'Sgr A*', massMsun: SGRA_MASS_MSUN, distancePc: R0_PC, source: SRC.gravity2024 },
  { id: 'm87', label: 'M87*', massMsun: 6.5e9, distancePc: 16.8e6, source: SRC.eht2019 },
  { id: 'cygx1', label: 'Cygnus X-1', massMsun: 21.2, distancePc: 2220, source: 'Miller-Jones et al. 2021, Science 371, 1046' },
];

export const SGRA = {
  massMsun: SGRA_MASS_MSUN,
  massErrMsun: SGRA_MASS_ERR_MSUN,
  distancePc: R0_PC,
  ehtRingUas: EHT_RING_UAS,
  ehtRingErrUas: EHT_RING_ERR_UAS,
} as const;

/** Angular size (µas) of a length at a distance. */
export const microArcsec = (lengthM: number, distanceM: number): number => (lengthM / distanceM) * 206264.806247e6;

export interface BlackHoleNumbers {
  massKg: number;
  rsM: number;
  photonSphereM: number;
  iscoM: number;
  /** Shadow (critical curve) diameter, m: 2·(3√3/2) r_s. */
  shadowDiameterM: number;
  /** Shadow diameter seen from the distance (µas) or null. */
  shadowUas: number | null;
  /** Mean density inside r_s (kg/m³) - drops as 1/M². */
  meanDensityKgM3: number;
  /** Radial tidal stretch across 2 m at the horizon (m/s²). */
  tidalAtHorizonMS2: number;
  /** Light-crossing time of r_s (s). */
  lightCrossS: number;
}

export function blackHole(massMsun: number, distancePc: number | null): BlackHoleNumbers {
  const massKg = massMsun * MSUN_KG;
  const rsM = schwarzschildRadiusM(massKg);
  const shadowDiameterM = 2 * shadowRadiusM(rsM);
  return {
    massKg,
    rsM,
    photonSphereM: photonSphereRadiusM(rsM),
    iscoM: iscoRadiusM(rsM),
    shadowDiameterM,
    shadowUas: distancePc ? microArcsec(shadowDiameterM, distancePc * PC_M) : null,
    meanDensityKgM3: massKg / ((4 / 3) * Math.PI * rsM ** 3),
    tidalAtHorizonMS2: (2 * G_SI * massKg * 2) / rsM ** 3,
    lightCrossS: rsM / C_M_PER_S,
  };
}

export interface ClockAt {
  /** Static (hovering) clock rate dτ/dt. */
  staticRate: number;
  /** Circular-orbit clock rate (NaN inside 1.5 r_s). */
  orbitRate: number;
  /** Gravitational redshift z of light from a hovering source. */
  redshift: number;
  /** Seconds that pass on the hovering clock while one year passes far away. */
  secondsPerFarYear: number;
}

const YEAR_S = 365.25 * 86400;

export function clockAt(rOverRs: number, rsM: number): ClockAt {
  const r = rOverRs * rsM;
  const staticRate = staticObserverTimeDilation(r, rsM);
  return {
    staticRate,
    orbitRate: circularOrbitTimeDilation(r, rsM),
    redshift: gravitationalRedshift(r, rsM),
    secondsPerFarYear: staticRate * YEAR_S,
  };
}

/** Curve of dτ/dt for a hovering clock and an orbiting clock vs r/r_s (log-spaced, from 1.0005 to maxX). */
export function dilationCurve(n: number, maxX: number): { x: number[]; hover: number[]; orbit: number[] } {
  const x: number[] = [], hover: number[] = [], orbit: number[] = [];
  const lo = Math.log10(1.0005), hi = Math.log10(maxX);
  for (let i = 0; i < n; i++) {
    const xi = 10 ** (lo + ((hi - lo) * i) / (n - 1));
    x.push(xi);
    hover.push(Math.sqrt(1 - 1 / xi));
    orbit.push(xi > 1.5 ? Math.sqrt(1 - 1.5 / xi) : NaN);
  }
  return { x, hover, orbit };
}

/**
 * Radial free fall from rest at r0 (Schwarzschild, units of r_s and r_s/c). Returns samples of far-away coordinate time t,
 * the clock's proper time τ and radius r. Integrated in τ (finite at the horizon): dr/dτ = −√(1/r − 1/r0),
 * dt/dτ = √(1 − 1/r0)/(1 − 1/r). Stops at r = 1 + 1e-4 (the far observer never sees the crossing: t → ∞).
 */
export interface FallSample { t: number; tau: number; r: number }

export function freeFall(r0: number, maxSamples = 2000): FallSample[] {
  const out: FallSample[] = [{ t: 0, tau: 0, r: r0 }];
  if (!(r0 > 1)) return out;
  const E = Math.sqrt(1 - 1 / r0);
  // Proper time from rest at r0 to r = 0: τ = (π/2)·r0^{3/2} (r_s = 1, c = 1, so GM = 1/2). Parametrise with the cycloid
  // r = r0·cos²(η/2), τ = (r0^{3/2}/2)(η + sin η) - exact, so no integration error accumulates in r or τ.
  const k = r0 ** 1.5 / 2;
  const etaH = 2 * Math.acos(Math.sqrt(1.0001 / r0));
  let t = 0, prevTau = 0, prevR = r0;
  for (let i = 1; i <= maxSamples; i++) {
    const eta = etaH * (1 - (1 - i / maxSamples) ** 2);
    const r = r0 * Math.cos(eta / 2) ** 2;
    const tau = k * (eta + Math.sin(eta));
    // dt = E/(1 − 1/r) dτ (trapezoid on the step; t diverges logarithmically at the horizon).
    t += 0.5 * (tau - prevTau) * (E / (1 - 1 / prevR) + E / (1 - 1 / r));
    out.push({ t, tau, r });
    prevTau = tau; prevR = r;
  }
  return out;
}

export interface S2Numbers {
  periodYr: number;
  e: number;
  periAu: number;
  apoAu: number;
  periLightHours: number;
  periOverRs: number;
  vPeriKmS: number;
  vPeriFracC: number;
  /** Gravitational + transverse-Doppler redshift at pericentre (km/s equivalent), first-order: (r_s/2r + v²/2c²)·c. */
  periRedshiftKmS: number;
  precessionArcminPerOrbit: number;
  lastPeriYr: number;
  nextPeriYr: number;
}

export function s2Numbers(massMsun = SGRA_MASS_MSUN, r0Pc = R0_PC, fromYr = 2026.8): S2Numbers {
  const el = S2_GRAVITY2020;
  const massKg = massMsun * MSUN_KG;
  const ex = orbitExtremes(el.aMas, el.e, r0Pc, massKg);
  const rs = schwarzschildRadiusM(massKg);
  const rp = ex.periAu * AU_M;
  const v = ex.vPeriKmS * 1000;
  const zKmS = (rs / (2 * rp) + (v * v) / (2 * C_M_PER_S * C_M_PER_S)) * C_M_PER_S / 1000;
  const next = nextPericentreYr(el, fromYr) ?? NaN;
  return {
    periodYr: el.periodYr ?? NaN,
    e: el.e,
    periAu: ex.periAu,
    apoAu: ex.apoAu,
    periLightHours: rp / C_M_PER_S / 3600,
    periOverRs: rp / rs,
    vPeriKmS: ex.vPeriKmS,
    vPeriFracC: v / C_M_PER_S,
    periRedshiftKmS: zKmS,
    precessionArcminPerOrbit: (schwarzschildPrecessionRad(ex.aM, el.e, massKg) * 180 * 60) / Math.PI,
    lastPeriYr: next - (el.periodYr ?? NaN),
    nextPeriYr: next,
  };
}

/** S2's orbit in its own plane (units of a; focus at origin, pericentre along +x) for n points, plus the rosette after k orbits. */
export function orbitPlanePath(e: number, n: number, rotationRad = 0): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const c = Math.cos(rotationRad), s = Math.sin(rotationRad);
  for (let i = 0; i <= n; i++) {
    const nu = (2 * Math.PI * i) / n;
    const r = (1 - e * e) / (1 + e * Math.cos(nu));
    const x = r * Math.cos(nu), y = r * Math.sin(nu);
    pts.push([x * c - y * s, x * s + y * c]);
  }
  return pts;
}

/** Position along the orbit (units of a, focus at origin) at a fraction of the period since pericentre. */
export function orbitPlaneAt(e: number, phase: number): { x: number; y: number; r: number; v: number } {
  const M = 2 * Math.PI * (((phase % 1) + 1) % 1);
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 40; k++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  const x = Math.cos(E) - e, y = Math.sqrt(1 - e * e) * Math.sin(E);
  const r = 1 - e * Math.cos(E);
  // Speed in units of the mean motion × a: v = √(2/r − 1) (vis-viva with GM = 1, a = 1).
  return { x, y, r, v: Math.sqrt(2 / r - 1) };
}

/** Milliarcseconds → AU at R0. */
export const masToAu = (mas: number, r0Pc = R0_PC): number => (mas * metresPerMas(r0Pc)) / AU_M;
