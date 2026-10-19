/**
 * Numerically robust eclipse penumbra for the solar domain (float32-safe).
 *
 * The render kit's sphereShadow evaluates the exact two-circle overlap (a1 + a2 − k)/(π·s²). When the occluder is
 * much larger than the solar disc (a planet seen from its own rings: ≈ 0.5 rad vs 5·10⁻⁴ rad) the terms are ~10⁶×
 * larger than their difference and acos() near ±1 loses all precision in float32, so the penumbra returns values
 * far outside [0, 1] (bright specks along the shadow edge that bloom into blobs). Here, for occluders more than 8×
 * the solar disc the limb is treated as a straight edge (error < 1 %), giving the exact circular-segment fraction
 *   f = 1 − (acos h − h·√(1 − h²))/π,   h = (sep − occR)/sunR ∈ [−1, 1];
 * otherwise the exact overlap is used (both radii are then comparable, which is well conditioned). Always clamped.
 */
export const SOLAR_SHADOW_GLSL = /* glsl */ `
#ifndef SOLAR_SHADOW
#define SOLAR_SHADOW
float solarDiscVisible(float sunR, float occR, float sep) {
  if (sep >= sunR + occR) return 1.0;
  if (occR > 8.0 * sunR) {
    float h = clamp((sep - occR) / sunR, -1.0, 1.0);
    return clamp(1.0 - (acos(h) - h * sqrt(max(1.0 - h * h, 0.0))) / PI, 0.0, 1.0);
  }
  if (sep <= abs(occR - sunR)) return occR >= sunR ? 0.0 : 1.0 - (occR * occR) / (sunR * sunR);
  float s2 = sunR * sunR, o2 = occR * occR, d2 = sep * sep;
  float a1 = s2 * acos(clamp((d2 + s2 - o2) / (2.0 * sep * sunR), -1.0, 1.0));
  float a2 = o2 * acos(clamp((d2 + o2 - s2) / (2.0 * sep * occR), -1.0, 1.0));
  float k = 0.5 * sqrt(max(0.0, (-sep + sunR + occR) * (sep + sunR - occR) * (sep - sunR + occR) * (sep + sunR + occR)));
  return clamp(1.0 - (a1 + a2 - k) / (PI * s2), 0.0, 1.0);
}

/** 1 = fully lit, 0 = umbra; p and the occluder centre in one frame/unit, s = unit vector toward the Sun. */
float solarSphereShadow(vec3 p, vec3 s, float sunR, vec3 center, float radius) {
  vec3 toOcc = center - p;
  float along = dot(toOcc, s);
  if (along <= 0.0) return 1.0;
  float dist = length(toOcc);
  float occR = asin(min(radius / dist, 1.0));
  float sep = 2.0 * asin(min(length(toOcc / dist - s) * 0.5, 1.0));
  return solarDiscVisible(sunR, occR, sep);
}
#endif
`;

/** TS mirror of the GLSL exact two-circle overlap (float64): visible fraction of the solar disc. */
export function discVisibleExact(sunR: number, occR: number, sep: number): number {
  if (sep >= sunR + occR) return 1;
  if (sep <= Math.abs(occR - sunR)) return occR >= sunR ? 0 : 1 - (occR * occR) / (sunR * sunR);
  const s2 = sunR * sunR, o2 = occR * occR, d2 = sep * sep;
  const a1 = s2 * Math.acos(Math.min(1, Math.max(-1, (d2 + s2 - o2) / (2 * sep * sunR))));
  const a2 = o2 * Math.acos(Math.min(1, Math.max(-1, (d2 + o2 - s2) / (2 * sep * occR))));
  const k = 0.5 * Math.sqrt(Math.max(0, (-sep + sunR + occR) * (sep + sunR - occR) * (sep - sunR + occR) * (sep + sunR + occR)));
  return 1 - (a1 + a2 - k) / (Math.PI * s2);
}

/** TS mirror of solarDiscVisible (straight-edge limb when the occluder is > 8 solar radii). */
export function solarDiscVisible(sunR: number, occR: number, sep: number): number {
  if (sep >= sunR + occR) return 1;
  if (occR > 8 * sunR) {
    const h = Math.min(1, Math.max(-1, (sep - occR) / sunR));
    return Math.min(1, Math.max(0, 1 - (Math.acos(h) - h * Math.sqrt(Math.max(1 - h * h, 0))) / Math.PI));
  }
  return Math.min(1, Math.max(0, discVisibleExact(sunR, occR, sep)));
}
