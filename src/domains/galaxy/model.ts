/**
 * Milky Way model: the Galactocentric frame, the Reid et al. (2019) spiral arms, the stellar/dust density model and
 * the S-star Kepler orbits around Sagittarius A*. Pure functions (no three.js scene objects), shared by the layers, the
 * entities, the black-hole lab and the tests.
 *
 * Sources (full citations in public/data/galactic/milkyway.json and sgra.json `references`):
 *  - R0 = 8275.9 ± 8.6 pc, M(Sgr A*) = 4.2996e6 Msun: GRAVITY Collaboration 2024, A&A 692, A242.
 *  - z_sun = 20.8 ± 0.3 pc: Bennett & Bovy 2019, MNRAS 482, 1417.
 *  - Sgr A* ICRS position: SIMBAD (landmarks.json).
 *  - Spiral arms: Reid et al. 2019, ApJ 885, 131, Table 2 (log-spirals with a kink).
 *  - Bar: Wegg et al. 2015 (half-length 5 kpc), Portail et al. 2017 (28° to the Sun-GC line, near end at l > 0).
 *  - Discs: Bland-Hawthorn & Gerhard 2016 (thin 2.6 kpc / 300 pc, thick 2.0 kpc / 900 pc).
 *  - Dust: Drimmel & Spergel 2001 (scale length 2.26 kpc, sech² height 134.4 pc).
 *  - S-stars: GRAVITY 2020 (S2) and Gillessen et al. 2017 (40 stars), visual-binary (Thiele-Innes) convention.
 *
 * Galactocentric frame (kpc): origin at Sgr A*, +X from the Sun toward the Galactic Centre (Sun at X ≈ −R0), +Y toward
 * Galactic longitude 90° (the direction of rotation at the Sun), +Z toward the North Galactic Pole. The frame is tilted so
 * that the Sun sits z_sun above the mid-plane (as in astropy's Galactocentric frame).
 */
import { GALACTIC_NORTH_POLE_ICRS, raDecDistToIcrs } from '../../core/frames';
import { AU_M, C_M_PER_S, G_SI, JULIAN_YEAR_S, KPC_M, PC_M } from '../../core/units';

export const DEG = Math.PI / 180;
const TAU = 2 * Math.PI;

// ── Adopted constants (each cross-checked against public/data/galactic/*.json in galaxy.test.ts) ─────────────────────

/** Sun – Sgr A* distance, pc (GRAVITY 2024). */
export const R0_PC = 8275.9;
/** Height of the Sun above the Galactic mid-plane, pc (Bennett & Bovy 2019). */
export const Z_SUN_PC = 20.8;
/** Sgr A* ICRS position (SIMBAD). */
export const SGRA_RA_DEG = 266.416817;
export const SGRA_DEC_DEG = -29.007825;
/** Sgr A* mass, solar masses (GRAVITY 2024). */
export const SGRA_MASS_MSUN = 4.2996e6;
export const SGRA_MASS_ERR_MSUN = 1.18e4;
/** Nominal solar mass parameter → kg (IAU 2015 B3 GM_sun / G). */
export const MSUN_KG = 1.3271244e20 / G_SI;
export const SGRA_MASS_KG = SGRA_MASS_MSUN * MSUN_KG;
/** Schwarzschild radius of Sgr A*, m (≈ 1.27e10 m ≈ 0.085 AU). */
export const SGRA_RS_M = (2 * G_SI * SGRA_MASS_KG) / (C_M_PER_S * C_M_PER_S);
/** EHT 2022 Paper I ring diameter, µas (51.8 ± 2.3). */
export const EHT_RING_UAS = 51.8;
export const EHT_RING_ERR_UAS = 2.3;
/** Bar: half-length (kpc), angle between the bar major axis and the Sun-GC line (deg), near end at l > 0. */
export const BAR_HALF_LENGTH_KPC = 5;
export const BAR_ANGLE_DEG = 28;
/** Disc structure (kpc). */
export const THIN_SCALE_LENGTH_KPC = 2.6;
export const THIN_SCALE_HEIGHT_KPC = 0.3;
export const THICK_SCALE_LENGTH_KPC = 2.0;
export const THICK_SCALE_HEIGHT_KPC = 0.9;
export const DUST_SCALE_LENGTH_KPC = 2.26;
export const DUST_SCALE_HEIGHT_KPC = 0.1344;

