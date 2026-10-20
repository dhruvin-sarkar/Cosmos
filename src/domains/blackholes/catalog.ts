/**
 * Black-hole catalogue (public/data/blackholes/blackholes.json, every value cited; see docs/data/blackholes.md) and
 * the per-system render model derived from it: Schwarzschild radius, binary orbit in ICRS, disc plane, companion star,
 * disc and jet display parameters. Pure logic + one fetch; no three.js scene objects.
 */
import * as THREE from 'three';
import {
  AU_M, PC_M, R_SUN_M, binarySeparationM, clampSpin, rocheLobeFraction, schwarzschildRadiusM, solveKepler,
} from '../../render/blackhole/physics';

export interface RawQ {
  value: number | null;
  errMinus?: number | null;
  errPlus?: number | null;
  ref?: string | null;
}

export interface RawBlackHole {
  id: string;
  name: string;
  aliases: string[];
  class: 'stellar-xrb' | 'stellar-dormant' | 'supermassive' | 'merger';
  accretionState: 'persistent' | 'transient-quiescent' | 'dormant' | 'agn' | 'low-luminosity-agn' | 'merged';
  constellation: string | null;
  raDeg: number;
  decDeg: number;
  positionRef: string | null;
  positionIllustrative: boolean;
  distancePc: RawQ;
  massMsun: RawQ;
  spin: (RawQ & { lowerLimit: number | null; note: string | null }) | null;
  companion: null | {
    name: string;
    spectralType: string | null;
    massMsun: RawQ | null;
    radiusRsun: RawQ | null;
    teffK: RawQ | null;
    ref: string | null;
  };
  orbit: null | {
    periodDays: RawQ;
    eccentricity: RawQ | null;
    inclinationDeg: RawQ | null;
    semiMajorAxisAU: RawQ | null;
    nodeDeg: number | null;
    argPeriDeg: number | null;
    tPeriJD: number | null;
    ref: string | null;
  };
  jet: null | {
    inclinationDeg: number | null;
    positionAngleDeg: number | null;
    speedC: number | null;
    lengthPc: number | null;
    ref: string | null;
    note: string | null;
  };
  hostGalaxyId: string | null;
  discovery: { year: number | null; method: string; text: string; ref: string | null };
  summary: string;
  extra?: Record<string, unknown>;
}

export interface BlackHoleCatalogue {
  schemaVersion: number;
  generated: string;
  note: string;
  references: Record<string, { citation: string; url?: string }>;
  objects: RawBlackHole[];
}

export const DATASET_ID = 'blackholes-catalogue';
export const CATALOGUE_PATH = 'data/blackholes/blackholes.json';

const BASE = (typeof import.meta !== 'undefined' && (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) || '/';
let pending: Promise<BlackHoleCatalogue> | null = null;
export function loadCatalogue(): Promise<BlackHoleCatalogue> {
  if (!pending) {
    pending = fetch(`${BASE}${CATALOGUE_PATH}`).then((r) => {
      if (!r.ok) throw new Error(`blackholes.json: HTTP ${r.status}`);
      return r.json() as Promise<BlackHoleCatalogue>;
    });
    pending.catch(() => { pending = null; });
  }
  return pending;
}

export const entityId = (raw: { id: string }): string => `bh:${raw.id}`;
export const companionId = (raw: { id: string }): string => `bh:${raw.id}:companion`;

// ── Sky geometry ────────────────────────────────────────────────────────────────────────────

const D2R = Math.PI / 180;

/** Unit vector to (RA, Dec) in ICRS, plus the local east and north directions on the sky. */
export function skyFrame(raDeg: number, decDeg: number): { c: THREE.Vector3; east: THREE.Vector3; north: THREE.Vector3 } {
  const a = raDeg * D2R;
  const d = decDeg * D2R;
  const c = new THREE.Vector3(Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d));
  const east = new THREE.Vector3(-Math.sin(a), Math.cos(a), 0);
  const north = new THREE.Vector3(-Math.sin(d) * Math.cos(a), -Math.sin(d) * Math.sin(a), Math.cos(d));
  return { c, east, north };
}

