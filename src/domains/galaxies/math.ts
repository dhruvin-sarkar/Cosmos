/**
 * Pure geometry/photometry helpers for galaxies (unit-tested in math.test.ts).
 *
 * Sky basis at (RA, Dec) in ICRS: c = line of sight (away from the observer), e = east, n = north. A galaxy disc
 * with position angle PA (major axis, north through east) and inclination i (0 = face-on) has
 *   major axis   a = sin PA · e + cos PA · n
 *   in-disc minor b = cos i · (cos PA · e − sin PA · n) + sin i · c     (the "receding" minor side tilted away)
 *   normal       N = a × b
 * so that seen from the Solar System the disc projects onto the catalogued ellipse (axis ratio cos i).
 * Which side of the minor axis is nearer is not in the catalogues; we pick the sign above (illustrative) except where
 * the near side is known (M31: the north-west side is nearer, Walterbos & Kennicutt 1987).
 */

export interface V3 { x: number; y: number; z: number }

const D2R = Math.PI / 180;

export function skyBasis(raDeg: number, decDeg: number): { c: V3; e: V3; n: V3 } {
  const a = raDeg * D2R, d = decDeg * D2R;
  const ca = Math.cos(a), sa = Math.sin(a), cd = Math.cos(d), sd = Math.sin(d);
  return {
    c: { x: cd * ca, y: cd * sa, z: sd },
    e: { x: -sa, y: ca, z: 0 },
    n: { x: -sd * ca, y: -sd * sa, z: cd },
  };
}

export const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;

/** Disc axes (unit vectors) for a catalogued orientation. `flipNear` mirrors the tilt (near side swapped). */
export function discAxes(raDeg: number, decDeg: number, paDeg: number, incDeg: number, flipNear = false): { a: V3; b: V3; normal: V3 } {
  const { c, e, n } = skyBasis(raDeg, decDeg);
  const p = paDeg * D2R, i = incDeg * D2R;
  const sp = Math.sin(p), cp = Math.cos(p), ci = Math.cos(i), si = Math.sin(i) * (flipNear ? -1 : 1);
  const a = { x: sp * e.x + cp * n.x, y: sp * e.y + cp * n.y, z: sp * e.z + cp * n.z };
  const m = { x: cp * e.x - sp * n.x, y: cp * e.y - sp * n.y, z: cp * e.z - sp * n.z };
  const b = { x: ci * m.x + si * c.x, y: ci * m.y + si * c.y, z: ci * m.z + si * c.z };
  return { a, b, normal: cross(a, b) };
}

/** Deterministic pseudo-random orientation (unit normal) from a string id, for galaxies without catalogued orientation. */
export function hashUnit(id: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let k = 0; k < id.length; k++) { h ^= id.charCodeAt(k); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Slug used in 'gal:ungc:<slug>' ids (must match scripts/data/galaxies/build-impostors.py slug()). */
export function slugName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Relative mean surface brightness within the Holmberg/D25 diameter: 10^(−0.4 (M_B + 21)) / (D / 30 kpc)²,
 * i.e. 1 for an L* spiral 30 kpc across. Clamped to [0.03, 4]. Null inputs → a typical dwarf value.
 */
export function relativeSurfaceBrightness(absMagB: number | null, diameterKpc: number | null): number {
  if (absMagB === null || diameterKpc === null || !(diameterKpc > 0)) return 0.25;
  const v = Math.pow(10, -0.4 * (absMagB + 21)) / Math.pow(diameterKpc / 30, 2);
  return Math.min(Math.max(v, 0.03), 4);
}

/**
 * Integrated colour (linear RGB, max component 1) by morphology: de Vaucouleurs T-type → B−V via the RC3 mean
 * relation (Roberts & Haynes 1994, Table 2: E ≈ 0.90 … Im ≈ 0.40), then a blackbody-like mapping B−V → RGB.
 */
export function colorForTType(tType: number | null, out: [number, number, number] = [1, 1, 1]): [number, number, number] {
  const t = tType === null ? 4 : Math.min(Math.max(tType, -5), 10);
  const bv = t <= -1 ? 0.92 : t <= 1 ? 0.88 : 0.88 - (t - 1) * 0.052;
  return colorForBV(bv, out);
}

/** B−V → display linear RGB (warm for red populations, blue-white for star-forming), max component 1. */
export function colorForBV(bv: number, out: [number, number, number] = [1, 1, 1]): [number, number, number] {
  const x = Math.min(Math.max((bv - 0.3) / 0.7, 0), 1); // 0 = blue star-forming, 1 = old red
  out[0] = 0.72 + 0.28 * x;
  out[1] = 0.80 + 0.04 * x - 0.02 * x * x;
  out[2] = 1.0 - 0.48 * x;
  const m = Math.max(out[0], out[1], out[2]);
  out[0] /= m; out[1] /= m; out[2] /= m;
  return out;
}

/**
 * DESI g−r (AB, extinction-corrected, observed frame) → display colour. Blue cloud ≈ 0.4–0.6, red sequence ≈ 0.8–1.0
 * at low z; outliers are clamped to 0.2–1.9 (docs/data/galaxies.md).
 */
export function colorForGR(gr: number, out: [number, number, number] = [1, 1, 1]): [number, number, number] {
  const g = Math.min(Math.max(gr, 0.2), 1.9);
  return colorForBV(0.3 + (Math.min(g, 1.1) - 0.3) * 0.9, out);
}
