/**
 * The Sun's outer atmosphere as a camera-facing billboard centred on the Sun (depth-tested, additive; the disc and
 * any body in front hide it).
 *
 *  - Visible light: the white-light K + F corona with the Baumbach radial profile (sunPhysics.baumbachCorona),
 *    helmet streamers that narrow outward and favour low latitudes, fine radial rays and polar plumes; a thin pink
 *    chromosphere and prominences, as seen in a total eclipse. The real corona is ~10⁻⁶ of the disc brightness;
 *    here it is ENHANCED (≈ 10⁴×) so it reads around the disc, the way an eclipse or coronagraph shows it.
 *  - Prominences come from today's SDO/AIA 304 Å image off the limb, laid around the current limb by position
 *    angle from projected solar north (exact when viewed from Earth's direction; a reconstruction elsewhere).
 *  - SDO view: the off-limb part of the selected AIA image (304 / 171 / 193 Å), placed the same way.
 */
import * as THREE from 'three';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import { NOISE_GLSL } from '../../render/glsl/noise';
import type { SunImage } from './sunImagery';

/** Billboard half-size in solar radii. */
export const CORONA_OUTER_R = 6;

export class SunCoronaMaterial extends THREE.ShaderMaterial {
  declare uniforms: {
    uRadius: { value: number };
    uOuter: { value: number };
    uIntensity: { value: number };
    uCoronaGain: { value: number };
    uPromGain: { value: number };
    uColor: { value: THREE.Color };
    uWest: { value: THREE.Vector2 };
    uNorth: { value: THREE.Vector2 };
    uTime: { value: number };
    uProm: { value: THREE.Texture | null };
    uPromW: { value: number };
    uPromScale: { value: number };
    uSdo: { value: THREE.Texture | null };
    uSdoLut: { value: THREE.Texture | null };
    uSdoW: { value: number };
    uSdoScale: { value: number };
    uSdoMix: { value: number };
    uSdoGain: { value: number };
    uOpacity: { value: number };
  };

