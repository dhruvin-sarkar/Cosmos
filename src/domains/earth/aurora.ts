/**
 * Illustrative aurora: auroral ovals around both geomagnetic poles, driven by the observed Kp index (./spaceWeather).
 *
 * A shell from 85 to 400 km is ray-marched per fragment in the Earth body-fixed frame (planet radii). Emission:
 *   - oval position: magnetic latitude band whose equatorward edge moves from ~77° (noon) / ~66° (midnight) toward the
 *     equator as Kp rises (Starkov 1994, linearised); widest and brightest in the midnight sector;
 *   - height profile: O(¹S) 557.7 nm green peaking at ~110 km with a long upper tail, O(¹D) 630.0 nm red above ~200 km
 *     (stronger in storms), a thin N₂⁺ 427.8 nm violet fringe at the lower edge (~95 km);
 *   - curtains: rayed structure along magnetic longitude with slow folds (procedural; real auroral morphology is not
 *     modelled — hence 'illustrative, driven by observed Kp').
 * Only atmosphere in the Earth's shadow emits visibly (against the sunlit disc an aurora is ~10⁻⁶ as bright).
 * Like Earthshine, the radiance carries a disclosed low-light display gain. Additive, nothing clamped.
 */
import * as THREE from 'three';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT } from '../../render/glsl/logdepth';
import { EARTH_VERTEX } from './earthMaterial';

/** Shell top / bottom in Earth radii (400 km / 85 km). */
export const AURORA_TOP = 1 + 400 / 6371.0084;
const AURORA_BOTTOM_KM = 85;

