/**
 * Shared GLSL for the cinematic post chain (src/render/post).
 *
 * AgX: the same curve three.js r186 ships as `AgXToneMapping` (Filament's port of Troy Sobotka's Blender AgX:
 * Rec.2020 working space, inset matrix, log2 encoding over [−12.47, +4.03] EV around 0.18 middle grey,
 * 6th-order polynomial fit of the default contrast sigmoid, outset matrix, 2.2 linearisation). Exposure is
 * applied by the caller before `agx()`; src/render/tonemap.ts mirrors this curve in TypeScript, and
 * src/render/post/post.test.ts checks both against reference values.
 *
 * On top of the base curve the composite applies Blender's AgX "Punchy" look (`agxLook`, mirrored by
 * `agxPunchyLook` below): CDL power 1.35 then saturation 1.4 about Rec.709 luma, in AgX display-encoded space.
 */

/** TS mirror of the GLSL `agxLook` (input/output: AgX sigmoid output, before the outset matrix). */
export function agxPunchyLook(v: readonly [number, number, number], amount = 1): [number, number, number] {
  const p = v.map(x => Math.pow(Math.max(x, 0), 1.35));
  const luma = 0.2126 * p[0]! + 0.7152 * p[1]! + 0.0722 * p[2]!;
  return v.map((x, i) => x + (Math.max(luma + 1.4 * (p[i]! - luma), 0) - x) * amount) as [number, number, number];
}

/** Fullscreen-triangle vertex shader (FullScreenQuad geometry), no camera matrices. */
export const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

export const LUMA_GLSL = /* glsl */ `
float lumaRec709(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

/**
 * NaN test on the bit pattern. isnan() is NOT usable: ANGLE's D3D11 back end (the exhibition laptop) compiles it
 * with fast-math and folds it to false (FXC warning X3577), so a stray NaN texel from any material would pass.
 */
export const NAN_GLSL = /* glsl */ `
bool nanBits(float x) { return (floatBitsToUint(x) & 0x7fffffffu) > 0x7f800000u; }
bool anyNan(vec3 v) { return nanBits(v.r) || nanBits(v.g) || nanBits(v.b); }
`;

export const AGX_GLSL = /* glsl */ `
// AgX "Punchy" look (Blender/Sobotka): ASC CDL power 1.35 + saturation 1.4 about Rec.709 luma, applied in the
// display-encoded AgX space (after the sigmoid, before the outset). Base AgX desaturates lit mid-highs into pastels;
// this restores the colour of bright discs (Io, Jupiter's belts, Pluto) without touching scene-linear light.
// amount 0 = base AgX (three.js r186 AgXToneMapping), 1 = full Punchy.
vec3 agxLook(vec3 v, float amount) {
  vec3 p = pow(max(v, vec3(0.0)), vec3(1.35));
  float luma = dot(p, vec3(0.2126, 0.7152, 0.0722));
  return mix(v, max(vec3(luma) + 1.4 * (p - vec3(luma)), vec3(0.0)), amount);
}
vec3 agxContrastApprox(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx(vec3 color, float look) {
  const mat3 SRGB_TO_REC2020 = mat3(
    vec3(0.6274, 0.0691, 0.0164),
    vec3(0.3293, 0.9195, 0.0880),
    vec3(0.0433, 0.0113, 0.8956));
  const mat3 REC2020_TO_SRGB = mat3(
    vec3(1.6605, -0.1246, -0.0182),
    vec3(-0.5876, 1.1329, -0.1006),
    vec3(-0.0728, -0.0083, 1.1187));
  const mat3 INSET = mat3(
    vec3(0.856627153315983, 0.137318972929847, 0.11189821299995),
    vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903),
    vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
  const mat3 OUTSET = mat3(
    vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
    vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294),
    vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
  const float MIN_EV = -12.47393;
  const float MAX_EV = 4.026069;
  color = INSET * (SRGB_TO_REC2020 * color);
  color = clamp((log2(max(color, 1e-10)) - MIN_EV) / (MAX_EV - MIN_EV), 0.0, 1.0);
  color = OUTSET * agxLook(agxContrastApprox(color), look);
  color = pow(max(color, vec3(0.0)), vec3(2.2));
  return clamp(REC2020_TO_SRGB * color, 0.0, 1.0);
}
// Khronos PBR Neutral (2024; three.js NeutralToneMapping): identity below ~0.76, then a hue-preserving shoulder.
vec3 pbrNeutral(vec3 color) {
  const float START = 0.76;
  const float DESAT = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < START) return color;
  float d = 1.0 - START;
  float newPeak = 1.0 - d * d / (peak + d - START);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (DESAT * (peak - newPeak) + 1.0);
  return clamp(mix(color, vec3(newPeak), g), 0.0, 1.0);
}
vec3 linearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
`;
