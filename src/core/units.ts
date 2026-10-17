/**
 * Physical and astronomical constants + unit conversions.
 *
 * Convention: everything inside Cosmos is SI (meters, seconds, kilograms, kelvin, radians) unless a
 * name says otherwise (e.g. `distPc`, `inclinationDeg`). Convert at boundaries (data loaders, UI).
 *
 * Sources:
 *  - SI 2019 redefinition (exact c, h, k_B, sigma derived exactly)
 *  - CODATA 2018 for G
 *  - IAU 2012 Resolution B2 (astronomical unit, exact)
 *  - IAU 2015 Resolution B2 (parsec definition) and Resolution B3 (nominal solar & planetary values)
 */

// ── Fundamental ────────────────────────────────────────────────────────────────────────────
/** Speed of light in vacuum, m/s (exact, SI). */
export const C_M_PER_S = 299_792_458;
/** Newtonian constant of gravitation, m^3 kg^-1 s^-2 (CODATA 2018; rel. uncertainty 2.2e-5). */
export const G_SI = 6.674_30e-11;
/** Stefan–Boltzmann constant, W m^-2 K^-4 (exact in SI 2019). */
export const SIGMA_SB = 5.670_374_419e-8;

// ── Time ───────────────────────────────────────────────────────────────────────────────────
export const SECONDS_PER_DAY = 86_400;
/** Julian year (exactly 365.25 d) in seconds — the year used by the light-year definition. */
export const JULIAN_YEAR_S = 365.25 * SECONDS_PER_DAY;
/** Julian Date of the Unix epoch 1970-01-01T00:00:00Z. */
export const JD_UNIX_EPOCH = 2_440_587.5;
/** Julian Date of J2000.0 (2000-01-01T12:00:00 TT). */
export const JD_J2000 = 2_451_545.0;
/** Unix ms of 2000-01-01T12:00:00 UTC. NOTE: J2000.0 is defined in TT (TT−UTC = 64.184 s at that instant). */
export const UNIX_MS_2000_01_01_12_UTC = Date.UTC(2000, 0, 1, 12, 0, 0);

// ── Length ─────────────────────────────────────────────────────────────────────────────────
/** Astronomical unit, m (exact, IAU 2012 B2). */
export const AU_M = 149_597_870_700;
/** Parsec, m (exact by IAU 2015 B2 definition: 648000/π au). */
export const PC_M = (648_000 / Math.PI) * AU_M; // 3.085677581491367e16
export const KPC_M = 1e3 * PC_M;
export const MPC_M = 1e6 * PC_M;
export const GPC_M = 1e9 * PC_M;
/** Light-year, m (IAU: c × Julian year). */
export const LY_M = C_M_PER_S * JULIAN_YEAR_S; // 9.4607304725808e15
export const LIGHT_SECOND_M = C_M_PER_S;
export const LIGHT_MINUTE_M = 60 * C_M_PER_S;
export const LIGHT_HOUR_M = 3_600 * C_M_PER_S;
export const LIGHT_DAY_M = SECONDS_PER_DAY * C_M_PER_S;
/** Mean Earth–Moon distance (semi-major axis of the lunar orbit ≈ 384,399 km), m. */
export const LUNAR_DISTANCE_M = 384_399e3;

// ── Sun (IAU 2015 B3 nominal values) ──────────────────────────────────────────────────────
/** Nominal solar mass parameter GM☉, m^3 s^-2. */
export const GM_SUN = 1.327_124_4e20;
/** Solar mass derived from GM☉ / G, kg (uncertainty dominated by G). */
export const M_SUN_KG = GM_SUN / G_SI; // ≈ 1.988 41e30
/** Nominal solar radius, m. */
export const R_SUN_M = 6.957e8;
/** Nominal solar luminosity, W. */
export const L_SUN_W = 3.828e26;
/** Nominal solar effective temperature, K. */
export const T_SUN_EFF_K = 5_772;