// ── Display model ───────────────────────────────────────────────────────────────────────────

export interface CompanionModel {
  name: string;
  massMsun: number;
  radiusM: number;
  teffK: number;
  /** Radius / Roche-lobe radius (≥ 0.95 → tidally distorted teardrop, mass transfer through L1). */
  rocheFill: number;
  /** Radius came from the catalogue (else estimated). */
  radiusMeasured: boolean;
  teffMeasured: boolean;
  /** Absolute visual magnitude estimate (for the far-away point). */
  absMagV: number;
}

export interface BinaryModel {
  periodSec: number;
  e: number;
  /** Relative orbit (companion around the hole) semi-major axis, m. */
  aM: number;
  /** Mean anomaly at the J2000 epoch... computed from tPeri (or illustrative phase). */
  tPeriMs: number;
  /** Orbit-plane basis in ICRS: P (towards periastron) and Q (90° ahead in the direction of motion). */
  P: THREE.Vector3;
  Q: THREE.Vector3;
  /** Orbit normal (direction of the orbital angular momentum). */
  normal: THREE.Vector3;
  /** Fraction of the relative orbit the hole moves (m₂ / (m₁ + m₂)). */
  bhShare: number;
  /** Orientation of the orbit on the sky measured (Gaia astrometry) vs assumed. */
  nodeMeasured: boolean;
  phaseMeasured: boolean;
}

export interface DiscModel {
  outerRs: number;
  displayPeakK: number;
  gain: number;
  /** Brightness ∝ profile^intensityExponent (lens default 1.35); higher concentrates the light near the ISCO. */
  intensityExponent?: number;
}

export interface JetModel {
  axis: THREE.Vector3;
  beta: number;
  gain: number;
  width: number;
  lengthRs: number;
  /** Jet launch/acceleration zone, r_s. */
  baseRs?: number;
  fadeInRs?: number;
  ribbonGain?: number;
  illustrativeAxis: boolean;
}

export interface BlackHoleModel {
  raw: RawBlackHole;
  id: string;
  massMsun: number;
  rsM: number;
  /** Spin used for rendering (measured value, lower limit, or illustrative). */
  spin: number;
  spinShown: 'measured' | 'lower-limit' | 'illustrative' | 'none';
  /** System barycentre (ICRS m rel. SSB) for objects at a fixed position. */
  bary: THREE.Vector3;
  distanceM: number;
  binary: BinaryModel | null;
  companion: CompanionModel | null;
  /** Disc / spin axis. */
  normal: THREE.Vector3;
  disc: DiscModel | null;
  jet: JetModel | null;
  /** Upper limit for the lens proxy radius (keeps companions outside it), m. */
  maxProxyM: number | null;
  /** Mass-transfer stream ('rlof' through L1, 'wind' focused stellar wind). */
  stream: 'rlof' | 'wind' | null;
}

/** Teff estimate (K) from a spectral-type string when not measured. */
export function teffFromSpectralType(sp: string | null | undefined): number {
  const m = /([OBAFGKM])\s*(\d(?:\.\d)?)?/.exec(sp ?? '');
  if (!m) return 5000;
  const table: Record<string, [number, number]> = { O: [45000, 31000], B: [30000, 10500], A: [9800, 7400], F: [7200, 6100], G: [6000, 5300], K: [5250, 3900], M: [3850, 2600] };
  const [hot, cool] = table[m[1]];
  const sub = m[2] ? Number(m[2]) / 10 : 0.5;
  return hot + (cool - hot) * sub;
}

/** Bolometric correction BC_V(Teff) (Reed 1998 fit to Flower 1996), magnitudes. */
function bolometricCorrection(teffK: number): number {
  const x = Math.log10(teffK) - 4;
  return -8.499 * x ** 4 + 13.421 * x ** 3 - 8.131 * x ** 2 - 3.901 * x - 0.438;
}

export function absoluteVisualMagnitude(radiusM: number, teffK: number): number {
  const lum = (radiusM / R_SUN_M) ** 2 * (teffK / 5772) ** 4;
  return 4.74 - 2.5 * Math.log10(lum) - bolometricCorrection(teffK);
}

