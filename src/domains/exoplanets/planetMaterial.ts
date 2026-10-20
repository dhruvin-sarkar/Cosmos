/**
 * Procedural exoplanet surface: an ARTIST'S IMPRESSION driven by physical parameters (planet class, insolation,
 * illustrative climate state, tidal locking, thermal emission). Scene-linear HDR, no tone mapping, no ambient light:
 * the night side is black except for the planet's own thermal glow.
 *
 * Local frame: unit sphere, +Z = spin axis. All noise is evaluated on the 3-D unit vector, so there are no seams at
 * the antimeridian or the poles. Up to two stars light the planet (circumbinary systems).
 *
 *  - rocky (kind 0): fBm continents / basins, screen-space bump relief (Mikkelsen 2010) at the terminator, oceans with a
 *    sun glint, polar or night-side ("eyeball", Pierrehumbert 2011) ice, clouds, lava cracks with blackbody emission;
 *    lunar-Lambert BRDF for airless worlds, Lambert under an atmosphere.
 *  - giant (kind 1): latitude bands with domain-warped turbulence, Minnaert limb darkening, optional haze.
 */
import * as THREE from 'three';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import { NOISE_GLSL } from '../../render/glsl/noise';

export interface PlanetLook {
  kind: 0 | 1;
  colA: THREE.Color;
  colB: THREE.Color;
  colC: THREE.Color;
  ocean: number;
  ice: number;
  cloud: number;
  haze: number;
  hazeColor: THREE.Color;
  bandFreq: number;
  bandContrast: number;
  turbulence: number;
  lava: number;
  /** 1 = airless (lunar-Lambert), 0 = atmosphere (Lambert). */
  airless: number;
  relief: number;
  minnaertK: number;
  seed: number;
  /** 1 = synchronous rotation (eyeball ice / substellar pattern). */
  locked: number;
  /** Scene-linear thermal radiance at the substellar point / night side, per unit exposure (multiplied in the layer). */
  emitDay: THREE.Color;
  emitNight: THREE.Color;
  /** Rayleigh-ish limb colour of an atmosphere (0 = none). */
  limb: THREE.Color;
}

export class ExoPlanetMaterial extends THREE.ShaderMaterial {
  declare uniforms: {
    uKind: { value: number };
    uColA: { value: THREE.Color };
    uColB: { value: THREE.Color };
    uColC: { value: THREE.Color };
    uSurf: { value: THREE.Vector4 };
    uHaze: { value: number };
    uHazeColor: { value: THREE.Color };
    uBand: { value: THREE.Vector3 };
    uLava: { value: number };
    uAirless: { value: number };
    uRelief: { value: number };
    uMinnaert: { value: number };
    uSeed: { value: number };
    uLocked: { value: number };
    uEmitDay: { value: THREE.Color };
    uEmitNight: { value: THREE.Color };
    uEmitGain: { value: number };
    uLimb: { value: THREE.Color };
    uL0Dir: { value: THREE.Vector3 };
    uL0: { value: THREE.Color };
    uL1Dir: { value: THREE.Vector3 };
    uL1: { value: THREE.Color };
    uCamLocal: { value: THREE.Vector3 };
    uTime: { value: number };
  };

