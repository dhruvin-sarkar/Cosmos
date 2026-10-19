/**
 * Moon surface material: LRO WAC albedo + LOLA relief normals, lunar-Lambert photometry (McEwen 1991) with a
 * Hapke-style shadow-hiding opposition surge, Earthshine from the Earth's actual phase, and the Earth's shadow
 * (penumbra + a reddened umbra from light refracted through the Earth's atmosphere).
 *
 * Frame and units: unit sphere in the Moon's IAU body-fixed frame (+x toward the mean sub-Earth point, +z north);
 * lighting vectors are passed in that frame, distances in lunar radii.
 */
import * as THREE from 'three';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT } from '../../render/glsl/logdepth';
import { SHADOW_GLSL } from '../../render/glsl/shadow';
import { createSolidTexture } from '../../render/textures';
import { EARTH_VERTEX, SPHERE_UV_GLSL } from './earthMaterial';

const MOON_FRAGMENT = /* glsl */ `
${FRAGMENT_PRELUDE}
${SHADOW_GLSL}
${SPHERE_UV_GLSL}
uniform sampler2D uColor;
uniform sampler2D uNormal;
uniform vec3 uSunDir;          // body-fixed, unit
uniform vec3 uCamPos;          // body-fixed, lunar radii
uniform vec3 uEarthPos;        // body-fixed, lunar radii
uniform float uEarthRadius;    // lunar radii (incl. the ~2 % atmospheric enlargement of the shadow)
uniform float uSunIntensity;
uniform float uSunAngRadius;
uniform float uEarthshine;     // Earthshine irradiance / solar irradiance (already including the display gain)
uniform float uUmbraGlow;      // red refracted light in the umbra, fraction of sunlight
uniform float uAlbedoGain;
uniform float uNormalStrength;
uniform float uHasNormal;
uniform vec3 uTint;
varying vec3 vPos;

// McEwen (1991) lunar-Lambert limb-darkening weight L(α), α in degrees.
float lunarL(float alphaDeg) {
  float a = alphaDeg;
  return clamp(1.0 - 0.019 * a + 2.42e-4 * a * a - 1.46e-6 * a * a * a, 0.0, 1.0);
}
float lunarLambert(float mu0, float mu, float Lw) {
  if (mu0 <= 0.0) return 0.0;
  return 2.0 * Lw * mu0 / (mu0 + max(mu, 1e-3)) + (1.0 - Lw) * mu0;
}

void main() {
  ${LOGDEPTH_FRAGMENT}
  vec3 p = normalize(vPos);
  vec3 L = uSunDir;
  vec3 V = normalize(uCamPos - p);
  vec2 uv = sphereUv(p);
  vec2 gx, gy;
  sphereUvGrad(uv, gx, gy);
  vec3 east, north;
  sphereTangents(p, east, north);

  vec3 albedo = textureGrad(uColor, uv, gx, gy).rgb * uAlbedoGain * uTint;
  vec3 n = p;
  if (uHasNormal > 0.5 && uNormalStrength > 0.0) {
    vec3 nm = textureGrad(uNormal, uv, gx, gy).xyz * 2.0 - 1.0;
    nm.xy *= uNormalStrength;
    n = normalize(east * nm.x + north * nm.y + p * max(nm.z, 0.05));
  }

  float alpha = acos(clamp(dot(L, V), -1.0, 1.0));
  float alphaDeg = degrees(alpha);
  float Lw = lunarL(alphaDeg);
  float mu0 = dot(n, L);
  float mu = dot(n, V);
  // Self-shadowing at the terminator: relief can't light ground the geometric sphere has turned from the Sun.
  float geo = smoothstep(-0.03, 0.04, dot(p, L));
  float f = lunarLambert(mu0, mu, Lw) * geo;
  // Shadow-hiding opposition surge (Hapke 1986 form, B0 = 0.6, h = 0.06).
  float surge = 1.0 + 0.6 / (1.0 + tan(alpha * 0.5) / 0.06);

  // Earth's shadow: visible solar-disc fraction; reddened, refracted light deep in the umbra.
  vec3 toE = uEarthPos - p;
  float along = dot(toE, L);
  float vis = 1.0;
  vec3 umbraLight = vec3(0.0);
  if (along > 0.0) {
    vis = sphereShadow(p, L, uSunAngRadius, uEarthPos, uEarthRadius);
    float dist = length(toE);
    float occ = asin(min(uEarthRadius / dist, 1.0));
    float sep = 2.0 * asin(min(length(toE / dist - L) * 0.5, 1.0));
    float umbraR = max(occ - uSunAngRadius, 1e-5);
    float depth = clamp(1.0 - sep / umbraR, 0.0, 1.0);          // 0 at the umbra edge, 1 at the axis
    float inUmbra = 1.0 - smoothstep(umbraR * 0.98, umbraR * 1.12, sep);
    // Brighter and more orange toward the edge, deep copper-red toward the axis.
    vec3 tint = mix(vec3(1.0, 0.45, 0.18), vec3(0.85, 0.2, 0.07), depth);
    // Ozone (Chappuis band) lets bluish light through the stratosphere: a faint turquoise fringe at the umbra edge.
    tint += vec3(-0.25, 0.12, 0.3) * smoothstep(0.75, 0.97, sep / umbraR) * (1.0 - smoothstep(0.97, 1.08, sep / umbraR));
    umbraLight = max(tint, 0.0) * uUmbraGlow * (1.0 - 0.45 * depth) * inUmbra * max(dot(p, L), 0.0);
  }

  vec3 color = albedo * RECIPROCAL_PI * uSunIntensity * (f * surge * vis);
  color += albedo * RECIPROCAL_PI * uSunIntensity * umbraLight;

  // Earthshine: diffuse light from the Earth's day side (direction uEarthPos), physically scaled on the CPU.
  vec3 Ed = normalize(uEarthPos);
  float mue = max(dot(n, Ed), 0.0) * smoothstep(-0.05, 0.05, dot(p, Ed));
  color += albedo * RECIPROCAL_PI * uSunIntensity * uEarthshine * mue * vec3(0.86, 0.93, 1.06);

  gl_FragColor = vec4(color, 1.0);
}
`;

