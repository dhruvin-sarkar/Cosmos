/**
 * Single-scattering planetary atmosphere (Rayleigh + Mie), cheap enough for a full-screen limb at 60 FPS.
 *
 * Model: exponential density profiles ρ(h) = exp(−h/H). Along the view ray we take ATMOSPHERE_STEPS midpoint
 * samples; at each one the optical depth toward the Sun is the analytic Chapman grazing-incidence
 * approximation (Schüler 2012, "An Approximation to the Chapman Grazing-Incidence Function for Atmospheric
 * Scattering", GPU Pro 3) instead of a nested march, which also yields the Earth's shadow / soft terminator
 * (the Sun-ray optical depth explodes below the geometric horizon). Phase functions: Rayleigh
 * 3/(16π)(1+μ²); Mie: Cornette–Shanks. Sunset reddening, limb glow and the blue rim follow from β_R ∝ λ⁻⁴.
 * Multiple scattering and ozone absorption are omitted (the sky is ~10–20 % darker than reality at twilight).
 *
 * Units: the GLSL works in PLANET RADII (planet centre at the origin) so float32 resolves ~0.4 m on Earth.
 * `atmosphereUniformValues()` converts physical SI parameters into those units once.
 */
import { COMMON_GLSL } from './common';

export interface AtmosphereParams {
  planetRadiusM: number;
  /** Height of the top of the modelled atmosphere above the surface, m. */
  atmosphereHeightM: number;
  rayleighScaleHeightM: number;
  mieScaleHeightM: number;
  /** Rayleigh scattering coefficient at sea level per channel (R, G, B), 1/m. */
  rayleighScattering: readonly [number, number, number];
  /** Mie scattering coefficient at sea level, 1/m. */
  mieScattering: number;
  /** Mie extinction (scattering + absorption) at sea level, 1/m. */
  mieExtinction: number;
  /** Mie asymmetry parameter g (0.76–0.8 for Earth aerosols). */
  mieG: number;
}

/**
 * Earth, from Bruneton (2017) "Precomputed Atmospheric Scattering: a New Implementation" reference parameters
 * (β_R at 680/550/440 nm; Mie from Bruneton & Neyret 2008). Top of atmosphere 100 km.
 */
export const EARTH_ATMOSPHERE: AtmosphereParams = {
  planetRadiusM: 6_371_000,
  atmosphereHeightM: 100_000,
  rayleighScaleHeightM: 8_000,
  mieScaleHeightM: 1_200,
  rayleighScattering: [5.802e-6, 13.558e-6, 33.1e-6],
  mieScattering: 3.996e-6,
  mieExtinction: 4.44e-6,
  mieG: 0.8,
};

/**
 * Mars (dusty CO₂): Rayleigh is weak; suspended dust (Mie, forward scattering, slightly red-absorbing) dominates,
 * giving butterscotch skies and blue sunsets. Approximate values after Collienne et al. (2013).
 */
export const MARS_ATMOSPHERE: AtmosphereParams = {
  planetRadiusM: 3_389_500,
  atmosphereHeightM: 80_000,
  rayleighScaleHeightM: 11_100,
  mieScaleHeightM: 11_100,
  rayleighScattering: [19.918e-7, 13.57e-7, 5.75e-7],
  mieScattering: 2.1e-5,
  mieExtinction: 2.5e-5,
  mieG: 0.76,
};

export interface AtmosphereUniformValues {
  /** Atmosphere top radius in planet radii. */
  topRadius: number;
  /** R / H for Rayleigh and Mie (Chapman X parameters). */
  rayleighX: number;
  mieX: number;
  /** Scale heights in planet radii. */
  rayleighH: number;
  mieH: number;
  /** Coefficients multiplied by the planet radius (per planet radius). */
  rayleighBeta: [number, number, number];
  mieBeta: number;
  mieExt: number;
  mieG: number;
}

/** Convert SI parameters to the planet-radius units the shader uses. */
export function atmosphereUniformValues(p: AtmosphereParams): AtmosphereUniformValues {
  const R = p.planetRadiusM;
  return {
    topRadius: (R + p.atmosphereHeightM) / R,
    rayleighX: R / p.rayleighScaleHeightM,
    mieX: R / p.mieScaleHeightM,
    rayleighH: p.rayleighScaleHeightM / R,
    mieH: p.mieScaleHeightM / R,
    rayleighBeta: [p.rayleighScattering[0] * R, p.rayleighScattering[1] * R, p.rayleighScattering[2] * R],
    mieBeta: p.mieScattering * R,
    mieExt: p.mieExtinction * R,
    mieG: p.mieG,
  };
}

/** Schüler's Chapman approximation × exp(−h): column density factor along a ray to infinity (TS mirror for tests). */
export function chapmanColumn(X: number, h: number, cosZenith: number): number {
  const c = Math.sqrt(X + h);
  if (cosZenith >= 0) return (c / (c * cosZenith + 1)) * Math.exp(-h);
  const x0 = Math.sqrt(1 - cosZenith * cosZenith) * (X + h);
  const c0 = Math.sqrt(x0);
  return 2 * c0 * Math.exp(X - x0) - (c / (1 - c * cosZenith)) * Math.exp(-h);
}