// ── Galactocentric frame ──────────────────────────────────────────────────────────────────────────────────────────────

export interface V3 { x: number; y: number; z: number }

export interface GalacticFrame {
  /** Sgr A* world position (ICRS, metres, from the SSB ≈ Sun). */
  origin: V3;
  /** Galactocentric unit axes expressed in ICRS. */
  ex: V3;
  ey: V3;
  ez: V3;
  /** Sun position in Galactocentric kpc. */
  sunKpc: V3;
}

const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const norm = (a: V3): V3 => { const l = Math.hypot(a.x, a.y, a.z); return { x: a.x / l, y: a.y / l, z: a.z / l }; };
const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

export function buildGalacticFrame(r0Pc = R0_PC, zSunPc = Z_SUN_PC): GalacticFrame {
  const origin = raDecDistToIcrs(SGRA_RA_DEG, SGRA_DEC_DEG, r0Pc * PC_M, { x: 0, y: 0, z: 0 });
  const ex0 = norm(origin);
  const ngp = GALACTIC_NORTH_POLE_ICRS;
  const k = dot(ngp, ex0);
  const ezOrth = norm({ x: ngp.x - k * ex0.x, y: ngp.y - k * ex0.y, z: ngp.z - k * ex0.z });
  const s = zSunPc / r0Pc, c = Math.sqrt(1 - s * s);
  const ez = norm({ x: c * ezOrth.x - s * ex0.x, y: c * ezOrth.y - s * ex0.y, z: c * ezOrth.z - s * ex0.z });
  const kk = dot(ex0, ez);
  const ex = norm({ x: ex0.x - kk * ez.x, y: ex0.y - kk * ez.y, z: ex0.z - kk * ez.z });
  const ey = cross(ez, ex);
  const frame: GalacticFrame = { origin, ex, ey, ez, sunKpc: { x: 0, y: 0, z: 0 } };
  worldToGalKpc(frame, { x: 0, y: 0, z: 0 }, frame.sunKpc);
  return frame;
}

/** Galactocentric kpc → world metres (ICRS from the SSB). */
export function galKpcToWorld<T extends V3>(f: GalacticFrame, x: number, y: number, z: number, out: T): T {
  out.x = f.origin.x + (x * f.ex.x + y * f.ey.x + z * f.ez.x) * KPC_M;
  out.y = f.origin.y + (x * f.ex.y + y * f.ey.y + z * f.ez.y) * KPC_M;
  out.z = f.origin.z + (x * f.ex.z + y * f.ey.z + z * f.ez.z) * KPC_M;
  return out;
}

/** World metres → Galactocentric kpc. */
export function worldToGalKpc<T extends V3>(f: GalacticFrame, w: V3, out: T): T {
  const dx = w.x - f.origin.x, dy = w.y - f.origin.y, dz = w.z - f.origin.z;
  out.x = (dx * f.ex.x + dy * f.ex.y + dz * f.ex.z) / KPC_M;
  out.y = (dx * f.ey.x + dy * f.ey.y + dz * f.ey.z) / KPC_M;
  out.z = (dx * f.ez.x + dy * f.ez.y + dz * f.ez.z) / KPC_M;
  return out;
}

/** Heliocentric Galactic Cartesian (pc; x → GC, y → l = 90°, z → NGP, as in landmarks.json xyzHelioPc) → Galactocentric kpc. */
export function helioGalPcToGalKpc<T extends V3>(f: GalacticFrame, xyzPc: readonly number[], out: T): T {
  // Heliocentric Galactic axes are the untilted (l, b) axes; convert via ICRS to keep one source of truth.
  const lx = xyzPc[0]! * PC_M, ly = xyzPc[1]! * PC_M, lz = xyzPc[2]! * PC_M;
  // Galactic → ICRS: columns of the ICRS→Galactic matrix rows (GAL_X/Y/Z_ICRS below).
  const w = {
    x: lx * GAL_X_ICRS.x + ly * GAL_Y_ICRS.x + lz * GAL_Z_ICRS.x,
    y: lx * GAL_X_ICRS.y + ly * GAL_Y_ICRS.y + lz * GAL_Z_ICRS.y,
    z: lx * GAL_X_ICRS.z + ly * GAL_Y_ICRS.z + lz * GAL_Z_ICRS.z,
  };
  return worldToGalKpc(f, w, out);
}