const AURORA_FRAGMENT = /* glsl */ `
${FRAGMENT_PRELUDE}
uniform vec3 uCamPos;      // body-fixed, Earth radii
uniform vec3 uSunDir;      // body-fixed, unit
uniform vec3 uDipole;      // body-fixed, unit (geomagnetic north)
uniform float uEqMidnight; // equatorward oval edge at magnetic midnight, deg
uniform float uEqNoon;     // equatorward oval edge at magnetic noon, deg
uniform float uKp;
uniform float uGain;       // overall emission (Kp brightness × display gain)
uniform float uTime;       // animation phase (s)
uniform float uTop;
uniform sampler2D uNoise;  // 1-D periodic noise along magnetic longitude (R fine, B medium, A coarse)
varying vec3 vPos;

const float R_KM = 6371.0;
const vec3 GREEN = vec3(0.25, 1.0, 0.45);
const vec3 RED = vec3(1.0, 0.07, 0.10);
const vec3 VIOLET = vec3(0.42, 0.10, 1.0);
#ifndef STEPS
#define STEPS 24
#endif

vec2 raySphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float h = b * b - c;
  if (h < 0.0) return vec2(1.0, -1.0);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}
void main() {
  ${LOGDEPTH_FRAGMENT}
  vec3 ro = uCamPos;
  vec3 rd = normalize(vPos - ro);
  vec2 top = raySphere(ro, rd, uTop);
  if (top.y <= 0.0) discard;
  float t0 = max(top.x, 0.0);
  float t1 = top.y;
  vec2 g = raySphere(ro, rd, 1.0);
  if (g.x < g.y && g.y > 0.0) t1 = min(t1, max(g.x, 0.0));
  if (t1 <= t0) discard;

  // Quick reject: the ray never reaches magnetic latitudes the oval can occupy.
  float mMin = sin(radians(uEqMidnight - 6.0));
  vec3 qa = ro + rd * t0, qb = ro + rd * t1, qm = ro + rd * (0.5 * (t0 + t1));
  float mx = max(max(abs(dot(normalize(qa), uDipole)), abs(dot(normalize(qb), uDipole))), abs(dot(normalize(qm), uDipole)));
  if (mx < mMin - 0.08) discard;
  // Entirely sunlit path (dot(q, L) is linear along the ray, so positive at both ends means positive throughout).
  if (dot(qa, uSunDir) > 0.0 && dot(qb, uSunDir) > 0.0) discard;

  // Magnetic local time frame: sp → magnetic noon, dusk = east of noon.
  vec3 sp = normalize(uSunDir - uDipole * dot(uSunDir, uDipole) + vec3(1e-6, 0.0, 0.0));
  vec3 dusk = cross(uDipole, sp);

  float dt = (t1 - t0) / float(STEPS);
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  vec3 col = vec3(0.0);
  float redW = 0.025 + 0.015 * uKp;   // O(1D) red grows in storms but stays fainter than the green line
  for (int i = 0; i < STEPS; i++) {
    vec3 q = ro + rd * (t0 + (float(i) + jitter) * dt);
    float r = length(q);
    float h = (r - 1.0) * R_KM;
    if (h < ${AURORA_BOTTOM_KM.toFixed(1)}) continue;
    vec3 n = q / r;
    float m = dot(n, uDipole);
    float mlat = degrees(asin(min(abs(m), 1.0)));
    if (mlat < uEqMidnight - 4.0) continue;
    // Only air in the Earth's shadow (with a soft penumbra) shows the glow.
    float sq = dot(q, uSunDir);
    float shadow = sq > 0.0 ? 0.0 : 1.0 - smoothstep(0.985, 1.02, sqrt(max(r * r - sq * sq, 0.0)));
    if (shadow < 0.01) continue;
    vec3 np = n - uDipole * m;
    float lp = max(length(np), 1e-4);
    float cphi = dot(np, sp) / lp;
    float sphi = dot(np, dusk) / lp;
    float mid = 0.5 - 0.5 * cphi;                       // 1 at magnetic midnight
    float mlon = atan(sphi, -cphi) + (m < 0.0 ? 2.1 : 0.0); // 0 at midnight; offset decorrelates the hemispheres
    float eq = mix(uEqNoon, uEqMidnight, mid);
    float width = mix(2.0 + 0.2 * uKp, 4.0 + 0.8 * uKp, mid);
    // Folds and surges of the arcs (integer harmonics of magnetic longitude: continuous around the oval).
    float fold = 0.9 * sin(mlon * 3.0 + uTime * 0.013 + 1.3) + 0.55 * sin(mlon * 7.0 - uTime * 0.021 + 0.4)
      + 0.3 * sin(mlon * 17.0 + uTime * 0.05);
    float x = mlat - eq - fold;
    if (x < -2.5 || x > width + 3.0) continue;
    // Diffuse aurora filling the oval, in slowly evolving patches.
    float band = smoothstep(-1.0, 0.5, x) * (1.0 - smoothstep(width * 0.45, width + 1.5, x));
    float u = mlon * (0.5 / 3.14159265);   // one revolution of the oval = 1 in u (the noise texture repeats)
    vec4 nz0 = texture2D(uNoise, vec2(u + uTime * 0.0004, 0.5));
    float patches = 0.45 + 0.55 * nz0.b;
    // Discrete arcs: a bright one at the equatorward edge, a weaker one poleward (substorm double oval), rayed along
    // the arc (curtains seen from above appear as fine bright striations along the band).
    float arc = exp(-pow((x - 0.4) / 0.9, 2.0));
    float fold2 = 0.6 * sin(mlon * 5.0 - uTime * 0.017 + 2.0);
    float arc2 = exp(-pow((x - 0.45 * width - 1.0 - fold2) / 0.6, 2.0)) * 0.2;
    float rays = texture2D(uNoise, vec2(u * 2.0 + uTime * 0.0011, 0.5)).r * 0.6 + texture2D(uNoise, vec2(u * 5.0 - uTime * 0.004, 0.5)).r * 0.4;
    rays = 0.35 + 0.65 * rays * rays;
    float surge = 0.4 + 0.6 * smoothstep(0.25, 0.75, texture2D(uNoise, vec2(u - uTime * 0.0006 + 0.37, 0.5)).a);
    float em = (0.12 * band * patches + (arc + arc2) * rays * surge) * (0.25 + 0.75 * mid * mid);
    float pg = h < 110.0 ? exp(-pow((h - 110.0) / 9.0, 2.0)) : exp(-(h - 110.0) / 38.0);
    float pr = exp(-pow((h - 240.0) / 75.0, 2.0)) * redW;
    float pv = exp(-pow((h - 98.0) / 7.0, 2.0)) * 0.12;
    col += (GREEN * pg + RED * pr + VIOLET * pv) * (em * shadow);
  }
  // Long grazing paths at the limb would pile emission into a hard outline: normalise beyond ~300 km of shell path (about a vertical column).
  col *= uGain * dt / max(1.0, (t1 - t0) * R_KM / 300.0);
  gl_FragColor = vec4(col, 1.0);
}
`;

