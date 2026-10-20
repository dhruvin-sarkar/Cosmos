/**
 * Black-hole physics helpers shared by the black-hole renderer, the black-holes domain (fact sheets, approach readout)
 * and tests. SI units unless a name says otherwise; "M" units are gravitational radii GM/c², "rs" units Schwarzschild
 * radii 2GM/c². Pure functions, no allocation-heavy work.
 *
 * Sources: Schwarzschild radius, photon sphere and shadow (critical impact parameter √27 GM/c²): Misner, Thorne &
 * Wheeler 1973, ch. 25. ISCO, horizon and photon orbits in Kerr: Bardeen, Press & Teukolsky 1972, ApJ 178, 347.
 * Thin-disc temperature: Shakura & Sunyaev 1973, A&A 24, 337; Novikov & Thorne 1973 (zero-torque inner edge).
 * Eddington luminosity: Rybicki & Lightman 1979, §1.4.
 */

export const G = 6.6743e-11;
export const C = 299_792_458;
/** Nominal solar mass parameter GM☉ (IAU 2015 Resolution B3), m³ s⁻². */
export const GM_SUN = 1.3271244e20;
export const M_SUN_KG = GM_SUN / G;
export const SIGMA_SB = 5.670374419e-8;
export const PC_M = 3.0856775814913673e16;
export const AU_M = 1.495978707e11;
export const R_SUN_M = 6.957e8;
export const YEAR_S = 365.25 * 86400;
const SIGMA_T = 6.6524587321e-29;
const M_P = 1.67262192369e-27;
/** Standard gravity, for tidal readouts in g. */
export const G0 = 9.80665;

/** Schwarzschild radius 2GM/c², metres. */
export function schwarzschildRadiusM(massMsun: number): number {
  return (2 * GM_SUN * massMsun) / (C * C);
}

/** Gravitational radius GM/c², metres. */
export function gravitationalRadiusM(massMsun: number): number {
  return (GM_SUN * massMsun) / (C * C);
}

/** Clamp a dimensionless spin to the physical range (|a*| < 1; 0.9999 keeps formulas finite). */
export function clampSpin(a: number | null | undefined): number {
  if (a == null || !Number.isFinite(a)) return 0;
  return Math.max(-0.9999, Math.min(0.9999, a));
}

/** Outer event horizon r₊ = M(1 + √(1 − a²)), in M units. */
export function horizonRadiusM(spin: number): number {
  const a = clampSpin(spin);
  return 1 + Math.sqrt(1 - a * a);
}

/**
 * Innermost stable circular orbit (Bardeen, Press & Teukolsky 1972), in M units. Positive spin = prograde disc
 * (6 M for a = 0, → 1 M as a → 1); negative = retrograde (→ 9 M).
 */
export function iscoRadiusM(spin: number): number {
  const a = clampSpin(spin);
  const z1 = 1 + Math.cbrt(1 - a * a) * (Math.cbrt(1 + a) + Math.cbrt(1 - a));
  const z2 = Math.sqrt(3 * a * a + z1 * z1);
  const s = Math.sqrt((3 - z1) * (3 + z1 + 2 * z2));
  return 3 + z2 - Math.sign(a || 1) * s;
}

/** Circular photon orbit radius (prograde for a ≥ 0), M units: 2M{1 + cos[(2/3) arccos(−a)]}; 3 M for a = 0. */
export function photonOrbitRadiusM(spin: number): number {
  const a = clampSpin(spin);
  return 2 * (1 + Math.cos((2 / 3) * Math.acos(-a)));
}

/** Schwarzschild critical impact parameter (shadow radius seen from far away), M units: √27 ≈ 5.196. */
export const SHADOW_RADIUS_M = Math.sqrt(27);

/** Radiative efficiency of a thin disc, 1 − E_isco with E_isco = √(1 − 2/(3 r_isco)). 5.7 % at a = 0, 32 % at a = 0.998. */
export function radiativeEfficiency(spin: number): number {
  const r = iscoRadiusM(spin);
  return 1 - Math.sqrt(1 - 2 / (3 * r));
}