  constructor(look: PlanetLook) {
    super({
      uniforms: {
        uKind: { value: look.kind },
        uColA: { value: look.colA.clone() },
        uColB: { value: look.colB.clone() },
        uColC: { value: look.colC.clone() },
        uSurf: { value: new THREE.Vector4(look.ocean, look.ice, look.cloud, look.turbulence) },
        uHaze: { value: look.haze },
        uHazeColor: { value: look.hazeColor.clone() },
        uBand: { value: new THREE.Vector3(look.bandFreq, look.bandContrast, 0) },
        uLava: { value: look.lava },
        uAirless: { value: look.airless },
        uRelief: { value: look.relief },
        uMinnaert: { value: look.minnaertK },
        uSeed: { value: look.seed },
        uLocked: { value: look.locked },
        uEmitDay: { value: look.emitDay.clone() },
        uEmitNight: { value: look.emitNight.clone() },
        uEmitGain: { value: 1 },
        uLimb: { value: look.limb.clone() },
        uL0Dir: { value: new THREE.Vector3(1, 0, 0) },
        uL0: { value: new THREE.Color(0, 0, 0) },
        uL1Dir: { value: new THREE.Vector3(1, 0, 0) },
        uL1: { value: new THREE.Color(0, 0, 0) },
        uCamLocal: { value: new THREE.Vector3(0, 0, 5) },
        uTime: { value: 0 },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
    });
  }
}

const VERTEX = /* glsl */ `
${VERTEX_PRELUDE}
varying vec3 vObj;
void main() {
  vObj = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  ${LOGDEPTH_VERTEX}
}
`;

const FRAGMENT = /* glsl */ `
${FRAGMENT_PRELUDE}
${NOISE_GLSL}
uniform float uKind;
uniform vec3 uColA, uColB, uColC;
uniform vec4 uSurf; // ocean, ice, cloud, turbulence
uniform float uHaze;
uniform vec3 uHazeColor;
uniform vec3 uBand; // freq, contrast
uniform float uLava, uAirless, uRelief, uMinnaert, uSeed, uLocked;
uniform vec3 uEmitDay, uEmitNight;
uniform float uEmitGain;
uniform vec3 uLimb;
uniform vec3 uL0Dir, uL0, uL1Dir, uL1;
uniform vec3 uCamLocal;
uniform float uTime;
varying vec3 vObj;

float lunarLambert(float mu0, float mu, float L) {
  return 2.0 * L * mu0 / max(mu0 + mu, 1e-4) + (1.0 - L) * mu0;
}

vec3 lightTerm(vec3 n, vec3 g, vec3 v, vec3 l, vec3 E, vec3 albedo, float spec, float hazeK) {
  float mu0 = dot(n, l);
  float mu = max(dot(n, v), 0.0);
  // Soft terminator (finite stellar disc + atmospheric refraction-ish softening), on the geometric normal g so relief
  // can shade the day side but never light the night side.
  float w = smoothstep(-0.04, 0.10, dot(g, l));
  float m0 = max(mu0, 0.0);
  float brdf;
  if (uKind > 0.5) {
    brdf = pow(max(m0, 1e-4), uMinnaert) * pow(max(mu, 1e-3), uMinnaert - 1.0);
  } else {
    float alpha = acos(clamp(dot(l, v), -1.0, 1.0));
    float LL = exp(-alpha / 1.047);
    brdf = mix(m0, lunarLambert(m0, mu, LL), uAirless);
  }
  vec3 c = albedo * brdf * w / PI;
  // Ocean glint (Blinn-Phong as a stand-in for a rough Fresnel water surface).
  vec3 h = normalize(l + v);
  c += spec * pow(max(dot(n, h), 0.0), 220.0) * 0.6 * w * (0.02 + 0.98 * pow(1.0 - max(dot(h, v), 0.0), 5.0)) * 8.0;
  return c * E;
}

void main() {
  vec3 p = normalize(vObj);
  vec3 n = p;
  vec3 v = normalize(uCamLocal - vObj);
  vec3 sd = normalize(uL0Dir);
  vec3 seedV = vec3(uSeed * 37.0, uSeed * 17.0, uSeed * 91.0);
  vec3 albedo;
  float spec = 0.0;
  float lavaMask = 0.0;
  float cloud = 0.0;

  if (uKind < 0.5) {
    // ── Rocky ──
    vec3 q = domainWarp3(p * 1.6 + seedV, 0.35);
    float h = fbm3(q * 1.8, 6);
    float fine = fbm3(p * 22.0 + seedV, 4);
    float height = h + 0.12 * fine;
    float sea = mix(-1.0, 0.55, clamp(uSurf.x, 0.0, 1.0)) - 0.18 * (1.0 - step(0.001, uSurf.x));
    float isOcean = uSurf.x > 0.001 ? 1.0 - smoothstep(sea - 0.01, sea + 0.01, height) : 0.0;
    vec3 land = mix(uColA, uColB, smoothstep(-0.3, 0.6, height));
    land = mix(land, uColC, 0.35 * smoothstep(0.2, 0.9, fine * 0.5 + 0.5));
    vec3 ocean = vec3(0.012, 0.03, 0.065) * (0.8 + 0.4 * smoothstep(sea - 0.25, sea, height));
    albedo = mix(land, ocean, isOcean);
    spec = isOcean;
    // Relief: screen-space bump on the land height.
    // Continuous at the coast (0 at sea level) and low-frequency only: screen-space derivatives are constant per 2×2
    // pixel quad, so a discontinuous or high-frequency height turns into blocky shading close up.
    // The bump uses the first 3 octaves of the same field (features of tens of pixels even close up).
    float hb = fbm3(q * 1.8, 3);
    float bh = 0.6 * uRelief * (uSurf.x > 0.001 ? max(hb - sea, 0.0) : hb + 1.0);
    vec3 dpdx = dFdx(vObj), dpdy = dFdy(vObj);
    float dhx = dFdx(bh), dhy = dFdy(bh);
    vec3 r1 = cross(dpdy, n), r2 = cross(n, dpdx);
    float det = dot(dpdx, r1);
    if (abs(det) > 1e-12) {
      vec3 grad = sign(det) * (dhx * r1 + dhy * r2) / abs(det);
      // Bound the tilt (≤ ~22°): close up the screen-space derivative of the fine octaves would otherwise flip normals.
      float gl = length(grad);
      if (gl > 0.4) grad *= 0.4 / gl;
      n = normalize(n - grad);
    }
    // Ice: polar caps, or the night side for synchronous rotators (an "eyeball" world).
    float ice = clamp(uSurf.y, 0.0, 1.0);
    float iceN = 0.08 * fbm3(p * 6.0 + seedV, 3);
    float polar = smoothstep(1.0 - ice * 1.15 - 0.02, 1.0 - ice * 1.15 + 0.06, abs(p.z) + iceN);
    float eyeball = smoothstep(1.0 - 2.0 * ice - 0.05, 1.0 - 2.0 * ice + 0.08, -dot(p, sd) * 0.5 + 0.5 + iceN);
    float iceMask = mix(polar, eyeball, uLocked) * step(0.001, ice);
    albedo = mix(albedo, vec3(0.72, 0.76, 0.8), iceMask);
    spec *= 1.0 - iceMask;
    // Lava: glowing cracks between dark crust plates (strongest on the day side of a locked world).
    if (uLava > 0.0) {
      float cracks = 1.0 - smoothstep(0.0, 0.06, abs(fbm3(p * 5.0 + seedV * 1.3, 5)));
      float pool = smoothstep(0.25, 0.6, fbm3(p * 2.5 + seedV, 4));
      lavaMask = uLava * max(cracks, pool) * mix(1.0, smoothstep(-0.3, 0.6, dot(p, sd)), uLocked);
      albedo = mix(albedo, vec3(0.05, 0.03, 0.02), lavaMask);
    }
    // Clouds (slow drift).
    if (uSurf.z > 0.001) {
      float ang = uTime * 0.02;
      vec3 cp = vec3(p.x * cos(ang) - p.y * sin(ang), p.x * sin(ang) + p.y * cos(ang), p.z);
      float c = fbm3(domainWarp3(cp * 2.5 + seedV * 2.0, 0.6) * 1.7, 6) * 0.5 + 0.5;
      cloud = smoothstep(1.0 - uSurf.z - 0.08, 1.0 - uSurf.z + 0.12, c);
      albedo = mix(albedo, vec3(0.8), cloud * 0.92);
      spec *= 1.0 - cloud;
    }
  } else {
    // ── Giant: zonal bands with turbulence ──
    float lat = p.z;
    vec3 wp = domainWarp3(vec3(p.xy * 2.0, p.z * 9.0) + seedV, 0.5 * uSurf.w);
    float turb = fbm3(vec3(wp.xy * 1.5, wp.z * 3.0), 6);
    float b = sin((lat + 0.06 * turb * uSurf.w) * uBand.x * PI + uSeed * 6.0);
    float b2 = sin((lat + 0.03 * turb) * uBand.x * 2.3 * PI + uSeed * 3.0);
    float bands = 0.5 + 0.5 * (0.75 * b + 0.25 * b2);
    albedo = mix(uColA, uColB, smoothstep(0.5 - 0.5 * uBand.y, 0.5 + 0.5 * uBand.y, bands));
    albedo = mix(albedo, uColC, 0.25 * smoothstep(0.3, 0.9, turb * 0.5 + 0.5) * uBand.y);
    // Polar darkening / haze of giant atmospheres.
    albedo *= 1.0 - 0.25 * smoothstep(0.6, 0.95, abs(lat));
  }

  // Haze: flattens contrast toward the haze colour, brighter toward the limb.
  float mu = max(dot(p, v), 0.0);
  float hz = clamp(uHaze, 0.0, 1.0);
  albedo = mix(albedo, uHazeColor, hz * (0.55 + 0.45 * (1.0 - mu)));
  spec *= 1.0 - hz;

  vec3 col = lightTerm(n, p, v, normalize(uL0Dir), uL0, albedo, spec, hz);
  col += lightTerm(n, p, v, normalize(uL1Dir), uL1, albedo, spec, hz);

  // Thin atmospheric limb on the lit side.
  if (dot(uLimb, uLimb) > 0.0) {
    float rim = pow(1.0 - mu, 3.0);
    float lit = smoothstep(-0.15, 0.35, dot(p, normalize(uL0Dir)));
    col += uLimb * rim * lit * (uL0.r + uL0.g + uL0.b) * 0.08;
  }

  // Thermal emission (blackbody radiance from the layer, per channel).
  float cz = dot(p, sd);
  float dayW = smoothstep(-0.25, 1.0, cz);
  vec3 emit = mix(uEmitNight, uEmitDay, dayW) * (uKind > 0.5 ? (0.85 + 0.3 * fbm3(p * 4.0 + seedV, 3)) : 1.0);
  if (uLava > 0.0) emit = uEmitDay * lavaMask * (0.6 + 0.4 * dayW) + uEmitNight;
  col += emit * uEmitGain * (1.0 - 0.6 * cloud);

  gl_FragColor = vec4(col, 1.0);
  ${LOGDEPTH_FRAGMENT}
}
`;
