/**
 * Equirectangular ICRS sky at infinity, drawn as one full-screen triangle.
 *
 * Each pixel reconstructs its view ray (inverse projection + camera world rotation, which in Cosmos *is* the ICRS
 * orientation because render space is ICRS-aligned), converts it to (RA, Dec) and samples the map with the project
 * sky-map convention:
 *     RA  = 360° · (x + 0.5) / W   increasing to the RIGHT of the image (x from the left edge)
 *     Dec = 90° − 180° · (y + 0.5) / H                                  (y from the top edge)
 * i.e. texture u = RA / 360°, v = (Dec + 90°) / 180° for a texture with flipY = true (three's default for images).
 * For flipY = false data textures pass `flipY: false` so v is mirrored.
 *
 * Two textures can be cross-faded (spectral view switcher). Mip selection uses analytic gradients with the RA seam
 * handled (Tarini 2012), so there is no one-pixel seam line at RA = 0h. Depth: z = w (far plane) and gl_FragDepth = 1
 * under log depth; the material does not depth-test or write, matching the `background` render group.
 */
import * as THREE from 'three';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_FRAGMENT_AT_INFINITY, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from './glsl/logdepth';

export interface SkySphereOptions {
  texture?: THREE.Texture | null;
  /** Multiplier on the map's linear values. */
  exposure?: number;
  flipY?: boolean;
}

/** u, v (0–1) for an ICRS unit direction — TS mirror of the shader mapping (flipY = true). */
export function icrsDirectionToSkyUv(x: number, y: number, z: number, out: { u: number; v: number } = { u: 0, v: 0 }): { u: number; v: number } {
  let ra = Math.atan2(y, x);
  if (ra < 0) ra += 2 * Math.PI;
  const dec = Math.asin(Math.max(-1, Math.min(1, z / Math.hypot(x, y, z))));
  out.u = ra / (2 * Math.PI);
  out.v = (dec + Math.PI / 2) / Math.PI;
  return out;
}

/** Image pixel (x from left, y from top) → (RA, Dec) in degrees, per the sky-map convention. */
export function skyPixelToRaDec(x: number, y: number, width: number, height: number): { raDeg: number; decDeg: number } {
  return { raDeg: (360 * (x + 0.5)) / width, decDeg: 90 - (180 * (y + 0.5)) / height };
}

export class SkySphereMaterial extends THREE.ShaderMaterial {
  declare uniforms: {
    uMapA: { value: THREE.Texture | null };
    uMapB: { value: THREE.Texture | null };
    uMix: { value: number };
    uExposure: { value: number };
    uFlipY: { value: number };
    uInvProjection: { value: THREE.Matrix4 };
    uCameraRotation: { value: THREE.Matrix3 };
  };

  constructor(opts: SkySphereOptions = {}) {
    super({
      uniforms: {
        uMapA: { value: opts.texture ?? null },
        uMapB: { value: null },
        uMix: { value: 0 },
        uExposure: { value: opts.exposure ?? 1 },
        uFlipY: { value: opts.flipY === false ? 0 : 1 },
        uInvProjection: { value: new THREE.Matrix4() },
        uCameraRotation: { value: new THREE.Matrix3() },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
    });
  }
}

let triangle: THREE.BufferGeometry | null = null;
function fullScreenTriangle(): THREE.BufferGeometry {
  if (!triangle) {
    triangle = new THREE.BufferGeometry();
    triangle.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  }
  return triangle;
}

export class SkySphere extends THREE.Mesh<THREE.BufferGeometry, SkySphereMaterial> {
  private fadeFrom = 0;
  private fadeTo = 0;
  private fadeStartMs = 0;
  private fadeDurationMs = 0;