/** Angular diameter (µas) of the shadow of a black hole of mass M seen from distance D (Schwarzschild; Kerr within ~4 %). */
export function shadowDiameterMicroarcsec(massMsun: number, distanceM: number): number {
  const d = 2 * SHADOW_RADIUS_M * gravitationalRadiusM(massMsun);
  return (d / distanceM) * 206264.806247e6;
}

/** Eddington luminosity 4πGMm_p c/σ_T, watts. */
export function eddingtonLuminosityW(massMsun: number): number {
  return (4 * Math.PI * GM_SUN * massMsun * M_P * C) / SIGMA_T;
}

/** Shakura–Sunyaev / Novikov–Thorne temperature profile shape: (r_in/r)^{3/4} (1 − √(r_in/r))^{1/4}; peak 0.488 at r = 49/36 r_in. */
export function thinDiscProfile(rOverRin: number): number {
  if (!(rOverRin > 1)) return 0;
  const x = 1 / rOverRin;
  return Math.pow(x, 0.75) * Math.pow(1 - Math.sqrt(x), 0.25);
}
export const THIN_DISC_PROFILE_PEAK = thinDiscProfile(49 / 36);

/**
 * Peak effective temperature (K) of a thin disc around a black hole of mass M accreting at `eddingtonFraction` of the
 * Eddington rate, inner edge at the ISCO: T = [3GMṀ / (8πσ r_in³)]^{1/4} × 0.488.
 */
export function discPeakTemperatureK(massMsun: number, eddingtonFraction: number, spin = 0): number {
  const eta = radiativeEfficiency(spin);
  const mdot = (eddingtonFraction * eddingtonLuminosityW(massMsun)) / (eta * C * C);
  const rin = iscoRadiusM(spin) * gravitationalRadiusM(massMsun);
  const base = (3 * GM_SUN * massMsun * mdot) / (8 * Math.PI * SIGMA_SB * rin ** 3);
  return Math.pow(base, 0.25) * THIN_DISC_PROFILE_PEAK;
}

/** Proper-time rate dτ/dt of a static observer at r (rs units, > 1): √(1 − 1/r). 0 at or inside the horizon. */
export function staticTimeRate(rOverRs: number): number {
  return rOverRs > 1 ? Math.sqrt(1 - 1 / rOverRs) : 0;
}

/** Proper-time rate on a circular geodesic orbit (r > 1.5 rs): √(1 − 3/(2r)); null inside the photon sphere. */
export function orbitTimeRate(rOverRs: number): number | null {
  return rOverRs > 1.5 ? Math.sqrt(1 - 1.5 / rOverRs) : null;
}

/** Gravitational redshift z of light climbing from r (rs units) to infinity; Infinity at the horizon. */
export function gravitationalRedshift(rOverRs: number): number {
  return rOverRs > 1 ? 1 / Math.sqrt(1 - 1 / rOverRs) - 1 : Infinity;
}

/** Newtonian tidal stretching acceleration 2GM·L/r³ (m s⁻²) across a body of length L at distance r (m). */
export function tidalAcceleration(massMsun: number, rM: number, lengthM = 2): number {
  return (2 * GM_SUN * massMsun * lengthM) / (rM * rM * rM);
}

/** Distance (m) at which a body of length L feels a tidal stretch of `accel` (default 10 g; "spaghettification"). */
export function spaghettificationRadiusM(massMsun: number, lengthM = 2, accel = 10 * G0): number {
  return Math.cbrt((2 * GM_SUN * massMsun * lengthM) / accel);
}

/** Orbital speed (fraction of c) of a circular geodesic seen by a static observer, Schwarzschild: √(1/(2(r − 1))) in rs units. */
export function circularOrbitBeta(rOverRs: number): number {
  return rOverRs > 1.5 ? Math.sqrt(1 / (2 * (rOverRs - 1))) : 1;
}

/**
 * Observed/emitted frequency ratio g for disc gas on a circular orbit at r (rs units) moving with speed β at angle
 * cosθ between its velocity and the photon direction to the observer: g = √(1 − 1/r) / (γ(1 − β cosθ)).
 * Observed intensity scales as g⁴ (bolometric: I_ν/ν³ invariant, integrated over frequency).
 */
