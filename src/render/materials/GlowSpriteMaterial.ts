/**
 * Camera-facing soft glow (corona/scattered light around emissive bodies, markers for unresolved sources).
 *
 * Profile: a Lorentzian 1/(1 + (r/r₀)²) — the shape of light scattered in optics and thin media — offset and
 * renormalized so it reaches exactly 0 at the sprite edge (no visible disc boundary). HDR colour × intensity, so
 * bright glows feed bloom. The quad sits at the object's centre and is depth-tested: a body's own sphere hides
 * the part of the glow in front of its disc, other bodies occlude it naturally. "Depth fade" fades the sprite out
 * as the camera approaches (so it never fills the screen) and beyond a far distance (both in render units).
 */
import * as THREE from 'three';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../glsl/logdepth';

export interface GlowSpriteOptions {
  /** Linear-sRGB colour (e.g. from blackbodyLinearSrgb). */
  color?: THREE.ColorRepresentation;
  /** HDR multiplier of the colour at the glow centre. */
  intensity?: number;
  /** Core radius as a fraction of the sprite radius (smaller = tighter glow). */
  coreFraction?: number;
  /** Minimum on-screen radius, CSS px (keeps distant glows visible). */
  minRadiusPx?: number;
  blending?: THREE.Blending;
}

export class GlowSpriteMaterial extends THREE.ShaderMaterial {
  declare uniforms: {
    uColor: { value: THREE.Color };
    uIntensity: { value: number };
    uCore: { value: number };
    uRadius: { value: number };
    uMinRadiusPx: { value: number };
    uViewportHeightPx: { value: number };
    uFade: { value: THREE.Vector4 };
    uOpacity: { value: number };
  };

  constructor(opts: GlowSpriteOptions = {}) {
    super({
      uniforms: {
        uColor: { value: new THREE.Color(opts.color ?? 0xffffff) },
        uIntensity: { value: opts.intensity ?? 1 },
        uCore: { value: opts.coreFraction ?? 0.12 },
        uRadius: { value: 1 },
        uMinRadiusPx: { value: opts.minRadiusPx ?? 0 },
        uViewportHeightPx: { value: 1080 },
        // near fade start/end, far fade start/end (render units); far end ≤ 0 disables the far fade.
        uFade: { value: new THREE.Vector4(0, 0, 0, 0) },
        uOpacity: { value: 1 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      blending: opts.blending ?? THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
  }

  /** Sprite radius in render units (set when the scale changes). */
  setRadius(radiusRender: number): void {
    this.uniforms.uRadius.value = radiusRender;
  }

  setViewportHeight(cssPx: number): void {
    this.uniforms.uViewportHeightPx.value = cssPx;
  }

  /** Fade in between nearStart→nearEnd and out between farStart→farEnd (render units from the camera). */
  setDepthFade(nearStart: number, nearEnd: number, farStart = 0, farEnd = 0): void {
    this.uniforms.uFade.value.set(nearStart, nearEnd, farStart, farEnd);
  }
}

const sharedQuad = new THREE.PlaneGeometry(2, 2);

/** A Mesh carrying a GlowSpriteMaterial on a shared quad. Position it at the glowing object's render position. */
export class GlowSprite extends THREE.Mesh<THREE.PlaneGeometry, GlowSpriteMaterial> {
  constructor(opts: GlowSpriteOptions = {}) {
    super(sharedQuad, new GlowSpriteMaterial(opts));
    this.frustumCulled = false;
  }

  override dispose(): void {
    this.material.dispose();
  }
}

const VERTEX_SHADER = /* glsl */ `
${VERTEX_PRELUDE}
uniform float uRadius;
uniform float uMinRadiusPx;
uniform float uViewportHeightPx;
uniform vec4 uFade;
varying vec2 vUv;
varying float vFade;

void main() {
  vec4 mvCenter = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float dist = max(-mvCenter.z, 1e-30);
  // Render units per CSS px at this depth: 2·dist / (P[1][1]·H).
  float unitsPerPx = 2.0 * dist / (projectionMatrix[1][1] * uViewportHeightPx);
  float radius = max(uRadius, uMinRadiusPx * unitsPerPx);
  vUv = position.xy;
  float d = length(mvCenter.xyz);
  float nearFade = uFade.y > uFade.x ? smoothstep(uFade.x, uFade.y, d) : 1.0;
  float farFade = uFade.w > uFade.z ? 1.0 - smoothstep(uFade.z, uFade.w, d) : 1.0;
  vFade = nearFade * farFade;
  gl_Position = projectionMatrix * (mvCenter + vec4(position.xy * radius, 0.0, 0.0));
  ${LOGDEPTH_VERTEX}
}
`;

const FRAGMENT_SHADER = /* glsl */ `
${FRAGMENT_PRELUDE}
uniform vec3 uColor;
uniform float uIntensity;
uniform float uCore;
uniform float uOpacity;
varying vec2 vUv;
varying float vFade;

void main() {
  float r = length(vUv);
  if (r >= 1.0) discard;
  float k = 1.0 / (uCore * uCore);
  float edge = 1.0 / (1.0 + k);
  float g = (1.0 / (1.0 + r * r * k) - edge) / (1.0 - edge);
  gl_FragColor = vec4(uColor * (uIntensity * g * vFade * uOpacity), 1.0);
  ${LOGDEPTH_FRAGMENT}
}
`;
