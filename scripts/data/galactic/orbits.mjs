// Keplerian sky-plane ephemeris used (a) to validate the orbital-element convention of the published
// S-star elements against the published S2 astrometry/RVs (Gillessen et al. 2017, table5), and
// (b) to document exactly how the app should turn the elements into 3D positions.
//
// Convention (visual-binary / Thiele-Innes, as used by the MPE/GRAVITY Galactic Centre group):
//   x = Δδ  (offset toward celestial North),  y = Δα·cosδ (offset toward East),  z = along the line of sight,
//   positive AWAY from the observer (so dz/dt > 0 is a positive, i.e. receding, radial velocity).
//   Ω = position angle of the ascending node, measured from North through East.
//   ω = argument of pericentre, measured from the ascending node in the direction of motion.
//   i = inclination of the orbit to the plane of the sky; i > 90° means clockwise motion on the sky.
//   The ascending node is the node at which the star moves away from the observer (z increasing).

const TWO_PI = 2 * Math.PI;
const DEG = Math.PI / 180;
export const AU_PER_YR_IN_KMS = 149597870.7 / (365.25 * 86400); // 4.740470463 km/s

export function solveKepler(M, e) {
  // returns eccentric anomaly E for mean anomaly M (rad), 0 <= e < 1
  let Mn = ((M % TWO_PI) + TWO_PI) % TWO_PI;
  let E = e < 0.8 ? Mn : Math.PI;
  for (let k = 0; k < 100; k++) {
    const f = E - e * Math.sin(E) - Mn;
    const d = f / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-14) break;
  }
  return E;
}

/** Thiele-Innes constants (dimensionless, multiply by a). */
export function thieleInnes(iDeg, OmegaDeg, omegaDeg) {
  const i = iDeg * DEG, O = OmegaDeg * DEG, w = omegaDeg * DEG;
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(i), si = Math.sin(i);
  return {
    A: cw * cO - sw * sO * ci,
    B: cw * sO + sw * cO * ci,
    F: -sw * cO - cw * sO * ci,
    G: -sw * sO + cw * cO * ci,
    C: sw * si,
    H: cw * si,
  };
}

/**
 * Position/velocity of a star at decimal-year t.
 * el = {aMas, e, iDeg, OmegaDeg, omegaDeg, tPeriYr, periodYr}; R0pc needed only for the radial velocity.
 * Returns {decOffMas (North), raOffMas (East, = Δα cosδ), zMas (away from observer), rvKms (receding positive), rMas}.
 */
export function ephemeris(el, t, R0pc = null) {
  const { aMas, e, iDeg, OmegaDeg, omegaDeg, tPeriYr, periodYr } = el;
  const n = TWO_PI / periodYr; // rad / yr
  const E = solveKepler(n * (t - tPeriYr), e);
  const X = Math.cos(E) - e;
  const Y = Math.sqrt(1 - e * e) * Math.sin(E);
  const ti = thieleInnes(iDeg, OmegaDeg, omegaDeg);
  const decOffMas = aMas * (ti.A * X + ti.F * Y);
  const raOffMas = aMas * (ti.B * X + ti.G * Y);
  const zMas = aMas * (ti.C * X + ti.H * Y);
  let rvKms = null;
  if (R0pc) {
    const Edot = n / (1 - e * Math.cos(E)); // rad/yr
    const dX = -Math.sin(E) * Edot, dY = Math.sqrt(1 - e * e) * Math.cos(E) * Edot; // 1/yr
    const aAU = (aMas / 1000) * R0pc; // arcsec * pc = AU
    rvKms = aAU * (ti.C * dX + ti.H * dY) * AU_PER_YR_IN_KMS;
  }
  return { decOffMas, raOffMas, zMas, rvKms, rMas: Math.hypot(decOffMas, raOffMas, zMas) };
}

/** Kepler's third law mass in solar masses from a [mas], R0 [pc], P [yr]: M = (a_AU)^3 / P^2. */
export function keplerMassMsun(aMas, R0pc, periodYr) {
  const aAU = (aMas / 1000) * R0pc;
  return aAU ** 3 / periodYr ** 2;
}

/** decimal year (Julian-epoch convention) -> Julian Date */
export function decimalYearToJD(y) { return 2451545.0 + (y - 2000.0) * 365.25; }