export class MoonSurfaceMaterial extends THREE.ShaderMaterial {
  declare uniforms: {
    uColor: { value: THREE.Texture };
    uNormal: { value: THREE.Texture };
    uSunDir: { value: THREE.Vector3 };
    uCamPos: { value: THREE.Vector3 };
    uEarthPos: { value: THREE.Vector3 };
    uEarthRadius: { value: number };
    uSunIntensity: { value: number };
    uSunAngRadius: { value: number };
    uEarthshine: { value: number };
    uUmbraGlow: { value: number };
    uAlbedoGain: { value: number };
    uNormalStrength: { value: number };
    uHasNormal: { value: number };
    uTint: { value: THREE.Vector3 };
  };

  readonly fallbacks: THREE.Texture[];

  constructor() {
    const grey = createSolidTexture(0x5a5a5a);
    const flat = createSolidTexture(0x8080ff);
    flat.colorSpace = THREE.NoColorSpace;
    super({
      uniforms: {
        uColor: { value: grey },
        uNormal: { value: flat },
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uCamPos: { value: new THREE.Vector3(0, 0, 10) },
        uEarthPos: { value: new THREE.Vector3(220, 0, 0) },
        uEarthRadius: { value: 3.74 },
        uSunIntensity: { value: 5 },
        uSunAngRadius: { value: 0.00465 },
        uEarthshine: { value: 0 },
        uUmbraGlow: { value: 0.004 },
        uAlbedoGain: { value: 1.0 },
        uNormalStrength: { value: 0 },
        uHasNormal: { value: 0 },
        uTint: { value: new THREE.Vector3(1.0, 0.95, 0.88) },
      },
      vertexShader: EARTH_VERTEX,
      fragmentShader: MOON_FRAGMENT,
    });
    this.fallbacks = [grey, flat];
  }

  override dispose(): void {
    for (const t of this.fallbacks) t.dispose();
    super.dispose();
  }
}
