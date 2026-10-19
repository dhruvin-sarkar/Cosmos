/**
 * Moon atmospheric / eruptive effects (all in the moon's body-fixed frame, lengths in mean radii):
 *  - PlumeSystem: ballistic particle plumes (Enceladus' tiger-stripe jets, Io's umbrella plumes). Every particle follows
 *    p(t) = vent + v·t − ½ g t² on the GPU (no CPU work per frame), is lit only by the Sun (eclipsed by the moon's own
 *    shadow) and scatters with a forward-peaked phase function, so plumes glow when backlit exactly as in Cassini images.
 *  - DetachedHaze: Titan's thin detached blue haze layer (~500 km up), a Rayleigh-like single-scattering shell visible at the limb.
 * Plume geometry and speeds are physically motivated (observed speeds, vent positions, plume heights) but the particle
 * distribution is illustrative, and the entity fact sheets say so.
 */
import * as THREE from 'three';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import { cameraPositionToLocal, worldDirectionToLocal } from '../../render/util';

const DEG = Math.PI / 180;

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Unit vector for planetographic east-positive longitude / latitude in the body-fixed frame (+z north, +x prime meridian). */
export function lonLatDir(lonDeg: number, latDeg: number): THREE.Vector3 {
  const lo = lonDeg * DEG, la = latDeg * DEG;
  return new THREE.Vector3(Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la));
}

export interface PlumeSource {
  /** Vent position: unit vector in the body frame. */
  dir: THREE.Vector3;
  /** Particles assigned to this vent. */
  count: number;
  /** 'jet': narrow fountain tilted up to tiltDeg off the vertical. 'umbrella': ballistic dome (fixed-speed, spread of elevations). */
  mode: 'jet' | 'umbrella';
  /** Launch speed range (m/s); speed = min + (max−min)·u^speedPow. */
  speed: [number, number];
  speedPow?: number;
  /** Jet: maximum tilt from the vertical (deg). Umbrella: minimum elevation above the horizon (deg). */
  angleDeg: number;
  /** Optional preferred tilt azimuth axis (unit tangent hint, body frame) for jets along a fracture. */
  tiltAxis?: THREE.Vector3;
  /** Relative brightness of this vent. */
  weight?: number;
}

export interface PlumeSpec {
  sources: PlumeSource[];
  seed: number;
  /** Surface gravity (m/s²) and mean radius (m) of the moon. */
  gravityMps2: number;
  radiusM: number;
  /** Linear tint of the scattered light (peak component ~1). */
  tint: [number, number, number];
  /** Radiance scale relative to the solar irradiance (scene units). */
  intensity: number;
  /** Sprite radius in mean radii. */
  sizeLocal: number;
  /** Henyey–Greenstein forward asymmetry (0.8 ice grains, ~0.55 fine gas/dust). */
  forwardG: number;
  /** Isotropic fraction of the phase function. */
  isotropic: number;
  /** Time compression (flow speed-up versus reality so the flow reads on screen). */
  timeScale: number;
}

const PLUME_VERTEX = /* glsl */ `
${VERTEX_PRELUDE}
attribute vec3 aVel;
attribute vec4 aRand;
attribute float aT;
uniform float uTime;
uniform float uGrav;
uniform float uPxK;
uniform float uPixelRatio;
uniform vec3 uSunDir;
uniform vec3 uCamLocal;
uniform vec3 uTint;
uniform float uIntensity;
uniform float uForwardG;
uniform float uIso;
varying vec3 vColor;

float hg(float g, float c) {
  float d = 1.0 + g * g - 2.0 * g * c;
  return (1.0 - g * g) / (12.566370614 * d * sqrt(d));
}

void main() {
  vec3 n = position;
  float t = fract(uTime / aT + aRand.x) * aT;
  vec3 p = n * 1.0004 + aVel * t - 0.5 * uGrav * n * t * t;
  vec3 s = normalize(uSunDir);
  float ds = dot(p, s);
  float lit = ds < 0.0 ? smoothstep(0.98, 1.04, length(p - s * ds)) : 1.0;       // the moon's own shadow
  vec3 rd = normalize(p - uCamLocal);
  float cosT = dot(-s, rd);                                                      // 1 = looking toward the Sun through the plume
  float ph = uIso * 0.0796 + (1.0 - uIso) * (0.8 * hg(uForwardG, cosT) + 0.2 * hg(-0.25, cosT));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float depth = max(-mv.z, 1e-9);
  float px = uPxK * aRand.y / depth;
  float flux = min(px, 1.0);
  float fade = smoothstep(0.0, 0.04, t / aT) * (1.0 - 0.5 * smoothstep(0.6, 1.0, t / aT));
  vColor = uTint * (uIntensity * ph * lit * aRand.z * flux * flux * fade);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(px, 1.0, 400.0) * uPixelRatio;
  ${LOGDEPTH_VERTEX}
}`;