/** Galactic (l, b) axes in ICRS (rows of the Hipparcos ICRS→Galactic matrix, ESA 1997 Eq. 1.5.11). */
export const GAL_X_ICRS: V3 = { x: -0.0548755604, y: -0.8734370902, z: -0.4838350155 };
export const GAL_Y_ICRS: V3 = { x: 0.4941094279, y: -0.44482963, z: 0.7469822445 };
export const GAL_Z_ICRS: V3 = { x: -0.867666149, y: -0.1980763734, z: 0.4559837762 };

// ── Spiral arms (Reid et al. 2019, Table 2) ────────────────────────────────────────────────────────────────────────

export interface ArmDef {
  key: string;
  name: string;
  reidLabel: string;
  nMasers: number;
  /** Reid azimuth range constrained by masers (deg). */
  betaMinDeg: number;
  betaMaxDeg: number;
  betaKinkDeg: number;
  rKinkKpc: number;
  /** Pitch angles (deg) for β ≤ β_kink and β > β_kink. */
  pitchInDeg: number;
  pitchOutDeg: number;
  /** Intrinsic Gaussian 1σ width at the kink (kpc). */
  widthKpc: number;
  /** Illustrative extension of the arm beyond the maser-constrained range (deg of Reid azimuth). */
  extMinDeg: number;
  extMaxDeg: number;
  /** Relative strength in old/young stars and in gas (illustrative weights: Perseus and Scutum-Centaurus are the two
   *  major stellar arms in Spitzer/GLIMPSE counts, Churchwell et al. 2009; the others are mainly gas arms). */
  stellar: number;
  gas: number;
  major: boolean;
}

/** Reid 2019 Table 2 rows (verbatim) + illustrative extension ranges and weights. */
export const ARMS: readonly ArmDef[] = [
  { key: '3kpc', name: '3-kpc arm (near)', reidLabel: '3-kpc(N)', nMasers: 3, betaMinDeg: 15, betaMaxDeg: 18, betaKinkDeg: 15, rKinkKpc: 3.52, pitchInDeg: -4.2, pitchOutDeg: -4.2, widthKpc: 0.18, extMinDeg: -25, extMaxDeg: 70, stellar: 0.35, gas: 0.6, major: false },
  { key: 'norma', name: 'Norma arm', reidLabel: 'Norma', nMasers: 11, betaMinDeg: 5, betaMaxDeg: 54, betaKinkDeg: 18, rKinkKpc: 4.46, pitchInDeg: -1, pitchOutDeg: 19.5, widthKpc: 0.14, extMinDeg: -150, extMaxDeg: 66, stellar: 0.5, gas: 1.0, major: false },
  { key: 'sct-cen', name: 'Scutum–Centaurus arm', reidLabel: 'Sct-Cen', nMasers: 36, betaMinDeg: 0, betaMaxDeg: 104, betaKinkDeg: 23, rKinkKpc: 4.91, pitchInDeg: 14.1, pitchOutDeg: 12.1, widthKpc: 0.23, extMinDeg: -285, extMaxDeg: 112, stellar: 1.0, gas: 1.0, major: true },
  { key: 'sgr-car', name: 'Sagittarius–Carina arm', reidLabel: 'Sgr-Car', nMasers: 35, betaMinDeg: 2, betaMaxDeg: 97, betaKinkDeg: 24, rKinkKpc: 6.04, pitchInDeg: 17.1, pitchOutDeg: 1, widthKpc: 0.27, extMinDeg: -150, extMaxDeg: 130, stellar: 0.6, gas: 1.1, major: false },
  { key: 'local', name: 'Local (Orion) arm', reidLabel: 'Local', nMasers: 28, betaMinDeg: -8, betaMaxDeg: 34, betaKinkDeg: 9, rKinkKpc: 8.26, pitchInDeg: 11.4, pitchOutDeg: 11.4, widthKpc: 0.31, extMinDeg: -32, extMaxDeg: 58, stellar: 0.45, gas: 0.8, major: false },
  { key: 'perseus', name: 'Perseus arm', reidLabel: 'Perseus', nMasers: 41, betaMinDeg: -23, betaMaxDeg: 115, betaKinkDeg: 40, rKinkKpc: 8.87, pitchInDeg: 10.3, pitchOutDeg: 8.7, widthKpc: 0.35, extMinDeg: -125, extMaxDeg: 235, stellar: 1.0, gas: 0.9, major: true },
  { key: 'outer', name: 'Outer (Norma–Outer) arm', reidLabel: 'Outer', nMasers: 11, betaMinDeg: -16, betaMaxDeg: 71, betaKinkDeg: 18, rKinkKpc: 12.24, pitchInDeg: 3, pitchOutDeg: 9.4, widthKpc: 0.65, extMinDeg: -110, extMaxDeg: 160, stellar: 0.45, gas: 0.8, major: false },
];

