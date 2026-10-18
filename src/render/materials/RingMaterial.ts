/**
 * Planetary rings from a radial strip texture (u = (r − inner)/(outer − inner); rgb = particle albedo colour,
 * a = opacity at normal incidence), lit as a single-scattering particle layer:
 *
 *   τ = −ln(1 − a)  (normal optical depth),  μ = |v·n|, μ₀ = |s·n|
 *   lit face:   I = E ϖ P(θ)/4 · μ₀/(μ₀ + μ) · (1 − exp(−τ(1/μ₀ + 1/μ)))
 *   unlit face: I = E ϖ P(θ)/4 · μ₀/(μ₀ − μ) · (exp(−τ/μ₀) − exp(−τ/μ))
 *
 * (Chandrasekhar 1960 single-scattering layer; Cuzzi et al. 1984 for rings). P is a two-lobe Henyey–Greenstein
 * phase function: back-scattering icy boulders plus a forward-scattering dust fraction, so dense rings go dark
 * and dusty rings glow when seen from the unlit side, as Cassini showed. The planet's shadow on the rings is the
 * analytic penumbral sphere shadow (glsl/shadow.ts). Viewed opacity 1 − exp(−τ/μ) is written as premultiplied
 * alpha (rings correctly hide the planet behind them, more so at grazing views).
 *
 * Geometry: ring in the local XY plane (normal +Z) around the planet centre at the local origin; radii and the
 * planet radius in the same local units (see createRingGeometry).
 */
import * as THREE from 'three';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../glsl/logdepth';
import { SHADOW_GLSL } from '../glsl/shadow';
import { cameraPositionToLocal, worldDirectionToLocal } from '../util';

export interface RingMaterialOptions {
  strip: THREE.Texture;
  innerRadius: number;
  outerRadius: number;
  planetRadius: number;
  /** Sun irradiance in scene-linear units (same scale as the planet's lighting). */
  sunIntensity?: number;
  /** Angular radius of the Sun seen from the planet, rad (Saturn ≈ 4.9e-4). */
  sunAngularRadius?: number;
  /** Fraction of forward-scattering dust (0–1). */
  dustFraction?: number;
}

export class RingMaterial extends THREE.ShaderMaterial {
  declare uniforms: {
    uStrip: { value: THREE.Texture };
    uInner: { value: number };
    uOuter: { value: number };
    uPlanetRadius: { value: number };
    uSunDir: { value: THREE.Vector3 };
    uCameraLocal: { value: THREE.Vector3 };
    uSunIntensity: { value: number };
    uSunAngularRadius: { value: number };
    uDust: { value: number };
  };
  /** Unit vector toward the Sun in world/render axes; converted to local space before each draw. */
  readonly sunDirectionWorld = new THREE.Vector3(1, 0, 0);

  constructor(opts: RingMaterialOptions) {
    super({
      uniforms: {
        uStrip: { value: opts.strip },
        uInner: { value: opts.innerRadius },
        uOuter: { value: opts.outerRadius },
        uPlanetRadius: { value: opts.planetRadius },
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uCameraLocal: { value: new THREE.Vector3(0, 0, 10) },
        uSunIntensity: { value: opts.sunIntensity ?? 3 },
        uSunAngularRadius: { value: opts.sunAngularRadius ?? 4.9e-4 },
        uDust: { value: opts.dustFraction ?? 0.08 },
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

  /** Update local-space uniforms for `mesh` (call from mesh.onBeforeRender; RingMesh does this for you). */
  updateForMesh(mesh: THREE.Object3D, camera: THREE.Camera): void {
    worldDirectionToLocal(mesh, this.sunDirectionWorld, this.uniforms.uSunDir.value);
    cameraPositionToLocal(mesh, camera, this.uniforms.uCameraLocal.value);
  }
}

/** Flat annulus in the XY plane with enough angular segments that the edge stays round at close range. */
export function createRingGeometry(innerRadius: number, outerRadius: number, segments = 512): THREE.RingGeometry {
  return new THREE.RingGeometry(innerRadius, outerRadius, segments, 1);
}

/** Ring mesh that keeps its material's local-space lighting current. */
export class RingMesh extends THREE.Mesh<THREE.RingGeometry, RingMaterial> {
  constructor(opts: RingMaterialOptions, segments = 512) {
    super(createRingGeometry(opts.innerRadius, opts.outerRadius, segments), new RingMaterial(opts));
    this.onBeforeRender = (_r, _s, camera) => this.material.updateForMesh(this, camera);
  }

  override dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
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
uniform sampler2D uStrip;
uniform float uInner;
uniform float uOuter;
uniform float uPlanetRadius;
uniform vec3 uSunDir;
uniform vec3 uCameraLocal;
uniform float uSunIntensity;
uniform float uSunAngularRadius;
uniform float uDust;
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
  float a = min(strip.a, 0.999);
  if (a <= 0.001) discard;
  float tau = -log(1.0 - a);

  vec3 toCam = normalize(uCameraLocal - vLocal);
  float muV = max(abs(toCam.z), 1e-3);
  float muS = max(abs(uSunDir.z), 1e-3);
  bool litFace = (toCam.z * uSunDir.z) > 0.0;

  float cosTheta = dot(-uSunDir, toCam);
  float phase = mix(hg(cosTheta, -0.35), hg(cosTheta, 0.75), uDust);

  float layer;
  if (litFace) {
    layer = muS / (muS + muV) * (1.0 - exp(-tau * (1.0 / muS + 1.0 / muV)));
  } else {
    float d = muS - muV;
    layer = abs(d) < 1e-4 ? tau / muV * exp(-tau / muV) : muS / d * (exp(-tau / muS) - exp(-tau / muV));
  }
  float shadow = sphereShadow(vLocal, uSunDir, uSunAngularRadius, vec3(0.0), uPlanetRadius);
  vec3 radiance = uSunIntensity * strip.rgb * phase * 0.25 * layer * shadow;
  float viewOpacity = 1.0 - exp(-tau / muV);
  gl_FragColor = vec4(radiance, viewOpacity);
  ${LOGDEPTH_FRAGMENT}
}
`;