const ILLUSTRATIVE_SPIN_M87 = 0.9;

export function buildModel(raw: RawBlackHole): BlackHoleModel {
  const massMsun = raw.massMsun.value ?? 10;
  const rsM = schwarzschildRadiusM(massMsun);
  const sky = skyFrame(raw.raDeg, raw.decDeg);
  const distPc = raw.distancePc.value ?? 1000;
  const distanceM = distPc * PC_M;
  const bary = sky.c.clone().multiplyScalar(distanceM);

  let spin = 0;
  let spinShown: BlackHoleModel['spinShown'] = 'none';
  if (raw.spin?.value != null) { spin = raw.spin.value; spinShown = 'measured'; }
  else if (raw.spin?.lowerLimit != null) { spin = raw.spin.lowerLimit; spinShown = 'lower-limit'; }
  else if (raw.id === 'm87') { spin = ILLUSTRATIVE_SPIN_M87; spinShown = 'illustrative'; }
  spin = clampSpin(spin);

  // Binary orbit.
  let binary: BinaryModel | null = null;
  let companion: CompanionModel | null = null;
  let normal = sky.c.clone().negate();
  let maxProxyM: number | null = null;
  let stream: BlackHoleModel['stream'] = null;
  const c = raw.companion;
  const o = raw.orbit;
  if (c && o && o.periodDays.value != null) {
    const m2 = c.massMsun?.value ?? 0.7;
    const total = massMsun + m2;
    const periodDays = o.periodDays.value;
    const aM = o.semiMajorAxisAU?.value != null ? o.semiMajorAxisAU.value * AU_M : binarySeparationM(total, periodDays);
    const e = o.eccentricity?.value ?? 0;
    const inc = (o.inclinationDeg?.value ?? 60) * D2R;
    const node = (o.nodeDeg ?? 90) * D2R;
    const w = (o.argPeriDeg ?? 90) * D2R;
    // Thiele–Innes: x towards north, y towards east, z away from the observer (+c).
    const dir = (u: number): THREE.Vector3 => {
      const x = Math.cos(u) * Math.cos(node) - Math.sin(u) * Math.sin(node) * Math.cos(inc);
      const y = Math.cos(u) * Math.sin(node) + Math.sin(u) * Math.cos(node) * Math.cos(inc);
      const z = Math.sin(u) * Math.sin(inc);
      return new THREE.Vector3().addScaledVector(sky.north, x).addScaledVector(sky.east, y).addScaledVector(sky.c, z);
    };
    const P = dir(w);
    const Q = dir(w + Math.PI / 2);
    normal = new THREE.Vector3().crossVectors(P, Q).normalize();
    const tPeriMs = o.tPeriJD != null ? (o.tPeriJD - 2440587.5) * 86400e3 : Date.UTC(2000, 0, 1, 12);
    binary = {
      periodSec: periodDays * 86400, e, aM, tPeriMs, P, Q, normal: normal.clone(), bhShare: m2 / total,
      nodeMeasured: o.nodeDeg != null, phaseMeasured: o.tPeriJD != null,
    };
    // Companion: measured radius/Teff or estimates; Roche-lobe-filling donors in X-ray binaries.
    const rl = rocheLobeFraction(m2 / massMsun) * aM * (1 - e);
    const teffMeasured = c.teffK?.value != null;
    const teffK = c.teffK?.value ?? teffFromSpectralType(c.spectralType);
    let radiusM: number;
    let radiusMeasured = false;
    if (c.radiusRsun?.value != null) { radiusM = c.radiusRsun.value * R_SUN_M; radiusMeasured = true; }
    else if (raw.class === 'stellar-xrb') radiusM = rl * 0.98;
    else radiusM = Math.pow(m2, 0.8) * R_SUN_M;
    const rocheFill = radiusM / rl;
    companion = { name: c.name, massMsun: m2, radiusM, teffK, rocheFill, radiusMeasured, teffMeasured, absMagV: absoluteVisualMagnitude(radiusM, teffK) };
    maxProxyM = Math.max(aM * (1 - e) - radiusM * 1.25, 0);
    if (raw.class === 'stellar-xrb') stream = rocheFill >= 0.9 ? 'rlof' : 'wind';
  }

  // Accretion disc (display model; temperatures in the fact sheet are the physical ones).
  let disc: DiscModel | null = null;
  if (raw.class === 'stellar-xrb' && binary) {
    const rlBh = rocheLobeFraction(massMsun / (companion?.massMsun ?? 1)) * binary.aM * (1 - binary.e);
    const persistent = raw.accretionState === 'persistent';
    disc = { outerRs: (0.8 * rlBh) / rsM, displayPeakK: persistent ? 11500 : 7000, gain: persistent ? 5 : 1.4 };
  } else if (raw.id === 'm87') {
    // Compact, hot inner flow: lensed into a ring like the EHT image (the real emission is a thick synchrotron flow).
    disc = { outerRs: 12, displayPeakK: 5200, gain: 6, intensityExponent: 2.6 };
  } else if (raw.class === 'supermassive') {
    disc = { outerRs: 60, displayPeakK: 5200, gain: 1.2 };
  }

  // Jets: persistent microquasars and M87*.
  let jet: JetModel | null = null;
  if (raw.id === 'm87' && raw.jet) {
    const i = (raw.jet.inclinationDeg ?? 17) * D2R;
    const pa = (raw.jet.positionAngleDeg ?? 288) * D2R;
    const axis = sky.c.clone().multiplyScalar(-Math.cos(i))
      .addScaledVector(sky.north, Math.sin(i) * Math.cos(pa)).addScaledVector(sky.east, Math.sin(i) * Math.sin(pa)).normalize();
    // EHT 2019 (Paper V): clockwise rotation on the sky, spin axis pointing away from Earth → disc normal = −(approaching jet).
    normal = axis.clone().negate();
    const lengthPc = raw.jet.lengthPc ?? 1500;
    jet = { axis, beta: 0.98, gain: 0.12, width: 0.3, lengthRs: (lengthPc * PC_M) / rsM, baseRs: 90, fadeInRs: 120, ribbonGain: 12, illustrativeAxis: false };
  } else if (raw.jet && raw.accretionState === 'persistent') {
    const lengthAU = raw.id === 'cygnus-x1' ? 30 : 200;
    jet = {
      axis: normal.clone(), beta: raw.jet.speedC ?? (raw.id === 'cygnus-x1' ? 0.6 : 0.9), gain: raw.id === 'cygnus-x1' ? 0.25 : 1.2,
      width: raw.id === 'cygnus-x1' ? 0.2 : 0.3, lengthRs: (lengthAU * AU_M) / rsM, illustrativeAxis: raw.jet.positionAngleDeg == null,
    };
  }

  return { raw, id: entityId(raw), massMsun, rsM, spin, spinShown, bary, distanceM, binary, companion, normal, disc, jet, maxProxyM, stream };
}

/**
 * Positions at time t (Unix ms): the hole and the companion around the barycentre `bary` (ICRS m rel. SSB). Writes into
 * the outputs; allocation-free.
 */
export function binaryPositions(m: BlackHoleModel, bary: THREE.Vector3, tMs: number, bhOut: THREE.Vector3, starOut: THREE.Vector3 | null): void {
  const b = m.binary;
  if (!b) {
    bhOut.copy(bary);
    if (starOut) starOut.copy(bary);
    return;
  }
  const M = (2 * Math.PI * ((tMs - b.tPeriMs) / 1000)) / b.periodSec;
  const E = solveKepler(M, b.e);
  const xp = b.aM * (Math.cos(E) - b.e);
  const yq = b.aM * Math.sqrt(1 - b.e * b.e) * Math.sin(E);
  const rx = b.P.x * xp + b.Q.x * yq;
  const ry = b.P.y * xp + b.Q.y * yq;
  const rz = b.P.z * xp + b.Q.z * yq;
  const s = b.bhShare;
  bhOut.set(bary.x - s * rx, bary.y - s * ry, bary.z - s * rz);
  if (starOut) starOut.set(bary.x + (1 - s) * rx, bary.y + (1 - s) * ry, bary.z + (1 - s) * rz);
}
