/**
 * Planetary rings: the render kit's single-scattering particle layer (RingMaterial; Chandrasekhar 1960, Cuzzi et
 * al. 1984) extended for the solar domain:
 *  - the planet's shadow is cast by the oblate ellipsoid (exact under the affine map z → z·a/c that turns it into a
 *    sphere), with the solar-disc penumbra;
 *  - uniforms are set from the body-fixed frame (units of the equatorial radius a) by the layer, shared with the
 *    planet so both use exactly the same Sun direction;
 *  - an optional brightness scale lets faint dusty rings (Jupiter, Uranus, Neptune) stay honest and dim.
 *
 *   τ = −ln(1 − a)  (normal optical depth),  μ = |v·n|, μ₀ = |s·n|
 *   lit face:   I = E ϖ P(θ)/4 · μ₀/(μ₀ + μ) · (1 − exp(−τ(1/μ₀ + 1/μ)))
 *   unlit face: I = E ϖ P(θ)/4 · μ₀/(μ₀ − μ) · (exp(−τ/μ₀) − exp(−τ/μ))
 */
import * as THREE from 'three';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import { SHADOW_GLSL } from '../../render/glsl/shadow';
import { SOLAR_SHADOW_GLSL } from './shadowGlsl';

export interface SolarRingOptions {
  strip: THREE.Texture;
  innerA: number;
  outerA: number;
  /** Polar / equatorial axis ratio of the planet (c/a). */
  polarRatio: number;
  dustFraction: number;
  albedoScale?: number;
}

export class SolarRingMaterial extends THREE.ShaderMaterial {
  declare uniforms: {
    uStrip: { value: THREE.Texture };
    uInner: { value: number };
    uOuter: { value: number };
    uPolar: { value: number };
    uSunDir: { value: THREE.Vector3 };
    uCamLocal: { value: THREE.Vector3 };
    uSunIntensity: { value: number };
    uSunAngularRadius: { value: number };
    uDust: { value: number };
    uAlbedoScale: { value: number };
  };

  constructor(opts: SolarRingOptions) {
    super({
      uniforms: {
        uStrip: { value: opts.strip },
        uInner: { value: opts.innerA },
        uOuter: { value: opts.outerA },
        uPolar: { value: opts.polarRatio },
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uCamLocal: { value: new THREE.Vector3(0, 0, 10) },
        uSunIntensity: { value: 5 },
        uSunAngularRadius: { value: 4.9e-4 },
        uDust: { value: opts.dustFraction },
        uAlbedoScale: { value: opts.albedoScale ?? 1 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
  }
}

/** Flat annulus in the local XY plane (ring plane = planet equator). */
export function createRingGeometry(innerA: number, outerA: number, segments = 512): THREE.RingGeometry {
  return new THREE.RingGeometry(innerA, outerA, segments, 1);
}

/**
 * TS mirror of the planet shadow on the ring plane (for tests and tooling): fraction of sunlight reaching ring
 * point p (units of a, ring plane z = 0) past an ellipsoid with semi-axes (1, 1, c), ignoring the penumbra.
 */
export function ringPointInPlanetShadow(p: THREE.Vector3, sunDir: THREE.Vector3, c: number): boolean {
  // Affine map z → z / c turns the ellipsoid into the unit sphere; ray p + t s (t > 0) toward the Sun.
  const px = p.x, py = p.y, pz = p.z / c;
  let sx = sunDir.x, sy = sunDir.y, sz = sunDir.z / c;
  const l = Math.hypot(sx, sy, sz);
  sx /= l; sy /= l; sz /= l;
  const b = px * sx + py * sy + pz * sz;
  const cc = px * px + py * py + pz * pz - 1;
  if (b > 0) return false; // the planet is behind the point as seen from the Sun side
  return b * b - cc >= 0;
}

const VERTEX_SHADER = /* glsl */ `
${VERTEX_PRELUDE}
varying vec3 vLocal;
void main() {
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  ${LOGDEPTH_VERTEX}
}
`;

const FRAGMENT_SHADER = /* glsl */ `
${FRAGMENT_PRELUDE}
${SHADOW_GLSL}
${SOLAR_SHADOW_GLSL}
uniform sampler2D uStrip;
uniform float uInner;
uniform float uOuter;
uniform float uPolar;
uniform vec3 uSunDir;
uniform vec3 uCamLocal;
uniform float uSunIntensity;
uniform float uSunAngularRadius;
uniform float uDust;
uniform float uAlbedoScale;
varying vec3 vLocal;

float hg(float cosTheta, float g) {
  float g2 = g * g;
  return (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * cosTheta, 1e-4), 1.5);
}

void main() {
  float r = length(vLocal.xy);
  float u = (r - uInner) / (uOuter - uInner);
  if (u < 0.0 || u > 1.0) discard;
  vec4 strip = texture2D(uStrip, vec2(u, 0.5));
  // The strip's hues are exaggerated by its source stretch; true-colour Cassini views show subtle tan/grey rings.
  strip.rgb = mix(vec3(dot(strip.rgb, vec3(0.2126, 0.7152, 0.0722))), strip.rgb, 0.6);
  float a = min(strip.a, 0.999);
  if (a <= 0.001) discard;
  float tau = -log(1.0 - a);

  vec3 s = normalize(uSunDir);
  vec3 toCam = normalize(uCamLocal - vLocal);
  float muV = max(abs(toCam.z), 1e-3);
  float muS = max(abs(s.z), 1e-3);
  bool litFace = (toCam.z * s.z) > 0.0;

  float cosTheta = dot(-s, toCam);
  float phase = mix(hg(cosTheta, -0.35), hg(cosTheta, 0.75), uDust);

  float layer;
  if (litFace) {
    layer = muS / (muS + muV) * (1.0 - exp(-tau * (1.0 / muS + 1.0 / muV)));
  } else {
    float d = muS - muV;
    layer = abs(d) < 1e-4 ? tau / muV * exp(-tau / muV) : muS / d * (exp(-tau / muS) - exp(-tau / muV));
  }
  // Interparticle multiple scattering roughly doubles single scattering in the dense A/B rings (τ ≳ 1, ϖ ≈ 0.5;
  // Cuzzi et al. 1984, Dones et al. 1993): first-order approximation, saturating with optical depth.
  layer *= 1.0 + 0.9 * (1.0 - exp(-tau));
  // Oblate planet shadow: scale z so the ellipsoid becomes the unit sphere.
  vec3 pS = vec3(vLocal.xy, vLocal.z / uPolar);
  vec3 sS = normalize(vec3(s.xy, s.z / uPolar));
  float shadow = solarSphereShadow(pS, sS, uSunAngularRadius, vec3(0.0), 1.0);
  // Chandrasekhar single scattering with πF = E: I = E·ϖ·P(θ)/(4π) · …  (Lommel–Seeliger limit for τ → ∞).
  vec3 radiance = uSunIntensity * RECIPROCAL_PI * min(strip.rgb * uAlbedoScale, vec3(0.95)) * phase * 0.25 * layer * shadow;
  float viewOpacity = 1.0 - exp(-tau / muV);
  gl_FragColor = vec4(radiance, viewOpacity);
  ${LOGDEPTH_FRAGMENT}
}
`;