// ── Earth (IAU 2015 B3 nominal values) ────────────────────────────────────────────────────
/** Nominal terrestrial mass parameter GM⊕, m^3 s^-2. */
export const GM_EARTH = 3.986_004e14;
export const M_EARTH_KG = GM_EARTH / G_SI; // ≈ 5.9722e24
/** Nominal equatorial Earth radius, m. */
export const R_EARTH_EQ_M = 6.378_1e6;
/** Nominal polar Earth radius, m. */
export const R_EARTH_POLAR_M = 6.356_8e6;
/** Mean Earth radius (IUGG R1 ≈ 6371.0088 km), m — used for "Earth radii" display units. */
export const R_EARTH_MEAN_M = 6.371_008_8e6;

// ── Jupiter (IAU 2015 B3 nominal values) ──────────────────────────────────────────────────
export const GM_JUPITER = 1.266_865_3e17;
export const M_JUPITER_KG = GM_JUPITER / G_SI;
export const R_JUPITER_EQ_M = 7.149_2e7;

// ── Angles ─────────────────────────────────────────────────────────────────────────────────
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const ARCSEC = DEG / 3_600;
export const MAS = ARCSEC / 1_000;
export const MICROARCSEC = ARCSEC / 1e6;

// ── Conversions (pure, allocation-free) ───────────────────────────────────────────────────
export const auToM = (au: number): number => au * AU_M;
export const mToAu = (m: number): number => m / AU_M;
export const pcToM = (pc: number): number => pc * PC_M;
export const mToPc = (m: number): number => m / PC_M;
export const lyToM = (ly: number): number => ly * LY_M;
export const mToLy = (m: number): number => m / LY_M;
export const kmToM = (km: number): number => km * 1_000;
export const mToKm = (m: number): number => m / 1_000;
export const mpcToM = (mpc: number): number => mpc * MPC_M;
export const mToMpc = (m: number): number => m / MPC_M;

/** Unix milliseconds (UTC) → Julian Date (UTC scale). */
export const unixMsToJdUtc = (ms: number): number => ms / (SECONDS_PER_DAY * 1_000) + JD_UNIX_EPOCH;
/** Julian Date (UTC scale) → Unix milliseconds (UTC). */
export const jdUtcToUnixMs = (jd: number): number => (jd - JD_UNIX_EPOCH) * SECONDS_PER_DAY * 1_000;

/**
 * Length units the UI may present. `meters` is the size of one unit in meters.
 * Ordered from small to large; the Cosmic Ruler and distance formatters choose among these.
 */
export const LENGTH_UNITS = [
  { id: 'm', label: 'm', name: 'meters', meters: 1 },
  { id: 'km', label: 'km', name: 'kilometers', meters: 1_000 },
  { id: 'R_earth', label: 'R⊕', name: 'Earth radii', meters: R_EARTH_MEAN_M },
  { id: 'LD', label: 'LD', name: 'lunar distances', meters: LUNAR_DISTANCE_M },
  { id: 'ls', label: 'light-s', name: 'light-seconds', meters: LIGHT_SECOND_M },
  { id: 'lmin', label: 'light-min', name: 'light-minutes', meters: LIGHT_MINUTE_M },
  { id: 'AU', label: 'AU', name: 'astronomical units', meters: AU_M },
  { id: 'lh', label: 'light-h', name: 'light-hours', meters: LIGHT_HOUR_M },
  { id: 'ld', label: 'light-d', name: 'light-days', meters: LIGHT_DAY_M },
  { id: 'ly', label: 'ly', name: 'light-years', meters: LY_M },
  { id: 'pc', label: 'pc', name: 'parsecs', meters: PC_M },
  { id: 'kpc', label: 'kpc', name: 'kiloparsecs', meters: KPC_M },
  { id: 'Mpc', label: 'Mpc', name: 'megaparsecs', meters: MPC_M },
  { id: 'Gpc', label: 'Gpc', name: 'gigaparsecs', meters: GPC_M },
] as const;

export type LengthUnitId = (typeof LENGTH_UNITS)[number]['id'];