const NOISE_W = 1024;

/** Periodic blurred value noise: channel blur radii (texels) set the feature scale (fine rays → coarse surges). */
function createAuroraNoise(): THREE.DataTexture {
  let seed = 0x2f6b1d;
  const rnd = (): number => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const data = new Uint8Array(NOISE_W * 4);
  const sigmas = [1.2, 2.5, 7, 13];
  for (let c = 0; c < 4; c++) {
    const raw = new Float32Array(NOISE_W);
    for (let i = 0; i < NOISE_W; i++) raw[i] = rnd();
    const sg = sigmas[c]!;
    const r = Math.ceil(sg * 3);
    const out = new Float32Array(NOISE_W);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < NOISE_W; i++) {
      let acc = 0, wsum = 0;
      for (let k = -r; k <= r; k++) {
        const w = Math.exp(-(k * k) / (2 * sg * sg));
        acc += raw[(i + k + NOISE_W) % NOISE_W]! * w;
        wsum += w;
      }
      out[i] = acc / wsum;
      lo = Math.min(lo, out[i]!);
      hi = Math.max(hi, out[i]!);
    }
    for (let i = 0; i < NOISE_W; i++) data[i * 4 + c] = Math.round(((out[i]! - lo) / Math.max(hi - lo, 1e-6)) * 255);
  }
  const tex = new THREE.DataTexture(data, NOISE_W, 1, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export class AuroraMaterial extends THREE.ShaderMaterial {
  declare uniforms: {
    uCamPos: { value: THREE.Vector3 };
    uSunDir: { value: THREE.Vector3 };
    uDipole: { value: THREE.Vector3 };
    uEqMidnight: { value: number };
    uEqNoon: { value: number };
    uKp: { value: number };
    uGain: { value: number };
    uTime: { value: number };
    uTop: { value: number };
    uNoise: { value: THREE.DataTexture };
  };

  constructor() {
    super({
      uniforms: {
        uCamPos: { value: new THREE.Vector3(0, 0, 10) },
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uDipole: { value: new THREE.Vector3(0, 0, 1) },
        uEqMidnight: { value: 62 },
        uEqNoon: { value: 75 },
        uKp: { value: 2 },
        uGain: { value: 0 },
        uTime: { value: 0 },
        uTop: { value: AURORA_TOP },
        uNoise: { value: createAuroraNoise() },
      },
      vertexShader: EARTH_VERTEX,
      fragmentShader: AURORA_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
    });
  }

  override dispose(): void {
    this.uniforms.uNoise.value.dispose();
    super.dispose();
  }

  /** Ray-march steps (24 by default; fewer on low quality). */
  setSteps(n: number): void {
    if (this.defines.STEPS !== n) {
      this.defines.STEPS = n;
      this.needsUpdate = true;
    }
  }

  /** Outside the shell: front faces, depth-tested. Inside (low orbit): back faces, planet occlusion is analytic. */
  setInside(inside: boolean): void {
    const side = inside ? THREE.BackSide : THREE.FrontSide;
    if (this.side !== side) {
      this.side = side;
      this.depthTest = !inside;
      this.needsUpdate = true;
    }
  }
}