export function discRedshiftFactor(rOverRs: number, cosTheta: number): number {
  const beta = circularOrbitBeta(rOverRs);
  const gamma = 1 / Math.sqrt(Math.max(1e-9, 1 - beta * beta));
  return Math.sqrt(Math.max(0, 1 - 1 / rOverRs)) / (gamma * (1 - beta * cosTheta));
}

/** Relativistic Doppler factor δ = 1/(γ(1 − β cosθ)) of a jet moving at β with angle θ to the line of sight. */
export function dopplerFactor(beta: number, cosTheta: number): number {
  const gamma = 1 / Math.sqrt(Math.max(1e-12, 1 - beta * beta));
  return 1 / (gamma * (1 - beta * cosTheta));
}

/** Apparent transverse speed (units of c) of a jet blob: β sinθ / (1 − β cosθ); superluminal for fast jets near the line of sight. */
export function apparentSpeed(beta: number, thetaRad: number): number {
  return (beta * Math.sin(thetaRad)) / (1 - beta * Math.cos(thetaRad));
}

/** Einstein radius (rad) for a lens of mass M at D_l and a source at D_s (D_ls = D_s − D_l); source at infinity when D_s = ∞. */
export function einsteinRadiusRad(massMsun: number, dLensM: number, dSourceM = Infinity): number {
  const rs = schwarzschildRadiusM(massMsun);
  const ratio = Number.isFinite(dSourceM) ? (dSourceM - dLensM) / dSourceM : 1;
  return Math.sqrt((2 * rs * ratio) / dLensM);
}

/** Weak-field light deflection 4GM/(c²b) = 2 r_s/b, radians. */
export function weakDeflectionRad(massMsun: number, impactM: number): number {
  return (2 * schwarzschildRadiusM(massMsun)) / impactM;
}

/** Eggleton (1983, ApJ 268, 368) Roche-lobe radius / separation for the body of mass ratio q = M_this/M_other. */
export function rocheLobeFraction(q: number): number {
  const q23 = Math.cbrt(q * q);
  return (0.49 * q23) / (0.6 * q23 + Math.log(1 + Math.cbrt(q)));
}

/** Kepler's third law: semi-major axis (m) of a binary of total mass (M☉) and period (days). */
export function binarySeparationM(totalMsun: number, periodDays: number): number {
  const p = periodDays * 86400;
  return Math.cbrt((GM_SUN * totalMsun * p * p) / (4 * Math.PI * Math.PI));
}

/** Solve Kepler's equation M = E − e sin E (radians) by Newton iteration. */
export function solveKepler(meanAnomaly: number, e: number): number {
  const m = meanAnomaly - 2 * Math.PI * Math.floor(meanAnomaly / (2 * Math.PI));
  let E = e < 0.8 ? m : Math.PI;
  for (let i = 0; i < 12; i++) {
    const d = (E - e * Math.sin(E) - m) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  return E;
}

export interface ApproachReadout {
  /** Distance from the centre in Schwarzschild radii. */
  rOverRs: number;
  /** dτ/dt for a hovering (static) observer; 0 inside the horizon. */
  clockRate: number;
  /** Seconds that pass far away per second on your clock (1/clockRate); Infinity at the horizon. */
  farSecondsPerSecond: number;
  /** Gravitational redshift z of light sent out from here. */
  redshiftZ: number;
  /** Tidal stretch across a 2 m body, m s⁻². */
  tidalMs2: number;
  /** Inside the event horizon. */
  inside: boolean;
}

/** Everything the approach readout shows, for a camera at `rM` metres from a black hole of `massMsun`. */
export function approachReadout(massMsun: number, rM: number): ApproachReadout {
  const rs = schwarzschildRadiusM(massMsun);
  const x = rM / rs;
  const rate = staticTimeRate(x);
  return {
    rOverRs: x,
    clockRate: rate,
    farSecondsPerSecond: rate > 0 ? 1 / rate : Infinity,
    redshiftZ: gravitationalRedshift(x),
    tidalMs2: tidalAcceleration(massMsun, Math.max(rM, 1), 2),
    inside: x <= 1,
  };
}
