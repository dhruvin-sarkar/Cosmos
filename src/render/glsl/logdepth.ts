/**
 * Logarithmic-depth include snippets (see the depth rule in src/core/types.ts).
 *
 * The engine renders with `logarithmicDepthBuffer: true`, so every custom ShaderMaterial must write
 * log depth or it will depth-test against the wrong values. Typical use:
 *
 *   vertex:   VERTEX_PRELUDE ... gl_Position = ...; LOGDEPTH_VERTEX
 *   fragment: FRAGMENT_PRELUDE ... void main() { ...; LOGDEPTH_FRAGMENT }
 *
 * The preludes pull in three.js `<common>` (PI, saturate, isPerspectiveMatrix…) which the log-depth
 * vertex chunk depends on. Include each prelude exactly once per shader, before any Cosmos chunk.
 */

/** three.js `<common>` + log-depth vertex declarations. */
export const VERTEX_PRELUDE = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
`;

/** three.js `<common>` + log-depth fragment declarations. */
export const FRAGMENT_PRELUDE = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
`;

/** Place in the vertex shader after `gl_Position` is written. */
export const LOGDEPTH_VERTEX = /* glsl */ `
#include <logdepthbuf_vertex>
`;

/** Place inside the fragment shader's main(). */
export const LOGDEPTH_FRAGMENT = /* glsl */ `
#include <logdepthbuf_fragment>
`;

/**
 * Fragment depth for geometry at infinity (sky backdrops, stars given as directions): writes the far
 * plane so the fragment only survives where nothing else was drawn, with or without log depth.
 * The vertex shader should emit gl_Position with z == w (e.g. a full-screen triangle at z = w = 1).
 */
export const LOGDEPTH_FRAGMENT_AT_INFINITY = /* glsl */ `
#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
  gl_FragDepth = 1.0;
#endif
`;