/** Pitch used for the illustrative extensions: the nearest measured pitch clamped to a typical 7°–14° (Vallée 2015). */
const extPitch = (deg: number): number => Math.tan(Math.min(14, Math.max(7, deg)) * DEG);

/** Reid law: ln(R/R_kink) = −(β − β_kink)·tan ψ (β in radians). */
function reidR(a: ArmDef, betaRad: number): number {
  const bk = a.betaKinkDeg * DEG;
  const psi = (betaRad <= bk ? a.pitchInDeg : a.pitchOutDeg) * DEG;
  return a.rKinkKpc * Math.exp(-(betaRad - bk) * Math.tan(psi));
}

/** Arm centre radius (kpc) at Reid azimuth β (rad), with illustrative log-spiral extensions outside the maser range. */
export function armRadiusKpc(a: ArmDef, betaRad: number): number {
  const b0 = a.betaMinDeg * DEG, b1 = a.betaMaxDeg * DEG;
  if (betaRad < b0) return reidR(a, b0) * Math.exp(-(betaRad - b0) * extPitch(a.pitchInDeg));
  if (betaRad > b1) return reidR(a, b1) * Math.exp(-(betaRad - b1) * extPitch(a.pitchOutDeg));
  return reidR(a, betaRad);
}

/** Galactocentric X, Y (kpc) of an arm point at Reid azimuth β: X = −R cos β, Y = R sin β (Sun at −X). */
export function armPointKpc(a: ArmDef, betaRad: number, out: V3): V3 {
  const r = armRadiusKpc(a, betaRad);
  out.x = -r * Math.cos(betaRad);
  out.y = r * Math.sin(betaRad);
  out.z = 0;
  return out;
}

/** Arm 1σ width (kpc) at radius R: Reid's width at the kink, growing ≈ linearly with radius (Reid et al. 2014). */
export function armWidthKpc(a: ArmDef, rKpc: number): number {
  return Math.max(0.12, a.widthKpc + 0.036 * (rKpc - a.rKinkKpc));
}

/** Is β inside the maser-constrained range (true) or on the illustrative extension (false)? */
export function armMeasured(a: ArmDef, betaRad: number): boolean {
  return betaRad >= a.betaMinDeg * DEG && betaRad <= a.betaMaxDeg * DEG;
}

/** Fade of the arm towards the ends of its drawn range (0..1). */
export function armEndFade(a: ArmDef, betaRad: number): number {
  const lo = a.extMinDeg * DEG, hi = a.extMaxDeg * DEG;
  if (betaRad < lo || betaRad > hi) return 0;
  const span = 0.6;
  return Math.min(1, (betaRad - lo) / span, (hi - betaRad) / span);
}

/**
 * Arm membership weights at a mid-plane point (kpc): Σ over arms and windings of a Gaussian in the radial offset.
 * Returns { stellar, gas } (unbounded, typically 0..1.5). JS twin of the bake shader (no noise).
 */