  constructor(color: THREE.Color) {
    super({
      uniforms: {
        uRadius: { value: 1 },
        uOuter: { value: CORONA_OUTER_R },
        uIntensity: { value: 14 },
        uCoronaGain: { value: 0.05 },
        uPromGain: { value: 0.25 },
        uColor: { value: color.clone() },
        uWest: { value: new THREE.Vector2(1, 0) },
        uNorth: { value: new THREE.Vector2(0, 1) },
        uTime: { value: 0 },
        uProm: { value: null },
        uPromW: { value: 0 },
        uPromScale: { value: 0.39 },
        uSdo: { value: null },
        uSdoLut: { value: null },
        uSdoW: { value: 0 },
        uSdoScale: { value: 0.39 },
        uSdoMix: { value: 0 },
        uSdoGain: { value: 1 },
        uOpacity: { value: 1 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
  }

  setProminenceImage(img: SunImage | null): void {
    this.uniforms.uProm.value = img?.texture ?? null;
    this.uniforms.uPromW.value = img ? 1 : 0;
    if (img) this.uniforms.uPromScale.value = img.radiusFrac;
  }

  setSdoImage(img: SunImage | null): void {
    this.uniforms.uSdo.value = img?.texture ?? null;
    this.uniforms.uSdoLut.value = img?.lut ?? null;
    this.uniforms.uSdoW.value = img ? 1 : 0;
    if (img) this.uniforms.uSdoScale.value = img.radiusFrac;
  }
}

const quad = new THREE.PlaneGeometry(2, 2);

export class SunCorona extends THREE.Mesh<THREE.PlaneGeometry, SunCoronaMaterial> {
  constructor(color: THREE.Color) {
    super(quad, new SunCoronaMaterial(color));
    this.frustumCulled = false;
    this.renderOrder = -1;
  }
  override dispose(): void {
    this.material.dispose();
  }
}

// The corona is optically thin: each pixel shows emission integrated along its view ray, which depends on the ray's
// impact parameter (closest approach to the Sun's centre), not on where the ray crosses a plane through the centre —
// up close that plane maps the sky just outside the visible limb to r ≈ 1.5 R and the chromosphere would vanish.
// The quad is therefore only a screen-facing carrier covering every ray with impact parameter < uOuter·R, placed
// halfway to the Sun; the fragment shader works per ray and writes the depth of the ray's closest-approach point.
const VERTEX_SHADER = /* glsl */ `
${VERTEX_PRELUDE}
uniform float uRadius;
uniform float uOuter;
varying vec3 vView;
varying vec3 vCenter;
void main() {
  vec3 c = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float D = length(c);
  float bMax = uRadius * uOuter;
  // Angular radius to cover (capped: inside the corona the quad just has to fill the view).
  float th = min(D > bMax ? asin(bMax / D) : 1.45, 1.45);
  // Screen-facing plane at half the Sun's view depth; off-axis Suns get extra margin from the oblique plane.
  float zp = c.z * 0.5;
  vec3 ctr = c * (zp / c.z);
  float H = abs(zp) * tan(th) * (1.15 + length(c.xy) / max(abs(c.z), 1e-6));
  vec4 mv = vec4(ctr + vec3(position.xy * H, 0.0), 1.0);
  vView = mv.xyz;
  vCenter = c;
  gl_Position = projectionMatrix * mv;
  ${LOGDEPTH_VERTEX}
}
`;

const FRAGMENT_SHADER = /* glsl */ `
${FRAGMENT_PRELUDE}
${NOISE_GLSL}
uniform float uIntensity;
uniform float uCoronaGain;
uniform float uPromGain;
uniform vec3 uColor;
uniform vec2 uWest;
uniform vec2 uNorth;
uniform float uTime;
uniform sampler2D uProm;
uniform float uPromW;
uniform float uPromScale;
uniform sampler2D uSdo;
uniform sampler2D uSdoLut;
uniform float uSdoW;
uniform float uSdoScale;
uniform float uSdoMix;
uniform float uSdoGain;
uniform float uOuter;
uniform float uOpacity;
uniform float uRadius;
varying vec3 vView;
varying vec3 vCenter;

void main() {
  vec3 rd = normalize(vView);
  float b = dot(rd, vCenter);
  if (b <= 0.0) discard;
  // Centre → closest approach of this ray, in solar radii (view space).
  vec3 q = (rd * b - vCenter) / uRadius;
  float r = length(q);
  // Rays that hit the photosphere are hidden by it; the 1 % band under the limb stays so the closest-approach depth
  // (inside the sphere, so behind the mesh) fills the sub-pixel gaps of the polygonal silhouette.
  if (r < 0.99 || r > uOuter) discard;
  // Plane-of-sky coordinates: X toward solar west, Y toward projected solar north (solar radii).
  vec2 q2 = r * normalize(q.xy + vec2(1e-9, 0.0));
  vec2 sky = vec2(dot(q2, uWest), dot(q2, uNorth));
  vec2 dir = sky / r;
  float h = max(r - 1.0, 0.0);

  // ── white-light corona (Baumbach profile, normalised to 1 at the limb) ──
  float base = (0.0532 * pow(r, -2.5) + 1.425 * pow(r, -7.0) + 2.565 * pow(r, -17.0)) / 4.0432;
  float lr = log(r);
  vec3 a3 = vec3(dir, 0.0);
  float sn = simplexNoise3(a3 * 1.9 + vec3(3.1, 7.3, lr * 0.35));
  float streamer = pow(clamp(sn * 0.5 + 0.5, 0.0, 1.0), 1.5 + 3.0 * h);
  float eq = 1.0 - 0.75 * dir.y * dir.y;
  float rays = 0.8 + 0.25 * simplexNoise3(a3 * 26.0 + vec3(0.0, 0.0, lr * 1.5)) + 0.12 * simplexNoise3(a3 * 70.0 + vec3(9.0, 0.0, lr * 3.0));
  float plumes = smoothstep(0.75, 0.95, abs(dir.y));
  if (plumes > 0.0) plumes *= 0.5 + 0.5 * simplexNoise3(a3 * 45.0 + vec3(0.0, 4.0, lr));
  float corona = base * (0.3 + 2.2 * streamer * eq + 0.5 * plumes) * rays;
  // Soft outer fade so the billboard edge never shows.
  corona *= 1.0 - smoothstep(uOuter * 0.6, uOuter, r);
  vec3 col = uColor * corona * uCoronaGain;

  // ── chromosphere rim + prominences (eclipse view) ──
  vec3 hAlpha = vec3(1.0, 0.22, 0.34);
  float chromo = h < 0.04 ? exp(-h / 0.006) * (0.7 + 0.3 * simplexNoise3(a3 * 220.0 + vec3(0.0, 0.0, uTime * 0.01))) : 0.0;
  float prom = 0.0;
  if (uPromW > 0.0 && h < 0.16) {
    vec2 uv = 0.5 + sky * uPromScale;
    float s = pow(texture2D(uProm, uv).r, 2.2); // encoded luma index → ≈ linear luminance
    // Remove the smooth off-limb glow and the faint diffuse 304 haze; keep the structured emission (prominences,
    // spicule forest). Real prominences rarely rise above ~0.1 R☉, so the term falls off with height.
    float bg = 0.22 * exp(-h / 0.025) + 0.06;
    prom = uPromW * smoothstep(0.03, 0.3, s - bg) * exp(-h / 0.06) * (1.0 - smoothstep(0.1, 0.16, h));
  }
  col += hAlpha * (0.35 * chromo + prom) * uPromGain;

  // ── SDO view: the AIA image's own off-limb emission ──
  if (uSdoMix > 0.0) {
    vec3 sdo = vec3(0.0);
    if (uSdoW > 0.0) {
      vec2 uv = 0.5 + sky * uSdoScale;
      float rMax = 0.5 / uSdoScale;
      sdo = texture2D(uSdoLut, vec2(texture2D(uSdo, uv).r * (255.0 / 256.0) + 0.5 / 256.0, 0.5)).rgb * (1.0 - smoothstep(rMax * 0.86, rMax * 0.99, r));
    }
    col = mix(col, sdo * uSdoGain, uSdoMix);
  }

  gl_FragColor = vec4(col * uIntensity * uOpacity, 1.0);
  ${LOGDEPTH_FRAGMENT}
#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
  gl_FragDepth = log2(1.0 + max(-(rd * b).z, 1e-6)) * logDepthBufFC * 0.5;
#endif
}
`;