  constructor(opts: SkySphereOptions = {}) {
    super(fullScreenTriangle(), new SkySphereMaterial(opts));
    this.frustumCulled = false;
    this.renderOrder = -1000;
    this.onBeforeRender = (_r, _s, camera) => {
      const u = this.material.uniforms;
      u.uInvProjection.value.copy(camera.projectionMatrixInverse);
      u.uCameraRotation.value.setFromMatrix4(camera.matrixWorld);
      if (this.fadeDurationMs > 0) {
        const t = Math.min(1, (performance.now() - this.fadeStartMs) / this.fadeDurationMs);
        u.uMix.value = this.fadeFrom + (this.fadeTo - this.fadeFrom) * t * t * (3 - 2 * t);
        if (t >= 1) this.finishFade();
      }
    };
  }

  get texture(): THREE.Texture | null {
    return this.material.uniforms.uMapA.value;
  }

  setTexture(tex: THREE.Texture | null): void {
    const u = this.material.uniforms;
    u.uMapA.value = tex;
    u.uMapB.value = null;
    u.uMix.value = 0;
    this.fadeDurationMs = 0;
  }

  /** Cross-fade to another map over `durationSec` (0 = immediate). */
  crossFadeTo(tex: THREE.Texture, durationSec = 0.8): void {
    const u = this.material.uniforms;
    if (!u.uMapA.value || durationSec <= 0) {
      this.setTexture(tex);
      return;
    }
    if (this.fadeDurationMs > 0) this.finishFade();
    u.uMapB.value = tex;
    this.fadeFrom = 0;
    this.fadeTo = 1;
    this.fadeStartMs = performance.now();
    this.fadeDurationMs = durationSec * 1000;
  }

  set exposure(v: number) {
    this.material.uniforms.uExposure.value = v;
  }

  private finishFade(): void {
    const u = this.material.uniforms;
    if (u.uMapB.value) u.uMapA.value = u.uMapB.value;
    u.uMapB.value = null;
    u.uMix.value = 0;
    this.fadeDurationMs = 0;
  }

  override dispose(): void {
    this.material.dispose();
  }
}

const VERTEX_SHADER = /* glsl */ `
${VERTEX_PRELUDE}
uniform mat4 uInvProjection;
uniform mat3 uCameraRotation;
varying vec3 vDir;
void main() {
  vec4 view = uInvProjection * vec4(position.xy, -1.0, 1.0);
  vDir = uCameraRotation * (view.xyz / view.w);
  gl_Position = vec4(position.xy, 1.0, 1.0);
  ${LOGDEPTH_VERTEX}
}
`;

const FRAGMENT_SHADER = /* glsl */ `
${FRAGMENT_PRELUDE}
uniform sampler2D uMapA;
uniform sampler2D uMapB;
uniform float uMix;
uniform float uExposure;
uniform float uFlipY;
varying vec3 vDir;

vec4 sampleSky(sampler2D map, vec2 uv, vec2 dx, vec2 dy) {
  return textureGrad(map, uv, dx, dy);
}

void main() {
  vec3 d = normalize(vDir);
  float ra = atan(d.y, d.x);                         // −π..π
  float dec = asin(clamp(d.z, -1.0, 1.0));
  float u = ra * RECIPROCAL_PI2;                      // −0.5..0.5
  vec2 uv = vec2(fract(u), dec * RECIPROCAL_PI + 0.5);
  if (uFlipY < 0.5) uv.y = 1.0 - uv.y;
  // Seam-free gradients: pick whichever of u and fract(u) is continuous at this pixel.
  float du1 = fwidth(fract(u));
  float du2 = fwidth(u);
  vec2 dUVx = vec2(du1 < du2 ? dFdx(fract(u)) : dFdx(u), dFdx(uv.y));
  vec2 dUVy = vec2(du1 < du2 ? dFdy(fract(u)) : dFdy(u), dFdy(uv.y));
  vec3 c = sampleSky(uMapA, uv, dUVx, dUVy).rgb;
  if (uMix > 0.0) c = mix(c, sampleSky(uMapB, uv, dUVx, dUVy).rgb, uMix);
  gl_FragColor = vec4(c * uExposure, 1.0);
  ${LOGDEPTH_FRAGMENT}
  ${LOGDEPTH_FRAGMENT_AT_INFINITY}
}
`;