const PLUME_FRAGMENT = /* glsl */ `
${FRAGMENT_PRELUDE}
varying vec3 vColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = exp(-dot(d, d) * 14.0);
  if (a < 0.012) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
  ${LOGDEPTH_FRAGMENT}
}`;

export class PlumeSystem extends THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
  private timeS = 0;
  private readonly timeScale: number;
  private readonly baseIntensity: number;
  readonly sunDirectionWorld = new THREE.Vector3(1, 0, 0);

  constructor(spec: PlumeSpec) {
    const total = spec.sources.reduce((a, s) => a + s.count, 0);
    const pos = new Float32Array(total * 3);
    const vel = new Float32Array(total * 3);
    const rnd = new Float32Array(total * 4);
    const T = new Float32Array(total);
    const rand = mulberry32(spec.seed);
    const gR = spec.gravityMps2 / spec.radiusM;            // R / s²
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), v = new THREE.Vector3(), ref = new THREE.Vector3();
    let k = 0;
    for (const src of spec.sources) {
      const n = src.dir.clone().normalize();
      ref.set(Math.abs(n.z) > 0.9 ? 1 : 0, Math.abs(n.z) > 0.9 ? 0 : 0, Math.abs(n.z) > 0.9 ? 0 : 1);
      e1.crossVectors(n, ref).normalize();
      e2.crossVectors(n, e1).normalize();
      if (src.tiltAxis) {
        const a = src.tiltAxis.clone().sub(n.clone().multiplyScalar(src.tiltAxis.dot(n))).normalize();
        if (a.lengthSq() > 0.5) { e1.copy(a); e2.crossVectors(n, e1).normalize(); }
      }
      for (let i = 0; i < src.count; i++, k++) {
        const sp = (src.speed[0] + (src.speed[1] - src.speed[0]) * Math.pow(rand(), src.speedPow ?? 1)) / spec.radiusM;   // R/s
        if (src.mode === 'jet') {
          const tilt = src.angleDeg * DEG * Math.pow(rand(), 0.7);
          // Fracture-aligned jets lean mostly across the fracture (e1 = hint axis) – bias the azimuth.
          const az = src.tiltAxis ? (rand() < 0.5 ? 0 : Math.PI) + (rand() - 0.5) * 1.2 : rand() * 2 * Math.PI;
          v.copy(n).multiplyScalar(Math.cos(tilt)).addScaledVector(e1, Math.cos(az) * Math.sin(tilt)).addScaledVector(e2, Math.sin(az) * Math.sin(tilt));
        } else {
          const elev = (src.angleDeg + (90 - src.angleDeg) * Math.pow(rand(), 0.8)) * DEG;
          const az = rand() * 2 * Math.PI;
          v.copy(n).multiplyScalar(Math.sin(elev)).addScaledVector(e1, Math.cos(az) * Math.cos(elev)).addScaledVector(e2, Math.sin(az) * Math.cos(elev));
        }
        v.multiplyScalar(sp);
        pos[3 * k] = n.x; pos[3 * k + 1] = n.y; pos[3 * k + 2] = n.z;
        vel[3 * k] = v.x; vel[3 * k + 1] = v.y; vel[3 * k + 2] = v.z;
        const vUp = Math.max(v.dot(n), sp * 0.05);
        T[k] = Math.max((2 * vUp) / gR, 1);
        rnd[4 * k] = rand();
        rnd[4 * k + 1] = 0.55 + 0.9 * rand();
        rnd[4 * k + 2] = (src.weight ?? 1) * (0.5 + rand());
        rnd[4 * k + 3] = rand();
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aVel', new THREE.BufferAttribute(vel, 3));
    geo.setAttribute('aRand', new THREE.BufferAttribute(rnd, 4));
    geo.setAttribute('aT', new THREE.BufferAttribute(T, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 12);
    const mat = new THREE.ShaderMaterial({
      vertexShader: PLUME_VERTEX,
      fragmentShader: PLUME_FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uGrav: { value: gR },
        uPxK: { value: 1 },
        uPixelRatio: { value: 1 },
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uCamLocal: { value: new THREE.Vector3(0, 0, 10) },
        uTint: { value: new THREE.Vector3(...spec.tint) },
        uIntensity: { value: 0 },
        uForwardG: { value: spec.forwardG },
        uIso: { value: spec.isotropic },
      },
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    super(geo, mat);
    this.name = 'plume';
    this.frustumCulled = false;
    this.renderOrder = 5;
    this.timeScale = spec.timeScale;
    this.baseIntensity = spec.intensity;
    this.userData.sizeLocal = spec.sizeLocal;
    this.onBeforeRender = (_r, _s, camera) => {
      const u = this.material.uniforms;
      worldDirectionToLocal(this, this.sunDirectionWorld, u.uSunDir.value);
      cameraPositionToLocal(this, camera, u.uCamLocal.value);
    };
  }

  /** Per frame: irradiance at the moon (scene units, already × LOD fade), render units per local unit, pixels per radian, pixel ratio. */
  step(dtRealSec: number, irradiance: number, localToRender: number, pixelsPerRadian: number, pixelRatio: number): void {
    this.timeS += dtRealSec * this.timeScale;
    const u = this.material.uniforms;
    u.uTime.value = this.timeS;
    u.uIntensity.value = irradiance * this.baseIntensity;
    u.uPxK.value = (this.userData.sizeLocal as number) * 2 * localToRender * pixelsPerRadian;
    u.uPixelRatio.value = pixelRatio;
  }

  override dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** Enceladus: ~100 jets along the four "tiger stripe" fractures near the south pole (Porco et al. 2014; Spitale et al. 2015). */
export function enceladusPlumeSpec(radiusM: number, gravityMps2: number): PlumeSpec {
  const sources: PlumeSource[] = [];
  const rand = mulberry32(2014);
  // Four sub-parallel fractures (Damascus, Baghdad, Cairo, Alexandria) ~35 km apart, ~130 km long, centred on the pole.
  const R = radiusM / 1000;
  const offsets = [-52, -17, 18, 52];
  const axisAlong = new THREE.Vector3(Math.cos(35 * DEG), Math.sin(35 * DEG), 0);
  const across = new THREE.Vector3(-Math.sin(35 * DEG), Math.cos(35 * DEG), 0);
  for (let s = 0; s < 4; s++) {
    for (let j = 0; j < 26; j++) {
      const along = (rand() - 0.5) * 130;
      const bow = 6 * Math.cos((along / 130) * Math.PI);                       // fractures bow slightly
      const x = axisAlong.clone().multiplyScalar(along).addScaledVector(across, offsets[s] + bow + (rand() - 0.5) * 3);
      const dir = new THREE.Vector3(x.x / R, x.y / R, -1).normalize();         // south pole region (−z)
      sources.push({
        dir, count: 380, mode: 'jet', speed: [60, 400], speedPow: 2.4, angleDeg: 10, tiltAxis: across, weight: 0.6 + 0.8 * rand(),
      });
    }
  }
  return {
    sources, seed: 11, gravityMps2, radiusM, tint: [0.92, 0.97, 1.0], intensity: 0.0095, sizeLocal: 0.026,
    forwardG: 0.82, isotropic: 0.04, timeScale: 70,
  };
}

/** Io: Pele, Prometheus, Loki and Tvashtar at their catalogued positions (west longitudes → east-positive). */
export function ioPlumeSpec(radiusM: number, gravityMps2: number): PlumeSpec {
  const vents: { lon: number; lat: number; v: number; count: number; w: number }[] = [
    { lon: -255.3, lat: -18.7, v: 1050, count: 14000, w: 1.0 },   // Pele, ~300 km umbrella
    { lon: -153, lat: -1.5, v: 520, count: 7000, w: 0.8 },       // Prometheus, ~75 km
    { lon: -309, lat: 13, v: 780, count: 6000, w: 0.6 },         // Loki Patera region
    { lon: -122, lat: 63, v: 1000, count: 12000, w: 0.9 },        // Tvashtar, ~330 km (New Horizons 2007)
  ];
  const sources: PlumeSource[] = vents.map((v) => ({
    dir: lonLatDir(v.lon, v.lat), count: v.count, mode: 'umbrella', speed: [v.v * 0.92, v.v], angleDeg: 18, weight: v.w,
  }));
  return {
    sources, seed: 5, gravityMps2, radiusM, tint: [0.62, 0.78, 1.0], intensity: 0.01, sizeLocal: 0.013,
    forwardG: 0.5, isotropic: 0.25, timeScale: 18,
  };
}

// ── Titan's detached haze ─────────────────────────────────────────────────────────────────────────────────────────

const HAZE_VERTEX = /* glsl */ `
${VERTEX_PRELUDE}
varying vec3 vLocal;
void main() {
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  ${LOGDEPTH_VERTEX}
}`;

const HAZE_FRAGMENT = /* glsl */ `
${FRAGMENT_PRELUDE}
uniform vec3 uSunDir;
uniform vec3 uCameraLocal;
uniform float uSunIntensity;
uniform float uRIn;
uniform float uROut;
uniform float uTau;
varying vec3 vLocal;

vec2 raySphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float h = b * b - c;
  if (h < 0.0) return vec2(1.0, -1.0);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}
float chord(vec3 ro, vec3 rd, float r, float tMax) {
  vec2 t = raySphere(ro, rd, r);
  float t0 = max(t.x, 0.0), t1 = min(t.y, tMax);
  return t.x > t.y ? 0.0 : max(t1 - t0, 0.0);
}
float hg(float g, float c) {
  float d = 1.0 + g * g - 2.0 * g * c;
  return (1.0 - g * g) / (12.566370614 * d * sqrt(d));
}

void main() {
  vec3 ro = uCameraLocal;
  vec3 rd = normalize(vLocal - ro);
  vec2 tb = raySphere(ro, rd, 1.0);
  float tMax = (tb.x <= tb.y && tb.y > 0.0) ? max(tb.x, 0.0) : 1e9;           // the body hides what is behind it
  float path = chord(ro, rd, uROut, tMax) - chord(ro, rd, uRIn, tMax);
  if (path <= 0.0) discard;
  // sample the shell for sunlight: skip the shadowed part (shadow cylinder of the body, lit side fully lit)
  vec2 to = raySphere(ro, rd, uROut);
  float t0 = max(to.x, 0.0);
  float tEnd = min(to.y, tMax);
  float lit = 0.0;
  for (int i = 0; i < 6; i++) {
    float tt = mix(t0, tEnd, (float(i) + 0.5) / 6.0);
    vec3 p = ro + rd * tt;
    float ds = dot(p, uSunDir);
    float rc = length(p - uSunDir * ds);
    float inner = length(p) < uRIn ? 0.0 : 1.0;
    lit += (ds > 0.0 ? 1.0 : smoothstep(0.96, 1.06, rc)) * inner;
  }
  lit /= 6.0;
  float cosT = dot(-uSunDir, rd);
  float phase = 0.55 * (3.0 / (16.0 * 3.14159265) * (1.0 + cosT * cosT)) + 0.45 * hg(0.45, cosT);
  float tau = uTau * path * 2.0;
  float a = 1.0 - exp(-tau);
  vec3 col = vec3(0.30, 0.50, 1.0) * (uSunIntensity * phase * lit * 2.2 * a);
  gl_FragColor = vec4(col, a * 0.25);
  ${LOGDEPTH_FRAGMENT}
}`;

export class DetachedHaze extends THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  readonly sunDirectionWorld = new THREE.Vector3(1, 0, 0);

  /** rIn / rOut: shell radii in mean radii (Titan: ~500 km altitude ≈ 1.19 R, ~25 km thick). */
  constructor(rIn: number, rOut: number, tau = 1.0) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: HAZE_VERTEX,
      fragmentShader: HAZE_FRAGMENT,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uCameraLocal: { value: new THREE.Vector3(0, 0, 10) },
        uSunIntensity: { value: 5 },
        uRIn: { value: rIn },
        uROut: { value: rOut },
        uTau: { value: tau },
      },
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
    super(new THREE.SphereGeometry(rOut * 1.002, 96, 48), mat);
    this.name = 'titan:detached-haze';
    this.frustumCulled = false;
    this.onBeforeRender = (_r, _s, camera) => {
      const u = this.material.uniforms;
      worldDirectionToLocal(this, this.sunDirectionWorld, u.uSunDir.value);
      cameraPositionToLocal(this, camera, u.uCameraLocal.value);
      this.material.side = u.uCameraLocal.value.length() < rOut * 1.002 ? THREE.BackSide : THREE.FrontSide;
    };
  }

  override dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