export function armWeights(x: number, y: number, out: { stellar: number; gas: number } = { stellar: 0, gas: 0 }): { stellar: number; gas: number } {
  const r = Math.hypot(x, y);
  const beta0 = Math.atan2(y, -x);
  out.stellar = 0; out.gas = 0;
  for (const a of ARMS) {
    for (let k = -2; k <= 2; k++) {
      const b = beta0 + k * TAU;
      if (b < a.extMinDeg * DEG || b > a.extMaxDeg * DEG) continue;
      const ra = armRadiusKpc(a, b);
      const w = armWidthKpc(a, ra);
      const d = (r - ra) / w;
      if (Math.abs(d) > 4) continue;
      const g = Math.exp(-0.5 * d * d) * armEndFade(a, b) * (armMeasured(a, b) ? 1 : 0.8);
      out.stellar += g * a.stellar;
      out.gas += g * a.gas;
    }
  }
  return out;
}

// ── Stellar populations (particle sampling) ─────────────────────────────────────────────────────────────────────────

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const Pop = { Bulge: 0, Disc: 1, Young: 2, Hii: 3, Thick: 4, Halo: 5, Cluster: 6 } as const;
export type Pop = (typeof Pop)[keyof typeof Pop];

export interface GalaxyParticles {
  count: number;
  /** Galactocentric kpc. */
  positions: Float32Array;
  /** Linear RGB colour (unit luminance-ish). */
  colors: Float32Array;
  /** Relative luminosity (0..~4). */
  lum: Float32Array;
  /** Population index (Pop). */
  pop: Uint8Array;
}

/** Linear-sRGB colours of the populations (blackbody-ish: bulge ≈ 4300 K, disc ≈ 5200 K, young ≈ 15000 K; HII = Hα+Hβ pink). */
export const POP_COLORS: Record<number, readonly [number, number, number]> = {
  [Pop.Bulge]: [1.0, 0.7, 0.42],
  [Pop.Disc]: [1.0, 0.86, 0.68],
  [Pop.Young]: [0.62, 0.76, 1.0],
  [Pop.Hii]: [1.0, 0.34, 0.52],
  [Pop.Thick]: [1.0, 0.78, 0.55],
  [Pop.Halo]: [1.0, 0.82, 0.6],
  [Pop.Cluster]: [0.75, 0.85, 1.0],
};

/** Population fractions of the particle budget (illustrative mix tuned for legibility, not a mass budget). */
export const POP_FRACTIONS = { bulge: 0.2, disc: 0.33, young: 0.25, hii: 0.07, thick: 0.08, halo: 0.04, cluster: 0.03 } as const;

function gauss(r: () => number): number {
  let u = r();
  if (u < 1e-12) u = 1e-12;
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * r());
}
function laplace(r: () => number, h: number): number {
  const u = r() - 0.5;
  return -h * Math.sign(u) * Math.log(1 - 2 * Math.abs(u) + 1e-12);
}
/** Radius from an exponential surface-density disc (Σ ∝ e^(−R/h)): R = −h ln(u1 u2). */
function expDiscR(r: () => number, h: number): number {
  return -h * Math.log((r() + 1e-12) * (r() + 1e-12));
}

/** Pick a point on an arm (weighted by drawn length × weight), offset by the arm width. */
function armSample(r: () => number, weightKey: 'stellar' | 'gas', widthMul: number, out: V3): ArmDef {
  let total = 0;
  for (const a of ARMS) total += a[weightKey] * (a.extMaxDeg - a.extMinDeg);
  let pick = r() * total;
  let arm = ARMS[0]!;
  for (const a of ARMS) {
    pick -= a[weightKey] * (a.extMaxDeg - a.extMinDeg);
    if (pick <= 0) { arm = a; break; }
  }
  // Rejection on the end fade so arms taper.
  for (let tries = 0; tries < 8; tries++) {
    const b = (arm.extMinDeg + r() * (arm.extMaxDeg - arm.extMinDeg)) * DEG;
    if (r() > armEndFade(arm, b) * (armMeasured(arm, b) ? 1 : 0.8)) continue;
    const ra = armRadiusKpc(arm, b);
    const rr = ra + gauss(r) * armWidthKpc(arm, ra) * widthMul;
    const bb = b + gauss(r) * 0.02;
    out.x = -rr * Math.cos(bb);
    out.y = rr * Math.sin(bb);
    return arm;
  }
  out.x = out.y = 1e9; // rejected: caller discards
  return arm;
}

