/**
 * GLSL helper for equirectangular sky maps: a sample whose footprint is isotropic on the sky at every declination.
 * A mip level gives an s × s texel footprint (s = 2^lod); near the poles one texel spans only cos(Dec) of its
 * nominal width in RA, so `skyTap` averages a horizontal row of ~1/cos(Dec) such footprints. Without it, survey noise
 * and blurs turn into radial streaks around the celestial poles. (Hardware anisotropic filtering is not reliable in
 * the bake passes, so the row is explicit; it costs extra taps only in the polar rows of a one-time bake.)
 */
export const SKY_TAP_GLSL = /* glsl */ `
vec3 skyTap(sampler2D t, vec2 uv, float lod, vec2 texel, float sx) {
  float s = exp2(lod);
  float m = min(24.0, floor(0.5 * sx));
  vec2 p = vec2(uv.x, clamp(uv.y, 0.5 * texel.y * s, 1.0 - 0.5 * texel.y * s));
  vec3 acc = vec3(0.0);
  for (int i = -24; i <= 24; i++) {
    if (abs(float(i)) > m) continue;
    acc += textureLod(t, p + vec2(float(i) * s * texel.x, 0.0), lod).rgb;
  }
  return acc / (2.0 * m + 1.0);
}
// Tent-smoothed isotropic blur: three skyTap rows half a footprint apart in Dec.
vec3 skySoft(sampler2D t, vec2 uv, float lod, vec2 texel, float sx) {
  vec2 dy = vec2(0.0, 0.5 * texel.y * exp2(lod));
  return 0.5 * skyTap(t, uv, lod, texel, sx) + 0.25 * (skyTap(t, uv + dy, lod, texel, sx) + skyTap(t, uv - dy, lod, texel, sx));
}
/** 1/cos(Dec) for a texture v coordinate, capped (the row of taps is at most 49 wide). */
float skyStretch(float v) {
  return min(48.0, 1.0 / max(cos((v - 0.5) * 3.14159265), 0.02));
}
`;
