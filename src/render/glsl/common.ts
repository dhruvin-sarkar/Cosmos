/**
 * Shared GLSL helpers for Cosmos shaders.
 *
 * Include AFTER three.js `#include <common>` (VERTEX_PRELUDE / FRAGMENT_PRELUDE do that). three's chunk
 * already defines PI, PI2, PI_HALF, RECIPROCAL_PI, EPSILON, saturate(), pow2…pow4(), max3() and
 * average(); this chunk only adds non-colliding names and is include-guarded, so other Cosmos chunks
 * can depend on it freely.
 */
export const COMMON_GLSL = /* glsl */ `
#ifndef COSMOS_COMMON
#define COSMOS_COMMON

#define LOG2_10 3.321928094887362
#define LOG10_2 0.30102999566398120
#define LN_10 2.302585092994046

// Rec.709 / linear-sRGB relative luminance (Y of CIE XYZ for D65-white linear sRGB).
float luminance709(vec3 c) { return dot(c, vec3(0.2126729, 0.7151522, 0.0721750)); }

float linearstep(float edge0, float edge1, float x) { return clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0); }

float pow10(float x) { return exp2(x * LOG2_10); }

// log10 guarded against non-positive input.
float log10Safe(float x) { return log2(max(x, 1e-37)) * LOG10_2; }

vec3 desaturate(vec3 c, float saturation) { return mix(vec3(luminance709(c)), c, saturation); }

// Ray/sphere intersection for a sphere centred at the origin; rd must be unit length.
// Returns (tNear, tFar); tNear > tFar means the ray misses. The discriminant is formed from the
// perpendicular offset (Ray Tracing Gems ch. 7), which stays accurate when |ro| >> r.
vec2 raySphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  vec3 f = ro - b * rd;
  float h = r * r - dot(f, f);
  if (h < 0.0) return vec2(1.0, -1.0);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}

// Interleaved gradient noise (Jimenez 2014): cheap per-pixel dither in [0, 1).
float interleavedGradientNoise(vec2 fragCoord) {
  return fract(52.9829189 * fract(dot(fragCoord, vec2(0.06711056, 0.00583715))));
}

#endif
`;