/**
 * Seeded particle sampling of the Milky Way model: bulge/bar, thin disc (arm-modulated), young arm stars, HII knots,
 * young clusters, thick disc and stellar halo. Positions in Galactocentric kpc.
 */
export function generateGalaxyParticles(count: number, seed = 20261019): GalaxyParticles {
  const r = rng(seed);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const lum = new Float32Array(count);
  const pop = new Uint8Array(count);
  const barA = BAR_ANGLE_DEG * DEG;
  // Bar major axis unit vector (near end at positive l, i.e. +Y, on the Sun's side −X).
  const bx = -Math.cos(barA), by = Math.sin(barA);
  const p: V3 = { x: 0, y: 0, z: 0 };
  const aw = { stellar: 0, gas: 0 };
  let n = 0;
  const put = (kind: Pop, x: number, y: number, z: number, l: number, tint = 0): void => {
    if (n >= count || !Number.isFinite(x) || Math.abs(x) > 60) return;
    positions[3 * n] = x; positions[3 * n + 1] = y; positions[3 * n + 2] = z;
    const c = POP_COLORS[kind]!;
    // Small per-star colour scatter (spectral spread within a population).
    const j = 1 + (r() - 0.5) * 0.25 + tint;
    colors[3 * n] = c[0] * (2 - j); colors[3 * n + 1] = c[1]; colors[3 * n + 2] = c[2] * j;
    lum[n] = l;
    pop[n] = kind;
    n++;
  };
  const F = POP_FRACTIONS;
  const nBulge = Math.round(count * F.bulge), nDisc = Math.round(count * F.disc), nYoung = Math.round(count * F.young);
  const nHii = Math.round(count * F.hii), nThick = Math.round(count * F.thick), nHalo = Math.round(count * F.halo);
  // Bulge + long bar.
  for (let i = 0; i < nBulge; i++) {
    let u: number, v: number, z: number;
    if (r() < 0.62) {
      // Box/peanut bulge (triaxial Gaussian, Dwek-like scale lengths).
      u = gauss(r) * 1.1; v = gauss(r) * 0.45; z = gauss(r) * (0.28 + 0.1 * Math.min(1, Math.abs(u) / 1.5));
    } else {
      // Long thin bar out to the half-length.
      u = (r() * 2 - 1) * BAR_HALF_LENGTH_KPC * Math.sqrt(r()); v = gauss(r) * 0.32; z = laplace(r, 0.18);
    }
    put(Pop.Bulge, u * bx - v * by, u * by + v * bx, z, 0.6 + r() * 0.8, -0.05);
  }
  // Thin disc, modulated by the arms (old stars show a ~20–40% arm contrast).
  for (let i = 0, guard = 0; i < nDisc && guard < nDisc * 6; guard++) {
    const R = expDiscR(r, THIN_SCALE_LENGTH_KPC);
    if (R < 2.2 || R > 22) continue;
    const phi = r() * TAU;
    const x = R * Math.cos(phi), y = R * Math.sin(phi);
    armWeights(x, y, aw);
    if (r() > 0.45 + 0.55 * Math.min(1, aw.stellar)) continue;
    put(Pop.Disc, x, y, laplace(r, THIN_SCALE_HEIGHT_KPC * (R > 10 ? 1 + 0.08 * (R - 10) : 1)), 0.5 + r() * 0.9);
    i++;
  }
  // Young stars along the arms.
  for (let i = 0; i < nYoung; i++) {
    armSample(r, 'stellar', 0.9, p);
    put(Pop.Young, p.x, p.y, laplace(r, 0.09), 0.7 + 1.6 * r() * r(), 0.08);
  }
  // HII regions: knots of 6–20 particles along the gas arms.
  for (let i = 0; i < nHii;) {
    armSample(r, 'gas', 0.7, p);
    if (Math.abs(p.x) > 100) continue;
    const k = 6 + Math.floor(r() * 14), s = 0.03 + 0.08 * r();
    const z0 = laplace(r, 0.05);
    for (let j = 0; j < k && i < nHii; j++, i++) put(Pop.Hii, p.x + gauss(r) * s, p.y + gauss(r) * s, z0 + gauss(r) * s * 0.5, 0.6 + r() * 0.8, 0);
  }
  // Young open clusters (tight blue knots).
  const nCl = Math.round(count * F.cluster);
  for (let i = 0; i < nCl;) {
    armSample(r, 'stellar', 0.6, p);
    if (Math.abs(p.x) > 100) continue;
    const k = 4 + Math.floor(r() * 10), s = 0.008 + 0.02 * r();
    const z0 = laplace(r, 0.06);
    for (let j = 0; j < k && i < nCl; j++, i++) put(Pop.Cluster, p.x + gauss(r) * s, p.y + gauss(r) * s, z0 + gauss(r) * s, 0.9 + 1.4 * r(), 0.1);
  }
  // Thick disc.
  for (let i = 0; i < nThick; i++) {
    const R = expDiscR(r, THICK_SCALE_LENGTH_KPC);
    const phi = r() * TAU;
    put(Pop.Thick, R * Math.cos(phi), R * Math.sin(phi), laplace(r, THICK_SCALE_HEIGHT_KPC), 0.4 + 0.6 * r());
  }
  // Stellar halo: ρ ∝ r^−2.5 inside the 25 kpc break (BHG16), oblate q ≈ 0.7; sampled between 1 and 60 kpc.
  for (let i = 0; i < nHalo; i++) {
    // Inverse CDF of ∝ r^−2.5 · r² dr = r^−0.5 dr between 1 and 60: r = (1 + u(√60 − 1))².
    const rad = Math.pow(1 + r() * (Math.sqrt(60) - 1), 2);
    const cz = 2 * r() - 1, ph = r() * TAU, sz = Math.sqrt(1 - cz * cz);
    put(Pop.Halo, rad * sz * Math.cos(ph), rad * sz * Math.sin(ph), rad * cz * 0.7, 0.4 + 0.5 * r());
  }
  return { count: n, positions, colors, lum, pop };
}

