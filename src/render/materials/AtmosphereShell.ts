/**
 * Atmosphere shell: a sphere at the top of the atmosphere that ray-marches single scattering (glsl/atmosphere.ts)
 * along each view ray, stopping at the planet surface. From space the shell's front faces cover the whole disc
 * (haze over the ground, blue limb, red terminator); once the camera enters the atmosphere (low orbit, surface)
 * it switches to back faces so the sky is drawn around the camera. Output is premultiplied: the planet behind is
 * dimmed by the mean view transmittance.
 *
 * Local units are planet radii (geometry radius = top radius in planet radii); set the mesh scale to the planet
 * radius in render units and position it at the planet's render position (ctx.toRender).
 */
import * as THREE from 'three';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../glsl/logdepth';
import { ATMOSPHERE_GLSL, EARTH_ATMOSPHERE, atmosphereUniformValues, type AtmosphereParams } from '../glsl/atmosphere';
import { cameraPositionToLocal, worldDirectionToLocal } from '../util';

export type AtmosphereUniforms = ReturnType<typeof createAtmosphereUniforms>;

/** Uniform objects for ATMOSPHERE_GLSL (share them with a planet surface shader that uses aerial perspective). */
export function createAtmosphereUniforms(params: AtmosphereParams) {
  const v = atmosphereUniformValues(params);
  return {
    uAtmTopRadius: { value: v.topRadius },
    uAtmRayleighX: { value: v.rayleighX },
    uAtmMieX: { value: v.mieX },
    uAtmRayleighH: { value: v.rayleighH },
    uAtmMieH: { value: v.mieH },
    uAtmRayleighBeta: { value: new THREE.Vector3(...v.rayleighBeta) },
    uAtmMieBeta: { value: v.mieBeta },
    uAtmMieExt: { value: v.mieExt },
    uAtmMieG: { value: v.mieG },
  };
}

/** Write new physical parameters into existing uniform objects (no allocation). */
export function setAtmosphereUniforms(u: AtmosphereUniforms, params: AtmosphereParams): void {
  const v = atmosphereUniformValues(params);
  u.uAtmTopRadius.value = v.topRadius;
  u.uAtmRayleighX.value = v.rayleighX;
  u.uAtmMieX.value = v.mieX;
  u.uAtmRayleighH.value = v.rayleighH;
  u.uAtmMieH.value = v.mieH;
  u.uAtmRayleighBeta.value.set(...v.rayleighBeta);
  u.uAtmMieBeta.value = v.mieBeta;
  u.uAtmMieExt.value = v.mieExt;
  u.uAtmMieG.value = v.mieG;
}

export interface AtmosphereShellOptions {
  params?: AtmosphereParams;
  /** Solar irradiance in scene-linear units (same scale as the planet's lighting). */
  sunIntensity?: number;
  /** View-ray samples: 16 (high), 10 (balanced), 6 (performance). */
  steps?: number;
}

export class AtmosphereShellMaterial extends THREE.ShaderMaterial {
  declare uniforms: AtmosphereUniforms & {
    uSunDir: { value: THREE.Vector3 };
    uCameraLocal: { value: THREE.Vector3 };
    uSunIntensity: { value: number };
  };

  constructor(opts: AtmosphereShellOptions = {}) {
    super({
      defines: { ATMOSPHERE_STEPS: String(opts.steps ?? 12) },
      uniforms: {
        ...createAtmosphereUniforms(opts.params ?? EARTH_ATMOSPHERE),
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uCameraLocal: { value: new THREE.Vector3(0, 0, 10) },
        uSunIntensity: { value: opts.sunIntensity ?? 5 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      side: THREE.FrontSide,
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

export class AtmosphereShell extends THREE.Mesh<THREE.SphereGeometry, AtmosphereShellMaterial> {
  /** Unit vector toward the Sun in world/render axes. */
  readonly sunDirectionWorld = new THREE.Vector3(1, 0, 0);

  constructor(opts: AtmosphereShellOptions = {}) {
    const material = new AtmosphereShellMaterial(opts);
    super(new THREE.SphereGeometry(material.uniforms.uAtmTopRadius.value, 128, 64), material);
    this.frustumCulled = false;
    this.onBeforeRender = (_r, _s, camera) => {
      const u = this.material.uniforms;
      worldDirectionToLocal(this, this.sunDirectionWorld, u.uSunDir.value);
      cameraPositionToLocal(this, camera, u.uCameraLocal.value);
      this.material.side = u.uCameraLocal.value.length() < u.uAtmTopRadius.value ? THREE.BackSide : THREE.FrontSide;
    };
  }

  /** Change the atmosphere (rebuilds the geometry only if the top radius changed). */
  setParams(params: AtmosphereParams): void {
    const before = this.material.uniforms.uAtmTopRadius.value;
    setAtmosphereUniforms(this.material.uniforms, params);
    const after = this.material.uniforms.uAtmTopRadius.value;
    if (after !== before) {
      this.geometry.dispose();
      this.geometry = new THREE.SphereGeometry(after, 128, 64);
    }
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
${ATMOSPHERE_GLSL}
uniform vec3 uSunDir;
uniform vec3 uCameraLocal;
uniform float uSunIntensity;
varying vec3 vLocal;

void main() {
  vec3 ro = uCameraLocal;
  vec3 rd = normalize(vLocal - ro);
  vec2 tp = raySphere(ro, rd, 1.0);
  float tMax = (tp.x <= tp.y && tp.y > 0.0) ? max(tp.x, 0.0) : 1e9;
  vec4 s = atmosphereScatter(ro, rd, tMax, uSunDir);
  gl_FragColor = vec4(s.rgb * uSunIntensity, s.a);
  ${LOGDEPTH_FRAGMENT}
}
`;
