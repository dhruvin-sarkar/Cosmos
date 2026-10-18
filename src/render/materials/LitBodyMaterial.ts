/**
 * Baseline lit body: Lambertian sphere lit by the Sun with analytic shadows. Domain modules with bespoke shaders
 * (Earth, gas giants) can use it as a fallback representation and copy its shadow wiring.
 *
 *  L = albedo · E · max(n·s, 0)/π · eclipse · ringShadow [· sunTransmittance through the atmosphere]
 *
 * Local frame: sphere of radius `planetRadius` at the origin (mesh scale converts to render units). Ring shadow:
 * rings in the local XY plane (as RingMesh) using the same strip texture. Eclipse: one spherical occluder (e.g. a
 * moon) given in the same local units. With `atmosphere`, the ground is lit by sunlight filtered through the
 * atmosphere (reddened near the terminator) — pair with an AtmosphereShell for the sky/limb.
 */
import * as THREE from 'three';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../glsl/logdepth';
import { SHADOW_GLSL } from '../glsl/shadow';
import { ATMOSPHERE_GLSL, type AtmosphereParams } from '../glsl/atmosphere';
import { createAtmosphereUniforms } from './AtmosphereShell';
import { worldDirectionToLocal } from '../util';

export interface LitBodyOptions {
  /** Linear albedo colour, or a map (sRGB textures are linearized by three). */
  color?: THREE.ColorRepresentation;
  map?: THREE.Texture | null;
  planetRadius?: number;
  sunIntensity?: number;
  sunAngularRadius?: number;
  ring?: { strip: THREE.Texture; innerRadius: number; outerRadius: number } | null;
  atmosphere?: AtmosphereParams | null;
}

export class LitBodyMaterial extends THREE.ShaderMaterial {
  declare uniforms: Record<string, THREE.IUniform> & {
    uColor: { value: THREE.Color };
    uMap: { value: THREE.Texture | null };
    uPlanetRadius: { value: number };
    uSunDir: { value: THREE.Vector3 };
    uSunIntensity: { value: number };
    uSunAngularRadius: { value: number };
    uRingStrip: { value: THREE.Texture | null };
    uRingRadii: { value: THREE.Vector2 };
    uOccluder: { value: THREE.Vector4 };
  };
  readonly sunDirectionWorld = new THREE.Vector3(1, 0, 0);

  constructor(opts: LitBodyOptions = {}) {
    const defines: Record<string, string> = {};
    if (opts.map) defines.USE_ALBEDO_MAP = '';
    if (opts.ring) defines.USE_RING_SHADOW = '';
    if (opts.atmosphere) defines.USE_ATMOSPHERE = '';
    super({
      defines,
      uniforms: {
        ...(opts.atmosphere ? createAtmosphereUniforms(opts.atmosphere) : {}),
        uColor: { value: new THREE.Color(opts.color ?? 0xb0b0b0) },
        uMap: { value: opts.map ?? null },
        uPlanetRadius: { value: opts.planetRadius ?? 1 },
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uSunIntensity: { value: opts.sunIntensity ?? 5 },
        uSunAngularRadius: { value: opts.sunAngularRadius ?? 4.65e-3 },
        uRingStrip: { value: opts.ring?.strip ?? null },
        uRingRadii: { value: new THREE.Vector2(opts.ring?.innerRadius ?? 0, opts.ring?.outerRadius ?? 0) },
        // xyz = occluder centre (local), w = radius; w ≤ 0 disables the eclipse.
        uOccluder: { value: new THREE.Vector4(0, 0, 0, 0) },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
    });
  }

  /** Convert the world Sun direction to `mesh`'s local frame (call per frame or from onBeforeRender). */
  updateForMesh(mesh: THREE.Object3D): void {
    worldDirectionToLocal(mesh, this.sunDirectionWorld, this.uniforms.uSunDir.value);
  }
}

const VERTEX_SHADER = /* glsl */ `
${VERTEX_PRELUDE}
varying vec3 vLocal;
varying vec2 vUv;
void main() {
  vLocal = position;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  ${LOGDEPTH_VERTEX}
}
`;

const FRAGMENT_SHADER = /* glsl */ `
${FRAGMENT_PRELUDE}
${SHADOW_GLSL}
#ifdef USE_ATMOSPHERE
${ATMOSPHERE_GLSL}
#endif
uniform vec3 uColor;
uniform sampler2D uMap;
uniform float uPlanetRadius;
uniform vec3 uSunDir;
uniform float uSunIntensity;
uniform float uSunAngularRadius;
uniform sampler2D uRingStrip;
uniform vec2 uRingRadii;
uniform vec4 uOccluder;
varying vec3 vLocal;
varying vec2 vUv;

void main() {
  vec3 n = normalize(vLocal);
  vec3 albedo = uColor;
#ifdef USE_ALBEDO_MAP
  albedo *= texture2D(uMap, vUv).rgb;
#endif
  float cosI = dot(n, uSunDir);
  // Soft terminator: fraction of the solar disc above the local horizon (linear in sin of elevation).
  float sinA = sin(uSunAngularRadius);
  float discUp = clamp((cosI + sinA) / (2.0 * sinA), 0.0, 1.0);
  float irr = max(cosI, 0.0) * discUp;
  vec3 light = vec3(irr);
  vec3 p = n * uPlanetRadius;
#ifdef USE_RING_SHADOW
  light *= ringTransmittance(p, uSunDir, vec3(0.0, 0.0, 1.0), uRingRadii.x, uRingRadii.y, uRingStrip);
#endif
  if (uOccluder.w > 0.0) light *= sphereShadow(p, uSunDir, uSunAngularRadius, uOccluder.xyz, uOccluder.w);
#ifdef USE_ATMOSPHERE
  light *= atmosphereSunTransmittance(n * 1.0001, uSunDir);
#endif
  gl_FragColor = vec4(albedo * light * (uSunIntensity * RECIPROCAL_PI), 1.0);
  ${LOGDEPTH_FRAGMENT}
}
`;
