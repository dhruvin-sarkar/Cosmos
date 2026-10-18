/**
 * Analytic shadows: eclipses by spheres (moons, planets on rings) and ring shadows on a planet.
 *
 * Eclipse factor = visible fraction of the solar disc, from the exact overlap area of two discs in the
 * small-angle (planar) approximation; solar limb darkening is ignored (≲ 10 % error inside the
 * penumbra, none outside it). Ring transmittance along a slant path uses the ring's normal optical depth
 * τₙ = −ln(1 − α) from the strip's alpha, so T = exp(−τₙ/|μ₀|) — rings get more opaque at low sun angles.
 */
import { COMMON_GLSL } from './common';

/** Visible fraction of a disc of angular radius `sun` partially covered by a disc `occ` at separation `sep` (radians). */
export function discVisibleFraction(sunRad: number, occRad: number, sepRad: number): number {
  if (sepRad >= sunRad + occRad) return 1;
  if (sepRad <= Math.abs(occRad - sunRad)) return occRad >= sunRad ? 0 : 1 - (occRad * occRad) / (sunRad * sunRad);
  const s2 = sunRad * sunRad, o2 = occRad * occRad, d2 = sepRad * sepRad;
  const a1 = s2 * Math.acos(Math.min(1, Math.max(-1, (d2 + s2 - o2) / (2 * sepRad * sunRad))));
  const a2 = o2 * Math.acos(Math.min(1, Math.max(-1, (d2 + o2 - s2) / (2 * sepRad * occRad))));
  const k = 0.5 * Math.sqrt(Math.max(0, (-sepRad + sunRad + occRad) * (sepRad + sunRad - occRad) * (sepRad - sunRad + occRad) * (sepRad + sunRad + occRad)));
  return 1 - (a1 + a2 - k) / (Math.PI * s2);
}

/**
 * GLSL:
 *   float discVisibleFraction(float sunAngularRadius, float occluderAngularRadius, float separation)
 *   float sphereShadow(vec3 p, vec3 sunDir, float sunAngularRadius, vec3 occluderCenter, float occluderRadius)
 *       — 1 = fully lit, 0 = umbra. Positions in any common frame/unit; sunDir unit vector toward the Sun.
 *   float ringTransmittance(vec3 p, vec3 sunDir, vec3 ringNormal, float innerRadius, float outerRadius, sampler2D ringStrip)
 *       — p relative to the planet centre (ring plane through the centre); strip u = (r − inner)/(outer − inner), alpha = opacity at normal incidence.
 */
export const SHADOW_GLSL = /* glsl */ `
${COMMON_GLSL}
#ifndef COSMOS_SHADOW
#define COSMOS_SHADOW

float discVisibleFraction(float sunR, float occR, float sep) {
  if (sep >= sunR + occR) return 1.0;
  if (sep <= abs(occR - sunR)) return occR >= sunR ? 0.0 : 1.0 - (occR * occR) / (sunR * sunR);
  float s2 = sunR * sunR, o2 = occR * occR, d2 = sep * sep;
  float a1 = s2 * acos(clamp((d2 + s2 - o2) / (2.0 * sep * sunR), -1.0, 1.0));
  float a2 = o2 * acos(clamp((d2 + o2 - s2) / (2.0 * sep * occR), -1.0, 1.0));
  float k = 0.5 * sqrt(max(0.0, (-sep + sunR + occR) * (sep + sunR - occR) * (sep - sunR + occR) * (sep + sunR + occR)));
  return 1.0 - (a1 + a2 - k) / (PI * s2);
}

float sphereShadow(vec3 p, vec3 sunDir, float sunAngularRadius, vec3 occluderCenter, float occluderRadius) {
  vec3 toOcc = occluderCenter - p;
  float along = dot(toOcc, sunDir);
  if (along <= 0.0) return 1.0;                       // occluder is not between p and the Sun
  float dist = length(toOcc);
  float occAngular = asin(min(occluderRadius / dist, 1.0));
  // Angle between the Sun direction and the occluder direction; 2·asin(|a − b|/2) is accurate for small angles.
  float sep = 2.0 * asin(min(length(toOcc / dist - sunDir) * 0.5, 1.0));
  return discVisibleFraction(sunAngularRadius, occAngular, sep);
}

float ringTransmittance(vec3 p, vec3 sunDir, vec3 ringNormal, float innerRadius, float outerRadius, sampler2D ringStrip) {
  float mu0 = dot(sunDir, ringNormal);
  if (abs(mu0) < 1e-4) return 1.0;
  float t = -dot(p, ringNormal) / mu0;
  if (t <= 0.0) return 1.0;
  float r = length(p + t * sunDir);
  float u = (r - innerRadius) / (outerRadius - innerRadius);
  if (u < 0.0 || u > 1.0) return 1.0;
  float alpha = min(texture2D(ringStrip, vec2(u, 0.5)).a, 0.999);
  float tauNormal = -log(1.0 - alpha);
  return exp(-tauNormal / abs(mu0));
}

#endif
`;