// ── S-stars (Kepler, visual-binary convention) ──────────────────────────────────────────────────────────────────────

export interface SStarElements {
  id: string;
  aMas: number;
  e: number;
  iDeg: number;
  OmegaDeg: number;
  omegaDeg: number;
  tPeriYr: number;
  /** Null when the orbit is unbound/undetermined (S111). */
  periodYr: number | null;
  spectralClass: string | null;
  kMag: number | null;
  /** Gillessen 2017 flag column (e.g. 'b' for less reliable fits) or null. */
  flag: string | null;
}

/** Mean-anomaly Kepler solver (Newton), 0 ≤ e < 1. */
export function solveKepler(M: number, e: number): number {
  let m = ((M % TAU) + TAU) % TAU;
  if (m > Math.PI) m -= TAU;
  let E = e < 0.8 ? m : Math.PI * Math.sign(m || 1);
  for (let k = 0; k < 50; k++) {
    const d = (E - e * Math.sin(E) - m) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-13) break;
  }
  return E;
}

/** Decimal year of a Unix-ms time (Julian years from J2000: 2000.0 + Δt/365.25 d). */
export function decimalYear(tMs: number): number {
  return 2000 + (tMs - Date.UTC(2000, 0, 1, 12)) / (JULIAN_YEAR_S * 1000);
}

/** Unix ms of a decimal year (inverse of decimalYear). */
export function msOfDecimalYear(y: number): number {
  return Date.UTC(2000, 0, 1, 12) + (y - 2000) * JULIAN_YEAR_S * 1000;
}

/**
 * Sky-plane offset of an S-star (mas) at decimal year t, Thiele–Innes: out.x = Δδ (North), out.y = Δα cosδ (East),
 * out.z = along the line of sight, positive AWAY from the observer. Matches scripts/data/galactic/orbits.mjs.
 */
export function sStarOffsetMas(el: SStarElements, tYr: number, out: V3): V3 {
  const P = el.periodYr;
  if (P === null || !(el.e < 1)) { out.x = out.y = out.z = NaN; return out; }
  const E = solveKepler((TAU / P) * (tYr - el.tPeriYr), el.e);
  return sStarOffsetFromE(el, E, out);
}

