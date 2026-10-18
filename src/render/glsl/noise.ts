/**
 * Procedural noise for shaders.
 *
 *  - simplexNoise3: 3D simplex noise in ≈[−1, 1] (Ian McEwan / Ashima Arts, MIT License,
 *    https://github.com/ashima/webgl-noise).
 *  - fbm3: fractal Brownian motion of simplex noise (normalized to ≈[−1, 1]).
 *  - domainWarp3: displaces a point by a vector noise field (Quilez-style warping).
 *  - cellularNoise3: Worley F1/F2 (Euclidean) over a jittered grid; `cellularNoise3Animated` moves the
 *    feature points on small orbits so cells evolve without sliding (granulation).
 *  - noiseHash33: Dave Hoskins' sine-free hash (MIT), stable across GPUs.
 *
 * Helper names carry a `noise` prefix so this chunk can coexist with other noise includes.
 */
import { COMMON_GLSL } from './common';

export const NOISE_GLSL = /* glsl */ `
${COMMON_GLSL}
#ifndef COSMOS_NOISE
#define COSMOS_NOISE

vec3 noiseMod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 noiseMod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 noisePermute(vec4 x) { return noiseMod289(((x * 34.0) + 1.0) * x); }
vec4 noiseTaylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float simplexNoise3(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = noiseMod289(i);
  vec4 p = noisePermute(noisePermute(noisePermute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = noiseTaylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

// Up to 8 octaves; lacunarity 2, gain 0.5. Returns ≈[−1, 1].
float fbm3(vec3 p, int octaves) {
  float sum = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    sum += amp * simplexNoise3(p);
    norm += amp;
    p = p * 2.03 + vec3(17.1, -9.7, 4.3);
    amp *= 0.5;
  }
  return sum / norm;
}

vec3 domainWarp3(vec3 p, float strength) {
  return p + strength * vec3(
    simplexNoise3(p + vec3(31.7, 0.0, 0.0)),
    simplexNoise3(p + vec3(0.0, 47.3, 0.0)),
    simplexNoise3(p + vec3(0.0, 0.0, 59.1)));
}

vec3 noiseHash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

// Worley noise: (F1, F2) distances to the nearest and second-nearest feature point.
vec2 cellularNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float d1 = 9.0;
  float d2 = 9.0;
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 r = g + noiseHash33(i + g) - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
  return sqrt(vec2(d1, d2));
}

// Feature points circle their cell jitter position with the given phase (radians).
vec2 cellularNoise3Animated(vec3 p, float phase) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float d1 = 9.0;
  float d2 = 9.0;
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 h = noiseHash33(i + g);
    vec3 o = 0.5 + 0.38 * sin(phase * (0.6 + 0.8 * h.zxy) + PI2 * h);
    vec3 r = g + o - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
  return sqrt(vec2(d1, d2));
}

#endif
`;