/**
 * GLSL uniforms (declared by this chunk):
 *   uAtmTopRadius, uAtmRayleighX, uAtmMieX, uAtmRayleighH, uAtmMieH, uAtmRayleighBeta (vec3), uAtmMieBeta,
 *   uAtmMieExt, uAtmMieG
 * Functions:
 *   vec4 atmosphereScatter(vec3 ro, vec3 rd, float tMax, vec3 sunDir)
 *     ro: ray origin in planet radii relative to the planet centre; rd: unit direction; tMax: distance to the
 *     first opaque hit (planet radii; use 1e9 for none); sunDir: unit vector toward the Sun.
 *     Returns rgb = in-scattered radiance per unit solar irradiance, a = 1 − mean transmittance (premultiplied
 *     alpha for "One, OneMinusSrcAlpha" blending). Usable as aerial perspective by planet surface shaders too.
 *   vec3 atmosphereSunTransmittance(vec3 p, vec3 sunDir) — Sun colour reaching point p (sunset reddening on the ground).
 * Define ATMOSPHERE_STEPS (default 12) before including to trade quality for speed.
 */
export const ATMOSPHERE_GLSL = /* glsl */ `
${COMMON_GLSL}
#ifndef COSMOS_ATMOSPHERE
#define COSMOS_ATMOSPHERE
#ifndef ATMOSPHERE_STEPS
#define ATMOSPHERE_STEPS 12
#endif

uniform float uAtmTopRadius;
uniform float uAtmRayleighX;
uniform float uAtmMieX;
uniform float uAtmRayleighH;
uniform float uAtmMieH;
uniform vec3 uAtmRayleighBeta;
uniform float uAtmMieBeta;
uniform float uAtmMieExt;
uniform float uAtmMieG;

float atmChapman(float X, float h, float cosZ) {
  float c = sqrt(X + h);
  if (cosZ >= 0.0) return c / (c * cosZ + 1.0) * exp(-h);
  float x0 = sqrt(max(0.0, 1.0 - cosZ * cosZ)) * (X + h);
  float c0 = sqrt(x0);
  // min() keeps exp() finite in float32; such rays pass deep through the planet and are fully extinct anyway.
  return 2.0 * c0 * exp(min(X - x0, 80.0)) - c / (1.0 - c * cosZ) * exp(-h);
}

// Optical depth (per channel) from p toward the Sun, to the top of the atmosphere.
vec3 atmSunOpticalDepth(vec3 p, vec3 sunDir) {
  float r = length(p);
  float cosZ = dot(p, sunDir) / r;
  float alt = r - 1.0;
  float colR = uAtmRayleighH * atmChapman(uAtmRayleighX, alt / uAtmRayleighH, cosZ);
  float colM = uAtmMieH * atmChapman(uAtmMieX, alt / uAtmMieH, cosZ);
  return uAtmRayleighBeta * colR + vec3(uAtmMieExt * colM);
}

vec3 atmosphereSunTransmittance(vec3 p, vec3 sunDir) {
  return exp(-atmSunOpticalDepth(p, sunDir));
}

float atmRayleighPhase(float mu) { return 3.0 / (16.0 * PI) * (1.0 + mu * mu); }

float atmMiePhase(float mu, float g) {
  float g2 = g * g;
  return 3.0 / (8.0 * PI) * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5));
}

vec4 atmosphereScatter(vec3 ro, vec3 rd, float tMax, vec3 sunDir) {
  vec2 tTop = raySphere(ro, rd, uAtmTopRadius);
  if (tTop.x > tTop.y || tTop.y < 0.0) return vec4(0.0);
  float t0 = max(tTop.x, 0.0);
  float t1 = min(tTop.y, tMax);
  if (t1 <= t0) return vec4(0.0);
  float dt = (t1 - t0) / float(ATMOSPHERE_STEPS);
  float mu = dot(rd, sunDir);
  float phaseR = atmRayleighPhase(mu);
  float phaseM = atmMiePhase(mu, uAtmMieG);

  vec3 sumR = vec3(0.0);
  vec3 sumM = vec3(0.0);
  float odR = 0.0;   // view-ray Rayleigh column (planet radii)
  float odM = 0.0;   // view-ray Mie column
  for (int i = 0; i < ATMOSPHERE_STEPS; i++) {
    vec3 p = ro + rd * (t0 + (float(i) + 0.5) * dt);
    float alt = max(length(p) - 1.0, 0.0);
    float dR = exp(-alt / uAtmRayleighH) * dt;
    float dM = exp(-alt / uAtmMieH) * dt;
    // Accumulate half of this segment before evaluating transmittance at its midpoint.
    float cR = odR + 0.5 * dR;
    float cM = odM + 0.5 * dM;
    vec3 tau = uAtmRayleighBeta * cR + vec3(uAtmMieExt * cM) + atmSunOpticalDepth(p, sunDir);
    vec3 T = exp(-tau);
    sumR += T * dR;
    sumM += T * dM;
    odR += dR;
    odM += dM;
  }
  vec3 viewT = exp(-(uAtmRayleighBeta * odR + vec3(uAtmMieExt * odM)));
  vec3 inscatter = sumR * uAtmRayleighBeta * phaseR + sumM * uAtmMieBeta * phaseM;
  return vec4(inscatter, 1.0 - dot(viewT, vec3(1.0 / 3.0)));
}

#endif
`;