export function sStarOffsetFromE(el: SStarElements, E: number, out: V3): V3 {
  const X = Math.cos(E) - el.e;
  const Y = Math.sqrt(1 - el.e * el.e) * Math.sin(E);
  const i = el.iDeg * DEG, O = el.OmegaDeg * DEG, w = el.omegaDeg * DEG;
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(i), si = Math.sin(i);
  const A = cw * cO - sw * sO * ci, B = cw * sO + sw * cO * ci, F = -sw * cO - cw * sO * ci, G = -sw * sO + cw * cO * ci;
  const C = sw * si, H = cw * si;
  out.x = el.aMas * (A * X + F * Y);
  out.y = el.aMas * (B * X + G * Y);
  out.z = el.aMas * (C * X + H * Y);
  return out;
}

/** Sky-plane basis at Sgr A*: North, East and line-of-sight (away) unit vectors in ICRS. */
export interface SkyBasis { north: V3; east: V3; los: V3 }

export function skyBasisAt(raDeg: number, decDeg: number): SkyBasis {
  const a = raDeg * DEG, d = decDeg * DEG;
  return {
    los: { x: Math.cos(d) * Math.cos(a), y: Math.cos(d) * Math.sin(a), z: Math.sin(d) },
    east: { x: -Math.sin(a), y: Math.cos(a), z: 0 },
    north: { x: -Math.sin(d) * Math.cos(a), y: -Math.sin(d) * Math.sin(a), z: Math.cos(d) },
  };
}

/** Metres per milliarcsecond at distance R0 (pc). */
export const metresPerMas = (r0Pc = R0_PC): number => (1e-3 / 206264.806247) * r0Pc * PC_M;

/** Offset (mas, sky-plane) → ICRS metres relative to Sgr A*. */
export function offsetMasToIcrs<T extends V3>(b: SkyBasis, off: V3, mPerMas: number, out: T): T {
  out.x = (off.x * b.north.x + off.y * b.east.x + off.z * b.los.x) * mPerMas;
  out.y = (off.x * b.north.y + off.y * b.east.y + off.z * b.los.y) * mPerMas;
  out.z = (off.x * b.north.z + off.y * b.east.z + off.z * b.los.z) * mPerMas;
  return out;
}

/** S2 (GRAVITY 2020, A&A 636, L5) osculating elements. */
export const S2_GRAVITY2020: SStarElements = {
  id: 'S2', aMas: 125.058, e: 0.884649, iDeg: 134.567, OmegaDeg: 228.171, omegaDeg: 66.263, tPeriYr: 2018.379, periodYr: 16.0455,
  spectralClass: 'early', kMag: 13.95, flag: null,
};

/** Pericentre / apocentre distances (AU) and pericentre speed (km/s, vis-viva) of an orbit around a mass. */
export function orbitExtremes(aMas: number, e: number, r0Pc: number, massKg: number): { periAu: number; apoAu: number; vPeriKmS: number; aM: number } {
  const aM = aMas * metresPerMas(r0Pc);
  const rp = aM * (1 - e), ra = aM * (1 + e);
  const mu = G_SI * massKg;
  const vp = Math.sqrt(mu * (2 / rp - 1 / aM));
  return { periAu: rp / AU_M, apoAu: ra / AU_M, vPeriKmS: vp / 1000, aM };
}

/** GR (Schwarzschild) pericentre advance per orbit, radians: Δω = 6πGM / (c² a (1 − e²)). */
export function schwarzschildPrecessionRad(aM: number, e: number, massKg: number): number {
  return (6 * Math.PI * G_SI * massKg) / (C_M_PER_S * C_M_PER_S * aM * (1 - e * e));
}

/** Next pericentre passage (decimal year) at or after `fromYr`. */
export function nextPericentreYr(el: SStarElements, fromYr: number): number | null {
  if (el.periodYr === null) return null;
  const k = Math.ceil((fromYr - el.tPeriYr) / el.periodYr);
  return el.tPeriYr + k * el.periodYr;
}
